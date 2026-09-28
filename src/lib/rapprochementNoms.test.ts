import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  confianceDepuisScore,
  normaliserNom,
  rapprocherArticle,
} from './rapprochementNoms.ts';

const CATALOGUE = [
  { id: '1', nom: 'Passion twist' },
  { id: '2', nom: 'Mèche grand' },
  { id: '3', nom: 'Mèche petit' },
  { id: '4', nom: 'Shampooing doux' },
  { id: '5', nom: 'Après-shampooing karité' },
  { id: '6', nom: 'Boîte tresses XL' },
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

describe('rapprocherArticle', () => {
  it('match exact', () => {
    const r = rapprocherArticle('Passion twist', CATALOGUE);
    assert.equal(r.articleId, '1');
    assert.ok(r.score >= 0.9);
  });

  it('abréviation grd → Mèche grand', () => {
    const r = rapprocherArticle('meche grd', CATALOGUE);
    assert.equal(r.articleId, '2');
  });

  it('abréviation pt → Mèche petit', () => {
    const r = rapprocherArticle('mch pt', CATALOGUE);
    assert.equal(r.articleId, '3');
  });

  it('faute d’orthographe proche', () => {
    const r = rapprocherArticle('pasion twist', CATALOGUE);
    assert.equal(r.articleId, '1');
  });

  it('inconnu → null / basse', () => {
    const r = rapprocherArticle('truc inventé xyz', CATALOGUE);
    assert.equal(r.articleId, null);
    assert.equal(confianceDepuisScore(r.score, r.articleId), 'basse');
  });

  it('shampoing → shampooing', () => {
    const r = rapprocherArticle('shampoing doux', CATALOGUE);
    assert.equal(r.articleId, '4');
  });
});
