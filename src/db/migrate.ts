import type { SQLiteDatabase } from 'expo-sqlite';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts';

const VERSION_KEY = 'schema_version';

/**
 * Montée de version **additive uniquement** : jamais de DROP TABLE.
 * Toutes les lignes (y compris a_envoyer = 1) sont conservées.
 * Les migrations futures doivent être des ALTER TABLE ADD COLUMN / CREATE TABLE IF NOT EXISTS.
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

  // Schéma courant (idempotent : CREATE IF NOT EXISTS + indexes)
  await db.execAsync(SCHEMA_SQL);

  // Migrations additives passées / futures (exemples de colonnes déjà dans SCHEMA_SQL)
  if (version < 2) {
    await ensureColumn(db, 'articles', 'prix_achat', 'INTEGER');
    await ensureColumn(db, 'mouvements', 'cout_unitaire', 'INTEGER');
  }

  if (version !== SCHEMA_VERSION) {
    await db.runAsync(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [VERSION_KEY, String(SCHEMA_VERSION)]
    );
  }
}

async function ensureColumn(
  db: SQLiteDatabase,
  table: string,
  column: string,
  typeSql: string
): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (cols.some((c) => c.name === column)) return;
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`);
}
