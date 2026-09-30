#!/usr/bin/env node
/**
 * Smoke test local / déployé : 1 onglet OK, reload OK, 2ᵉ onglet → message autre onglet.
 * Usage :
 *   node scripts/verifier-sqlite-onglets.mjs http://127.0.0.1:4173/
 *   node scripts/verifier-sqlite-onglets.mjs https://gestion-boutique.pages.dev/
 */
import { chromium, firefox } from 'playwright';
import { existsSync } from 'node:fs';

const URL = process.argv[2] || 'https://gestion-boutique.pages.dev/';
const chromePath = existsSync('/usr/bin/chromium-browser')
  ? '/usr/bin/chromium-browser'
  : existsSync('/usr/bin/chromium')
    ? '/usr/bin/chromium'
    : undefined;

async function runBrowser(type, name, launchOpts = {}) {
  const browser = await type.launch({ headless: true, ...launchOpts });
  const context = await browser.newContext();
  const page1 = await context.newPage();
  const errors1 = [];
  page1.on('pageerror', (e) => errors1.push(String(e)));

  await page1.goto(URL, { waitUntil: 'networkidle', timeout: 90_000 });
  await page1.waitForTimeout(4000);
  let t1 = (await page1.locator('body').innerText()).trim();
  const ok1 =
    /Connectez-vous|Numéro de téléphone|Se connecter|Bienvenue/i.test(t1) &&
    !/Déjà ouverte ailleurs|NoModificationAllowed/i.test(t1) &&
    !/Une erreur est survenue/i.test(t1);

  // Reload
  await page1.reload({ waitUntil: 'networkidle', timeout: 90_000 });
  await page1.waitForTimeout(3000);
  t1 = (await page1.locator('body').innerText()).trim();
  const okReload =
    /Connectez-vous|Numéro de téléphone|Se connecter|Bienvenue/i.test(t1) &&
    !/Déjà ouverte ailleurs/i.test(t1);

  // 2ᵉ onglet (même contexte = même origine, partage Web Locks + OPFS)
  const page2 = await context.newPage();
  await page2.goto(URL, { waitUntil: 'networkidle', timeout: 90_000 });
  await page2.waitForTimeout(3000);
  const t2 = (await page2.locator('body').innerText()).trim();
  const otherTab = /Déjà ouverte ailleurs|autre onglet/i.test(t2);

  // page1 toujours OK
  const t1b = (await page1.locator('body').innerText()).trim();
  const page1StillOk = /Connectez-vous|Numéro de téléphone|Se connecter|Bienvenue/i.test(t1b);

  await browser.close();

  const pass = ok1 && okReload && otherTab && page1StillOk;
  console.log(`\n=== ${name} ===`);
  console.log(`onglet1=${ok1} reload=${okReload} onglet2_message=${otherTab} onglet1_stable=${page1StillOk}`);
  if (errors1.length) console.log('pageerrors onglet1:', errors1.slice(0, 5));
  if (!otherTab) console.log('onglet2 texte:', t2.slice(0, 240).replace(/\n/g, ' | '));
  return pass;
}

const results = [];
results.push(
  await runBrowser(chromium, 'chromium', {
    ...(chromePath ? { executablePath: chromePath } : {}),
    args: ['--no-sandbox'],
  })
);

try {
  results.push(await runBrowser(firefox, 'firefox'));
} catch (e) {
  console.warn('firefox skip:', e.message?.split('\n')[0]);
}

const all = results.every(Boolean);
console.log(all ? '\nOK sqlite onglets' : '\nFAIL sqlite onglets');
process.exit(all ? 0 : 1);
