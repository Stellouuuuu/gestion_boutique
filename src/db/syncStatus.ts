import type { SQLiteDatabase } from 'expo-sqlite';

export type SyncTable = 'articles' | 'mouvements' | 'inventaires' | 'inventaire_lignes';

export const SYNC_TABLES: SyncTable[] = [
  'articles',
  'mouvements',
  'inventaires',
  'inventaire_lignes',
];

/** Ordre d'envoi : parents avant enfants. */
export const SYNC_PUSH_ORDER: SyncTable[] = [
  'articles',
  'mouvements',
  'inventaires',
  'inventaire_lignes',
];

export async function getDernierPull(
  db: SQLiteDatabase,
  table: SyncTable
): Promise<string | null> {
  const row = await db.getFirstAsync<{ dernier_pull: string | null }>(
    'SELECT dernier_pull FROM synchro WHERE table_name = ?',
    [table]
  );
  return row?.dernier_pull ?? null;
}

export async function setDernierPull(
  db: SQLiteDatabase,
  table: SyncTable,
  iso: string
): Promise<void> {
  await db.runAsync(
    `INSERT INTO synchro (table_name, dernier_pull) VALUES (?, ?)
     ON CONFLICT(table_name) DO UPDATE SET dernier_pull = excluded.dernier_pull`,
    [table, iso]
  );
}

export interface PendingCounts {
  ventes: number;
  total: number;
}

/** Lignes locales pas encore envoyées (tous types). */
export async function countPending(db: SQLiteDatabase): Promise<PendingCounts> {
  const [ventes, articles, mouvements, inventaires, lignes] = await Promise.all([
    db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) as n FROM mouvements WHERE a_envoyer = 1 AND type = 'vente' AND annule = 0`
    ),
    db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM articles WHERE a_envoyer = 1'),
    db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM mouvements WHERE a_envoyer = 1'),
    db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM inventaires WHERE a_envoyer = 1'),
    db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) as n FROM inventaire_lignes WHERE a_envoyer = 1'
    ),
  ]);
  const total =
    (articles?.n ?? 0) + (mouvements?.n ?? 0) + (inventaires?.n ?? 0) + (lignes?.n ?? 0);
  return { ventes: ventes?.n ?? 0, total };
}

const SETTINGS_LAST_SYNC = 'derniere_synchro_ok';
const SETTINGS_LAST_ERR = 'derniere_synchro_erreur';
const SETTINGS_LAST_ERR_AT = 'derniere_synchro_erreur_le';

export async function getDerniereSynchroOk(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [SETTINGS_LAST_SYNC]
  );
  return row?.value ?? null;
}

export async function setDerniereSynchroOk(db: SQLiteDatabase, iso: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [SETTINGS_LAST_SYNC, iso]
  );
}

export async function getDerniereSynchroErreur(
  db: SQLiteDatabase
): Promise<{ message: string; le: string } | null> {
  const [msg, le] = await Promise.all([
    db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
      SETTINGS_LAST_ERR,
    ]),
    db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
      SETTINGS_LAST_ERR_AT,
    ]),
  ]);
  if (!msg?.value) return null;
  return { message: msg.value, le: le?.value ?? '' };
}

export async function setDerniereSynchroErreur(
  db: SQLiteDatabase,
  message: string,
  iso = new Date().toISOString()
): Promise<void> {
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [SETTINGS_LAST_ERR, message]
  );
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [SETTINGS_LAST_ERR_AT, iso]
  );
}

export async function clearDerniereSynchroErreur(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM settings WHERE key IN (?, ?)', [
    SETTINGS_LAST_ERR,
    SETTINGS_LAST_ERR_AT,
  ]);
}

export type SyncIndicateur =
  | { kind: 'ok'; label: string }
  | { kind: 'pending'; label: string }
  | { kind: 'stale'; label: string }
  | { kind: 'error'; label: string };

const DAY_MS = 24 * 60 * 60 * 1000;

const MSG_ERREUR_SAUVEGARDE =
  "Les ventes n'arrivent pas à être sauvegardées. Prévenez Stella.";

export interface BuildSyncIndicateurOptions {
  now?: number;
  /** false = hors ligne affirmé ; true / undefined = on considère qu’un échec Supabase n’est pas « réseau ». */
  isOnline?: boolean | null;
  lastSyncError?: string | null;
}

export function buildSyncIndicateur(
  pending: PendingCounts,
  derniereSynchroOk: string | null,
  options: BuildSyncIndicateurOptions = {}
): SyncIndicateur {
  const now = options.now ?? Date.now();
  const isOnline = options.isOnline;
  const lastError = options.lastSyncError ?? null;
  const last = derniereSynchroOk ? Date.parse(derniereSynchroOk) : NaN;
  const stale = !Number.isFinite(last) || now - last > DAY_MS;

  // Réseau présent (ou non affirmé hors-ligne) + échec d’envoi → jamais « attente de réseau ».
  if (pending.total > 0 && lastError && isOnline !== false) {
    return { kind: 'error', label: MSG_ERREUR_SAUVEGARDE };
  }

  if (pending.total > 0 && stale) {
    return {
      kind: 'stale',
      label: 'Pas de connexion depuis hier, vos ventes sont gardées dans le téléphone',
    };
  }
  if (pending.ventes > 0) {
    const n = pending.ventes;
    return {
      kind: 'pending',
      label: n === 1 ? '1 vente en attente de réseau' : `${n} ventes en attente de réseau`,
    };
  }
  if (pending.total > 0) {
    return { kind: 'pending', label: 'Des changements en attente de réseau' };
  }
  if (stale && derniereSynchroOk == null) {
    return { kind: 'ok', label: '✓ Tout est sauvegardé' };
  }
  if (stale) {
    return {
      kind: 'stale',
      label: 'Pas de connexion depuis hier, vos ventes sont gardées dans le téléphone',
    };
  }
  return { kind: 'ok', label: '✓ Tout est sauvegardé' };
}
