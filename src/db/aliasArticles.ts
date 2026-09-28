/**
 * Surnoms manuscrits → article catalogue (par boutique).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { notifyLocalDataChange } from '../lib/syncBus.ts';
import { normaliserNom } from '../lib/rapprochementNoms.ts';
import { getSetting, SETTINGS_KEYS } from './settings.ts';

export async function trouverAlias(
  db: SQLiteDatabase,
  texteLu: string
): Promise<string | null> {
  const boutiqueId = await getSetting(db, SETTINGS_KEYS.boutiqueId);
  if (!boutiqueId) return null;
  const n = normaliserNom(texteLu);
  if (!n) return null;
  const row = await db.getFirstAsync<{ article_id: string }>(
    `SELECT article_id FROM alias_articles WHERE boutique_id = ? AND texte_norm = ?`,
    [boutiqueId, n]
  );
  return row?.article_id ?? null;
}

export async function enregistrerAlias(
  db: SQLiteDatabase,
  texteLu: string,
  articleId: string
): Promise<void> {
  const boutiqueId = await getSetting(db, SETTINGS_KEYS.boutiqueId);
  if (!boutiqueId) return;
  const n = normaliserNom(texteLu);
  if (!n || !articleId) return;
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO alias_articles (boutique_id, texte_norm, article_id, cree_le, modifie_le, a_envoyer)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(boutique_id, texte_norm) DO UPDATE SET
       article_id = excluded.article_id,
       modifie_le = excluded.modifie_le,
       a_envoyer = 1`,
    [boutiqueId, n, articleId, now, now]
  );
  notifyLocalDataChange();
}
