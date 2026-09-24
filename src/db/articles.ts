import type { SQLiteDatabase } from 'expo-sqlite';
import { notifyLocalDataChange } from '../lib/syncBus';
import { newId } from '../lib/uuid';
import { getSetting, SETTINGS_KEYS } from './settings';
import { ARTICLE_SELECT_WITH_STOCK } from './stockSql';
import type { Article, Categorie } from './types';

export class DuplicateArticleError extends Error {
  constructor(nom: string) {
    super(`Un article « ${nom} » existe déjà dans cette catégorie.`);
    this.name = 'DuplicateArticleError';
  }
}

export async function listArticles(
  db: SQLiteDatabase,
  categorie: Categorie,
  opts?: { activeOnly?: boolean }
): Promise<Article[]> {
  const activeOnly = opts?.activeOnly ?? true;
  const sql = activeOnly
    ? `SELECT ${ARTICLE_SELECT_WITH_STOCK} FROM articles a WHERE a.categorie = ? AND a.actif = 1`
    : `SELECT ${ARTICLE_SELECT_WITH_STOCK} FROM articles a WHERE a.categorie = ?`;
  return db.getAllAsync<Article>(sql, [categorie]);
}

export async function listArticlesSansPrix(db: SQLiteDatabase): Promise<Article[]> {
  return db.getAllAsync<Article>(
    `SELECT ${ARTICLE_SELECT_WITH_STOCK} FROM articles a
     WHERE a.actif = 1 AND a.prix_detail IS NULL ORDER BY a.nom`
  );
}

export async function getArticle(db: SQLiteDatabase, id: string): Promise<Article | null> {
  return db.getFirstAsync<Article>(
    `SELECT ${ARTICLE_SELECT_WITH_STOCK} FROM articles a WHERE a.id = ?`,
    [id]
  );
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Tri alphabétique insensible aux accents/majuscules, comme la maquette. */
export function sortArticles(list: Article[]): Article[] {
  return [...list].sort((a, b) => normalise(a.nom).localeCompare(normalise(b.nom)));
}

export function filterByQuery(list: Article[], query: string): Article[] {
  const q = normalise(query.trim());
  if (!q) return list;
  return list.filter((a) => normalise(a.nom).includes(q));
}

export async function findDuplicate(
  db: SQLiteDatabase,
  nom: string,
  categorie: Categorie,
  excludeId?: string
): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM articles
     WHERE actif = 1 AND categorie = ? AND lower(nom) = lower(?) AND id != ?`,
    [categorie, nom, excludeId ?? '']
  );
  return row != null;
}

export interface NewArticleInput {
  nom: string;
  categorie: Categorie;
  prix_detail: number | null;
  prix_gros: number | null;
  prix_achat: number | null;
  /** Stock de départ : crée un mouvement `correction` si ≠ 0. */
  stock: number;
}

async function requireBoutiqueId(db: SQLiteDatabase): Promise<string> {
  const boutiqueId = await getSetting(db, SETTINGS_KEYS.boutiqueId);
  if (!boutiqueId) throw new Error('Aucune boutique associée à cet appareil.');
  return boutiqueId;
}

export async function createArticle(db: SQLiteDatabase, input: NewArticleInput): Promise<Article> {
  const nom = input.nom.trim();
  if (await findDuplicate(db, nom, input.categorie)) {
    throw new DuplicateArticleError(nom);
  }
  const boutiqueId = await requireBoutiqueId(db);
  const now = new Date().toISOString();
  const id = newId();
  const stockInitial = Math.round(input.stock) || 0;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO articles
         (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)`,
      [
        id,
        boutiqueId,
        nom,
        input.categorie,
        input.prix_detail,
        input.prix_gros,
        input.prix_achat,
        now,
        now,
      ]
    );
    if (stockInitial !== 0) {
      await db.runAsync(
        `INSERT INTO mouvements
           (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
            cout_unitaire, annule, cree_le, modifie_le, a_envoyer)
         VALUES (?, ?, ?, 'correction', ?, NULL, 0, 0, 0, ?, 0, ?, ?, 1)`,
        [newId(), boutiqueId, id, stockInitial, input.prix_achat, now, now]
      );
    }
  });

  const created = await getArticle(db, id);
  if (!created) throw new Error('Échec de la création de l’article.');
  notifyLocalDataChange();
  return created;
}

export interface UpdateArticleInput {
  nom: string;
  categorie: Categorie;
  prix_detail: number | null;
  prix_gros: number | null;
  prix_achat: number | null;
}

/** Met à jour les champs de la fiche, hors stock (voir `recordCorrection` pour le stock). */
export async function updateArticleFields(
  db: SQLiteDatabase,
  id: string,
  input: UpdateArticleInput
): Promise<void> {
  const nom = input.nom.trim();
  if (await findDuplicate(db, nom, input.categorie, id)) {
    throw new DuplicateArticleError(nom);
  }
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE articles
     SET nom = ?, categorie = ?, prix_detail = ?, prix_gros = ?, prix_achat = ?,
         modifie_le = ?, a_envoyer = 1
     WHERE id = ?`,
    [nom, input.categorie, input.prix_detail, input.prix_gros, input.prix_achat, now, id]
  );
  notifyLocalDataChange();
}

export async function softDeleteArticle(db: SQLiteDatabase, id: string): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    'UPDATE articles SET actif = 0, modifie_le = ?, a_envoyer = 1 WHERE id = ?',
    [now, id]
  );
  notifyLocalDataChange();
}

export async function countArticles(db: SQLiteDatabase, boutiqueId?: string): Promise<number> {
  if (boutiqueId) {
    const row = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) as n FROM articles WHERE boutique_id = ?',
      [boutiqueId]
    );
    return row?.n ?? 0;
  }
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM articles');
  return row?.n ?? 0;
}
