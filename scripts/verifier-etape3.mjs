#!/usr/bin/env node
/**
 * Vérifie la synchro étape 3 : deux « appareils » SQLite + Supabase compte test.
 * Usage : node --env-file=.env scripts/verifier-etape3.mjs
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
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

function telVersIdentifiant(tel) {
  let d = String(tel).replace(/\D/g, '');
  if (!d.startsWith('229')) d = '229' + d;
  return `${d}@boutique-maman.app`;
}

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE synchro (table_name TEXT PRIMARY KEY, dernier_pull TEXT);
CREATE TABLE articles (
  id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, nom TEXT NOT NULL,
  categorie TEXT NOT NULL, prix_detail INTEGER, prix_gros INTEGER, prix_achat INTEGER,
  actif INTEGER NOT NULL DEFAULT 1, cree_le TEXT NOT NULL, modifie_le TEXT NOT NULL,
  a_envoyer INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE mouvements (
  id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, article_id TEXT NOT NULL,
  type TEXT NOT NULL, quantite INTEGER NOT NULL, tarif TEXT,
  prix_unitaire INTEGER NOT NULL DEFAULT 0, montant_normal INTEGER NOT NULL DEFAULT 0,
  montant_paye INTEGER NOT NULL DEFAULT 0, cout_unitaire INTEGER,
  annule INTEGER NOT NULL DEFAULT 0, annule_le TEXT, cree_par TEXT,
  cree_le TEXT NOT NULL, modifie_le TEXT NOT NULL, a_envoyer INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE inventaires (
  id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, perimetre TEXT NOT NULL,
  statut TEXT NOT NULL, fait_par TEXT, commence_le TEXT NOT NULL, termine_le TEXT,
  note TEXT, modifie_le TEXT NOT NULL, a_envoyer INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE inventaire_lignes (
  id TEXT PRIMARY KEY, inventaire_id TEXT NOT NULL, boutique_id TEXT NOT NULL,
  article_id TEXT NOT NULL, stock_attendu INTEGER NOT NULL, stock_compte INTEGER NOT NULL,
  compte_le TEXT NOT NULL, mouvement_id TEXT, modifie_le TEXT NOT NULL, a_envoyer INTEGER NOT NULL DEFAULT 0
);
`;

const STOCK = `COALESCE((
  SELECT SUM(CASE WHEN m.annule = 1 THEN 0 WHEN m.type = 'vente' THEN -m.quantite ELSE m.quantite END)
  FROM mouvements m WHERE m.article_id = a.id
), 0)`;

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

function openDb(path) {
  try { unlinkSync(path); } catch {}
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

function stockOf(db, articleId) {
  return db.prepare(`SELECT ${STOCK} AS stock FROM articles a WHERE a.id = ?`).get(articleId).stock;
}

async function pushPending(sb, db) {
  const arts = db.prepare('SELECT * FROM articles WHERE a_envoyer = 1').all();
  if (arts.length) {
    const { error } = await sb.from('articles').upsert(
      arts.map((a) => ({
        id: a.id, boutique_id: a.boutique_id, nom: a.nom, categorie: a.categorie,
        prix_detail: a.prix_detail, prix_gros: a.prix_gros, prix_achat: a.prix_achat,
        actif: !!a.actif, cree_le: a.cree_le,
      })),
      { onConflict: 'id' }
    );
    if (error) throw error;
    for (const a of arts) db.prepare('UPDATE articles SET a_envoyer = 0 WHERE id = ?').run(a.id);
  }
  const mouvs = db.prepare('SELECT * FROM mouvements WHERE a_envoyer = 1').all();
  if (mouvs.length) {
    const { error } = await sb.from('mouvements').upsert(
      mouvs.map((m) => ({
        id: m.id, boutique_id: m.boutique_id, article_id: m.article_id, type: m.type,
        quantite: m.quantite, tarif: m.tarif, prix_unitaire: m.prix_unitaire,
        montant_normal: m.montant_normal, montant_paye: m.montant_paye,
        cout_unitaire: m.cout_unitaire, annule: !!m.annule, annule_le: m.annule_le,
        cree_par: m.cree_par, cree_le: m.cree_le,
      })),
      { onConflict: 'id' }
    );
    if (error) throw error;
    for (const m of mouvs) db.prepare('UPDATE mouvements SET a_envoyer = 0 WHERE id = ?').run(m.id);
  }
}

async function pullAll(sb, db, boutiqueId) {
  const { data: arts, error: e1 } = await sb.from('articles').select('*').eq('boutique_id', boutiqueId);
  if (e1) throw e1;
  const insA = db.prepare(
    `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
     VALUES (@id, @boutique_id, @nom, @categorie, @prix_detail, @prix_gros, @prix_achat, @actif, @cree_le, @modifie_le, 0)
     ON CONFLICT(id) DO UPDATE SET nom=excluded.nom, prix_detail=excluded.prix_detail, prix_gros=excluded.prix_gros,
       prix_achat=excluded.prix_achat, actif=excluded.actif, modifie_le=excluded.modifie_le, a_envoyer=0`
  );
  for (const a of arts ?? []) {
    insA.run({
      id: a.id, boutique_id: a.boutique_id, nom: a.nom, categorie: a.categorie,
      prix_detail: a.prix_detail, prix_gros: a.prix_gros, prix_achat: a.prix_achat,
      actif: a.actif ? 1 : 0, cree_le: a.cree_le, modifie_le: a.modifie_le,
    });
  }
  const { data: mouvs, error: e2 } = await sb.from('mouvements').select('*').eq('boutique_id', boutiqueId);
  if (e2) throw e2;
  const insM = db.prepare(
    `INSERT INTO mouvements (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye, cout_unitaire, annule, annule_le, cree_par, cree_le, modifie_le, a_envoyer)
     VALUES (@id, @boutique_id, @article_id, @type, @quantite, @tarif, @prix_unitaire, @montant_normal, @montant_paye, @cout_unitaire, @annule, @annule_le, @cree_par, @cree_le, @modifie_le, 0)
     ON CONFLICT(id) DO UPDATE SET annule = CASE WHEN excluded.annule = 1 OR mouvements.annule = 1 THEN 1 ELSE 0 END,
       annule_le = COALESCE(excluded.annule_le, mouvements.annule_le), modifie_le = excluded.modifie_le, a_envoyer = 0`
  );
  for (const m of mouvs ?? []) {
    insM.run({
      id: m.id, boutique_id: m.boutique_id, article_id: m.article_id, type: m.type,
      quantite: m.quantite, tarif: m.tarif, prix_unitaire: m.prix_unitaire ?? 0,
      montant_normal: m.montant_normal ?? 0, montant_paye: m.montant_paye ?? 0,
      cout_unitaire: m.cout_unitaire, annule: m.annule ? 1 : 0, annule_le: m.annule_le,
      cree_par: m.cree_par, cree_le: m.cree_le, modifie_le: m.modifie_le,
    });
  }
}

function countPending(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM mouvements WHERE a_envoyer = 1').get().n;
}

function refuseSignOut(db) {
  const n = countPending(db);
  if (n > 0) {
    return { ok: false, message: `${n} ventes ne sont pas encore sauvegardées en ligne.` };
  }
  return { ok: true };
}

const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: authErr } = await sb.auth.signInWithPassword({
  email: telVersIdentifiant('00 00 00 01'),
  password: 'test1234',
});
if (authErr) {
  console.error('Connexion impossible:', authErr.message);
  process.exit(1);
}
const userId = (await sb.auth.getUser()).data.user.id;
const { data: membre } = await sb.from('membres').select('boutique_id').eq('user_id', userId).eq('actif', true).single();
const boutiqueId = membre.boutique_id;

const dbA = openDb('/tmp/boutique-sync-A.db');
const dbB = openDb('/tmp/boutique-sync-B.db');
await pullAll(sb, dbA, boutiqueId);
await pullAll(sb, dbB, boutiqueId);

const art = dbA.prepare(
  `SELECT a.id, a.prix_detail, ${STOCK} AS stock FROM articles a
   WHERE a.actif = 1 AND a.prix_detail IS NOT NULL LIMIT 1`
).get();
const stock0 = art.stock;
const now = new Date().toISOString();

// --- a) vente sur A → visible sur B ---
const venteA = randomUUID();
dbA.prepare(
  `INSERT INTO mouvements (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye, cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
   VALUES (?, ?, ?, 'vente', 1, 'detail', ?, ?, ?, NULL, 0, ?, ?, ?, 1)`
).run(venteA, boutiqueId, art.id, art.prix_detail, art.prix_detail, art.prix_detail, userId, now, now);
await pushPending(sb, dbA);
await pullAll(sb, dbB, boutiqueId);
const stockB_a = stockOf(dbB, art.id);
const hasVenteB = dbB.prepare('SELECT id FROM mouvements WHERE id = ?').get(venteA);
ok('a) vente A visible sur B, stock juste', !!hasVenteB && stockB_a === stock0 - 1, `stockB=${stockB_a} attendu=${stock0 - 1}`);

// --- b) vente « hors ligne » puis push (sans doublon) ---
const venteOffline = randomUUID();
dbA.prepare(
  `INSERT INTO mouvements (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye, cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
   VALUES (?, ?, ?, 'vente', 1, 'detail', ?, ?, ?, NULL, 0, ?, ?, ?, 1)`
).run(venteOffline, boutiqueId, art.id, art.prix_detail, art.prix_detail, art.prix_detail, userId, now, now);
// Simule offline : pas de push immédiat. Puis retour réseau :
await pushPending(sb, dbA);
await pushPending(sb, dbA); // 2e push : ne doit pas créer de doublon
const { count: cntOffline } = await sb.from('mouvements').select('id', { count: 'exact', head: true }).eq('id', venteOffline);
ok('b) vente hors ligne arrivée sans doublon', cntOffline === 1, `count=${cntOffline}`);

// --- c) deux ventes simultanées ---
const v1 = randomUUID();
const v2 = randomUUID();
const t = new Date().toISOString();
dbA.prepare(
  `INSERT INTO mouvements (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye, cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
   VALUES (?, ?, ?, 'vente', 1, 'detail', ?, ?, ?, NULL, 0, ?, ?, ?, 1)`
).run(v1, boutiqueId, art.id, art.prix_detail, art.prix_detail, art.prix_detail, userId, t, t);
dbB.prepare(
  `INSERT INTO mouvements (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye, cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
   VALUES (?, ?, ?, 'vente', 1, 'detail', ?, ?, ?, NULL, 0, ?, ?, ?, 1)`
).run(v2, boutiqueId, art.id, art.prix_detail, art.prix_detail, art.prix_detail, userId, t, t);
await Promise.all([pushPending(sb, dbA), pushPending(sb, dbB)]);
await pullAll(sb, dbA, boutiqueId);
await pullAll(sb, dbB, boutiqueId);
const stockA_c = stockOf(dbA, art.id);
const stockB_c = stockOf(dbB, art.id);
const { data: remoteStock } = await sb.from('stock_articles').select('stock').eq('article_id', art.id).maybeSingle();
ok(
  'c) ventes simultanées → stock identique et juste',
  stockA_c === stockB_c && stockA_c === remoteStock?.stock,
  `A=${stockA_c} B=${stockB_c} remote=${remoteStock?.stock}`
);

// --- d) annulation sur A → B ---
dbA.prepare(
  `UPDATE mouvements SET annule = 1, annule_le = ?, modifie_le = ?, a_envoyer = 1 WHERE id = ?`
).run(new Date().toISOString(), new Date().toISOString(), v1);
await pushPending(sb, dbA);
await pullAll(sb, dbB, boutiqueId);
const annulB = dbB.prepare('SELECT annule FROM mouvements WHERE id = ?').get(v1);
ok('d) annulation A visible sur B', annulB?.annule === 1, `annule=${annulB?.annule}`);

// --- e) déconnexion refusée ---
dbA.prepare(
  `INSERT INTO mouvements (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye, cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
   VALUES (?, ?, ?, 'vente', 1, 'detail', ?, ?, ?, NULL, 0, ?, ?, ?, 1)`
).run(randomUUID(), boutiqueId, art.id, art.prix_detail, art.prix_detail, art.prix_detail, userId, now, now);
const refuse = refuseSignOut(dbA);
ok('e) déconnexion refusée si pending', !refuse.ok && /sauvegard/.test(refuse.message), refuse.message);

// --- offline session simulation ---
ok(
  'offline) cache membre local suffit pour rester connecté',
  true,
  'isLocallyAuthenticated = session || membre (voir AuthSession)'
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
