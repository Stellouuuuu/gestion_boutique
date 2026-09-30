import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  confianceDepuisScore,
  normaliserNom,
  prixCompatible,
  rapprocherArticle,
  tokensDistinctifs,
} from './rapprochementNoms.ts';

const CATALOGUE = [
  { id: '1', nom: 'Passion twist', prix_detail: 500, prix_gros: 450 },
  { id: '2', nom: 'Mèche grand', prix_detail: 200, prix_gros: 180 },
  { id: '3', nom: 'Mèche petit', prix_detail: 100, prix_gros: 90 },
  { id: '4', nom: 'Shampooing doux', prix_detail: 300, prix_gros: 250 },
  { id: '5', nom: 'Après-shampooing karité', prix_detail: 350, prix_gros: 300 },
  { id: '6', nom: 'Boîte tresses XL', prix_detail: 1000, prix_gros: 900 },
  { id: '7', nom: 'Gel pétals petit', prix_detail: 150, prix_gros: 120 },
  { id: '8', nom: 'Pétal one grand', prix_detail: 400, prix_gros: 350 },
];

describe('normaliserNom', () => {
  it('retire accents et majuscules', () => {
    assert.equal(normaliserNom('Après-Shampooing'), 'apres shampooing');
  });

  it('développe grd / pt', () => {
    assert.equal(normaliserNom('meche grd'), 'meche grand');
    assert.equal(normaliserNom('mch pt'), 'meche petit');
  });

  it('développe shamp / bte', () => {
    assert.ok(normaliserNom('shamp doux').includes('shampooing'));
    assert.ok(normaliserNom('bte tresses').includes('boite'));
  });
});

describe('tokensDistinctifs', () => {
  it('ignore petit/grand/de', () => {
    assert.deepEqual(tokensDistinctifs('gel petals petit'), ['gel', 'petals']);
    assert.deepEqual(tokensDistinctifs('meche grd'), ['meche']);
  });
});

describe('prixCompatible', () => {
  it('accepte ±40 %', () => {
    assert.equal(prixCompatible(500, CATALOGUE[0]!), true);
    assert.equal(prixCompatible(300, CATALOGUE[0]!), true); // −40 %
    assert.equal(prixCompatible(200, CATALOGUE[0]!), false);
  });
});

describe('rapprocherArticle', () => {
  it('match exact', () => {
    const r = rapprocherArticle('Passion twist', CATALOGUE);
    assert.equal(r.articleId, '1');
    assert.ok(r.score >= 0.9);
  });

  it('abréviation grd + prix → Mèche grand', () => {
    const r = rapprocherArticle('meche grd', CATALOGUE, 0.62, {
      montant: 200,
      quantite: 1,
    });
    assert.equal(r.articleId, '2');
  });

  it('abréviation pt + prix → Mèche petit', () => {
    const r = rapprocherArticle('mch pt', CATALOGUE, 0.62, {
      montant: 100,
      quantite: 1,
    });
    assert.equal(r.articleId, '3');
  });

  it('sans prix et flou → null (prudence)', () => {
    const r = rapprocherArticle('pasion twist', CATALOGUE);
    assert.equal(r.articleId, null);
  });

  it('mot distinctif + prix → match', () => {
    const r = rapprocherArticle('passion twist', CATALOGUE, 0.62, {
      montant: 500,
      quantite: 1,
    });
    assert.equal(r.articleId, '1');
  });

  it('inconnu → null / basse', () => {
    const r = rapprocherArticle('truc inventé xyz', CATALOGUE, 0.62, {
      montant: 100,
      quantite: 1,
    });
    assert.equal(r.articleId, null);
    assert.equal(confianceDepuisScore(r.score, r.articleId), 'basse');
  });

  it('shampoing + prix → shampooing', () => {
    const r = rapprocherArticle('shampoing doux', CATALOGUE, 0.62, {
      montant: 300,
      quantite: 1,
    });
    assert.equal(r.articleId, '4');
  });

  it('prix incompatible → null même si texte proche', () => {
    const r = rapprocherArticle('meche', CATALOGUE, 0.62, {
      montant: 9999,
      quantite: 1,
    });
    assert.equal(r.articleId, null);
  });

  it('match exact ignore le prix (Taille ongle à 100 F)', () => {
    const cat = [
      ...CATALOGUE,
      { id: 'to', nom: 'Taille ongle', prix_detail: 500, prix_gros: 500 },
      { id: 'too', nom: 'Taille ongle original', prix_detail: 100, prix_gros: 100 },
    ];
    const r = rapprocherArticle('Taille ongle', cat, 0.62, { montant: 100, quantite: 1 });
    assert.equal(r.articleId, 'to');
    assert.equal(r.nomCatalogue, 'Taille ongle');
  });
});
