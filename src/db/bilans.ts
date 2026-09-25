import type { SQLiteDatabase } from 'expo-sqlite';
import { buildPeriode, periodePrecedente, type PeriodeBounds, type PeriodeKind } from './periodes.ts';

export type { PeriodeBounds, PeriodeKind };

/** Compatible expo-sqlite et adaptateur node:sqlite (tests). */
export type BilansDb = Pick<SQLiteDatabase, 'getAllAsync' | 'getFirstAsync'>;

export interface BeneficeEstime {
  montant: number;
  ventesAvecCout: number;
  ventesTotal: number;
  articlesSansPrix: number;
  /** Ex. « Bénéfice estimé : 45 000 F (sur 80 % des ventes, 12 articles n'ont pas de prix d'achat) » */
  label: string;
}

export interface BilanPeriode {
  periode: PeriodeBounds;
  precedente: PeriodeBounds;
  argentEncaisse: number;
  argentPrecedent: number;
  /** Variation en % vs période précédente ; null si précédent = 0. */
  variationPct: number | null;
  benefice: BeneficeEstime;
  mechesMontant: number;
  mechesPieces: number;
  produitsMontant: number;
  produitsPieces: number;
  detailMontant: number;
  grosMontant: number;
  reductionsTotal: number;
  reductionsNb: number;
  entreesPieces: number;
  entreesCout: number | null;
  entreesAvecCout: number;
  stockValeurAchat: number | null;
  stockValeurDetail: number;
  stockPieces: number;
}

export interface MouvementBilan {
  id: string;
  type: 'vente' | 'entree' | 'correction';
  quantite: number;
  tarif: 'detail' | 'gros' | null;
  prix_unitaire: number;
  montant_normal: number;
  montant_paye: number;
  cout_unitaire: number | null;
  cree_le: string;
  article_nom: string;
  article_categorie: 'meches' | 'produits';
  annule: number;
}

export interface StockArticleFin {
  id: string;
  nom: string;
  categorie: 'meches' | 'produits';
  stock: number;
  prix_achat: number | null;
  prix_detail: number | null;
  valeur_achat: number | null;
  valeur_detail: number;
}

function stockExprUntil(finIsoPlaceholder: string): string {
  return `COALESCE((
    SELECT SUM(
      CASE
        WHEN m.annule = 1 THEN 0
        WHEN m.type = 'vente' THEN -m.quantite
        ELSE m.quantite
      END
    )
    FROM mouvements m
    WHERE m.article_id = a.id AND m.cree_le < '${finIsoPlaceholder.replace(/'/g, "''")}'
  ), 0)`;
}

function labelBenefice(b: Omit<BeneficeEstime, 'label'>): string {
  if (b.ventesTotal === 0) return 'Bénéfice estimé : — (aucune vente)';
  if (b.ventesAvecCout === 0) {
    return `Bénéfice estimé : inconnu (${b.articlesSansPrix} article${b.articlesSansPrix > 1 ? 's' : ''} sans prix d’achat)`;
  }
  const pct = Math.round((100 * b.ventesAvecCout) / b.ventesTotal);
  const montant = Math.round(b.montant)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  if (b.ventesAvecCout === b.ventesTotal) {
    return `Bénéfice estimé : ${montant} F`;
  }
  return `Bénéfice estimé : ${montant} F (sur ${pct} % des ventes, ${b.articlesSansPrix} article${b.articlesSansPrix > 1 ? 's' : ''} n’ont pas de prix d’achat)`;
}

async function sommeEncaisse(db: BilansDb, debut: string, fin: string): Promise<number> {
  const row = await db.getFirstAsync<{ s: number | null }>(
    `SELECT SUM(montant_paye) AS s FROM mouvements
     WHERE type = 'vente' AND annule = 0 AND cree_le >= ? AND cree_le < ?`,
    [debut, fin]
  );
  return row?.s ?? 0;
}

export async function calculerBilan(
  db: BilansDb,
  periode: PeriodeBounds
): Promise<BilanPeriode> {
  const precedente = periodePrecedente(periode);
  const { debutIso: debut, finIso: fin } = periode;

  const ventes = await db.getAllAsync<{
    montant_paye: number;
    montant_normal: number;
    quantite: number;
    tarif: string | null;
    cout_unitaire: number | null;
    categorie: 'meches' | 'produits';
    article_id: string;
  }>(
    `SELECT m.montant_paye, m.montant_normal, m.quantite, m.tarif, m.cout_unitaire,
            a.categorie, a.id AS article_id
     FROM mouvements m
     JOIN articles a ON a.id = m.article_id
     WHERE m.type = 'vente' AND m.annule = 0 AND m.cree_le >= ? AND m.cree_le < ?`,
    [debut, fin]
  );

  let argentEncaisse = 0;
  let mechesMontant = 0;
  let mechesPieces = 0;
  let produitsMontant = 0;
  let produitsPieces = 0;
  let detailMontant = 0;
  let grosMontant = 0;
  let reductionsTotal = 0;
  let reductionsNb = 0;
  let beneficeMontant = 0;
  let ventesAvecCout = 0;
  const sansPrixIds = new Set<string>();

  for (const v of ventes) {
    argentEncaisse += v.montant_paye;
    if (v.categorie === 'meches') {
      mechesMontant += v.montant_paye;
      mechesPieces += v.quantite;
    } else {
      produitsMontant += v.montant_paye;
      produitsPieces += v.quantite;
    }
    if (v.tarif === 'gros') grosMontant += v.montant_paye;
    else detailMontant += v.montant_paye;
    if (v.montant_paye < v.montant_normal) {
      reductionsTotal += v.montant_normal - v.montant_paye;
      reductionsNb += 1;
    }
    if (v.cout_unitaire != null) {
      beneficeMontant += v.montant_paye - v.quantite * v.cout_unitaire;
      ventesAvecCout += 1;
    } else {
      sansPrixIds.add(v.article_id);
    }
  }

  const entrees = await db.getAllAsync<{
    quantite: number;
    cout_unitaire: number | null;
  }>(
    `SELECT quantite, cout_unitaire FROM mouvements
     WHERE type = 'entree' AND annule = 0 AND cree_le >= ? AND cree_le < ?`,
    [debut, fin]
  );
  let entreesPieces = 0;
  let entreesCoutSum = 0;
  let entreesAvecCout = 0;
  for (const e of entrees) {
    entreesPieces += e.quantite;
    if (e.cout_unitaire != null) {
      entreesCoutSum += e.quantite * e.cout_unitaire;
      entreesAvecCout += 1;
    }
  }

  const stockRows = await db.getAllAsync<{
    stock: number;
    prix_achat: number | null;
    prix_detail: number | null;
  }>(
    `SELECT ${stockExprUntil(fin)} AS stock, a.prix_achat, a.prix_detail
     FROM articles a WHERE a.actif = 1`
  );
  let stockPieces = 0;
  let stockValeurDetail = 0;
  let stockValeurAchat = 0;
  let stockAvecAchat = 0;
  for (const s of stockRows) {
    const st = Number(s.stock) || 0;
    if (st <= 0) continue;
    stockPieces += st;
    stockValeurDetail += st * (s.prix_detail ?? 0);
    if (s.prix_achat != null) {
      stockValeurAchat += st * s.prix_achat;
      stockAvecAchat += 1;
    }
  }

  const argentPrecedent = await sommeEncaisse(db, precedente.debutIso, precedente.finIso);
  let variationPct: number | null = null;
  if (argentPrecedent > 0) {
    variationPct = Math.round(((argentEncaisse - argentPrecedent) / argentPrecedent) * 100);
  } else if (argentEncaisse > 0) {
    variationPct = null; // pas de base comparable
  }

  const beneficeBase = {
    montant: beneficeMontant,
    ventesAvecCout,
    ventesTotal: ventes.length,
    articlesSansPrix: sansPrixIds.size,
  };

  return {
    periode,
    precedente,
    argentEncaisse,
    argentPrecedent,
    variationPct,
    benefice: { ...beneficeBase, label: labelBenefice(beneficeBase) },
    mechesMontant,
    mechesPieces,
    produitsMontant,
    produitsPieces,
    detailMontant,
    grosMontant,
    reductionsTotal,
    reductionsNb,
    entreesPieces,
    entreesCout: entreesAvecCout === entrees.length && entrees.length > 0 ? entreesCoutSum : entreesAvecCout > 0 ? entreesCoutSum : null,
    entreesAvecCout,
    stockValeurAchat: stockAvecAchat > 0 ? stockValeurAchat : null,
    stockValeurDetail,
    stockPieces,
  };
}

export async function listMouvementsPeriode(
  db: BilansDb,
  periode: PeriodeBounds,
  filtres: {
    types?: ('vente' | 'entree' | 'correction')[];
    categories?: ('meches' | 'produits')[];
    inclureAnnules?: boolean;
  } = {}
): Promise<MouvementBilan[]> {
  const types = filtres.types ?? ['vente', 'entree', 'correction'];
  const cats = filtres.categories ?? ['meches', 'produits'];
  const annules = filtres.inclureAnnules ? '' : 'AND m.annule = 0';
  const typePlaceholders = types.map(() => '?').join(',');
  const catPlaceholders = cats.map(() => '?').join(',');
  return db.getAllAsync<MouvementBilan>(
    `SELECT m.id, m.type, m.quantite, m.tarif, m.prix_unitaire, m.montant_normal, m.montant_paye,
            m.cout_unitaire, m.cree_le, m.annule, a.nom AS article_nom, a.categorie AS article_categorie
     FROM mouvements m JOIN articles a ON a.id = m.article_id
     WHERE m.cree_le >= ? AND m.cree_le < ?
       AND m.type IN (${typePlaceholders})
       AND a.categorie IN (${catPlaceholders})
       ${annules}
     ORDER BY m.cree_le DESC`,
    [periode.debutIso, periode.finIso, ...types, ...cats]
  );
}

export async function listStockFinPeriode(
  db: BilansDb,
  periode: PeriodeBounds
): Promise<StockArticleFin[]> {
  const rows = await db.getAllAsync<{
    id: string;
    nom: string;
    categorie: 'meches' | 'produits';
    stock: number;
    prix_achat: number | null;
    prix_detail: number | null;
  }>(
    `SELECT a.id, a.nom, a.categorie, ${stockExprUntil(periode.finIso)} AS stock,
            a.prix_achat, a.prix_detail
     FROM articles a
     WHERE a.actif = 1
     ORDER BY a.nom COLLATE NOCASE`
  );
  return rows.map((r) => {
    const stock = Number(r.stock) || 0;
    return {
      id: r.id,
      nom: r.nom,
      categorie: r.categorie,
      stock,
      prix_achat: r.prix_achat,
      prix_detail: r.prix_detail,
      valeur_achat: r.prix_achat != null ? stock * r.prix_achat : null,
      valeur_detail: stock * (r.prix_detail ?? 0),
    };
  });
}

export async function articlesSansPrixAchat(db: BilansDb): Promise<{ id: string; nom: string }[]> {
  return db.getAllAsync(
    `SELECT id, nom FROM articles WHERE actif = 1 AND prix_achat IS NULL ORDER BY nom COLLATE NOCASE`
  );
}

export function variationLabel(
  variationPct: number | null,
  precedente: PeriodeBounds
): string | null {
  if (variationPct == null) return null;
  const signe = variationPct > 0 ? '+' : '';
  const ref =
    precedente.kind === 'mois'
      ? precedente.label.toLowerCase()
      : precedente.kind === 'annee'
        ? precedente.label
        : precedente.kind === 'semaine'
          ? 'la semaine précédente'
          : 'la veille';
  return `${signe}${variationPct} % par rapport à ${ref}`;
}

export { buildPeriode, periodePrecedente };
