#!/usr/bin/env node
/**
 * Diagnostic / smoke test du site web Cloudflare (Chromium + WebKit).
 * Usage : PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 node scripts/verifier-web-live.mjs [url]
 *
 * Sur certaines machines Linux, WebKit Playwright demande des paquets système
 * (`npx playwright install-deps`). Chromium système (`chromium-browser`) suffit
 * alors pour valider le déploiement.
 */
import { chromium, webkit } from 'playwright';
import { existsSync } from 'node:fs';

const URL = process.argv[2] || 'https://gestion-boutique.pages.dev/';
const DEMO_MDP = 'demo1234';

async function probe(browserType, name, launchOpts = {}) {
  const browser = await browserType.launch({ headless: true, ...launchOpts });
  const page = await browser.newPage();
  const consoleMsgs = [];
  const failed = [];

  page.on('console', (msg) => {
    consoleMsgs.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    consoleMsgs.push({ type: 'pageerror', text: String(err) });
  });
  page.on('response', (res) => {
    const status = res.status();
    const ct = res.headers()['content-type'] || '';
    const u = res.url();
    if (status >= 400) failed.push({ u, status, ct, why: 'http' });
    else if (u.includes('.wasm') && ct.includes('text/html')) {
      failed.push({ u, status, ct, why: 'wasm-html-fallback' });
    } else if (u.includes('assets/node_modules/')) {
      failed.push({ u, status, ct, why: 'old-node_modules-path' });
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForTimeout(3000);

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const hasConnexion = /Connectez-vous pour continuer|Numéro de téléphone|Se connecter/i.test(
    bodyText
  );
  const isBlank = bodyText.trim().length < 8;
  const hasErrorScreen = /erreur est survenue|rechargez/i.test(bodyText);

  let loginOk = false;
  let afterLogin = '';
  if (hasConnexion) {
    try {
      await page.locator('input').nth(0).fill('22900000009');
      await page.locator('input[type="password"]').fill(DEMO_MDP);
      await page.getByText('Se connecter', { exact: true }).click();
      await page.waitForTimeout(10000);
      afterLogin = await page.locator('body').innerText();
      loginOk =
        !/numéro ou mot de passe incorrect/i.test(afterLogin) &&
        (/Bienvenue|Choisissez un code|stock|vendre|aujourd|mèches|produits/i.test(afterLogin) ||
          !/Connectez-vous pour continuer/i.test(afterLogin));
    } catch (e) {
      consoleMsgs.push({ type: 'login-error', text: String(e) });
    }
  }

  await browser.close();

  const fatal = consoleMsgs.filter(
    (m) =>
      m.type === 'pageerror' ||
      /Aborted|CompileError|wasm validation|unsupported MIME|COEP|Failed to fetch/i.test(m.text)
  );

  return {
    name,
    isBlank,
    hasConnexion,
    hasErrorScreen,
    loginOk,
    afterLogin: afterLogin.slice(0, 120),
    fatal,
    failed: failed.slice(0, 30),
  };
}

function print(r) {
  console.log(`\n=== ${r.name} ===`);
  if (r.skipped) {
    console.log(`SKIPPED — ${r.reason}`);
    return;
  }
  console.log(
    `blank=${r.isBlank} connexion=${r.hasConnexion} errorScreen=${r.hasErrorScreen} loginOk=${r.loginOk}`
  );
  if (r.afterLogin) console.log(`après login: ${r.afterLogin.replace(/\n/g, ' | ')}`);
  if (r.failed?.length) {
    console.log('requêtes suspectes:');
    for (const f of r.failed) console.log(`  [${f.why}] ${f.status} ${f.ct} ${f.u}`);
  }
  if (r.fatal?.length) {
    console.log('erreurs console:');
    for (const m of r.fatal.slice(0, 10)) console.log(`  (${m.type}) ${m.text.slice(0, 200)}`);
  }
}

const results = [];
const chromePath = existsSync('/usr/bin/chromium-browser')
  ? '/usr/bin/chromium-browser'
  : existsSync('/usr/bin/chromium')
    ? '/usr/bin/chromium'
    : undefined;

results.push(
  await probe(chromium, 'chromium', {
    ...(chromePath ? { executablePath: chromePath } : {}),
    args: ['--no-sandbox'],
  })
);

try {
  results.push(await probe(webkit, 'webkit'));
} catch (e) {
  results.push({
    name: 'webkit',
    skipped: true,
    reason: `lancement impossible (${String(e.message).split('\n')[0]}). Installez les deps : npx playwright install-deps`,
  });
}

for (const r of results) print(r);

const chromiumOk = results.some(
  (r) =>
    r.name === 'chromium' &&
    !r.isBlank &&
    r.hasConnexion &&
    r.loginOk &&
    !(r.failed || []).some((f) => f.why === 'wasm-html-fallback')
);
const webkitResult = results.find((r) => r.name === 'webkit');
const webkitOk =
  webkitResult &&
  !webkitResult.skipped &&
  !webkitResult.isBlank &&
  webkitResult.hasConnexion &&
  webkitResult.loginOk;

console.log(
  `\nRésumé: chromium=${chromiumOk ? 'OK' : 'FAIL'} webkit=${webkitResult?.skipped ? 'SKIPPED' : webkitOk ? 'OK' : 'FAIL'}`
);
process.exit(chromiumOk ? 0 : 1);
