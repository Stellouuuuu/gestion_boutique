import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telVersIdentifiant } from './identifiant.ts';

test('un numéro saisi avec espaces et sans préfixe donne le même identifiant qu\'avec le préfixe 229', () => {
  assert.equal(telVersIdentifiant('01 97 00 00 00'), telVersIdentifiant('2290197000000'));
});

test('ajoute le préfixe 229 quand il manque', () => {
  assert.equal(telVersIdentifiant('0197000000'), '2290197000000@boutique-maman.app');
});

test('ne double pas le préfixe 229 quand il est déjà présent', () => {
  assert.equal(telVersIdentifiant('2290197000000'), '2290197000000@boutique-maman.app');
});

test('retire tout ce qui n\'est pas un chiffre', () => {
  assert.equal(telVersIdentifiant('+229 01 97 00 00 00'), '2290197000000@boutique-maman.app');
});
