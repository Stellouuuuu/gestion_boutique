import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.ts';
import { fromLocal, buildPeriode } from './periodes.ts';
import { calculerBilan, type BilansDb } from './bilans.ts';
import { calculerStats, chronometrerStats } from './stats.ts';
import { buildStatsPeriode } from './statsPeriodes.ts';
import { formatAxeCourt } from '../lib/format.ts';

function adapt(db: DatabaseSync): BilansDb {
  return {
    async getAllAsync<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []) {
      return (db.prepare(sql).get(...(params as never[])) as T) ?? null;
    },
  } as BilansDb;
}

function openDb(): { raw: DatabaseSync; db: BilansDb } {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_SQL);
  return { raw, db: adapt(raw) };
}

function seed(raw: DatabaseSync) {
  const boutique = 'b1';
  const arts = [
    ['a1', 'Bella', 'meches', 5000, 3000],
    ['a2', 'Shampooing', 'produits', 2000, 1200],
    ['a3', 'Marge faible', 'meches', 1000, 950],
    ['a4', 'Dort', 'produits', 3000, 2000],
  ] as const;
  for (const [id, nom, cat, pd, pa] of arts) {
    raw.prepare(
      `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
       VALUES (?, ?, ?, ?, ?, null, ?, 1, ?, ?, 0)`
    ).run(id, boutique, nom, cat, pd, pa, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  }

  const ins = raw.prepare(
    `INSERT INTO mouvements
       (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
        cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'u1', ?, ?, 0)`
  );

  const t0 = fromLocal(2026, 5, 1, 8).toISOString(); // 1 juin
  ins.run('s0', boutique, 'a1', 'correction', 5, null, 0, 0, 0, 3000, 0, t0, t0);
  ins.run('s1', boutique, 'a2', 'correction', 20, null, 0, 0, 0, 1200, 0, t0, t0);
  ins.run('s2', boutique, 'a3', 'correction', 10, null, 0, 0, 0, 950, 0, t0, t0);
  ins.run('s3', boutique, 'a4', 'correction', 8, null, 0, 0, 0, 2000, 0, t0, t0);

  // Ventes récentes (sept 2026) — samedi fort
  const samedi = fromLocal(2026, 8, 19, 11).toISOString(); // 19 sept 2026 = samedi
  const mardi = fromLocal(2026, 8, 15, 11).toISOString();
  ins.run('v1', boutique, 'a1', 'vente', 3, 'detail', 5000, 15000, 15000, 3000, 0, samedi, samedi);
  ins.run('v2', boutique, 'a2', 'vente', 2, 'gros', 1800, 3600, 3600, 1200, 0, samedi, samedi);
  ins.run('v3', boutique, 'a3', 'vente', 1, 'detail', 1000, 1000, 1000, 950, 0, mardi, mardi);
  ins.run('v4', boutique, 'a1', 'vente', 1, 'detail', 5000, 5000, 4500, 3000, 0, mardi, mardi); // réduction

  // Stock bas Bella après ventes (5-3-1=1) → à racheter
  // a4 jamais vendu → argent qui dort
}

describe('formatAxeCourt', () => {
  it('formate k et M', () => {
    assert.equal(formatAxeCourt(12000), '12 k');
    assert.equal(formatAxeCourt(1_200_000), '1,2 M');
  });
});

describe('stats', () => {
  it('calcule les 9 blocs cohérents avec le bilan', async () => {
    const { raw, db } = openDb();
    seed(raw);
    const now = fromLocal(2026, 8, 25, 12); // 25 sept 2026
    const stats = await calculerStats(db, '30j', now);

    assert.ok(stats.evolution.total > 0);
    assert.ok(stats.evolution.phrase.length > 10);
    assert.ok(stats.aRacheter.some((a) => a.nom === 'Bella'));
    assert.ok(stats.meilleures.topArgent[0]?.nom === 'Bella');
    assert.ok(stats.argentDort.nb >= 1);
    assert.ok(stats.argentDort.articles.some((a) => a.nom === 'Dort'));
    assert.ok(stats.meilleursJours.jours.some((j) => j.moyenne > 0));
    assert.ok(stats.categories.mechesArgent > 0);
    assert.ok(stats.detailGros.gros > 0);
    assert.ok(stats.reductions.total === 500);
    assert.ok(stats.marges.articles.some((a) => a.nom === 'Marge faible'));

    // Total = 15000 + 3600 + 1000 + 4500 (toutes dans la fenêtre 30 j)
    assert.equal(stats.evolution.total, 24100);

    // Cohérence avec le bilan mois septembre (mêmes ventes dans le seed)
    const bilan = await calculerBilan(db, buildPeriode('mois', '2026-09-01'));
    assert.equal(bilan.argentEncaisse, 24100);
    assert.equal(bilan.reductionsTotal, 500);
    assert.equal(bilan.grosMontant, 3600);
  });

  it('reste rapide avec 50 000 mouvements', async () => {
    const { raw, db } = openDb();
    const boutique = 'b1';
    const t0 = '2025-01-01T00:00:00.000Z';
    raw.prepare(
      `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
       VALUES ('a1', ?, 'Art', 'meches', 1000, null, 600, 1, ?, ?, 0)`
    ).run(boutique, t0, t0);

    const ins = raw.prepare(
      `INSERT INTO mouvements
         (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
          cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
       VALUES (?, ?, 'a1', 'vente', 1, 'detail', 1000, 1000, 1000, 600, 0, 'u', ?, ?, 0)`
    );
    raw.exec('BEGIN');
    for (let i = 0; i < 50_000; i++) {
      const day = i % 365;
      const iso = new Date(Date.UTC(2025, 0, 1 + day, 10, 0, 0)).toISOString();
      ins.run(`m${i}`, boutique, iso, iso);
    }
    raw.exec('COMMIT');

    const times = await chronometrerStats(db, '30j', new Date('2026-01-01T12:00:00.000Z'));
    for (const [name, ms] of Object.entries(times)) {
      assert.ok(ms < 2000, `${name} trop lent: ${ms.toFixed(0)} ms`);
    }
  });
});

describe('statsPeriodes', () => {
  it('couvre 30 jours', () => {
    const p = buildStatsPeriode('30j', fromLocal(2026, 8, 25, 12));
    assert.equal(p.nbJours, 30);
    assert.ok(p.debutIso < p.finIso);
  });
});
