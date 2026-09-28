#!/usr/bin/env node
/**
 * Preuves des protections lire-feuille SANS vrai Gemini.
 * Usage : node --env-file=.env.test scripts/prouver-protections-lire-feuille.mjs
 *
 * Prérequis TEST : fonction déployée VERSION=lire-feuille-v2-single-call
 * Secrets : IA_ACTIVE / SIMULATE_GEMINI basculés par ce script via CLI (ou déjà placés).
 */
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { createClient } from '@supabase/supabase-js';
import { loadTestEnv } from './lib/env-test.mjs';
import { telVersIdentifiant } from './lib/tel.mjs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = 'lire-feuille-v2-single-call';
const REF = 'ivqbjgfxbymiizfjhygv';
const EMAIL = telVersIdentifiant('01 99 00 00 01');
const MDP = 'test1234';

function stop(m) {
  console.error('\n✗ ' + m);
  process.exit(1);
}

function sleep(ms) {
  execSync(`sleep ${Math.ceil(ms / 1000)}`, { stdio: 'ignore' });
}

async function retry(label, fn, times = 8) {
  let last = null;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.log(`  ${label} retry ${i + 1}/${times}:`, String(e.message || e).slice(0, 120));
      sleep(3000);
    }
  }
  throw last;
}

function getAccessToken() {
  return execSync(
    `python3 -c "import secretstorage
bus=secretstorage.dbus_init()
for coll in secretstorage.get_all_collections(bus):
  for item in coll.get_all_items():
    a=item.get_attributes()
    if a.get('service')=='Supabase CLI' and a.get('username')=='supabase':
      print(item.get_secret().decode()); raise SystemExit"`,
    { encoding: 'utf8' }
  ).trim();
}

function setSecrets(pairs) {
  const token = getAccessToken();
  const body = JSON.stringify(
    Object.entries(pairs).map(([name, value]) => ({
      name,
      value: value === '' ? '' : String(value),
    }))
  );
  let lastErr = null;
  for (let i = 0; i < 8; i++) {
    try {
      console.log(`  secrets set (${i + 1}) ${Object.keys(pairs).join(',')}`);
      // curl -4 : Node fetch vers api.supabase.com échoue souvent (IPv6) sur cette machine
      execSync(
        `curl -4 -sS --fail --max-time 45 -X POST ` +
          `"https://api.supabase.com/v1/projects/${REF}/secrets" ` +
          `-H ${JSON.stringify('Authorization: Bearer ' + token)} ` +
          `-H "Content-Type: application/json" ` +
          `-d ${JSON.stringify(body)}`,
        { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }
      );
      return;
    } catch (e) {
      lastErr = e;
      console.log('    retry…', String(e.stderr || e.message).slice(0, 140));
      sleep(3000);
    }
  }
  throw lastErr;
}

const { url, anon, service } = loadTestEnv();
const admin = createClient(url, service, { auth: { persistSession: false } });
const client = createClient(url, anon, { auth: { persistSession: false } });

await retry('auth', async () => {
  const { error: signErr } = await client.auth.signInWithPassword({ email: EMAIL, password: MDP });
  if (signErr) throw new Error(signErr.message);
});

const { data: membres } = await admin
  .from('membres')
  .select('boutique_id')
  .eq('user_id', (await client.auth.getUser()).data.user.id)
  .eq('actif', true);
const boutiqueId = membres?.[0]?.boutique_id;
if (!boutiqueId) stop('Boutique test introuvable');

const jour = new Date().toISOString().slice(0, 10);
const fakeB64 = Buffer.alloc(200, 65).toString('base64'); // >= 100 chars

async function lire() {
  return retry('lire-feuille', async () => {
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.access_token) throw new Error('session absente');
    const payload = JSON.stringify({ image_base64: fakeB64, mime: 'image/jpeg' });
    const out = execSync(
      `curl -4 -sS --max-time 60 -X POST ${JSON.stringify(url + '/functions/v1/lire-feuille')} ` +
        `-H ${JSON.stringify('Authorization: Bearer ' + session.access_token)} ` +
        `-H ${JSON.stringify('apikey: ' + anon)} ` +
        `-H "Content-Type: application/json" ` +
        `-d ${JSON.stringify(payload)}`,
      { encoding: 'utf8' }
    );
    try {
      return JSON.parse(out);
    } catch {
      throw new Error('JSON invalide: ' + out.slice(0, 200));
    }
  });
}

async function quotaRow() {
  return retry('quotaRow', async () => {
    const { data, error } = await admin
      .from('quotas_photo')
      .select('nb, nb_appels_ia')
      .eq('boutique_id', boutiqueId)
      .eq('jour', jour)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data || { nb: 0, nb_appels_ia: 0 };
  });
}

async function setQuotaAppels(n) {
  return retry('setQuota', async () => {
    const { error } = await admin.from('quotas_photo').upsert(
      { boutique_id: boutiqueId, jour, nb: 0, nb_appels_ia: n },
      { onConflict: 'boutique_id,jour' }
    );
    if (error) throw new Error(error.message);
  });
}

console.log('Projet TEST', url);
console.log('Boutique', boutiqueId);

// ——— A) IA_ACTIVE=false → 0 appel ———
console.log('\n=== A) IA_ACTIVE=false ===');
setSecrets({ IA_ACTIVE: 'false', SIMULATE_GEMINI: '503' });
await new Promise((r) => setTimeout(r, 8000));
const avantA = await quotaRow();
const resA = await lire();
const apresA = await quotaRow();
console.log('réponse', { ok: resA?.ok, code: resA?.code, version: resA?.version, nb_appels: resA?.nb_appels_ia });
console.log('quota avant/après', avantA, apresA);
if (resA?.version !== VERSION) stop(`VERSION A : ${resA?.version}`);
if (resA?.code !== 'ia_off') stop('Attendu code ia_off');
if ((apresA.nb_appels_ia || 0) !== (avantA.nb_appels_ia || 0)) stop('Quota a bougé alors que IA off');
console.log('✓ A : 0 appel Gemini, quota inchangé');

// ——— B) plafond atteint → 0 appel Gemini ———
console.log('\n=== B) plafond nb_appels_ia déjà ≥ 10 ===');
setSecrets({ IA_ACTIVE: 'true', SIMULATE_GEMINI: '503' });
await new Promise((r) => setTimeout(r, 8000));
await setQuotaAppels(10);
const avantB = await quotaRow();
const resB = await lire();
const apresB = await quotaRow();
console.log('réponse', { ok: resB?.ok, code: resB?.code, version: resB?.version, nb_appels: resB?.nb_appels_ia, raw: resB });
console.log('quota avant/après', avantB, apresB);
if (resB?.code !== 'quota') stop('Attendu code quota, got ' + JSON.stringify(resB));
if ((apresB.nb_appels_ia || 0) !== 10) stop('Plafond ne doit pas incrémenter si déjà plein');
if (Array.isArray(resB?.essais) && resB.essais.length > 0) stop('Aucun essai Gemini attendu');
console.log('✓ B : refus plafond, 0 appel Gemini');

// ——— C) 1 photo → exactement 1 « appel » simulé (503) ———
console.log('\n=== C) SIMULATE_GEMINI=503 → 1 essai puis arrêt ===');
await setQuotaAppels(0);
const avantC = await quotaRow();
const resC = await lire();
const apresC = await quotaRow();
console.log('réponse', {
  ok: resC?.ok,
  code: resC?.code,
  version: resC?.version,
  nb_appels_ia: resC?.nb_appels_ia,
  essais: resC?.essais?.length,
  http: resC?.essais?.[0]?.http,
});
console.log('quota avant/après', avantC, apresC);
if (resC?.version !== VERSION) stop(`VERSION C : ${resC?.version}`);
if (resC?.nb_appels_ia !== 1) stop(`Attendu nb_appels_ia=1, got ${resC?.nb_appels_ia}`);
if (!Array.isArray(resC?.essais) || resC.essais.length !== 1) stop('Attendu exactement 1 essai');
if (resC.essais[0].http !== 503) stop('Attendu HTTP 503 simulé');
if ((apresC.nb_appels_ia || 0) !== 1) stop('Quota jour doit être 1');
console.log('✓ C : exactement 1 appel simulé, arrêt (pas de retry)');

// ——— D) SIMULATE_GEMINI=429 → 1 essai, pas de 2ᵉ ———
console.log('\n=== D) SIMULATE_GEMINI=429 → 1 essai ===');
setSecrets({ IA_ACTIVE: 'true', SIMULATE_GEMINI: '429' });
await new Promise((r) => setTimeout(r, 8000));
await setQuotaAppels(0);
const resD = await lire();
const apresD = await quotaRow();
console.log('réponse', {
  code: resD?.code,
  nb_appels_ia: resD?.nb_appels_ia,
  essais: resD?.essais?.length,
  http: resD?.essais?.[0]?.http,
});
if (resD?.nb_appels_ia !== 1 || resD?.essais?.length !== 1 || resD.essais[0].http !== 429) {
  stop('429 simulé doit faire exactement 1 essai');
}
console.log('✓ D : 429 → 1 essai, stop');

// Remettre IA off + simulation off pour sécurité
console.log('\n=== Remise IA_ACTIVE=false + FORCE_NO_GEMINI (sécurité) ===');
setSecrets({ IA_ACTIVE: 'false', SIMULATE_GEMINI: '', FORCE_NO_GEMINI: 'true' });

console.log('\n✓ Toutes les preuves OK — aucun appel Google.');
