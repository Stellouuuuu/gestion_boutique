import type { SQLiteDatabase } from 'expo-sqlite';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts';

const VERSION_KEY = 'schema_version';

/**
 * Montée de version **additive uniquement** : jamais de DROP TABLE.
 * Toutes les lignes (y compris a_envoyer = 1) sont conservées.
 * Les migrations futures doivent être des ALTER TABLE ADD COLUMN / CREATE TABLE IF NOT EXISTS.
 *
 * Ordre critique : d’abord ALTER ADD COLUMN sur les tables existantes,
 * ensuite CREATE INDEX qui référencent ces colonnes (sinon SQLite plante
 * et la mise à jour échoue sur le téléphone de Maman).
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

  // 1) Colonnes additives AVANT les index qui les utilisent
  if (version < 2) {
    // tables peuvent ne pas exister encore : on créera via SCHEMA_SQL après
    await ensureColumnIfTableExists(db, 'articles', 'prix_achat', 'INTEGER');
    await ensureColumnIfTableExists(db, 'mouvements', 'cout_unitaire', 'INTEGER');
  }

  if (version < 3) {
    await ensureColumnIfTableExists(db, 'mouvements', 'source', `TEXT DEFAULT 'manuel'`);
    await ensureColumnIfTableExists(db, 'mouvements', 'lot_id', 'TEXT');
  }

  // 2) CREATE IF NOT EXISTS (tables + index sans lot_id)
  await db.execAsync(SCHEMA_SQL);

  // 3) Colonnes à nouveau (si tables venaient d’être créées vides en v0)
  if (version < 2) {
    await ensureColumn(db, 'articles', 'prix_achat', 'INTEGER');
    await ensureColumn(db, 'mouvements', 'cout_unitaire', 'INTEGER');
  }
  if (version < 3) {
    await ensureColumn(db, 'mouvements', 'source', `TEXT DEFAULT 'manuel'`);
    await ensureColumn(db, 'mouvements', 'lot_id', 'TEXT');
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_mouvements_lot ON mouvements(lot_id)`
    );
  }

  // v4 : table alias_articles créée via SCHEMA_SQL (IF NOT EXISTS)

  if (version !== SCHEMA_VERSION) {
    await db.runAsync(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [VERSION_KEY, String(SCHEMA_VERSION)]
    );
  }
}

async function tableExists(db: SQLiteDatabase, table: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
    [table]
  );
  return !!row;
}

async function ensureColumnIfTableExists(
  db: SQLiteDatabase,
  table: string,
  column: string,
  typeSql: string
): Promise<void> {
  if (!(await tableExists(db, table))) return;
  await ensureColumn(db, table, column, typeSql);
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
