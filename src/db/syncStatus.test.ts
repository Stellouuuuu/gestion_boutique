import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSyncIndicateur, type PendingCounts } from './syncStatus.ts';

describe('buildSyncIndicateur', () => {
  const now = Date.parse('2026-09-24T12:00:00.000Z');

  it('montre tout sauvegardé quand rien n’attend et synchro récente', () => {
    const pending: PendingCounts = { ventes: 0, total: 0 };
    const ind = buildSyncIndicateur(pending, '2026-09-24T10:00:00.000Z', now);
    assert.equal(ind.kind, 'ok');
    assert.match(ind.label, /Tout est sauvegardé/);
  });

  it('compte les ventes en attente', () => {
    const ind = buildSyncIndicateur(
      { ventes: 3, total: 3 },
      '2026-09-24T10:00:00.000Z',
      now
    );
    assert.equal(ind.kind, 'pending');
    assert.equal(ind.label, '3 ventes en attente de réseau');
  });

  it('alerte orange après 24 h sans synchro avec pending', () => {
    const ind = buildSyncIndicateur(
      { ventes: 1, total: 1 },
      '2026-09-22T10:00:00.000Z',
      now
    );
    assert.equal(ind.kind, 'stale');
    assert.match(ind.label, /Pas de connexion depuis hier/);
  });
});
