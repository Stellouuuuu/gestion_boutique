import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stockDepuisMouvements } from './stockSql.ts';

describe('stockDepuisMouvements (même règle que stock_articles)', () => {
  it('vente diminue, entrée augmente, correction delta signé', () => {
    assert.equal(
      stockDepuisMouvements([
        { type: 'correction', quantite: 10, annule: 0 },
        { type: 'vente', quantite: 3, annule: 0 },
        { type: 'entree', quantite: 2, annule: 0 },
        { type: 'correction', quantite: -1, annule: 0 },
      ]),
      8
    );
  });

  it('ignore les mouvements annulés', () => {
    assert.equal(
      stockDepuisMouvements([
        { type: 'correction', quantite: 5, annule: 0 },
        { type: 'vente', quantite: 2, annule: 1 },
        { type: 'vente', quantite: 1, annule: true },
      ]),
      5
    );
  });

  it('sans mouvement → 0', () => {
    assert.equal(stockDepuisMouvements([]), 0);
  });
});
