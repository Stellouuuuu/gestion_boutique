/**
 * Mise à jour web/téléphone : base locale v4 (lots_photo sans reponse_ia)
 * → migrateDatabase vers v5 → rien perdu, colonne additive seulement.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION } from './schema.ts';
import { migrateDatabase } from './migrate.ts';

const SCHEMA_V4 = `
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
CREATE TABLE IF NOT EXISTS lots_photo (
  id TEXT PRIMARY KEY NOT NULL,
  boutique_id TEXT NOT NULL,
  date_feuille TEXT NOT NULL,
  nb_lignes INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  photo_path TEXT,
  lecture_ia TEXT,
  resultat_valide TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  modifie_le TEXT NOT NULL,
  annule INTEGER NOT NULL DEFAULT 0,
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
  source TEXT NOT NULL DEFAULT 'manuel',
  lot_id TEXT,
  cree_le TEXT NOT NULL,
  modifie_le TEXT NOT NULL,
  a_envoyer INTEGER NOT NULL DEFAULT 0
);
`;

function wrap(db: DatabaseSync) {
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, params: unknown[] = []) => {
      db.prepare(sql).run(...(params as never[]));
    },
    getFirstAsync: async <T,>(sql: string, params: unknown[] = []) => {
      const row = db.prepare(sql).get(...(params as never[]));
      return (row ?? null) as T | null;
    },
    getAllAsync: async <T,>(sql: string, params: unknown[] = []) => {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
  };
}

describe('migrate v4 → v5', () => {
  it('conserve lots_photo a_envoyer et ajoute reponse_ia', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_V4);
    raw
      .prepare(`INSERT INTO settings (key, value) VALUES ('schema_version', '4')`)
      .run();
    raw
      .prepare(
        `INSERT INTO lots_photo (id, boutique_id, date_feuille, nb_lignes, total, cree_le, modifie_le, a_envoyer)
         VALUES ('lot1', 'b1', '2026-09-25', 2, 1000, '2026-09-25T10:00:00Z', '2026-09-25T10:00:00Z', 1)`
      )
      .run();

    await migrateDatabase(wrap(raw) as never);

    const ver = raw.prepare(`SELECT value FROM settings WHERE key = 'schema_version'`).get() as {
      value: string;
    };
    assert.equal(ver.value, String(SCHEMA_VERSION));
    assert.ok(SCHEMA_VERSION >= 5);

    const cols = raw.prepare(`PRAGMA table_info(lots_photo)`).all() as { name: string }[];
    assert.ok(cols.some((c) => c.name === 'reponse_ia'));

    const lot = raw.prepare(`SELECT id, a_envoyer FROM lots_photo WHERE id = 'lot1'`).get() as {
      id: string;
      a_envoyer: number;
    };
    assert.equal(lot.a_envoyer, 1);
  });
});
