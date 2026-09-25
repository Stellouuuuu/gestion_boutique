import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.ts';
import {
  ajouterCompteRecent,
  listerComptesRecents,
  oublierCompte,
} from './comptesRecents.ts';
import { purgerDonneesBoutiqueLocale } from './purgeBoutique.ts';
import { countPending } from './syncStatus.ts';
import { SETTINGS_KEYS } from './settings.ts';
import type { BilansDb } from './bilans.ts';

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
  } as BilansDb & {
    runAsync: (sql: string, params?: unknown[]) => Promise<unknown>;
    withTransactionAsync: (fn: () => Promise<void>) => Promise<void>;
  };
}

describe('comptes récents', () => {
  it('stocke sans mot de passe et plafonne à 3', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    const db = adapt(raw);

    await ajouterCompteRecent(db as never, {
      userId: 'u1',
      telDigits: '0197000011',
      prenom: 'Awa',
      boutiqueNom: 'Chez Awa',
    });
    await ajouterCompteRecent(db as never, {
      userId: 'u2',
      telDigits: '0197000022',
      prenom: 'Béatrice',
      boutiqueNom: 'Chez Béa',
    });
    await ajouterCompteRecent(db as never, {
      userId: 'u3',
      telDigits: '0197000033',
      prenom: 'Céline',
      boutiqueNom: 'Chez Cé',
    });
    await ajouterCompteRecent(db as never, {
      userId: 'u4',
      telDigits: '0197000044',
      prenom: 'Dina',
      boutiqueNom: 'Chez Di',
    });

    const list = await listerComptesRecents(db as never);
    assert.equal(list.length, 3);
    assert.equal(list[0]!.prenom, 'Dina');
    const dumped = JSON.stringify(list);
    assert.ok(!/password|motDePasse|mdp/i.test(dumped));

    raw
      .prepare(`UPDATE settings SET value = ? WHERE key = ?`)
      .run(
        JSON.stringify([{ ...list[0], password: 'secret', motDePasse: 'x' }, ...list.slice(1)]),
        SETTINGS_KEYS.comptesRecents
      );
    const cleaned = await listerComptesRecents(db as never);
    assert.ok(!('password' in cleaned[0]!));
    assert.ok(!JSON.stringify(cleaned).includes('secret'));

    await oublierCompte(db as never, 'u4');
    assert.equal((await listerComptesRecents(db as never)).length, 2);
  });
});

describe('purge boutique', () => {
  it('efface les données A et laisse B intacte', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    const db = adapt(raw);
    const t = '2026-01-01T00:00:00.000Z';
    for (const bid of ['boutiqueA', 'boutiqueB']) {
      raw
        .prepare(
          `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
           VALUES (?, ?, 'X', 'meches', 1000, null, null, 1, ?, ?, 0)`
        )
        .run(`a-${bid}`, bid, t, t);
      raw
        .prepare(
          `INSERT INTO mouvements
             (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
              cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
           VALUES (?, ?, ?, 'vente', 1, 'detail', 1000, 1000, 1000, null, 0, 'u', ?, ?, 0)`
        )
        .run(`m-${bid}`, bid, `a-${bid}`, t, t);
    }

    await purgerDonneesBoutiqueLocale(db as never, 'boutiqueA');
    assert.equal(
      (raw.prepare('SELECT COUNT(*) as n FROM articles WHERE boutique_id = ?').get('boutiqueA') as {
        n: number;
      }).n,
      0
    );
    assert.equal(
      (raw.prepare('SELECT COUNT(*) as n FROM mouvements WHERE boutique_id = ?').get('boutiqueA') as {
        n: number;
      }).n,
      0
    );
    assert.equal(
      (raw.prepare('SELECT COUNT(*) as n FROM articles WHERE boutique_id = ?').get('boutiqueB') as {
        n: number;
      }).n,
      1
    );
    assert.equal(
      (raw.prepare('SELECT COUNT(*) as n FROM mouvements WHERE boutique_id = ?').get('boutiqueB') as {
        n: number;
      }).n,
      1
    );
  });
});

describe('signOut / pending', () => {
  it('détecte a_envoyer=1 (règle signOut refuse)', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    const db = adapt(raw);
    const t = '2026-01-01T00:00:00.000Z';
    raw
      .prepare(
        `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
         VALUES ('a1', 'b1', 'X', 'meches', 1000, null, null, 1, ?, ?, 0)`
      )
      .run(t, t);
    raw
      .prepare(
        `INSERT INTO mouvements
           (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
            cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
         VALUES ('m1', 'b1', 'a1', 'vente', 1, 'detail', 1000, 1000, 1000, null, 0, 'u', ?, ?, 1)`
      )
      .run(t, t);

    const pending = await countPending(db as never);
    assert.ok(pending.total > 0);
    assert.ok(pending.ventes >= 1);
  });
});
