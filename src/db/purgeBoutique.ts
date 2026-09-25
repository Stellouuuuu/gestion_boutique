import type { SQLiteDatabase } from 'expo-sqlite';
import { SYNC_TABLES } from './syncStatus.ts';

/**
 * Efface toutes les données métier locales d’une boutique.
 * À n’appeler qu’après vérification que a_envoyer = 0 (déjà en ligne).
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
