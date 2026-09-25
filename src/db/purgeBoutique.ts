import type { SQLiteDatabase } from 'expo-sqlite';
import { SYNC_TABLES } from './syncStatus.ts';

/**
 * Efface les données métier locales d’une boutique.
 * À n’appeler qu’après vérification que a_envoyer = 0.
 */
export async function purgerDonneesBoutiqueLocale(
  db: Pick<SQLiteDatabase, 'runAsync' | 'withTransactionAsync'>,
  boutiqueId: string
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM inventaire_lignes WHERE boutique_id = ?', [boutiqueId]);
    await db.runAsync('DELETE FROM inventaires WHERE boutique_id = ?', [boutiqueId]);
    await db.runAsync('DELETE FROM mouvements WHERE boutique_id = ?', [boutiqueId]);
    await db.runAsync('DELETE FROM articles WHERE boutique_id = ?', [boutiqueId]);
  });
}

/** Efface TOUTES les données métier locales (toutes boutiques). */
export async function purgerToutesDonneesMetierLocales(
  db: Pick<SQLiteDatabase, 'runAsync' | 'withTransactionAsync'>
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM inventaire_lignes');
    await db.runAsync('DELETE FROM inventaires');
    await db.runAsync('DELETE FROM mouvements');
    await db.runAsync('DELETE FROM articles');
  });
}

/** Remet les curseurs de pull à zéro pour un prochain téléchargement propre. */
export async function resetSynchroLocale(
  db: Pick<SQLiteDatabase, 'runAsync'>
): Promise<void> {
  for (const table of SYNC_TABLES) {
    await db.runAsync('DELETE FROM synchro WHERE table_name = ?', [table]);
  }
  await db.runAsync('DELETE FROM settings WHERE key IN (?, ?, ?)', [
    'derniere_synchro_ok',
    'derniere_synchro_erreur',
    'derniere_synchro_erreur_le',
  ]);
}

/** Boutique_id distincts présents en local (articles + mouvements). */
export async function listerBoutiqueIdsLocaux(
  db: Pick<SQLiteDatabase, 'getAllAsync'>
): Promise<string[]> {
  const rows = await db.getAllAsync<{ boutique_id: string }>(
    `SELECT DISTINCT boutique_id FROM articles
     UNION
     SELECT DISTINCT boutique_id FROM mouvements
     UNION
     SELECT DISTINCT boutique_id FROM inventaires`
  );
  return rows.map((r) => r.boutique_id).filter(Boolean);
}
