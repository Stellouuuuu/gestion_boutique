import type { SQLiteDatabase } from 'expo-sqlite';
import { supabase } from '../lib/supabase';
import { seedArticlesFromJson } from './seed';
import type { CatalogueInitial } from './settings';
import type { Categorie, Tarif, TypeMouvement } from './types';

export interface Membre {
  boutiqueId: string;
  role: 'proprietaire' | 'vendeuse';
  nom: string;
  boutiqueNom: string;
}

/** Récupère la boutique et le rôle de l'utilisateur connecté (une seule boutique active pour l'instant). */
export async function fetchMembre(userId: string): Promise<Membre | null> {
  const { data, error } = await supabase
    .from('membres')
    .select('boutique_id, role, nom, boutiques(nom)')
    .eq('user_id', userId)
    .eq('actif', true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const boutique = data.boutiques as { nom: string } | { nom: string }[] | null;
  const boutiqueNom = Array.isArray(boutique) ? boutique[0]?.nom : boutique?.nom;
  return {
    boutiqueId: data.boutique_id,
    role: data.role,
    nom: data.nom,
    boutiqueNom: boutiqueNom ?? '',
  };
}

interface RemoteArticle {
  id: string;
  nom: string;
  categorie: Categorie;
  prix_detail: number | null;
  prix_gros: number | null;
  prix_achat: number | null;
  actif: boolean;
  cree_le: string;
  modifie_le: string;
}

interface RemoteMouvement {
  id: string;
  article_id: string;
  type: TypeMouvement;
  quantite: number;
  tarif: Tarif | null;
  prix_unitaire: number;
  montant_normal: number;
  montant_paye: number;
  cout_unitaire: number | null;
  annule: boolean;
  annule_le: string | null;
  cree_par: string | null;
  cree_le: string;
  modifie_le: string;
}

/**
 * Téléchargement initial : si la boutique a déjà des articles en ligne,
 * on les télécharge avec leurs mouvements (stock = somme des mouvements).
 * Sinon : liste type (articles.json, stock 0) ou liste vide selon `catalogue`.
 * N'agit que si la boutique n'a encore aucun article en local.
 */
export async function telechargerBoutiqueSiVide(
  db: SQLiteDatabase,
  boutiqueId: string,
  catalogue: CatalogueInitial = 'type'
): Promise<{ nbArticles: number; depuisJson: boolean }> {
  const dejaLocal = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) as n FROM articles WHERE boutique_id = ?',
    [boutiqueId]
  );
  if ((dejaLocal?.n ?? 0) > 0) return { nbArticles: dejaLocal!.n, depuisJson: false };

  const { data: remoteArticles, error: errA } = await supabase
    .from('articles')
    .select('id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le')
    .eq('boutique_id', boutiqueId);
  if (errA) throw errA;

  if (!remoteArticles || remoteArticles.length === 0) {
    if (catalogue === 'vide') {
      return { nbArticles: 0, depuisJson: false };
    }
    await seedArticlesFromJson(db, boutiqueId);
    const n = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) as n FROM articles WHERE boutique_id = ?',
      [boutiqueId]
    );
    return { nbArticles: n?.n ?? 0, depuisJson: true };
  }

  const { data: remoteMouvements, error: errM } = await supabase
    .from('mouvements')
    .select(
      'id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye, cout_unitaire, annule, annule_le, cree_par, cree_le, modifie_le'
    )
    .eq('boutique_id', boutiqueId);
  if (errM) throw errM;

  await db.withTransactionAsync(async () => {
    const stmtArticle = await db.prepareAsync(
      `INSERT INTO articles
         (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
       VALUES ($id, $boutique_id, $nom, $categorie, $prix_detail, $prix_gros, $prix_achat, $actif, $cree_le, $modifie_le, 0)`
    );
    try {
      for (const a of remoteArticles as RemoteArticle[]) {
        await stmtArticle.executeAsync({
          $id: a.id,
          $boutique_id: boutiqueId,
          $nom: a.nom,
          $categorie: a.categorie,
          $prix_detail: a.prix_detail,
          $prix_gros: a.prix_gros,
          $prix_achat: a.prix_achat,
          $actif: a.actif ? 1 : 0,
          $cree_le: a.cree_le,
          $modifie_le: a.modifie_le,
        });
      }
    } finally {
      await stmtArticle.finalizeAsync();
    }

    const stmtMouvement = await db.prepareAsync(
      `INSERT INTO mouvements
         (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
          cout_unitaire, annule, annule_le, cree_par, cree_le, modifie_le, a_envoyer)
       VALUES ($id, $boutique_id, $article_id, $type, $quantite, $tarif, $prix_unitaire, $montant_normal, $montant_paye,
          $cout_unitaire, $annule, $annule_le, $cree_par, $cree_le, $modifie_le, 0)`
    );
    try {
      for (const m of (remoteMouvements ?? []) as RemoteMouvement[]) {
        await stmtMouvement.executeAsync({
          $id: m.id,
          $boutique_id: boutiqueId,
          $article_id: m.article_id,
          $type: m.type,
          $quantite: m.quantite,
          $tarif: m.tarif,
          $prix_unitaire: m.prix_unitaire,
          $montant_normal: m.montant_normal,
          $montant_paye: m.montant_paye,
          $cout_unitaire: m.cout_unitaire,
          $annule: m.annule ? 1 : 0,
          $annule_le: m.annule_le,
          $cree_par: m.cree_par,
          $cree_le: m.cree_le,
          $modifie_le: m.modifie_le,
        });
      }
    } finally {
      await stmtMouvement.finalizeAsync();
    }
  });

  return { nbArticles: remoteArticles.length, depuisJson: false };
}
