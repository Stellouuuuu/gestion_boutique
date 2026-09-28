/**
 * Détection de lots en double + annulation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.ts';
import {
  annulerLotPhoto,
  enregistrerLotPhoto,
  trouverLotSimilaire,
} from './lotsPhoto.ts';

function adapt(db: DatabaseSync) {
  return {
    async getAllAsync<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []) {
      return (db.prepare(sql).get(...(params as never[])) as T) ?? null;
    },
    async runAsync(sql: string, params: unknown[] = []) {
      return db.prepare(sql).run(...(params as never[]));
    },
    async withTransactionAsync(fn: () => Promise<void>) {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

describe('lots photo', () => {
  it('détecte un lot en double et annuler restaure le stock logique', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    const db = adapt(raw);
    const t = '2026-09-25T12:00:00.000Z';
    raw
      .prepare(`INSERT INTO settings (key, value) VALUES ('boutique_id', 'b1')`)
      .run();
    raw
      .prepare(
        `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
         VALUES ('a1','b1','Mèche', 'meches', 5000, 4000, 3000, 1, ?, ?, 0)`
      )
      .run(t, t);

    const lignes = [{ article_id: 'a1', quantite: 2, tarif: 'detail' as const, montant_paye: 10000 }];
    const lot1 = await enregistrerLotPhoto(db as never, {
      dateFeuille: '2026-09-25',
      lignes,
      lectureIa: { raw: true },
      photoPath: null,
      creePar: 'u1',
      creeLeVentes: t,
    });
    assert.equal(lot1.nb_lignes, 1);
    assert.equal(
      (raw.prepare(`SELECT COUNT(*) as n FROM mouvements WHERE lot_id = ? AND annule = 0`).get(lot1.id) as {
        n: number;
      }).n,
      1
    );

    const double = await trouverLotSimilaire(db as never, 'b1', '2026-09-25', lignes);
    assert.ok(double);
    assert.equal(double!.id, lot1.id);

    await annulerLotPhoto(db as never, lot1.id);
    assert.equal(
      (raw.prepare(`SELECT annule FROM lots_photo WHERE id = ?`).get(lot1.id) as { annule: number })
        .annule,
      1
    );
    assert.equal(
      (raw.prepare(`SELECT COUNT(*) as n FROM mouvements WHERE lot_id = ? AND annule = 0`).get(lot1.id) as {
        n: number;
      }).n,
      0
    );
  });
});
