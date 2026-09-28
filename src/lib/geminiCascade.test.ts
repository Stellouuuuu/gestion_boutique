import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LIRE_FEUILLE_VERSION,
  PLAFOND_APPELS_IA_JOUR,
  appelIaUnique,
  modeleUnique,
} from './geminiCascade.ts';

describe('geminiCascade — appel unique', () => {
  it('expose la VERSION et le plafond 10', () => {
    assert.equal(LIRE_FEUILLE_VERSION, 'lire-feuille-v2-single-call');
    assert.equal(PLAFOND_APPELS_IA_JOUR, 10);
  });

  it('choisit un seul modèle', () => {
    assert.equal(modeleUnique('gemini-x', 'a,b'), 'gemini-x');
    assert.equal(modeleUnique('', 'first,second'), 'first');
  });

  it('un seul appel même sur 503 — pas de retry', async () => {
    let n = 0;
    const r = await appelIaUnique({
      model: 'm',
      call: async () => {
        n += 1;
        return { ok: false, http: 503, body: 'busy' };
      },
      parse: () => ({ ok: true }),
    });
    assert.equal(n, 1);
    assert.equal(r.ok, false);
    assert.equal(r.nbAppels, 1);
    if (!r.ok) assert.equal(r.code, 'surcharge');
  });

  it('un seul appel sur 429 — pas de modèle suivant', async () => {
    let n = 0;
    const r = await appelIaUnique({
      model: 'm1',
      call: async () => {
        n += 1;
        return { ok: false, http: 429, body: 'quota' };
      },
      parse: () => ({}),
    });
    assert.equal(n, 1);
    assert.equal(r.nbAppels, 1);
    if (!r.ok) assert.equal(r.code, 'quota');
  });

  it('succès : exactement 1 appel', async () => {
    let n = 0;
    const r = await appelIaUnique({
      model: 'm',
      call: async () => {
        n += 1;
        return { ok: true, http: 200, body: '{"x":1}' };
      },
      parse: (body) => JSON.parse(body),
    });
    assert.equal(n, 1);
    assert.equal(r.ok, true);
    assert.equal(r.nbAppels, 1);
  });
});
