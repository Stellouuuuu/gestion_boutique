/**
 * Test livraison : téléphone en v2 (articles + ventes a_envoyer=1)
 * → migrateDatabase vers v3 → rien perdu, colonnes additives seulement.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION } from './schema.ts';
import { migrateDatabase } from './migrate.ts';

/** Schéma tel qu’il était en v2 (sans lots_photo, sans source/lot_id). */
const SCHEMA_V2 = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY NOT NULL,
  boutique_id TEXT NOT NULL,
  nom TEXT NOT NULL,
  categorie TEXT NOT NULL CHECK (categorie IN ('meches','produits')),
  prix_detail INTEGER,
  prix_gros INTEGER,
  prix_achat INTEGER,
  actif INTEGER NOT NULL DEFAULT 1,
  cree_le TEXT NOT NULL,
  modifie_le TEXT NOT NULL,
  a_envoyer INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mouvements (
  id TEXT PRIMARY KEY NOT NULL,
  boutique_id TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id),
  type TEXT NOT NULL CHECK (type IN ('vente','entree','correction')),
  quantite INTEGER NOT NULL CHECK (quantite <> 0),
  tarif TEXT CHECK (tarif IN ('detail','gros')),
  prix_unitaire INTEGER NOT NULL DEFAULT 0,
  montant_normal INTEGER NOT NULL DEFAULT 0,
  montant_paye INTEGER NOT NULL DEFAULT 0,
  cout_unitaire INTEGER,
  annule INTEGER NOT NULL DEFAULT 0,
  annule_le TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  modifie_le TEXT NOT NULL,
  a_envoyer INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inventaires (
  id TEXT PRIMARY KEY NOT NULL,
  boutique_id TEXT NOT NULL,
  perimetre TEXT NOT NULL CHECK (perimetre IN ('tout','meches','produits')),
  statut TEXT NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours','termine','abandonne')),
  fait_par TEXT,
  commence_le TEXT NOT NULL,
  termine_le TEXT,
  note TEXT,
  modifie_le TEXT NOT NULL,
  a_envoyer INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inventaire_lignes (
  id TEXT PRIMARY KEY NOT NULL,
  inventaire_id TEXT NOT NULL REFERENCES inventaires(id) ON DELETE CASCADE,
  boutique_id TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id),
  stock_attendu INTEGER NOT NULL,
  stock_compte INTEGER NOT NULL CHECK (stock_compte >= 0),
  compte_le TEXT NOT NULL,
  mouvement_id TEXT REFERENCES mouvements(id),
  modifie_le TEXT NOT NULL,
  a_envoyer INTEGER NOT NULL DEFAULT 0,
  UNIQUE (inventaire_id, article_id)
);
CREATE TABLE IF NOT EXISTS synchro (
  table_name TEXT PRIMARY KEY NOT NULL,
  dernier_pull TEXT
);
`;

function adapt(db: DatabaseSync) {
  return {
    async execAsync(sql: string) {
      db.exec(sql);
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []) {
      return (db.prepare(sql).get(...(params as never[])) as T) ?? null;
    },
    async getAllAsync<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    async runAsync(sql: string, params: unknown[] = []) {
      return db.prepare(sql).run(...(params as never[]));
    },
  };
}

describe('migration v2 → v3 additive', () => {
  it('conserve articles, ventes envoyées et ventes a_envoyer=1', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_V2);
    raw.prepare(`INSERT INTO settings (key, value) VALUES ('schema_version', '2')`).run();
    const t = '2026-09-25T10:00:00.000Z';
    raw
      .prepare(
        `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
         VALUES ('a1','b1','Mèche Bella','meches',5000,null,3000,1,?,?,0),
                ('a2','b1','Shampooing','produits',2000,null,1000,1,?,?,1)`
      )
      .run(t, t, t, t);
    raw
      .prepare(
        `INSERT INTO mouvements
           (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
            cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
         VALUES
           ('m-sync','b1','a1','vente',2,'detail',5000,10000,10000,3000,0,'u1',?,?,0),
           ('m-pending','b1','a1','vente',1,'detail',5000,5000,4500,3000,0,'u1',?,?,1),
           ('m-pending2','b1','a2','vente',3,'detail',2000,6000,6000,1000,0,'u1',?,?,1)`
      )
      .run(t, t, t, t, t, t);

    // Vérifie qu’en v2 il n’y a pas encore source / lots_photo
    const colsAvant = raw.prepare(`PRAGMA table_info(mouvements)`).all() as { name: string }[];
    assert.ok(!colsAvant.some((c) => c.name === 'source'));
    assert.ok(!colsAvant.some((c) => c.name === 'lot_id'));

    const db = adapt(raw);
    await migrateDatabase(db as never);

    // Version
    const ver = raw.prepare(`SELECT value FROM settings WHERE key = 'schema_version'`).get() as {
      value: string;
    };
    assert.equal(ver.value, String(SCHEMA_VERSION));
    assert.ok(SCHEMA_VERSION >= 3);

    // Colonnes additives présentes
    const cols = raw.prepare(`PRAGMA table_info(mouvements)`).all() as { name: string }[];
    assert.ok(cols.some((c) => c.name === 'source'));
    assert.ok(cols.some((c) => c.name === 'lot_id'));
    const lotsExists = raw
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='lots_photo'`)
      .get() as { name: string } | undefined;
    assert.equal(lotsExists?.name, 'lots_photo');

    // Aucune ligne perdue
    assert.equal(
      (raw.prepare(`SELECT COUNT(*) as n FROM articles`).get() as { n: number }).n,
      2
    );
    assert.equal(
      (raw.prepare(`SELECT COUNT(*) as n FROM mouvements`).get() as { n: number }).n,
      3
    );
    const pending = raw
      .prepare(`SELECT id, montant_paye, a_envoyer FROM mouvements WHERE a_envoyer = 1 ORDER BY id`)
      .all() as { id: string; montant_paye: number; a_envoyer: number }[];
    assert.equal(pending.length, 2);
    assert.equal(pending[0]!.id, 'm-pending');
    assert.equal(pending[0]!.montant_paye, 4500);
    assert.equal(pending[1]!.id, 'm-pending2');
    assert.equal(pending[1]!.montant_paye, 6000);

    // Article encore a_envoyer=1 intact
    assert.equal(
      (raw.prepare(`SELECT a_envoyer FROM articles WHERE id='a2'`).get() as { a_envoyer: number })
        .a_envoyer,
      1
    );

    // Defaults source
    const src = raw.prepare(`SELECT source FROM mouvements WHERE id='m-pending'`).get() as {
      source: string | null;
    };
    assert.ok(src.source === 'manuel' || src.source == null || src.source === '');
  });
});
