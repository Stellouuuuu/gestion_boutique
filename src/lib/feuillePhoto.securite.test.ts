import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MSG_LECTURE_ECHEC } from './feuilleTypes.ts';

describe('échec lecture feuille', () => {
  it('message utilisateur sans jargon technique', async () => {
    const { MSG_LECTURE_SURCHARGE, MSG_LECTURE_QUOTA_JOUR } = await import('./feuilleTypes.ts');
    assert.equal(
      MSG_LECTURE_ECHEC,
      'La lecture ne marche pas pour le moment, vous pouvez saisir vos ventes à la main'
    );
    assert.ok(MSG_LECTURE_SURCHARGE.includes('très demandée'));
    assert.ok(MSG_LECTURE_QUOTA_JOUR.includes('jusqu’à demain'));
    assert.ok(!/gemini|api|key|token|quota/i.test(MSG_LECTURE_ECHEC));
    assert.ok(!/gemini|api|key|token/i.test(MSG_LECTURE_SURCHARGE));
    assert.ok(!/gemini|api|key|token/i.test(MSG_LECTURE_QUOTA_JOUR));
  });
});

describe('pas de clé IA dans le client', () => {
  it('lireFeuille.ts n’embarque pas de clé', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('./lireFeuille.ts', import.meta.url), 'utf8');
    assert.ok(!/GEMINI_API_KEY|AIza[0-9A-Za-z_-]{20,}/.test(src));
    assert.ok(src.includes("functions.invoke('lire-feuille'"));
  });
});
