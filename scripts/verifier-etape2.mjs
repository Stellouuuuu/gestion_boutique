#!/usr/bin/env node
/**
 * Vérifie le schéma local v2 (UUID, stock calculé, cout_unitaire, a_envoyer, inventaires)
 * et le téléchargement depuis Supabase pour le compte test.
 *
 * Usage : node --env-file=.env scripts/verifier-etape2.mjs
 * (lit aussi .env.admin si présent pour le service_role ; sinon utilise l'anon + login)
 */
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';

function loadEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}

const env = { ...loadEnv('.env'), ...loadEnv('.env.admin') };
const url = (env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, '');
const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE articles (
  id TEXT PRIMARY KEY NOT NULL, boutique_id TEXT NOT NULL, nom TEXT NOT NULL,
  categorie TEXT NOT NULL CHECK (categorie IN ('meches','produits')),
  prix_detail INTEGER, prix_gros INTEGER, prix_achat INTEGER,
  actif INTEGER NOT NULL DEFAULT 1, cree_le TEXT NOT NULL, modifie_le TEXT NOT NULL,
  a_envoyer INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE mouvements (
  id TEXT PRIMARY KEY NOT NULL, boutique_id TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id),
  type TEXT NOT NULL CHECK (type IN ('vente','entree','correction')),
  quantite INTEGER NOT NULL CHECK (quantite <> 0),
  tarif TEXT CHECK (tarif IN ('detail','gros')),
  prix_unitaire INTEGER NOT NULL DEFAULT 0, montant_normal INTEGER NOT NULL DEFAULT 0,
  montant_paye INTEGER NOT NULL DEFAULT 0, cout_unitaire INTEGER,
  annule INTEGER NOT NULL DEFAULT 0, annule_le TEXT, cree_par TEXT,
  cree_le TEXT NOT NULL, modifie_le TEXT NOT NULL, a_envoyer INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE inventaires (
  id TEXT PRIMARY KEY NOT NULL, boutique_id TEXT NOT NULL,
  perimetre TEXT NOT NULL CHECK (perimetre IN ('tout','meches','produits')),
  statut TEXT NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours','termine','abandonne')),
  fait_par TEXT, commence_le TEXT NOT NULL, termine_le TEXT, note TEXT,
  modifie_le TEXT NOT NULL, a_envoyer INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE inventaire_lignes (
  id TEXT PRIMARY KEY NOT NULL,
  inventaire_id TEXT NOT NULL REFERENCES inventaires(id) ON DELETE CASCADE,
  boutique_id TEXT NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id),
  stock_attendu INTEGER NOT NULL, stock_compte INTEGER NOT NULL CHECK (stock_compte >= 0),
  compte_le TEXT NOT NULL, mouvement_id TEXT REFERENCES mouvements(id),
  modifie_le TEXT NOT NULL, a_envoyer INTEGER NOT NULL DEFAULT 0,
  UNIQUE (inventaire_id, article_id)
);
CREATE INDEX idx_mouvements_cree_le ON mouvements(cree_le);
CREATE INDEX idx_mouvements_article_cree ON mouvements(article_id, cree_le);
`;

const STOCK_SQL = `COALESCE((
  SELECT SUM(CASE WHEN m.annule = 1 THEN 0 WHEN m.type = 'vente' THEN -m.quantite ELSE m.quantite END)
  FROM mouvements m WHERE m.article_id = a.id
), 0)`;

function stockOf(db, articleId) {
  return db.prepare(`SELECT ${STOCK_SQL} AS stock FROM articles a WHERE a.id = ?`).get(articleId).stock;
}

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

// --- a) Connexion compte test + 316 articles ---
const TEL = '00 00 00 01';
const MDP = 'test1234';
function telVersIdentifiant(tel) {
  let d = String(tel).replace(/\D/g, '');
  if (!d.startsWith('229')) d = '229' + d;
  return `${d}@boutique-maman.app`;
}

const sb = createClient(url, anon || service, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: authData, error: authErr } = await sb.auth.signInWithPassword({
  email: telVersIdentifiant(TEL),
  password: MDP,
});
if (authErr) {
  ok('a) connexion compte test', false, authErr.message);
  process.exit(1);
}
const userId = authData.user.id;
const { data: membre, error: mErr } = await sb
  .from('membres')
  .select('boutique_id')
  .eq('user_id', userId)
  .eq('actif', true)
  .maybeSingle();
if (mErr || !membre) {
  ok('a) connexion compte test', false, mErr?.message || 'pas de boutique');
  process.exit(1);
}
const boutiqueId = membre.boutique_id;

const { count: nbArt, error: cErr } = await sb
  .from('articles')
  .select('id', { count: 'exact', head: true })
  .eq('boutique_id', boutiqueId);
ok('a) connexion + 316 articles en ligne', !cErr && nbArt === 316, `count=${nbArt}`);

// Téléchargement dans SQLite local (même logique que remote.ts)
const dbPath = '/tmp/boutique-etape2-test.db';
try { await import('node:fs').then((fs) => fs.unlinkSync(dbPath)); } catch {}
let db = new DatabaseSync(dbPath);
db.exec(SCHEMA_SQL);

const { data: remoteArticles } = await sb
  .from('articles')
  .select('id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le')
  .eq('boutique_id', boutiqueId);
const { data: remoteMouvements } = await sb
  .from('mouvements')
  .select(
    'id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye, cout_unitaire, annule, annule_le, cree_par, cree_le, modifie_le'
  )
  .eq('boutique_id', boutiqueId);

const insA = db.prepare(
  `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
);
for (const a of remoteArticles) {
  insA.run(a.id, boutiqueId, a.nom, a.categorie, a.prix_detail, a.prix_gros, a.prix_achat, a.actif ? 1 : 0, a.cree_le, a.modifie_le);
}
const insM = db.prepare(
  `INSERT INTO mouvements (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye, cout_unitaire, annule, annule_le, cree_par, cree_le, modifie_le, a_envoyer)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
);
for (const m of remoteMouvements ?? []) {
  insM.run(
    m.id, boutiqueId, m.article_id, m.type, m.quantite, m.tarif, m.prix_unitaire, m.montant_normal, m.montant_paye,
    m.cout_unitaire, m.annule ? 1 : 0, m.annule_le, m.cree_par, m.cree_le, m.modifie_le
  );
}
const localCount = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;
ok('a) téléchargement local = 316', localCount === 316, `local=${localCount}`);

// Article avec prix d'achat pour tests b/c
let art = db.prepare(
  `SELECT a.id, a.prix_detail, a.prix_achat, ${STOCK_SQL} AS stock FROM articles a
   WHERE a.prix_achat IS NOT NULL AND a.prix_detail IS NOT NULL AND a.actif = 1 LIMIT 1`
).get();
if (!art) {
  // Aucun prix_achat en ligne : on en pose un localement pour le test c
  art = db.prepare(
    `SELECT a.id, a.prix_detail, a.prix_achat, ${STOCK_SQL} AS stock FROM articles a
     WHERE a.prix_detail IS NOT NULL AND a.actif = 1 LIMIT 1`
  ).get();
  db.prepare('UPDATE articles SET prix_achat = 500 WHERE id = ?').run(art.id);
  art.prix_achat = 500;
}

const stock0 = art.stock;

// --- b) vente, entrée, annulation, correction ---
const now = new Date().toISOString();
const venteId = randomUUID();
db.prepare(
  `INSERT INTO mouvements (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye, cout_unitaire, annule, cree_le, modifie_le, a_envoyer)
   VALUES (?, ?, ?, 'vente', 2, 'detail', ?, ?, ?, ?, 0, ?, ?, 1)`
).run(venteId, boutiqueId, art.id, art.prix_detail, 2 * art.prix_detail, 2 * art.prix_detail, art.prix_achat, now, now);
const afterVente = stockOf(db, art.id);
ok('b) vente −2', afterVente === stock0 - 2, `${stock0} → ${afterVente}`);

const entreeId = randomUUID();
db.prepare(
  `INSERT INTO mouvements (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye, cout_unitaire, annule, cree_le, modifie_le, a_envoyer)
   VALUES (?, ?, ?, 'entree', 5, NULL, 0, 0, 0, ?, 0, ?, ?, 1)`
).run(entreeId, boutiqueId, art.id, art.prix_achat, now, now);
const afterEntree = stockOf(db, art.id);
ok('b) entrée +5', afterEntree === afterVente + 5, `${afterVente} → ${afterEntree}`);

db.prepare(`UPDATE mouvements SET annule = 1, annule_le = ?, modifie_le = ?, a_envoyer = 1 WHERE id = ?`).run(now, now, venteId);
const afterAnnul = stockOf(db, art.id);
ok('b) annulation vente', afterAnnul === afterEntree + 2, `${afterEntree} → ${afterAnnul}`);

const corrId = randomUUID();
const voulu = afterAnnul + 3;
db.prepare(
  `INSERT INTO mouvements (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye, cout_unitaire, annule, cree_le, modifie_le, a_envoyer)
   VALUES (?, ?, ?, 'correction', 3, NULL, 0, 0, 0, NULL, 0, ?, ?, 1)`
).run(corrId, boutiqueId, art.id, now, now);
const afterCorr = stockOf(db, art.id);
ok('b) correction +3', afterCorr === voulu, `${afterAnnul} → ${afterCorr} (voulu ${voulu})`);

// --- c) cout_unitaire rempli sur vente ---
const cout = db.prepare('SELECT cout_unitaire FROM mouvements WHERE id = ?').get(venteId).cout_unitaire;
ok('c) cout_unitaire = prix_achat', cout === art.prix_achat, `cout=${cout} prix_achat=${art.prix_achat}`);

// --- d) fermeture / relance ---
db.close();
db = new DatabaseSync(dbPath);
const afterReopen = stockOf(db, art.id);
const still316 = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;
const tables = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('inventaires','inventaire_lignes') ORDER BY name`
).all().map((r) => r.name);
ok('d) persistance après relance', afterReopen === afterCorr && still316 === 316, `stock=${afterReopen} articles=${still316}`);
ok('d) tables inventaires présentes', tables.join(',') === 'inventaire_lignes,inventaires', tables.join(','));

// Indexes
const idxs = db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all().map((r) => r.name);
ok('index mouvements(cree_le)', idxs.includes('idx_mouvements_cree_le'));
ok('index mouvements(article_id, cree_le)', idxs.includes('idx_mouvements_article_cree'));

db.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
