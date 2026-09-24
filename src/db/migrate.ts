import type { SQLiteDatabase } from 'expo-sqlite';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

const VERSION_KEY = 'schema_version';

/**
 * Schéma v2 : pas de migration des anciennes données (aucune donnée réelle hors ligne).
 * On drop les tables métier et on repart de zéro ; le téléchargement Supabase refill.
 * settings (PIN, boutique) est conservé.
 */
export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [VERSION_KEY]
  );
  const version = row ? Number(row.value) : 0;

  if (version < SCHEMA_VERSION) {
    await db.execAsync(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE IF EXISTS inventaire_lignes;
      DROP TABLE IF EXISTS inventaires;
      DROP TABLE IF EXISTS mouvements;
      DROP TABLE IF EXISTS articles;
      DROP TABLE IF EXISTS synchro;
      PRAGMA foreign_keys = ON;
    `);
    await db.execAsync(SCHEMA_SQL);
    await db.runAsync(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [VERSION_KEY, String(SCHEMA_VERSION)]
    );
  } else {
    await db.execAsync(SCHEMA_SQL);
  }
}
