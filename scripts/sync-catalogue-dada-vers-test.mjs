#!/usr/bin/env node
/**
 * Copie la liste d’articles actifs de Chez Dada (PROD, lecture seule)
 * vers la boutique TEST « Boutique test feuilles ».
 * Pas de mouvements. Archivés exclus.
 *
 * Usage : node --env-file=.env.test scripts/sync-catalogue-dada-vers-test.mjs
 * (lit aussi .env.admin pour la PROD en lecture seule)
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadTestEnv } from './lib/env-test.mjs';
import { telVersIdentifiant } from './lib/tel.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOM_DADA = 'Chez Dada';
const TEL_TEST = '01 99 00 00 01';
const BOUTIQUE_TEST = 'Boutique test feuilles';
const EMAIL_TEST = telVersIdentifiant(TEL_TEST);

function stop(msg) {
  console.error('\n✗ ' + msg);
  process.exit(1);
}

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [
          l.slice(0, i).trim(),
          l.slice(i + 1).trim().replace(/^["']|["']$/g, ''),
        ];
      })
  );
}

function normalizeUrl(u) {
  return String(u || '')
    .trim()
    .replace(/\/+$/, '');
}

async function allRows(sb, table, sel, col, val) {
  let out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select(sel)
      .eq(col, val)
      .range(from, from + 999);
    if (error) stop(`Lecture ${table} : ${error.message}`);
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

const { url: testUrl, service: testService } = loadTestEnv();
const prodEnv = {
  ...loadEnvFile(resolve(ROOT, '.env')),
  ...loadEnvFile(resolve(ROOT, '.env.admin')),
};
const prodUrl = normalizeUrl(prodEnv.SUPABASE_URL || prodEnv.EXPO_PUBLIC_SUPABASE_URL);
const prodKey = (prodEnv.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!prodUrl || !prodKey) stop('.env.admin requis pour lire Chez Dada (lecture seule).');
if (prodUrl === testUrl) stop('REFUS : PROD et TEST ont la même URL.');
if (prodUrl.includes('ivqbjgfxbymiizfjhygv')) stop('REFUS : .env.admin pointe vers TEST.');

const prod = createClient(prodUrl, prodKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const test = createClient(testUrl, testService, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log('PROD (lecture) :', prodUrl);
console.log('TEST (écriture) :', testUrl);

const { data: boutiquesProd, error: bpErr } = await prod
  .from('boutiques')
  .select('id, nom')
  .eq('nom', NOM_DADA);
if (bpErr) stop('Lecture boutiques PROD : ' + bpErr.message);
if (!boutiquesProd?.length || boutiquesProd.length > 1) {
  stop('Boutique Chez Dada introuvable / ambiguë en PROD.');
}
const dadaId = boutiquesProd[0].id;

const dadaArts = await allRows(
  prod,
  'articles',
  'nom, categorie, prix_detail, prix_gros, actif',
  'boutique_id',
  dadaId
);
const actifs = dadaArts.filter((a) => a.actif === true);
console.log(`Chez Dada : ${actifs.length} articles actifs (sur ${dadaArts.length})`);

async function trouverUser(mail) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await test.auth.admin.listUsers({ page, perPage: 200 });
    if (error) stop('Lecture comptes TEST : ' + error.message);
    const u = data.users.find((x) => x.email?.toLowerCase() === mail.toLowerCase());
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}

let user = await trouverUser(EMAIL_TEST);
if (!user) {
  const { data, error } = await test.auth.admin.createUser({
    email: EMAIL_TEST,
    password: 'test1234',
    email_confirm: true,
    user_metadata: { nom: 'Test feuilles', tel: TEL_TEST },
  });
  if (error) stop('Création compte TEST : ' + error.message);
  user = data.user;
  console.log('✓ Compte TEST créé');
} else {
  console.log('✓ Compte TEST :', EMAIL_TEST);
}

const { data: membres, error: mErr } = await test
  .from('membres')
  .select('boutique_id')
  .eq('user_id', user.id)
  .eq('actif', true);
if (mErr) stop('Membres TEST : ' + mErr.message);

let boutiqueId = null;
for (const m of membres || []) {
  const { data: b } = await test
    .from('boutiques')
    .select('id, nom')
    .eq('id', m.boutique_id)
    .maybeSingle();
  if (b?.nom === BOUTIQUE_TEST) {
    boutiqueId = b.id;
    break;
  }
}
if (!boutiqueId && membres?.[0]) {
  const { data: b } = await test
    .from('boutiques')
    .select('id, nom')
    .eq('id', membres[0].boutique_id)
    .maybeSingle();
  if (b) boutiqueId = b.id;
}

if (!boutiqueId) {
  const { data, error } = await test
    .from('boutiques')
    .insert({ nom: BOUTIQUE_TEST, code_invitation: 'TESTFL' })
    .select('id')
    .single();
  if (error) stop('Création boutique TEST : ' + error.message);
  boutiqueId = data.id;
  const { error: me } = await test.from('membres').insert({
    boutique_id: boutiqueId,
    user_id: user.id,
    role: 'proprietaire',
    nom: 'Test feuilles',
  });
  if (me) stop('Membre TEST : ' + me.message);
  console.log('✓ Boutique TEST créée');
} else {
  console.log('✓ Boutique TEST :', boutiqueId);
}

// Purge TEST uniquement (mouvements puis articles) — pas la prod
const { error: delM } = await test.from('mouvements').delete().eq('boutique_id', boutiqueId);
if (delM) stop('Purge mouvements TEST : ' + delM.message);
const { error: delA } = await test.from('articles').delete().eq('boutique_id', boutiqueId);
if (delA) stop('Purge articles TEST : ' + delA.message);

const now = new Date().toISOString();
const rows = actifs.map((a) => ({
  id: randomUUID(),
  boutique_id: boutiqueId,
  nom: a.nom,
  categorie: a.categorie,
  prix_detail: a.prix_detail,
  prix_gros: a.prix_gros,
  actif: true,
  cree_le: now,
  modifie_le: now,
}));

for (let i = 0; i < rows.length; i += 100) {
  const chunk = rows.slice(i, i + 100);
  const { error } = await test.from('articles').insert(chunk);
  if (error) stop('Insert TEST : ' + error.message);
}

const { count } = await test
  .from('articles')
  .select('id', { count: 'exact', head: true })
  .eq('boutique_id', boutiqueId)
  .eq('actif', true);

console.log(`✓ ${count} articles actifs copiés vers TEST (attendu ${actifs.length})`);
if (count !== actifs.length) stop('Écart de compte après copie.');
console.log('✓ Sync terminée (sans mouvements).');
