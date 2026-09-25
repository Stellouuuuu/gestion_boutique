import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.ts';
import {
  buildPeriode,
  fromLocal,
  partsLocal,
  periodeAujourdhui,
  shiftPeriode,
} from './periodes.ts';
import {
  calculerBilan,
  listStockFinPeriode,
  type BilansDb,
} from './bilans.ts';

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

function seedMinimal(raw: DatabaseSync) {
  const boutique = 'b1';
  const a1 = 'art-meche';
  const a2 = 'art-prod';
  const a3 = 'art-sans-cout';
  raw.prepare(
    `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)`
  ).run(a1, boutique, 'Bella', 'meches', 5000, 4000, 3000, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  raw.prepare(
    `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)`
  ).run(a2, boutique, 'Shampooing', 'produits', 2000, null, 1200, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  raw.prepare(
    `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)`
  ).run(a3, boutique, 'Sans coût', 'meches', 1000, null, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

  const ins = raw.prepare(
    `INSERT INTO mouvements
       (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
        cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'u1', ?, ?, 0)`
  );

  // Stock départ : 10 Bella, 10 shampoo, 5 sans coût — 1er jan (UTC+1 = 2025-12-31 23:00Z)
  const tStock = fromLocal(2026, 0, 1, 8).toISOString();
  ins.run('m0', boutique, a1, 'correction', 10, null, 0, 0, 0, 3000, 0, tStock, tStock);
  ins.run('m1', boutique, a2, 'correction', 10, null, 0, 0, 0, 1200, 0, tStock, tStock);
  ins.run('m2', boutique, a3, 'correction', 5, null, 0, 0, 0, null, 0, tStock, tStock);

  // Vente 23h30 locale le 15 jan 2026 → doit compter pour le 15
  const t2330 = fromLocal(2026, 0, 15, 23, 30).toISOString();
  ins.run('m3', boutique, a1, 'vente', 1, 'detail', 5000, 5000, 5000, 3000, 0, t2330, t2330);

  // Vente normale 16 jan
  const t16 = fromLocal(2026, 0, 16, 10).toISOString();
  ins.run('m4', boutique, a2, 'vente', 2, 'detail', 2000, 4000, 3500, 1200, 0, t16, t16); // réduction 500

  // Vente sans cout
  const t16b = fromLocal(2026, 0, 16, 11).toISOString();
  ins.run('m5', boutique, a3, 'vente', 1, 'detail', 1000, 1000, 1000, null, 0, t16b, t16b);

  // Vente annulée (ne compte nulle part)
  const t17 = fromLocal(2026, 0, 17, 12).toISOString();
  ins.run('m6', boutique, a1, 'vente', 1, 'detail', 5000, 5000, 5000, 3000, 1, t17, t17);

  // Entrée
  const t18 = fromLocal(2026, 0, 18, 9).toISOString();
  ins.run('m7', boutique, a1, 'entree', 5, null, 5000, 25000, 0, 3000, 0, t18, t18);

  // Vente février (autre mois)
  const tFev = fromLocal(2026, 1, 5, 14).toISOString();
  ins.run('m8', boutique, a1, 'vente', 1, 'gros', 4000, 4000, 4000, 3000, 0, tFev, tFev);

  return { a1, a2, a3, boutique };
}

describe('periodes Porto-Novo UTC+1', () => {
  it('place 23 h 30 locale dans le bon jour UTC', () => {
    const d = fromLocal(2026, 0, 15, 23, 30);
    const p = partsLocal(d);
    assert.equal(p.day, 15);
    assert.equal(p.h, 23);
    assert.equal(p.min, 30);
    // En UTC c’est le 15 à 22:30
    assert.equal(d.toISOString(), '2026-01-15T22:30:00.000Z');
  });

  it('semaine lundi–dimanche', () => {
    // 15 jan 2026 = jeudi
    const p = buildPeriode('semaine', '2026-01-15');
    assert.equal(p.ancre, '2026-01-12'); // lundi
    assert.match(p.label, /12.*18|du 12 au 18/);
  });
});

describe('bilans §8', () => {
  it('vente à 23 h 30 locale tombe dans le bon jour', async () => {
    const { raw, db } = openDb();
    seedMinimal(raw);
    const jour = buildPeriode('jour', '2026-01-15');
    const b = await calculerBilan(db, jour);
    assert.equal(b.argentEncaisse, 5000);
  });

  it('vente annulée n’est comptée nulle part', async () => {
    const { raw, db } = openDb();
    seedMinimal(raw);
    const jour = buildPeriode('jour', '2026-01-17');
    const b = await calculerBilan(db, jour);
    assert.equal(b.argentEncaisse, 0);
  });

  it('somme des jours = semaine ; mois cohérents', async () => {
    const { raw, db } = openDb();
    seedMinimal(raw);
    const semaine = buildPeriode('semaine', '2026-01-15'); // 12–18 jan
    const bSem = await calculerBilan(db, semaine);
    let sommeJours = 0;
    for (let i = 0; i < 7; i++) {
      const j = shiftPeriode(buildPeriode('jour', semaine.ancre), i);
      sommeJours += (await calculerBilan(db, j)).argentEncaisse;
    }
    assert.equal(sommeJours, bSem.argentEncaisse);

    const jan = buildPeriode('mois', '2026-01-01');
    const fev = buildPeriode('mois', '2026-02-01');
    const annee = buildPeriode('annee', '2026-01-01');
    const bJan = await calculerBilan(db, jan);
    const bFev = await calculerBilan(db, fev);
    const bAn = await calculerBilan(db, annee);
    assert.equal(bJan.argentEncaisse + bFev.argentEncaisse, bAn.argentEncaisse);
  });

  it('bénéfice ignore les ventes sans cout_unitaire et reste stable si prix_achat change', async () => {
    const { raw, db } = openDb();
    seedMinimal(raw);
    const jour = buildPeriode('jour', '2026-01-16');
    const avant = await calculerBilan(db, jour);
    // 1 vente shampoo : 3500 − 2×1200 = 1100 ; 1 vente sans coût exclue
    assert.equal(avant.benefice.montant, 1100);
    assert.equal(avant.benefice.ventesAvecCout, 1);
    assert.equal(avant.benefice.ventesTotal, 2);
    assert.equal(avant.benefice.articlesSansPrix, 1);
    assert.match(avant.benefice.label, /n’ont pas de prix d’achat|sans prix/);

    raw.prepare('UPDATE articles SET prix_achat = 9999 WHERE id = ?').run('art-prod');
    const apres = await calculerBilan(db, jour);
    assert.equal(apres.benefice.montant, 1100); // cout_unitaire figé sur le mouvement
  });

  it('stock fin de période = stock actuel quand la période se termine « maintenant »', async () => {
    const { raw, db } = openDb();
    seedMinimal(raw);
    // Période jour « demain » vide → fin = demain 00:00 = après tous nos mouvements de test jusqu’à fév
    // On utilise une ancre future pour que finIso soit après tous les mouvements
    const far = buildPeriode('jour', '2026-12-31');
    const stocks = await listStockFinPeriode(db, far);
    const bella = stocks.find((s) => s.nom === 'Bella')!;
    // départ 10 − 1 (15) − 0 annulée + 5 entrée − 1 fév = 13
    assert.equal(bella.stock, 13);

    // Stock « actuel » via même règle sans borne
    const actuel = raw
      .prepare(
        `SELECT COALESCE((
          SELECT SUM(CASE WHEN m.annule=1 THEN 0 WHEN m.type='vente' THEN -m.quantite ELSE m.quantite END)
          FROM mouvements m WHERE m.article_id = ?
        ),0) AS stock`
      )
      .get('art-meche') as { stock: number };
    assert.equal(bella.stock, actuel.stock);
  });

  it('période aujourd’hui se construit', () => {
    const p = periodeAujourdhui('mois', fromLocal(2026, 8, 25));
    assert.equal(p.ancre, '2026-09-01');
    assert.match(p.label, /Septembre 2026/i);
  });
});
