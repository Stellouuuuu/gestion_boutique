import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import * as XLSX from 'xlsx';
import { SCHEMA_SQL } from './schema.ts';
import { buildPeriode, fromLocal } from './periodes.ts';
import { calculerBilan, type BilansDb } from './bilans.ts';
import { buildExcelRapport, buildPdfHtml } from './export.ts';

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

describe('export Excel / PDF', () => {
  it('totaux Résumé Excel = bilan écran, accents OK', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    const db = adapt(raw);
    const t0 = fromLocal(2026, 8, 1, 8).toISOString();
    raw.prepare(
      `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
       VALUES ('a1','b1','Mèche spéciale','meches',5000,null,3000,1,?,?,0)`
    ).run(t0, t0);
    raw.prepare(
      `INSERT INTO mouvements
         (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
          cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
       VALUES ('m1','b1','a1','vente',1,'detail',5000,5000,5000,3000,0,'u',?,?,0)`
    ).run(fromLocal(2026, 8, 10, 12).toISOString(), fromLocal(2026, 8, 10, 12).toISOString());

    const periode = buildPeriode('mois', '2026-09-01');
    const bilan = await calculerBilan(db, periode);
    const excel = await buildExcelRapport(db, periode, 'Boutique démo');
    assert.match(excel.filename, /Boutique/);
    assert.match(excel.filename, /\.xlsx$/);

    const wb = XLSX.read(excel.base64, { type: 'base64' });
    assert.ok(wb.SheetNames.includes('Résumé'));
    assert.ok(wb.SheetNames.includes('Ventes'));
    const resume = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets['Résumé'], {
      header: 1,
    });
    const map = Object.fromEntries(resume.filter((r) => r.length >= 2).map((r) => [r[0], r[1]]));
    assert.equal(map['Argent encaissé'], bilan.argentEncaisse);
    assert.equal(map['Bénéfice estimé'], bilan.benefice.montant);

    const html = buildPdfHtml(bilan, 'Boutique démo');
    assert.match(html, /Boutique démo/);
    assert.match(html, /Septembre|septembre|2026/);
  });
});
