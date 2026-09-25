import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatTelAffiche,
  masquerTel,
  telDigitsDepuis,
  telVersIdentifiant,
} from './identifiant.ts';

const ATTENDU = '2290197504737@boutique-maman.app';

describe('telVersIdentifiant', () => {
  it('normalise 8 chiffres en ajoutant 01 (format béninois 2024+)', () => {
    assert.equal(telVersIdentifiant('97504737'), ATTENDU);
  });

  it('accepte déjà 10 chiffres locaux', () => {
    assert.equal(telVersIdentifiant('0197504737'), ATTENDU);
  });

  it('accepte un numéro espacé', () => {
    assert.equal(telVersIdentifiant('01 97 50 47 37'), ATTENDU);
  });

  it('accepte +229 avec espaces', () => {
    assert.equal(telVersIdentifiant('+229 01 97 50 47 37'), ATTENDU);
  });

  it('ne double pas le préfixe 229', () => {
    assert.equal(telVersIdentifiant('2290197504737'), ATTENDU);
  });

  it('un numéro saisi avec ou sans 229 donne le même identifiant', () => {
    assert.equal(telVersIdentifiant('01 97 00 00 01'), telVersIdentifiant('2290197000001'));
  });
});

describe('formatTelAffiche', () => {
  it('affiche un numéro béninois lisible', () => {
    assert.equal(formatTelAffiche('2290197000012@boutique-maman.app'), '01 97 00 00 12');
  });
});

describe('masquerTel', () => {
  it('masque le milieu', () => {
    assert.equal(masquerTel('2290197000012'), '01 97 •• •• 12');
  });
});

describe('telDigitsDepuis', () => {
  it('extrait les chiffres locaux', () => {
    assert.equal(telDigitsDepuis('2290197000012@boutique-maman.app'), '0197000012');
  });
});
