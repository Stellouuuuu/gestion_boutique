import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.ts';
import type { InventairesDb } from './inventaires.ts';
import {
  abandonnerInventaire,
  commencerInventaire,
  compterArticle,
  getInventaireEnCours,
  listLignesInventaire,
  resumeEcarts,
  validerInventaire,
} from './inventaires.ts';

function adapt(raw: DatabaseSync): InventairesDb {
  return {
    async getAllAsync<T>(sql: string, params: unknown[] = []) {
      return raw.prepare(sql).all(...(params as never[])) as T[];
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []) {
      return (raw.prepare(sql).get(...(params as never[])) as T) ?? null;
    },
    async runAsync(sql: string, params: unknown[] = []) {
      return raw.prepare(sql).run(...(params as never[]));
    },
    async withTransactionAsync(fn: () => Promise<void>) {
      raw.exec('BEGIN');
      try {
        await fn();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as InventairesDb;
}

function seed(raw: DatabaseSync) {
  const now = '2026-09-01T10:00:00.000Z';
  raw.prepare(`INSERT INTO settings (key, value) VALUES ('boutique_id', 'b1')`).run();
  raw.prepare(
    `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
     VALUES ('a1','b1','Bella','meches',5000,null,3000,1,?,?,0)`
  ).run(now, now);
  raw.prepare(
    `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
     VALUES ('a2','b1','Shamp','produits',2000,null,1000,1,?,?,0)`
  ).run(now, now);
  raw.prepare(
    `INSERT INTO mouvements
       (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
        cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
     VALUES ('m0','b1','a1','correction',10,null,0,0,0,3000,0,'u',?,?,0)`
  ).run(now, now);
  raw.prepare(
    `INSERT INTO mouvements
       (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
        cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
     VALUES ('m1','b1','a2','correction',5,null,0,0,0,1000,0,'u',?,?,0)`
  ).run(now, now);
}

describe('inventaires §8', () => {
  it('interrompu puis repris : rien n’est perdu', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    seed(raw);
    const db = adapt(raw);
    const inv = await commencerInventaire(db, 'tout', 'u1');
    await compterArticle(db, inv.id, 'a1', 10);
    // « Fermer l’app » : nouvel accès
    const repris = await getInventaireEnCours(db);
    assert.equal(repris?.id, inv.id);
    const lignes = await listLignesInventaire(db, inv.id);
    assert.equal(lignes.length, 1);
    assert.equal(lignes[0].stock_compte, 10);
  });

  it('une vente pendant l’inventaire ne fausse pas l’écart', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    seed(raw);
    const db = adapt(raw);
    const inv = await commencerInventaire(db, 'tout', 'u1');
    // Vente pendant l’inventaire AVANT de compter a1 : stock passe de 10 → 9
    const t = new Date().toISOString();
    raw.prepare(
      `INSERT INTO mouvements
         (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
          cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
       VALUES ('mv','b1','a1','vente',1,'detail',5000,5000,5000,3000,0,'u',?,?,0)`
    ).run(t, t);
    // On compte 9 (réalité) : attendu figé au moment du comptage = 9 → écart 0
    const ligne = await compterArticle(db, inv.id, 'a1', 9);
    assert.equal(ligne.stock_attendu, 9);
    assert.equal(ligne.stock_compte, 9);
    const resume = await resumeEcarts(db, inv.id);
    assert.equal(resume.nbArticlesEcart, 0);
  });

  it('inventaire abandonné ne touche pas le stock', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    seed(raw);
    const db = adapt(raw);
    const inv = await commencerInventaire(db, 'tout', 'u1');
    await compterArticle(db, inv.id, 'a1', 7); // écart -3
    await abandonnerInventaire(db, inv.id);
    const stock = raw
      .prepare(
        `SELECT COALESCE((
          SELECT SUM(CASE WHEN m.annule=1 THEN 0 WHEN m.type='vente' THEN -m.quantite ELSE m.quantite END)
          FROM mouvements m WHERE m.article_id='a1'
        ),0) AS s`
      )
      .get() as { s: number };
    assert.equal(stock.s, 10); // pas de correction
    const corr = raw
      .prepare(`SELECT COUNT(*) AS n FROM mouvements WHERE type='correction' AND id!='m0' AND id!='m1'`)
      .get() as { n: number };
    assert.equal(corr.n, 0);
  });

  it('à la validation, un seul mouvement correction par écart', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    seed(raw);
    const db = adapt(raw);
    const inv = await commencerInventaire(db, 'tout', 'u1');
    await compterArticle(db, inv.id, 'a1', 8); // -2
    await compterArticle(db, inv.id, 'a2', 5); // 0
    await validerInventaire(db, inv.id, 'u1');
    const corr = raw
      .prepare(
        `SELECT article_id, quantite FROM mouvements WHERE type='correction' AND id NOT IN ('m0','m1')`
      )
      .all() as { article_id: string; quantite: number }[];
    assert.equal(corr.length, 1);
    assert.equal(corr[0].article_id, 'a1');
    assert.equal(corr[0].quantite, -2);
    const stock = raw
      .prepare(
        `SELECT COALESCE((
          SELECT SUM(CASE WHEN m.annule=1 THEN 0 WHEN m.type='vente' THEN -m.quantite ELSE m.quantite END)
          FROM mouvements m WHERE m.article_id='a1'
        ),0) AS s`
      )
      .get() as { s: number };
    assert.equal(stock.s, 8);
    const ligne = (
      await listLignesInventaire(db, inv.id)
    ).find((l) => l.article_id === 'a1');
    assert.ok(ligne?.mouvement_id);
  });
});
