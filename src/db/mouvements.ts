import type { SQLiteDatabase } from 'expo-sqlite';
import { notifyLocalDataChange } from '../lib/syncBus';
import { newId } from '../lib/uuid';
import { getArticle } from './articles';
import { getSetting, SETTINGS_KEYS } from './settings';
import { stockExpr } from './stockSql';
import type { Article, Mouvement, Tarif } from './types';

export interface RecordVenteInput {
  articleId: string;
  quantite: number;
  tarif: Tarif;
  /** Montant total réellement payé, si différent du prix normal (réduction). */
  montantPaye?: number | null;
  creePar?: string | null;
}

export interface RecordVenteResult {
  mouvement: Mouvement;
  article: Article;
}

async function requireBoutiqueId(db: SQLiteDatabase): Promise<string> {
  const boutiqueId = await getSetting(db, SETTINGS_KEYS.boutiqueId);
  if (!boutiqueId) throw new Error('Aucune boutique associée à cet appareil.');
  return boutiqueId;
}

async function insertMouvement(
  db: SQLiteDatabase,
  values: {
    boutique_id: string;
    article_id: string;
    type: Mouvement['type'];
    quantite: number;
    tarif: Tarif | null;
    prix_unitaire: number;
    montant_normal: number;
    montant_paye: number;
    cout_unitaire: number | null;
    cree_par: string | null;
  }
): Promise<Mouvement> {
  const now = new Date().toISOString();
  const id = newId();
  await db.runAsync(
    `INSERT INTO mouvements
       (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
        cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 1)`,
    [
      id,
      values.boutique_id,
      values.article_id,
      values.type,
      values.quantite,
      values.tarif,
      values.prix_unitaire,
      values.montant_normal,
      values.montant_paye,
      values.cout_unitaire,
      values.cree_par,
      now,
      now,
    ]
  );
  const created = await db.getFirstAsync<Mouvement>('SELECT * FROM mouvements WHERE id = ?', [id]);
  if (!created) throw new Error('Échec de l’enregistrement du mouvement.');
  notifyLocalDataChange();
  return created;
}

export async function recordVente(
  db: SQLiteDatabase,
  input: RecordVenteInput
): Promise<RecordVenteResult> {
  const article = await getArticle(db, input.articleId);
  if (!article) throw new Error('Article introuvable.');
  const prixUnitaire = input.tarif === 'gros' ? article.prix_gros : article.prix_detail;
  if (prixUnitaire == null) {
    throw new Error('Cet article n’a pas de prix : impossible de le vendre.');
  }
  const montantNormal = input.quantite * prixUnitaire;
  const montantPaye = input.montantPaye ?? montantNormal;
  const boutiqueId = article.boutique_id || (await requireBoutiqueId(db));

  const mouvement = await insertMouvement(db, {
    boutique_id: boutiqueId,
    article_id: article.id,
    type: 'vente',
    quantite: input.quantite,
    tarif: input.tarif,
    prix_unitaire: prixUnitaire,
    montant_normal: montantNormal,
    montant_paye: montantPaye,
    cout_unitaire: article.prix_achat,
    cree_par: input.creePar ?? null,
  });
  const updated = (await getArticle(db, article.id))!;
  return { mouvement, article: updated };
}

export interface RecordEntreeInput {
  articleId: string;
  quantite: number;
  /** Si fourni, met à jour articles.prix_achat et enregistre cout_unitaire. */
  prixAchat?: number | null;
  creePar?: string | null;
}

export async function recordEntree(
  db: SQLiteDatabase,
  input: RecordEntreeInput
): Promise<RecordVenteResult> {
  const article = await getArticle(db, input.articleId);
  if (!article) throw new Error('Article introuvable.');
  const prixUnitaire = article.prix_detail ?? 0;
  const montantNormal = input.quantite * prixUnitaire;
  const boutiqueId = article.boutique_id || (await requireBoutiqueId(db));
  const prixAchat =
    input.prixAchat !== undefined ? input.prixAchat : article.prix_achat;

  let mouvement!: Mouvement;
  await db.withTransactionAsync(async () => {
    if (input.prixAchat != null && input.prixAchat !== article.prix_achat) {
      const now = new Date().toISOString();
      await db.runAsync(
        'UPDATE articles SET prix_achat = ?, modifie_le = ?, a_envoyer = 1 WHERE id = ?',
        [input.prixAchat, now, article.id]
      );
    }
    mouvement = await insertMouvement(db, {
      boutique_id: boutiqueId,
      article_id: article.id,
      type: 'entree',
      quantite: input.quantite,
      tarif: null,
      prix_unitaire: prixUnitaire,
      montant_normal: montantNormal,
      montant_paye: 0,
      cout_unitaire: prixAchat,
      cree_par: input.creePar ?? null,
    });
  });
  const updated = (await getArticle(db, article.id))!;
  return { mouvement, article: updated };
}

/**
 * Correction manuelle du stock depuis la fiche article.
 * La quantité du mouvement est le delta signé (stock voulu − stock actuel).
 */
export async function recordCorrection(
  db: SQLiteDatabase,
  articleId: string,
  nouveauStock: number,
  creePar?: string | null
): Promise<{ mouvement: Mouvement | null; article: Article }> {
  const article = await getArticle(db, articleId);
  if (!article) throw new Error('Article introuvable.');
  const ecart = nouveauStock - article.stock;
  if (ecart === 0) return { mouvement: null, article };

  const boutiqueId = article.boutique_id || (await requireBoutiqueId(db));
  const mouvement = await insertMouvement(db, {
    boutique_id: boutiqueId,
    article_id: article.id,
    type: 'correction',
    quantite: ecart,
    tarif: null,
    prix_unitaire: article.prix_detail ?? 0,
    montant_normal: 0,
    montant_paye: 0,
    cout_unitaire: article.prix_achat,
    cree_par: creePar ?? null,
  });
  const updated = (await getArticle(db, article.id))!;
  return { mouvement, article: updated };
}

/** Annule une ligne ; le stock se recalcule tout seul (mouvements annulés ignorés). */
export async function cancelMouvement(db: SQLiteDatabase, mouvementId: string): Promise<void> {
  const m = await db.getFirstAsync<Mouvement>('SELECT * FROM mouvements WHERE id = ?', [
    mouvementId,
  ]);
  if (!m || m.annule) return;
  const now = new Date().toISOString();
  await db.runAsync(
    'UPDATE mouvements SET annule = 1, annule_le = ?, modifie_le = ?, a_envoyer = 1 WHERE id = ?',
    [now, now, m.id]
  );
  notifyLocalDataChange();
}

function startEndOfToday(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  return { start, end };
}

export interface MouvementAvecArticle extends Mouvement {
  article_nom: string;
  article_categorie: Article['categorie'];
}

export async function listMouvementsDuJour(db: SQLiteDatabase): Promise<MouvementAvecArticle[]> {
  const boutiqueId = await getSetting(db, SETTINGS_KEYS.boutiqueId);
  if (!boutiqueId) return [];
  const { start, end } = startEndOfToday();
  return db.getAllAsync<MouvementAvecArticle>(
    `SELECT m.*, a.nom AS article_nom, a.categorie AS article_categorie
     FROM mouvements m JOIN articles a ON a.id = m.article_id
     WHERE m.boutique_id = ? AND m.cree_le >= ? AND m.cree_le < ?
     ORDER BY m.cree_le DESC`,
    [boutiqueId, start, end]
  );
}

export interface TotalDuJour {
  totalMeches: number;
  totalProduits: number;
  total: number;
  nbVentes: number;
}

export async function totalVentesDuJour(db: SQLiteDatabase): Promise<TotalDuJour> {
  const boutiqueId = await getSetting(db, SETTINGS_KEYS.boutiqueId);
  if (!boutiqueId) {
    return { totalMeches: 0, totalProduits: 0, total: 0, nbVentes: 0 };
  }
  const { start, end } = startEndOfToday();
  const rows = await db.getAllAsync<{ categorie: Article['categorie']; montant: number }>(
    `SELECT a.categorie as categorie, m.montant_paye as montant
     FROM mouvements m JOIN articles a ON a.id = m.article_id
     WHERE m.boutique_id = ? AND m.type = 'vente' AND m.annule = 0
       AND m.cree_le >= ? AND m.cree_le < ?`,
    [boutiqueId, start, end]
  );
  let totalMeches = 0;
  let totalProduits = 0;
  for (const r of rows) {
    if (r.categorie === 'meches') totalMeches += r.montant;
    else totalProduits += r.montant;
  }
  return {
    totalMeches,
    totalProduits,
    total: totalMeches + totalProduits,
    nbVentes: rows.length,
  };
}

export async function countArticlesFinis(db: SQLiteDatabase): Promise<number> {
  const boutiqueId = await getSetting(db, SETTINGS_KEYS.boutiqueId);
  if (!boutiqueId) return 0;
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) as n FROM articles a
     WHERE a.boutique_id = ? AND a.actif = 1 AND ${stockExpr('a.id')} <= 0`,
    [boutiqueId]
  );
  return row?.n ?? 0;
}
