import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatTelAffiche,
  masquerTel,
  telDigitsDepuis,
  telVersIdentifiant,
} from './identifiant.ts';

describe('telVersIdentifiant', () => {
  it('un numéro saisi avec espaces et sans préfixe donne le même identifiant qu\'avec le préfixe 229', () => {
    assert.equal(telVersIdentifiant('01 97 00 00 01'), telVersIdentifiant('2290197000001'));
  });

  it('ajoute le préfixe 229 quand il manque', () => {
    assert.equal(telVersIdentifiant('0197000001'), '2290197000001@boutique-maman.app');
  });

  it('ne double pas le préfixe 229 quand il est déjà présent', () => {
    assert.equal(telVersIdentifiant('2290197000001'), '2290197000001@boutique-maman.app');
  });

  it('retire tout ce qui n\'est pas un chiffre', () => {
    assert.equal(telVersIdentifiant('+229 01-97-00-00-01'), '2290197000001@boutique-maman.app');
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
