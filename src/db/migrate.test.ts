/**
 * Test livraison : mise à jour du schéma par-dessus une base avec ventes
 * a_envoyer=1 → aucune vente perdue (pas de DROP).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts';
import { migrateDatabase } from './migrate.ts';

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

describe('migration préserve a_envoyer', () => {
  it('aucune vente perdue après migrateDatabase', async () => {
    const raw = new DatabaseSync(':memory:');
    // Ancienne « version » installée avec données + ventes en attente
    raw.exec(SCHEMA_SQL);
    raw
      .prepare(`INSERT INTO settings (key, value) VALUES ('schema_version', '1')`)
      .run();
    const t = '2026-09-25T10:00:00.000Z';
    raw
      .prepare(
        `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
         VALUES ('a1','b1','Mèche','meches',5000,null,3000,1,?,?,0)`
      )
      .run(t, t);
    raw
      .prepare(
        `INSERT INTO mouvements
           (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
            cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
         VALUES ('m-pending','b1','a1','vente',1,'detail',5000,5000,5000,3000,0,'u1',?,?,1)`
      )
      .run(t, t);

    const db = adapt(raw);
    await migrateDatabase(db as never);

    const pending = raw
      .prepare(`SELECT COUNT(*) AS n FROM mouvements WHERE a_envoyer = 1`)
      .get() as { n: number };
    assert.equal(pending.n, 1);
    const row = raw.prepare(`SELECT id, montant_paye FROM mouvements WHERE id = 'm-pending'`).get() as {
      id: string;
      montant_paye: number;
    };
    assert.equal(row.montant_paye, 5000);
    const ver = raw.prepare(`SELECT value FROM settings WHERE key = 'schema_version'`).get() as {
      value: string;
    };
    assert.equal(ver.value, String(SCHEMA_VERSION));
  });
});
