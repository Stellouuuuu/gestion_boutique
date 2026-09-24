import type { SQLiteDatabase } from 'expo-sqlite';
import articlesData from '../../assets/data/articles.json';
import { newId } from '../lib/uuid';
import type { Categorie } from './types';

interface RawArticle {
  nom: string;
  categorie: Categorie;
  prix_detail: number | null;
  prix_gros: number | null;
  stock_initial: number;
}

const RAW_ARTICLES = articlesData as RawArticle[];

/**
 * Secours pour une boutique vide (étape 2 §2.3) : importe articles.json, stock à 0.
 * N'est appelé qu'après un téléchargement Supabase qui ne renvoie aucun article.
 */
export async function seedArticlesFromJson(db: SQLiteDatabase, boutiqueId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    const stmt = await db.prepareAsync(
      `INSERT INTO articles
         (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
       VALUES ($id, $boutique_id, $nom, $categorie, $prix_detail, $prix_gros, NULL, 1, $cree_le, $modifie_le, 1)`
    );
    try {
      for (const a of RAW_ARTICLES) {
        await stmt.executeAsync({
          $id: newId(),
          $boutique_id: boutiqueId,
          $nom: a.nom,
          $categorie: a.categorie,
          $prix_detail: a.prix_detail,
          $prix_gros: a.prix_gros,
          $cree_le: now,
          $modifie_le: now,
        });
      }
    } finally {
      await stmt.finalizeAsync();
    }
  });
}
