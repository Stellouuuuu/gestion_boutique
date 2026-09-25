import type { SQLiteDatabase } from 'expo-sqlite';
import { notifyLocalDataChange } from '../lib/syncBus.ts';
import { newId } from '../lib/uuid.ts';
import { getSetting, SETTINGS_KEYS } from './settings.ts';
import { stockExpr } from './stockSql.ts';
import type {
  Inventaire,
  InventaireLigne,
  PerimetreInventaire,
  StatutInventaire,
} from './types.ts';

export type InventairesDb = Pick<
  SQLiteDatabase,
  'getAllAsync' | 'getFirstAsync' | 'runAsync' | 'withTransactionAsync'
>;

async function requireBoutiqueId(db: InventairesDb): Promise<string> {
  const boutiqueId = await getSetting(db as SQLiteDatabase, SETTINGS_KEYS.boutiqueId);
  if (!boutiqueId) throw new Error('Aucune boutique associée à cet appareil.');
  return boutiqueId;
}

export async function getInventaireEnCours(
  db: InventairesDb
): Promise<Inventaire | null> {
  return db.getFirstAsync<Inventaire>(
    `SELECT * FROM inventaires WHERE statut = 'en_cours' ORDER BY commence_le DESC LIMIT 1`
  );
}

export async function listInventaires(db: InventairesDb): Promise<Inventaire[]> {
  return db.getAllAsync<Inventaire>(
    `SELECT * FROM inventaires ORDER BY commence_le DESC`
  );
}

export async function getInventaire(
  db: InventairesDb,
  id: string
): Promise<Inventaire | null> {
  return db.getFirstAsync<Inventaire>(`SELECT * FROM inventaires WHERE id = ?`, [id]);
}

export interface InventaireLigneAvecArticle extends InventaireLigne {
  article_nom: string;
  article_categorie: 'meches' | 'produits';
  prix_detail: number | null;
  prix_achat: number | null;
}

export async function listLignesInventaire(
  db: InventairesDb,
  inventaireId: string
): Promise<InventaireLigneAvecArticle[]> {
  return db.getAllAsync(
    `SELECT l.*, a.nom AS article_nom, a.categorie AS article_categorie,
            a.prix_detail, a.prix_achat
     FROM inventaire_lignes l
     JOIN articles a ON a.id = l.article_id
     WHERE l.inventaire_id = ?
     ORDER BY a.nom COLLATE NOCASE`,
    [inventaireId]
  );
}

export async function compterProgression(
  db: InventairesDb,
  inventaireId: string
): Promise<{ comptes: number; total: number }> {
  const inv = await getInventaire(db, inventaireId);
  if (!inv) return { comptes: 0, total: 0 };
  const comptesRow = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM inventaire_lignes WHERE inventaire_id = ?`,
    [inventaireId]
  );
  const catFilter =
    inv.perimetre === 'tout'
      ? ''
      : inv.perimetre === 'meches'
        ? `AND categorie = 'meches'`
        : `AND categorie = 'produits'`;
  const totalRow = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM articles WHERE actif = 1 ${catFilter}`
  );
  return { comptes: comptesRow?.n ?? 0, total: totalRow?.n ?? 0 };
}

/** Articles du périmètre pas encore comptés, avec stock actuel (attendu au moment du comptage). */
export async function listArticlesACompter(
  db: InventairesDb,
  inventaireId: string
): Promise<{ id: string; nom: string; categorie: 'meches' | 'produits'; stock: number }[]> {
  const inv = await getInventaire(db, inventaireId);
  if (!inv) return [];
  const catFilter =
    inv.perimetre === 'tout'
      ? ''
      : inv.perimetre === 'meches'
        ? `AND a.categorie = 'meches'`
        : `AND a.categorie = 'produits'`;
  return db.getAllAsync(
    `SELECT a.id, a.nom, a.categorie, ${stockExpr('a.id')} AS stock
     FROM articles a
     WHERE a.actif = 1 ${catFilter}
       AND a.id NOT IN (SELECT article_id FROM inventaire_lignes WHERE inventaire_id = ?)
     ORDER BY a.nom COLLATE NOCASE`,
    [inventaireId]
  );
}

export async function commencerInventaire(
  db: InventairesDb,
  perimetre: PerimetreInventaire,
  faitPar: string | null
): Promise<Inventaire> {
  const enCours = await getInventaireEnCours(db);
  if (enCours) throw new Error('Un inventaire est déjà en cours. Reprenez-le ou abandonnez-le.');
  const boutiqueId = await requireBoutiqueId(db);
  const now = new Date().toISOString();
  const id = newId();
  await db.runAsync(
    `INSERT INTO inventaires
       (id, boutique_id, perimetre, statut, fait_par, commence_le, termine_le, note, modifie_le, a_envoyer)
     VALUES (?, ?, ?, 'en_cours', ?, ?, NULL, NULL, ?, 1)`,
    [id, boutiqueId, perimetre, faitPar, now, now]
  );
  notifyLocalDataChange();
  const created = await getInventaire(db, id);
  if (!created) throw new Error('Échec de création de l’inventaire.');
  return created;
}

/**
 * Enregistre le comptage d’un article.
 * stock_attendu = stock calculé AU MOMENT du comptage (ventes pendant l’inventaire OK).
 */
export async function compterArticle(
  db: InventairesDb,
  inventaireId: string,
  articleId: string,
  stockCompte: number
): Promise<InventaireLigne> {
  if (stockCompte < 0 || !Number.isInteger(stockCompte)) {
    throw new Error('Le nombre compté doit être un entier ≥ 0.');
  }
  const inv = await getInventaire(db, inventaireId);
  if (!inv || inv.statut !== 'en_cours') throw new Error('Inventaire non modifiable.');

  const art = await db.getFirstAsync<{
    id: string;
    boutique_id: string;
    stock: number;
  }>(`SELECT id, boutique_id, ${stockExpr('articles.id')} AS stock FROM articles WHERE id = ?`, [
    articleId,
  ]);
  if (!art) throw new Error('Article introuvable.');

  const now = new Date().toISOString();
  const existing = await db.getFirstAsync<InventaireLigne>(
    `SELECT * FROM inventaire_lignes WHERE inventaire_id = ? AND article_id = ?`,
    [inventaireId, articleId]
  );

  if (existing) {
    await db.runAsync(
      `UPDATE inventaire_lignes
       SET stock_attendu = ?, stock_compte = ?, compte_le = ?, modifie_le = ?, a_envoyer = 1
       WHERE id = ?`,
      [art.stock, stockCompte, now, now, existing.id]
    );
    await db.runAsync(`UPDATE inventaires SET modifie_le = ?, a_envoyer = 1 WHERE id = ?`, [
      now,
      inventaireId,
    ]);
    notifyLocalDataChange();
    return (await db.getFirstAsync<InventaireLigne>(
      `SELECT * FROM inventaire_lignes WHERE id = ?`,
      [existing.id]
    ))!;
  }

  const id = newId();
  await db.runAsync(
    `INSERT INTO inventaire_lignes
       (id, inventaire_id, boutique_id, article_id, stock_attendu, stock_compte, compte_le, mouvement_id, modifie_le, a_envoyer)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 1)`,
    [id, inventaireId, art.boutique_id, articleId, art.stock, stockCompte, now, now]
  );
  await db.runAsync(`UPDATE inventaires SET modifie_le = ?, a_envoyer = 1 WHERE id = ?`, [
    now,
    inventaireId,
  ]);
  notifyLocalDataChange();
  return (await db.getFirstAsync<InventaireLigne>(
    `SELECT * FROM inventaire_lignes WHERE id = ?`,
    [id]
  ))!;
}

export interface EcartResume {
  nbArticlesEcart: number;
  manquePieces: number;
  manqueValeur: number;
  tropPieces: number;
  tropValeur: number;
  lignes: InventaireLigneAvecArticle[];
}

export async function resumeEcarts(
  db: InventairesDb,
  inventaireId: string
): Promise<EcartResume> {
  const lignes = await listLignesInventaire(db, inventaireId);
  const avecEcart = lignes.filter((l) => l.stock_compte !== l.stock_attendu);
  let manquePieces = 0;
  let manqueValeur = 0;
  let tropPieces = 0;
  let tropValeur = 0;
  for (const l of avecEcart) {
    const delta = l.stock_compte - l.stock_attendu;
    const pu = l.prix_detail ?? l.prix_achat ?? 0;
    if (delta < 0) {
      manquePieces += -delta;
      manqueValeur += -delta * pu;
    } else {
      tropPieces += delta;
      tropValeur += delta * pu;
    }
  }
  return {
    nbArticlesEcart: avecEcart.length,
    manquePieces,
    manqueValeur,
    tropPieces,
    tropValeur,
    lignes: avecEcart,
  };
}

/** Valide : crée un mouvement correction par écart, lie à la ligne. */
export async function validerInventaire(
  db: InventairesDb,
  inventaireId: string,
  creePar: string | null
): Promise<void> {
  const inv = await getInventaire(db, inventaireId);
  if (!inv || inv.statut !== 'en_cours') throw new Error('Inventaire non validable.');
  const resume = await resumeEcarts(db, inventaireId);
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    for (const l of resume.lignes) {
      const delta = l.stock_compte - l.stock_attendu;
      if (delta === 0) continue;
      const mouvId = newId();
      await db.runAsync(
        `INSERT INTO mouvements
           (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
            cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
         VALUES (?, ?, ?, 'correction', ?, NULL, 0, 0, 0, ?, 0, ?, ?, ?, 1)`,
        [
          mouvId,
          l.boutique_id,
          l.article_id,
          delta,
          l.prix_achat,
          creePar,
          now,
          now,
        ]
      );
      await db.runAsync(
        `UPDATE inventaire_lignes SET mouvement_id = ?, modifie_le = ?, a_envoyer = 1 WHERE id = ?`,
        [mouvId, now, l.id]
      );
    }
    await db.runAsync(
      `UPDATE inventaires SET statut = 'termine', termine_le = ?, modifie_le = ?, a_envoyer = 1 WHERE id = ?`,
      [now, now, inventaireId]
    );
  });
  notifyLocalDataChange();
}

export async function abandonnerInventaire(
  db: InventairesDb,
  inventaireId: string
): Promise<void> {
  const inv = await getInventaire(db, inventaireId);
  if (!inv || inv.statut !== 'en_cours') throw new Error('Inventaire non abandonnable.');
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE inventaires SET statut = 'abandonne', termine_le = ?, modifie_le = ?, a_envoyer = 1 WHERE id = ?`,
    [now, now, inventaireId]
  );
  notifyLocalDataChange();
}

export interface PertesAnnee {
  pieces: number;
  valeur: number;
}

/** Pertes (écarts négatifs) des inventaires terminés depuis le 1er janvier local. */
export async function pertesDepuisJanvier(
  db: InventairesDb,
  now = new Date()
): Promise<PertesAnnee> {
  const y = now.getFullYear();
  // Approximation : commence_le ISO >= 1er jan UTC+1
  const debut = new Date(Date.UTC(y, 0, 1, 0, 0, 0) - 3600e3).toISOString();
  const rows = await db.getAllAsync<{
    stock_attendu: number;
    stock_compte: number;
    prix_detail: number | null;
    prix_achat: number | null;
  }>(
    `SELECT l.stock_attendu, l.stock_compte, a.prix_detail, a.prix_achat
     FROM inventaire_lignes l
     JOIN inventaires i ON i.id = l.inventaire_id
     JOIN articles a ON a.id = l.article_id
     WHERE i.statut = 'termine' AND i.commence_le >= ?
       AND l.stock_compte < l.stock_attendu`,
    [debut]
  );
  let pieces = 0;
  let valeur = 0;
  for (const r of rows) {
    const d = r.stock_attendu - r.stock_compte;
    pieces += d;
    valeur += d * (r.prix_detail ?? r.prix_achat ?? 0);
  }
  return { pieces, valeur };
}

export async function joursDepuisDernierInventaireTermine(
  db: InventairesDb,
  now = Date.now()
): Promise<number | null> {
  const last = await db.getFirstAsync<{ termine_le: string }>(
    `SELECT termine_le FROM inventaires WHERE statut = 'termine' AND termine_le IS NOT NULL
     ORDER BY termine_le DESC LIMIT 1`
  );
  if (!last?.termine_le) return null;
  const t = Date.parse(last.termine_le);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now - t) / (24 * 60 * 60 * 1000));
}

export function labelPerimetre(p: PerimetreInventaire): string {
  if (p === 'meches') return 'Mèches seulement';
  if (p === 'produits') return 'Produits seulement';
  return 'Tout';
}

export function labelStatut(s: StatutInventaire): string {
  if (s === 'en_cours') return 'En cours';
  if (s === 'abandonne') return 'Abandonné';
  return 'Terminé';
}
