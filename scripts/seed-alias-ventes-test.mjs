#!/usr/bin/env node
/**
 * Remplit alias_articles sur TEST à partir des ventes validées par Maman.
 * Usage : node --env-file=.env.test scripts/seed-alias-ventes-test.mjs
 * Aucun appel Gemini.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadTestEnv } from './lib/env-test.mjs';
import { normaliserTexteAlias, normaliserNom } from './lib/rapprochementFeuille.mjs';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOUTIQUE = 'db88ec62-fe85-4548-8e8e-920c4f99db70';

const { url, service } = loadTestEnv();
const admin = createClient(url, service, { auth: { persistSession: false } });

const { data: arts, error: aErr } = await admin
  .from('articles')
  .select('id, nom, actif')
  .eq('boutique_id', BOUTIQUE);
if (aErr) {
  console.error(aErr.message);
  process.exit(1);
}
const byNom = new Map();
for (const a of arts || []) {
  const k = normaliserNom(a.nom);
  if (!k) continue;
  const prev = byNom.get(k);
  if (!prev || (a.actif && !prev.actif)) byNom.set(k, a);
}

function trouverArticle(nomApp) {
  if (!nomApp || !String(nomApp).trim()) return null;
  const k = normaliserNom(nomApp);
  return byNom.get(k) || null;
}

/** Map texte_norm → Set<article_id> */
const candidats = new Map();

function ajouter(ecrit, articleNom) {
  const art = trouverArticle(articleNom);
  if (!art) {
    return { skip: 'article_introuvable', ecrit, articleNom };
  }
  const cle = normaliserTexteAlias(ecrit);
  if (!cle) return { skip: 'texte_vide', ecrit };
  if (!candidats.has(cle)) candidats.set(cle, new Map());
  const m = candidats.get(cle);
  m.set(art.id, { id: art.id, nom: art.nom, ecrit });
  return { ok: true, cle, art };
}

const skips = [];
const rowsMeches = XLSX.utils.sheet_to_json(
  XLSX.readFile(resolve(ROOT, 'docs/ventes-23-au-26-09.xlsx')).Sheets['Ventes'],
  { defval: '' }
);
for (const r of rowsMeches) {
  const res = ajouter(r['Écrit sur la feuille'], r["Article dans l'app"]);
  if (res.skip) skips.push(res);
}

const rowsProd = XLSX.utils.sheet_to_json(
  XLSX.readFile(resolve(ROOT, 'docs/ventes-produits-22-au-26-09.xlsx')).Sheets[
    'Ventes produits'
  ],
  { defval: '' }
);
for (const r of rowsProd) {
  const confirme = String(r['Article CONFIRMÉ (à remplir si orange)'] || '').trim();
  const propose = String(r["Article dans l'app (proposé)"] || '').trim();
  const res = ajouter(r['Écrit sur le cahier'], confirme || propose);
  if (res.skip) skips.push(res);
}

const ambigus = [];
const aCreer = [];
for (const [cle, map] of candidats) {
  const artsUniques = [...map.values()];
  if (artsUniques.length > 1) {
    ambigus.push({
      texte_norm: cle,
      articles: artsUniques.map((a) => ({ id: a.id, nom: a.nom, exemple_ecrit: a.ecrit })),
    });
    continue;
  }
  const a = artsUniques[0];
  aCreer.push({ boutique_id: BOUTIQUE, texte_norm: cle, article_id: a.id, nom: a.nom });
}

console.log(`Candidats uniques : ${aCreer.length}`);
console.log(`Ambigus (non créés) : ${ambigus.length}`);
console.log(`Skips (article introuvable / vide) : ${skips.filter((s) => s.skip === 'article_introuvable').length}`);

const now = new Date().toISOString();
const payload = aCreer.map(({ boutique_id, texte_norm, article_id }) => ({
  boutique_id,
  texte_norm,
  article_id,
  cree_le: now,
  modifie_le: now,
}));

// upsert par lots
const BATCH = 80;
let ok = 0;
for (let i = 0; i < payload.length; i += BATCH) {
  const chunk = payload.slice(i, i + BATCH);
  for (let t = 0; t < 6; t++) {
    const { error } = await admin.from('alias_articles').upsert(chunk, {
      onConflict: 'boutique_id,texte_norm',
    });
    if (!error) {
      ok += chunk.length;
      break;
    }
    console.log('upsert retry', t + 1, error.message);
    await new Promise((r) => setTimeout(r, 2000));
    if (t === 5) {
      console.error('Échec upsert');
      process.exit(1);
    }
  }
}

const rapport = {
  boutique_id: BOUTIQUE,
  crees: aCreer.map((a) => ({ texte_norm: a.texte_norm, article: a.nom })),
  ambigus,
  skips_article_introuvable: skips
    .filter((s) => s.skip === 'article_introuvable')
    .slice(0, 40)
    .map((s) => ({ ecrit: s.ecrit, articleNom: s.articleNom })),
  nb_upsert: ok,
};
writeFileSync(
  resolve(ROOT, 'docs/exemples-feuilles/alias-seed-rapport.json'),
  JSON.stringify(rapport, null, 2)
);
console.log(`✓ ${ok} alias upsertés. Rapport → docs/exemples-feuilles/alias-seed-rapport.json`);
if (ambigus.length) {
  console.log('\nAmbigus (même texte → plusieurs articles) :');
  for (const a of ambigus) {
    console.log(
      `  « ${a.texte_norm} » → ${a.articles.map((x) => x.nom).join(' | ')}`
    );
  }
}
