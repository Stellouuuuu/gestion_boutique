/**
 * Lots issus d’une photo de feuille manuscrite.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { notifyLocalDataChange } from '../lib/syncBus.ts';
import { newId } from '../lib/uuid.ts';
import { getSetting, SETTINGS_KEYS } from './settings.ts';
import type { Tarif } from './types.ts';

export interface LigneFeuille {
  texte_lu: string;
  article_id: string | null;
  quantite: number;
  tarif: Tarif | null;
  prix_lu: number | null;
  montant: number;
  confiance: 'haute' | 'moyenne' | 'basse';
}

export interface LotPhoto {
  id: string;
  boutique_id: string;
  date_feuille: string;
  nb_lignes: number;
  total: number;
  photo_path: string | null;
  lecture_ia: string | null;
  /** Réponse brute IA (JSON) pour rejeu sans Gemini. */
  reponse_ia: string | null;
  resultat_valide: string | null;
  cree_par: string | null;
  cree_le: string;
  modifie_le: string;
  annule: number;
  a_envoyer: number;
}

export interface LigneValidee {
  article_id: string;
  quantite: number;
  tarif: Tarif;
  montant_paye: number;
}

function empreinteLot(dateFeuille: string, lignes: LigneValidee[]): string {
  const parts = [...lignes]
    .map((l) => `${l.article_id}:${l.quantite}:${l.tarif}:${l.montant_paye}`)
    .sort();
  return `${dateFeuille}|${parts.join(';')}`;
}

/** Détecte un lot non annulé déjà enregistré (même date + mêmes articles/qté/tarif). */
export async function trouverLotSimilaire(
  db: SQLiteDatabase,
  boutiqueId: string,
  dateFeuille: string,
  lignes: LigneValidee[]
): Promise<LotPhoto | null> {
  const cible = empreinteLot(dateFeuille, lignes);
  const lots = await db.getAllAsync<LotPhoto>(
    `SELECT * FROM lots_photo
     WHERE boutique_id = ? AND date_feuille = ? AND annule = 0`,
    [boutiqueId, dateFeuille]
  );
  for (const lot of lots) {
    if (!lot.resultat_valide) continue;
    try {
      const prev = JSON.parse(lot.resultat_valide) as LigneValidee[];
      if (empreinteLot(dateFeuille, prev) === cible) return lot;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function enregistrerLotPhoto(
  db: SQLiteDatabase,
  opts: {
    dateFeuille: string;
    lignes: LigneValidee[];
    lectureIa: unknown;
    /** Réponse brute de lire-feuille (rejeu sans Gemini). */
    reponseIa?: unknown;
    photoPath: string | null;
    creePar: string | null;
    /** Heure ISO pour cree_le des ventes (midi local de la date feuille). */
    creeLeVentes: string;
  }
): Promise<LotPhoto> {
  const boutiqueId = await getSetting(db, SETTINGS_KEYS.boutiqueId);
  if (!boutiqueId) throw new Error('Aucune boutique associée.');
  if (opts.lignes.length === 0) throw new Error('Aucune ligne à enregistrer.');

  const now = new Date().toISOString();
  const lotId = newId();
  let total = 0;
  for (const l of opts.lignes) total += l.montant_paye;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO lots_photo
         (id, boutique_id, date_feuille, nb_lignes, total, photo_path, lecture_ia, reponse_ia, resultat_valide,
          cree_par, cree_le, modifie_le, annule, a_envoyer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
      [
        lotId,
        boutiqueId,
        opts.dateFeuille,
        opts.lignes.length,
        total,
        opts.photoPath,
        JSON.stringify(opts.lectureIa),
        opts.reponseIa != null ? JSON.stringify(opts.reponseIa) : null,
        JSON.stringify(opts.lignes),
        opts.creePar,
        now,
        now,
      ]
    );

    for (const l of opts.lignes) {
      const article = await db.getFirstAsync<{
        id: string;
        nom: string;
        prix_detail: number | null;
        prix_gros: number | null;
        prix_achat: number | null;
      }>('SELECT id, nom, prix_detail, prix_gros, prix_achat FROM articles WHERE id = ?', [
        l.article_id,
      ]);
      if (!article) throw new Error('Article introuvable dans le lot.');
      const prixUnitaire =
        l.tarif === 'gros' ? (article.prix_gros ?? article.prix_detail) : article.prix_detail;
      if (prixUnitaire == null) throw new Error(`Prix manquant : ${article.nom}`);
      const montantNormal = l.quantite * prixUnitaire;
      await db.runAsync(
        `INSERT INTO mouvements
           (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
            cout_unitaire, annule, cree_par, source, lot_id, cree_le, modifie_le, a_envoyer)
         VALUES (?, ?, ?, 'vente', ?, ?, ?, ?, ?, ?, 0, ?, 'photo', ?, ?, ?, 1)`,
        [
          newId(),
          boutiqueId,
          l.article_id,
          l.quantite,
          l.tarif,
          prixUnitaire,
          montantNormal,
          l.montant_paye,
          article.prix_achat,
          opts.creePar,
          lotId,
          opts.creeLeVentes,
          now,
        ]
      );
    }
  });

  notifyLocalDataChange();
  const lot = await db.getFirstAsync<LotPhoto>('SELECT * FROM lots_photo WHERE id = ?', [lotId]);
  if (!lot) throw new Error('Lot non créé.');
  return lot;
}

export async function annulerLotPhoto(db: SQLiteDatabase, lotId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE lots_photo SET annule = 1, modifie_le = ?, a_envoyer = 1 WHERE id = ?`,
      [now, lotId]
    );
    await db.runAsync(
      `UPDATE mouvements
       SET annule = 1, annule_le = ?, modifie_le = ?, a_envoyer = 1
       WHERE lot_id = ? AND annule = 0`,
      [now, now, lotId]
    );
  });
  notifyLocalDataChange();
}

export async function getLotPhoto(db: SQLiteDatabase, id: string): Promise<LotPhoto | null> {
  return db.getFirstAsync<LotPhoto>('SELECT * FROM lots_photo WHERE id = ?', [id]);
}

export async function listLotsDuJour(
  db: SQLiteDatabase,
  dateFeuille: string
): Promise<LotPhoto[]> {
  const boutiqueId = await getSetting(db, SETTINGS_KEYS.boutiqueId);
  if (!boutiqueId) return [];
  return db.getAllAsync<LotPhoto>(
    `SELECT * FROM lots_photo
     WHERE boutique_id = ? AND date_feuille = ? AND annule = 0
     ORDER BY cree_le DESC`,
    [boutiqueId, dateFeuille]
  );
}

/** Estimation locale de l’espace photos (chemins locaux / cache) — octets. */
export async function estimerTaillePhotosLocales(db: SQLiteDatabase): Promise<number> {
  const boutiqueId = await getSetting(db, SETTINGS_KEYS.boutiqueId);
  if (!boutiqueId) return 0;
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) as n FROM lots_photo WHERE boutique_id = ? AND photo_path IS NOT NULL AND annule = 0`,
    [boutiqueId]
  );
  // Estimation ~100 Ko / photo compressée
  return (row?.n ?? 0) * 100_000;
}
