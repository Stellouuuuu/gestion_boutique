import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSyncIndicateur, type PendingCounts } from './syncStatus.ts';
import { fillCreeParForPush } from './syncPush.ts';

describe('buildSyncIndicateur', () => {
  const now = Date.parse('2026-09-24T12:00:00.000Z');

  it('montre tout sauvegardé quand rien n’attend et synchro récente', () => {
    const pending: PendingCounts = { ventes: 0, total: 0 };
    const ind = buildSyncIndicateur(pending, '2026-09-24T10:00:00.000Z', {
      now,
      isOnline: true,
    });
    assert.equal(ind.kind, 'ok');
    assert.match(ind.label, /Tout est sauvegardé/);
  });

  it('compte les ventes en attente de réseau seulement hors ligne', () => {
    const ind = buildSyncIndicateur(
      { ventes: 3, total: 3 },
      '2026-09-24T10:00:00.000Z',
      { now, isOnline: false }
    );
    assert.equal(ind.kind, 'pending');
    assert.equal(ind.label, '3 ventes en attente de réseau');
  });

  it('ne dit JAMAIS « en attente de réseau » si le réseau est là mais Supabase a échoué', () => {
    // Bug reproduit : l’UI affichait « N ventes en attente de réseau » alors que
    // le téléphone est en Wi‑Fi et que l’upsert RLS a échoué (cree_par null).
    const ind = buildSyncIndicateur(
      { ventes: 5, total: 5 },
      '2026-09-24T10:00:00.000Z',
      {
        now,
        isOnline: true,
        lastSyncError:
          'new row violates row-level security policy for table "mouvements"',
      }
    );
    assert.equal(ind.kind, 'error');
    assert.equal(
      ind.label,
      "Les ventes n'arrivent pas à être sauvegardées. Prévenez Stella."
    );
    assert.doesNotMatch(ind.label, /attente de réseau/);
  });

  it('alerte orange après 24 h sans synchro avec pending hors ligne', () => {
    const ind = buildSyncIndicateur(
      { ventes: 1, total: 1 },
      '2026-09-22T10:00:00.000Z',
      { now, isOnline: false }
    );
    assert.equal(ind.kind, 'stale');
    assert.match(ind.label, /Pas de connexion depuis hier/);
  });
});

describe('fillCreeParForPush (bug cree_par null → RLS)', () => {
  const uid = '61bd47d9-81c4-4a91-b902-50bb2d53e2ad';

  it('refuse d’envoyer un mouvement sans cree_par ni uid (repro RLS)', () => {
    assert.throws(
      () => fillCreeParForPush({ id: 'm1', cree_par: null }, null),
      /cree_par/
    );
  });

  it('remplit cree_par avec auth.uid() quand la ligne locale l’a oublié', () => {
    const out = fillCreeParForPush({ id: 'm1', cree_par: null }, uid);
    assert.equal(out.cree_par, uid);
    assert.equal(out.filled, true);
  });

  it('conserve un cree_par déjà renseigné', () => {
    const out = fillCreeParForPush({ id: 'm1', cree_par: uid }, uid);
    assert.equal(out.cree_par, uid);
    assert.equal(out.filled, false);
  });
});
