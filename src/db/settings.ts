import type { SQLiteDatabase } from 'expo-sqlite';

export const SETTINGS_KEYS = {
  pin: 'pin_code',
  boutiqueId: 'boutique_id',
  role: 'role',
  membreNom: 'membre_nom',
  /** Dernier user_id authentifié — pour bloquer un autre compte si a_envoyer > 0. */
  lastUserId: 'last_user_id',
} as const;

export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

export async function deleteSetting(db: SQLiteDatabase, key: string): Promise<void> {
  await db.runAsync('DELETE FROM settings WHERE key = ?', [key]);
}
