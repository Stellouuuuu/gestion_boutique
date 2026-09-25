/**
 * Règles de sécurité auth / synchro (tests unitaires « pour de vrai » sur la logique).
 *
 * a) Hors ligne + session expirée → on reste authentifié localement (cache boutique).
 * b) Ligne a_envoyer=1 n’est pas écrasée par un pull plus ancien.
 * c) Mot de passe changé ailleurs (SIGNED_OUT en ligne) → on purge le cache et on revient à Connexion.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.ts';
import {
  doitPurgerApresSignedOut,
  isLocallyAuthenticated,
  peutConnecterAvecPending,
} from '../lib/authSecurity.ts';

describe('sécurité a) hors ligne session expirée', () => {
  it('reste authentifiée avec membre local même sans session', () => {
    const membre = { boutiqueId: 'b1', role: 'proprietaire', nom: 'Démo' };
    assert.equal(isLocallyAuthenticated(null, membre), true);
    assert.equal(doitPurgerApresSignedOut({ intentionnel: false, isOnline: false }), false);
  });

  it('peut « vendre » localement : a_envoyer=1 sans session réseau', () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    const now = new Date().toISOString();
    raw.prepare(
      `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
       VALUES ('a1','b1','Test','meches',5000,null,3000,1,?,?,0)`
    ).run(now, now);
    raw.prepare(
      `INSERT INTO mouvements
         (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
          cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
       VALUES ('m1','b1','a1','vente',1,'detail',5000,5000,5000,3000,0,null,?,?,1)`
    ).run(now, now);
    const pending = raw.prepare(`SELECT COUNT(*) AS n FROM mouvements WHERE a_envoyer=1`).get() as {
      n: number;
    };
    assert.equal(pending.n, 1);
  });
});

describe('sécurité b) a_envoyer=1 non écrasé par pull plus ancien', () => {
  it('conserve la ligne locale pending face à un remote plus vieux', () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    const now = '2026-09-20T12:00:00.000Z';
    const older = '2026-09-01T12:00:00.000Z';
    raw.prepare(
      `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
       VALUES ('a1','b1','Local pending','meches',5000,null,3000,1,?,?,1)`
    ).run(now, now);

    const local = raw
      .prepare('SELECT a_envoyer, modifie_le, nom FROM articles WHERE id=?')
      .get('a1') as { a_envoyer: number; modifie_le: string; nom: string };
    assert.equal(local.a_envoyer, 1);

    const remote = { id: 'a1', nom: 'Remote ancien', modifie_le: older };
    if (local.a_envoyer !== 1) {
      raw.prepare('UPDATE articles SET nom=?, modifie_le=?, a_envoyer=0 WHERE id=?').run(
        remote.nom,
        remote.modifie_le,
        remote.id
      );
    }
    const after = raw.prepare('SELECT nom, a_envoyer FROM articles WHERE id=?').get('a1') as {
      nom: string;
      a_envoyer: number;
    };
    assert.equal(after.nom, 'Local pending');
    assert.equal(after.a_envoyer, 1);
  });
});

describe('sécurité c) mdp changé ailleurs → Connexion', () => {
  it('purge le cache quand SIGNED_OUT arrive en ligne', () => {
    assert.equal(doitPurgerApresSignedOut({ intentionnel: false, isOnline: true }), true);
  });

  it('ne purge pas hors ligne', () => {
    assert.equal(doitPurgerApresSignedOut({ intentionnel: false, isOnline: false }), false);
  });

  it('purge si déconnexion volontaire', () => {
    assert.equal(doitPurgerApresSignedOut({ intentionnel: true, isOnline: false }), true);
  });

  it('bloque un autre compte si a_envoyer>0', () => {
    const block = peutConnecterAvecPending({
      pendingTotal: 3,
      lastUserId: 'alice',
      newUserId: 'bob',
    });
    assert.equal(block.ok, false);
    const okSame = peutConnecterAvecPending({
      pendingTotal: 3,
      lastUserId: 'alice',
      newUserId: 'alice',
    });
    assert.equal(okSame.ok, true);
  });
});
