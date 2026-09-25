#!/usr/bin/env node
/**
 * Vérifie cohérence stats ↔ bilans sur Boutique démo + perf 50k mouvements.
 * Usage : node scripts/verifier-stats.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import { loadTestEnv } from './lib/env-test.mjs';
import { telVersIdentifiant } from './lib/tel.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');


const { url, anon, service } = loadTestEnv();

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const schemaSrc = readFileSync(resolve(ROOT, 'src/db/schema.ts'), 'utf8');
const m = schemaSrc.match(/export const SCHEMA_SQL = `([\s\S]*?)`;/);
if (!m) {
  console.error('SCHEMA_SQL introuvable');
  process.exit(1);
}
const schemaSql = m[1];

function adapt(raw) {
  return {
    async getAllAsync(sql, params = []) {
      return raw.prepare(sql).all(...params);
    },
    async getFirstAsync(sql, params = []) {
      return raw.prepare(sql).get(...params) ?? null;
    },
  };
}

const { calculerStats, chronometrerStats } = await import(
  pathToFileURL(resolve(ROOT, 'src/db/stats.ts')).href
);
const { calculerBilan } = await import(pathToFileURL(resolve(ROOT, 'src/db/bilans.ts')).href);
const { periodeAujourdhui } = await import(pathToFileURL(resolve(ROOT, 'src/db/periodes.ts')).href);
const { buildStatsPeriode } = await import(
  pathToFileURL(resolve(ROOT, 'src/db/statsPeriodes.ts')).href
);

// --- Démo live ---
if (!url || !(anon || service)) {
  console.error('Variables Supabase manquantes');
  process.exit(1);
}

const sb = createClient(url, anon || service, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error: authErr } = await sb.auth.signInWithPassword({
  email: telVersIdentifiant('00 00 00 09'),
  password: 'demo1234',
});
if (authErr) {
  console.error('Connexion démo impossible :', authErr.message);
  process.exit(1);
}
const user = (await sb.auth.getUser()).data.user;
const { data: membre } = await sb
  .from('membres')
  .select('boutique_id')
  .eq('user_id', user.id)
  .eq('actif', true)
  .single();
const boutiqueId = membre.boutique_id;
const { data: bout } = await sb.from('boutiques').select('nom').eq('id', boutiqueId).single();
if (bout?.nom !== 'Boutique démo') {
  console.error(`Attendu « Boutique démo », trouvé « ${bout?.nom} »`);
  process.exit(1);
}

const { data: articles } = await sb.from('articles').select('*').eq('boutique_id', boutiqueId);
const { data: mouvements } = await sb.from('mouvements').select('*').eq('boutique_id', boutiqueId);

const raw = new DatabaseSync(':memory:');
raw.exec(schemaSql);
const insA = raw.prepare(
  `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
   VALUES (@id, @boutique_id, @nom, @categorie, @prix_detail, @prix_gros, @prix_achat, @actif, @cree_le, @modifie_le, 0)`
);
for (const a of articles) {
  insA.run({
    id: a.id,
    boutique_id: a.boutique_id,
    nom: a.nom,
    categorie: a.categorie,
    prix_detail: a.prix_detail,
    prix_gros: a.prix_gros,
    prix_achat: a.prix_achat,
    actif: a.actif ? 1 : 0,
    cree_le: a.cree_le,
    modifie_le: a.modifie_le,
  });
}
const insM = raw.prepare(
  `INSERT INTO mouvements
     (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
      cout_unitaire, annule, annule_le, cree_par, cree_le, modifie_le, a_envoyer)
   VALUES (@id, @boutique_id, @article_id, @type, @quantite, @tarif, @prix_unitaire, @montant_normal, @montant_paye,
           @cout_unitaire, @annule, @annule_le, @cree_par, @cree_le, @modifie_le, 0)`
);
for (const mvt of mouvements) {
  insM.run({
    id: mvt.id,
    boutique_id: mvt.boutique_id,
    article_id: mvt.article_id,
    type: mvt.type,
    quantite: mvt.quantite,
    tarif: mvt.tarif,
    prix_unitaire: mvt.prix_unitaire,
    montant_normal: mvt.montant_normal,
    montant_paye: mvt.montant_paye,
    cout_unitaire: mvt.cout_unitaire,
    annule: mvt.annule ? 1 : 0,
    annule_le: mvt.annule_le,
    cree_par: mvt.cree_par,
    cree_le: mvt.cree_le,
    modifie_le: mvt.modifie_le,
  });
}

const db = adapt(raw);
const now = new Date();
const stats = await calculerStats(db, '30j', now);
const per = buildStatsPeriode('30j', now);

// Somme SQL directe = évolution
const row = raw
  .prepare(
    `SELECT SUM(montant_paye) AS s FROM mouvements
     WHERE type = 'vente' AND annule = 0 AND cree_le >= ? AND cree_le < ?`
  )
  .get(per.debutIso, per.finIso);
ok('évolution = SUM ventes période', stats.evolution.total === (row?.s ?? 0), `total=${stats.evolution.total}`);

const bilanMois = await calculerBilan(db, periodeAujourdhui('mois', now));
ok(
  'réductions stats ≥ 0 et phrase présente',
  stats.reductions.total >= 0 && stats.reductions.phrase.length > 5,
  stats.reductions.phrase.slice(0, 60)
);
ok(
  '9 phrases non vides',
  [
    stats.evolution.phrase,
    stats.meilleures.phrase,
    stats.argentDort.phrase,
    stats.meilleursJours.phrase,
    stats.categories.phrase,
    stats.detailGros.phrase,
    stats.reductions.phrase,
    stats.marges.phrase,
  ].every((p) => p.length > 8)
);
ok(
  'détail+gros = argent période (tolérance arrondi)',
  Math.abs(stats.detailGros.detail + stats.detailGros.gros - stats.evolution.total) < 1,
  `d=${stats.detailGros.detail} g=${stats.detailGros.gros} t=${stats.evolution.total}`
);
ok(
  'bilan mois démo a des ventes (référence)',
  bilanMois.argentEncaisse > 0,
  `mois=${bilanMois.argentEncaisse}`
);
ok('top ventes non vide si chiffre > 0', stats.evolution.total === 0 || stats.meilleures.topArgent.length > 0);

// --- Perf 50k ---
const raw2 = new DatabaseSync(':memory:');
raw2.exec(schemaSql);
const t0 = '2025-01-01T00:00:00.000Z';
raw2
  .prepare(
    `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
     VALUES ('a1', 'b1', 'Art', 'meches', 1000, null, 600, 1, ?, ?, 0)`
  )
  .run(t0, t0);
const ins = raw2.prepare(
  `INSERT INTO mouvements
     (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
      cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
   VALUES (?, 'b1', 'a1', 'vente', 1, 'detail', 1000, 1000, 1000, 600, 0, 'u', ?, ?, 0)`
);
raw2.exec('BEGIN');
for (let i = 0; i < 50_000; i++) {
  const day = i % 400;
  const iso = new Date(Date.UTC(2025, 0, 1 + day, 10, 0, 0)).toISOString();
  ins.run(`m${i}`, iso, iso);
}
raw2.exec('COMMIT');
const db2 = adapt(raw2);
const times = await chronometrerStats(db2, '12mois', new Date('2026-02-01T12:00:00.000Z'));
let perfOk = true;
for (const [name, ms] of Object.entries(times)) {
  if (ms >= 2000) {
    perfOk = false;
    ok(`perf ${name}`, false, `${ms.toFixed(0)} ms`);
  }
}
if (perfOk) {
  const detail = Object.entries(times)
    .map(([k, v]) => `${k}=${v.toFixed(0)}ms`)
    .join(' ');
  ok('perf 50k : chaque bloc < 2 s', true, detail);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
