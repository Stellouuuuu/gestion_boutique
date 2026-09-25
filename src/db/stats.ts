/**
 * Statistiques §E — tous les calculs en SQL SQLite.
 */
import type { BilansDb } from './bilans.ts';
import { stockExpr } from './stockSql.ts';
import { STOCK_BAS } from './types.ts';
import {
  buildStatsPeriode,
  statsPeriodePrecedente,
  type StatsPeriodeBounds,
  type StatsPeriodeKind,
} from './statsPeriodes.ts';
import { fromLocal, partsLocal } from './periodes.ts';

export type { StatsPeriodeBounds, StatsPeriodeKind };

/** Expression date locale Porto-Novo (UTC+1) pour GROUP BY. */
const LOCAL_DATE = `date(datetime(cree_le, '+1 hour'))`;
const LOCAL_MONTH = `strftime('%Y-%m', datetime(cree_le, '+1 hour'))`;
const LOCAL_DOW = `CAST(strftime('%w', datetime(cree_le, '+1 hour')) AS INTEGER)`;

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;
const JOURS_COURT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'] as const;
const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

export interface PointBarre {
  cle: string;
  label: string;
  valeur: number;
}

export interface EvolutionVentes {
  points: PointBarre[];
  moyenne: number;
  total: number;
  totalPrecedent: number;
  variationPct: number | null;
  phrase: string;
}

export interface ArticleRacheter {
  id: string;
  nom: string;
  stock: number;
  vendus30j: number;
  parSemaine: number;
  phrase: string;
}

export interface TopArticle {
  id: string;
  nom: string;
  valeur: number;
}

export interface MeilleuresVentes {
  topArgent: TopArticle[];
  topBenefice: TopArticle[];
  phrase: string;
}

export interface ArgentDort {
  articles: { id: string; nom: string; stock: number; valeurAchat: number | null }[];
  nb: number;
  valeurAchatTotal: number | null;
  phrase: string;
}

export interface JourSemaine {
  dow: number;
  label: string;
  labelCourt: string;
  moyenne: number;
}

export interface MeilleursJours {
  jours: JourSemaine[];
  phrase: string;
}

export interface PartCategories {
  mechesArgent: number;
  produitsArgent: number;
  mechesBenefice: number;
  produitsBenefice: number;
  phrase: string;
}

export interface DetailGros {
  detail: number;
  gros: number;
  pctGros: number | null;
  phrase: string;
}

export interface ReductionsStats {
  total: number;
  chiffre: number;
  pct: number | null;
  nb: number;
  phrase: string;
}

export interface ArticleMargeFaible {
  id: string;
  nom: string;
  margePct: number;
  aPerte: boolean;
}

export interface MargeParArticle {
  articles: ArticleMargeFaible[];
  phrase: string;
}

export interface StatsCompletes {
  periode: StatsPeriodeBounds;
  evolution: EvolutionVentes;
  aRacheter: ArticleRacheter[];
  meilleures: MeilleuresVentes;
  argentDort: ArgentDort;
  meilleursJours: MeilleursJours;
  categories: PartCategories;
  detailGros: DetailGros;
  reductions: ReductionsStats;
  marges: MargeParArticle;
}

function pctVar(actuel: number, precedent: number): number | null {
  if (precedent === 0) return actuel === 0 ? null : 100;
  return Math.round((100 * (actuel - precedent)) / precedent);
}

function phraseEvolution(
  kind: StatsPeriodeKind,
  points: PointBarre[],
  variationPct: number | null,
  total: number
): string {
  if (total === 0) return 'Aucune vente sur cette période. Les graphiques se rempliront dès les premières ventes.';
  if (kind === '12mois' && points.length >= 2) {
    const a = points[points.length - 1]!;
    const b = points[points.length - 2]!;
    if (b.valeur === 0) {
      return a.valeur > 0
        ? `Vos ventes de ${a.label} ont démarré (${Math.round(a.valeur).toLocaleString('fr-FR')} F).`
        : 'Peu de ventes sur les derniers mois.';
    }
    const v = Math.round((100 * (a.valeur - b.valeur)) / b.valeur);
    if (v > 0) return `Vos ventes de ${a.label} sont ${v} % au-dessus de ${b.label}.`;
    if (v < 0) return `Vos ventes de ${a.label} sont ${Math.abs(v)} % en dessous de ${b.label}.`;
    return `Vos ventes de ${a.label} sont stables par rapport à ${b.label}.`;
  }
  if (variationPct == null) return `Vous avez encaissé ${Math.round(total).toLocaleString('fr-FR')} F sur la période.`;
  if (variationPct > 0) {
    return `Vos ventes sont ${variationPct} % au-dessus de la période précédente. Continuez comme ça.`;
  }
  if (variationPct < 0) {
    return `Vos ventes sont ${Math.abs(variationPct)} % en dessous de la période précédente. Regardez les articles à promouvoir.`;
  }
  return 'Vos ventes sont stables par rapport à la période précédente.';
}

async function sommeEncaisse(db: BilansDb, debut: string, fin: string): Promise<number> {
  const row = await db.getFirstAsync<{ s: number | null }>(
    `SELECT SUM(montant_paye) AS s FROM mouvements
     WHERE type = 'vente' AND annule = 0 AND cree_le >= ? AND cree_le < ?`,
    [debut, fin]
  );
  return row?.s ?? 0;
}

async function calcEvolution(
  db: BilansDb,
  periode: StatsPeriodeBounds
): Promise<EvolutionVentes> {
  const prev = statsPeriodePrecedente(periode);
  const total = await sommeEncaisse(db, periode.debutIso, periode.finIso);
  const totalPrecedent = await sommeEncaisse(db, prev.debutIso, prev.finIso);
  const variationPct = pctVar(total, totalPrecedent);

  let points: PointBarre[] = [];

  if (periode.kind === '30j') {
    const rows = await db.getAllAsync<{ jour: string; s: number }>(
      `SELECT ${LOCAL_DATE} AS jour, SUM(montant_paye) AS s
       FROM mouvements
       WHERE type = 'vente' AND annule = 0 AND cree_le >= ? AND cree_le < ?
       GROUP BY jour ORDER BY jour`,
      [periode.debutIso, periode.finIso]
    );
    const map = new Map(rows.map((r) => [r.jour, r.s]));
    const debut = new Date(periode.debutIso);
    const dp = partsLocal(debut);
    for (let i = 0; i < 30; i++) {
      const d = fromLocal(dp.y, dp.m, dp.day + i);
      const cle = `${partsLocal(d).y}-${String(partsLocal(d).m + 1).padStart(2, '0')}-${String(partsLocal(d).day).padStart(2, '0')}`;
      const p = partsLocal(d);
      points.push({
        cle,
        label: i % 5 === 0 || i === 29 ? `${p.day}/${p.m + 1}` : '',
        valeur: map.get(cle) ?? 0,
      });
    }
  } else if (periode.kind === '3mois') {
    // Une barre par semaine (lundi local)
    const rows = await db.getAllAsync<{ jour: string; s: number }>(
      `SELECT ${LOCAL_DATE} AS jour, SUM(montant_paye) AS s
       FROM mouvements
       WHERE type = 'vente' AND annule = 0 AND cree_le >= ? AND cree_le < ?
       GROUP BY jour`,
      [periode.debutIso, periode.finIso]
    );
    const byWeek = new Map<string, number>();
    for (const r of rows) {
      const [y, m, day] = r.jour.split('-').map(Number);
      const d = fromLocal(y, m - 1, day);
      const p = partsLocal(d);
      const delta = p.dow === 0 ? -6 : 1 - p.dow;
      const lun = fromLocal(p.y, p.m, p.day + delta);
      const lp = partsLocal(lun);
      const cle = `${lp.y}-${String(lp.m + 1).padStart(2, '0')}-${String(lp.day).padStart(2, '0')}`;
      byWeek.set(cle, (byWeek.get(cle) ?? 0) + r.s);
    }
    points = [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cle, valeur], i, arr) => {
        const [, , day] = cle.split('-');
        return {
          cle,
          label: i === 0 || i === arr.length - 1 || i % 3 === 0 ? `${Number(day)}` : '',
          valeur,
        };
      });
  } else {
    const rows = await db.getAllAsync<{ mois: string; s: number }>(
      `SELECT ${LOCAL_MONTH} AS mois, SUM(montant_paye) AS s
       FROM mouvements
       WHERE type = 'vente' AND annule = 0 AND cree_le >= ? AND cree_le < ?
       GROUP BY mois ORDER BY mois`,
      [periode.debutIso, periode.finIso]
    );
    const map = new Map(rows.map((r) => [r.mois, r.s]));
    const debut = new Date(periode.debutIso);
    const dp = partsLocal(debut);
    for (let i = 0; i < 12; i++) {
      const d = fromLocal(dp.y, dp.m + i, 1);
      const p = partsLocal(d);
      const cle = `${p.y}-${String(p.m + 1).padStart(2, '0')}`;
      points.push({
        cle,
        label: MOIS[p.m]!.slice(0, 3),
        valeur: map.get(cle) ?? 0,
      });
    }
  }

  const moyenne =
    points.length === 0 ? 0 : points.reduce((s, p) => s + p.valeur, 0) / points.length;

  return {
    points,
    moyenne,
    total,
    totalPrecedent,
    variationPct,
    phrase: phraseEvolution(periode.kind, points, variationPct, total),
  };
}

async function calcARacheter(db: BilansDb, nowIsoFin: string): Promise<ArticleRacheter[]> {
  const fin = new Date(nowIsoFin);
  const debut30 = new Date(fin.getTime() - 30 * 86_400_000);
  const rows = await db.getAllAsync<{
    id: string;
    nom: string;
    stock: number;
    vendus: number;
  }>(
    `SELECT a.id, a.nom, ${stockExpr('a.id')} AS stock,
            COALESCE((
              SELECT SUM(m.quantite) FROM mouvements m
              WHERE m.article_id = a.id AND m.type = 'vente' AND m.annule = 0
                AND m.cree_le >= ? AND m.cree_le < ?
            ), 0) AS vendus
     FROM articles a
     WHERE a.actif = 1
       AND ${stockExpr('a.id')} <= ${STOCK_BAS}
       AND COALESCE((
         SELECT SUM(m.quantite) FROM mouvements m
         WHERE m.article_id = a.id AND m.type = 'vente' AND m.annule = 0
           AND m.cree_le >= ? AND m.cree_le < ?
       ), 0) > 0
     ORDER BY vendus DESC
     LIMIT 15`,
    [debut30.toISOString(), nowIsoFin, debut30.toISOString(), nowIsoFin]
  );

  return rows.map((r) => {
    const parSemaine = Math.round((r.vendus / 30) * 7 * 10) / 10;
    const phrase =
      r.stock <= 0
        ? `${r.nom} : plus de stock, vous en vendez environ ${parSemaine} par semaine. À racheter tout de suite.`
        : `${r.nom} : il en reste ${r.stock}, vous en vendez environ ${parSemaine} par semaine.`;
    return {
      id: r.id,
      nom: r.nom,
      stock: r.stock,
      vendus30j: r.vendus,
      parSemaine,
      phrase,
    };
  });
}

async function calcMeilleures(
  db: BilansDb,
  debut: string,
  fin: string
): Promise<MeilleuresVentes> {
  const topArgent = await db.getAllAsync<TopArticle>(
    `SELECT a.id, a.nom, SUM(m.montant_paye) AS valeur
     FROM mouvements m JOIN articles a ON a.id = m.article_id
     WHERE m.type = 'vente' AND m.annule = 0 AND m.cree_le >= ? AND m.cree_le < ?
     GROUP BY a.id
     ORDER BY valeur DESC
     LIMIT 10`,
    [debut, fin]
  );
  const topBenefice = await db.getAllAsync<TopArticle>(
    `SELECT a.id, a.nom,
            SUM(m.montant_paye - m.quantite * m.cout_unitaire) AS valeur
     FROM mouvements m JOIN articles a ON a.id = m.article_id
     WHERE m.type = 'vente' AND m.annule = 0 AND m.cree_le >= ? AND m.cree_le < ?
       AND m.cout_unitaire IS NOT NULL
     GROUP BY a.id
     ORDER BY valeur DESC
     LIMIT 10`,
    [debut, fin]
  );
  const best = topArgent[0];
  const phrase = best
    ? `${best.nom} rapporte le plus : ${Math.round(best.valeur).toLocaleString('fr-FR')} F encaissés. Gardez-en toujours en stock.`
    : 'Pas encore assez de ventes pour un classement.';
  return { topArgent, topBenefice, phrase };
}

async function calcArgentDort(db: BilansDb, finIso: string): Promise<ArgentDort> {
  const debut60 = new Date(new Date(finIso).getTime() - 60 * 86_400_000).toISOString();
  const rows = await db.getAllAsync<{
    id: string;
    nom: string;
    stock: number;
    prix_achat: number | null;
  }>(
    `SELECT a.id, a.nom, ${stockExpr('a.id')} AS stock, a.prix_achat
     FROM articles a
     WHERE a.actif = 1
       AND ${stockExpr('a.id')} > 0
       AND NOT EXISTS (
         SELECT 1 FROM mouvements m
         WHERE m.article_id = a.id AND m.type = 'vente' AND m.annule = 0
           AND m.cree_le >= ? AND m.cree_le < ?
       )
     ORDER BY (CASE WHEN a.prix_achat IS NULL THEN 0 ELSE a.prix_achat * ${stockExpr('a.id')} END) DESC
     LIMIT 40`,
    [debut60, finIso]
  );

  const articles = rows.map((r) => ({
    id: r.id,
    nom: r.nom,
    stock: r.stock,
    valeurAchat: r.prix_achat == null ? null : r.prix_achat * r.stock,
  }));
  const avecPrix = articles.filter((a) => a.valeurAchat != null);
  const valeurAchatTotal =
    avecPrix.length === 0 ? null : avecPrix.reduce((s, a) => s + (a.valeurAchat ?? 0), 0);
  const nb = articles.length;
  let phrase: string;
  if (nb === 0) {
    phrase = 'Aucun article qui dort : tout votre stock a bougé ces 2 derniers mois.';
  } else if (valeurAchatTotal != null) {
    phrase = `${nb} article${nb > 1 ? 's' : ''} n’${nb > 1 ? 'ont' : 'a'} rien vendu depuis 2 mois : ${Math.round(valeurAchatTotal).toLocaleString('fr-FR')} F de marchandise qui dort. Pensez à une promotion.`;
  } else {
    phrase = `${nb} article${nb > 1 ? 's' : ''} sans vente depuis 2 mois. Ajoutez les prix d’achat pour voir la valeur immobilisée, et pensez à une promotion.`;
  }
  return { articles, nb, valeurAchatTotal, phrase };
}

async function calcMeilleursJours(
  db: BilansDb,
  debut: string,
  fin: string
): Promise<MeilleursJours> {
  const rows = await db.getAllAsync<{ dow: number; total: number; nb_jours: number }>(
    `SELECT ${LOCAL_DOW} AS dow,
            SUM(montant_paye) AS total,
            COUNT(DISTINCT ${LOCAL_DATE}) AS nb_jours
     FROM mouvements
     WHERE type = 'vente' AND annule = 0 AND cree_le >= ? AND cree_le < ?
     GROUP BY dow`,
    [debut, fin]
  );
  const map = new Map(rows.map((r) => [r.dow, r]));
  // Afficher lundi → dimanche
  const ordre = [1, 2, 3, 4, 5, 6, 0];
  const jours: JourSemaine[] = ordre.map((dow) => {
    const r = map.get(dow);
    const moyenne = r && r.nb_jours > 0 ? r.total / r.nb_jours : 0;
    return {
      dow,
      label: JOURS[dow]!,
      labelCourt: JOURS_COURT[dow]!,
      moyenne,
    };
  });
  const tries = [...jours].sort((a, b) => b.moyenne - a.moyenne);
  const best = tries[0]!;
  const worst = [...tries].reverse().find((j) => j.moyenne > 0) ?? tries[tries.length - 1]!;
  let phrase: string;
  if (best.moyenne === 0) {
    phrase = 'Pas encore assez de ventes pour comparer les jours.';
  } else if (worst.moyenne > 0 && best.dow !== worst.dow) {
    const ratio = Math.round((best.moyenne / worst.moyenne) * 10) / 10;
    phrase =
      ratio >= 1.5
        ? `Le ${best.label} rapporte ${ratio} fois plus que le ${worst.label}. Prévoyez plus de stock ce jour-là.`
        : `Le ${best.label} est votre meilleur jour. Le ${worst.label} est le plus calme.`;
  } else {
    phrase = `Le ${best.label} est votre meilleur jour de la semaine.`;
  }
  return { jours, phrase };
}

async function calcCategories(
  db: BilansDb,
  debut: string,
  fin: string
): Promise<PartCategories> {
  const rows = await db.getAllAsync<{
    categorie: string;
    argent: number;
    benefice: number;
  }>(
    `SELECT a.categorie,
            SUM(m.montant_paye) AS argent,
            SUM(CASE WHEN m.cout_unitaire IS NOT NULL
                     THEN m.montant_paye - m.quantite * m.cout_unitaire ELSE 0 END) AS benefice
     FROM mouvements m JOIN articles a ON a.id = m.article_id
     WHERE m.type = 'vente' AND m.annule = 0 AND m.cree_le >= ? AND m.cree_le < ?
     GROUP BY a.categorie`,
    [debut, fin]
  );
  let mechesArgent = 0;
  let produitsArgent = 0;
  let mechesBenefice = 0;
  let produitsBenefice = 0;
  for (const r of rows) {
    if (r.categorie === 'meches') {
      mechesArgent = r.argent;
      mechesBenefice = r.benefice;
    } else {
      produitsArgent = r.argent;
      produitsBenefice = r.benefice;
    }
  }
  const tot = mechesArgent + produitsArgent;
  let phrase: string;
  if (tot === 0) phrase = 'Aucune vente pour comparer mèches et produits.';
  else {
    const pctM = Math.round((100 * mechesArgent) / tot);
    const pctP = 100 - pctM;
    if (pctM >= pctP) {
      phrase = `Les mèches représentent ${pctM} % de l’argent encaissé. Les produits : ${pctP} %.`;
    } else {
      phrase = `Les produits représentent ${pctP} % de l’argent encaissé. Les mèches : ${pctM} %.`;
    }
  }
  return { mechesArgent, produitsArgent, mechesBenefice, produitsBenefice, phrase };
}

async function calcDetailGros(
  db: BilansDb,
  debut: string,
  fin: string
): Promise<DetailGros> {
  const rows = await db.getAllAsync<{ tarif: string | null; s: number }>(
    `SELECT tarif, SUM(montant_paye) AS s FROM mouvements
     WHERE type = 'vente' AND annule = 0 AND cree_le >= ? AND cree_le < ?
     GROUP BY tarif`,
    [debut, fin]
  );
  let detail = 0;
  let gros = 0;
  for (const r of rows) {
    if (r.tarif === 'gros') gros = r.s;
    else detail += r.s; // detail + null
  }
  const tot = detail + gros;
  const pctGros = tot === 0 ? null : Math.round((100 * gros) / tot);
  let phrase: string;
  if (tot === 0) phrase = 'Pas encore de ventes détail / gros sur la période.';
  else if (pctGros === 0) phrase = 'Tout est vendu au détail. Le gros pourrait faire monter le volume.';
  else if ((pctGros ?? 0) >= 40) {
    phrase = `Le gros représente ${pctGros} % des ventes. C’est une bonne part de votre chiffre.`;
  } else {
    phrase = `Le gros représente ${pctGros} % des ventes. Le reste est du détail.`;
  }
  return { detail, gros, pctGros, phrase };
}

async function calcReductions(
  db: BilansDb,
  debut: string,
  fin: string
): Promise<ReductionsStats> {
  const row = await db.getFirstAsync<{
    total: number | null;
    chiffre: number | null;
    nb: number | null;
  }>(
    `SELECT
       SUM(CASE WHEN montant_paye < montant_normal THEN montant_normal - montant_paye ELSE 0 END) AS total,
       SUM(montant_paye) AS chiffre,
       SUM(CASE WHEN montant_paye < montant_normal THEN 1 ELSE 0 END) AS nb
     FROM mouvements
     WHERE type = 'vente' AND annule = 0 AND cree_le >= ? AND cree_le < ?`,
    [debut, fin]
  );
  const total = row?.total ?? 0;
  const chiffre = row?.chiffre ?? 0;
  const nb = row?.nb ?? 0;
  const pct = chiffre === 0 ? null : Math.round((100 * total) / (chiffre + total));
  let phrase: string;
  if (chiffre === 0) phrase = 'Aucune vente : pas de réductions à analyser.';
  else if (total === 0) phrase = 'Aucune réduction accordée sur la période. Bravo pour les prix tenus.';
  else if ((pct ?? 0) >= 10) {
    phrase = `Vous avez accordé ${Math.round(total).toLocaleString('fr-FR')} F de réductions (${pct} % du chiffre). Attention à ne pas trop baisser.`;
  } else {
    phrase = `Réductions : ${Math.round(total).toLocaleString('fr-FR')} F (${pct} % du chiffre, ${nb} vente${nb > 1 ? 's' : ''}). C’est raisonnable.`;
  }
  return { total, chiffre, pct, nb, phrase };
}

async function calcMarges(
  db: BilansDb,
  debut: string,
  fin: string
): Promise<MargeParArticle> {
  const rows = await db.getAllAsync<{
    id: string;
    nom: string;
    argent: number;
    cout: number;
  }>(
    `SELECT a.id, a.nom,
            SUM(m.montant_paye) AS argent,
            SUM(m.quantite * m.cout_unitaire) AS cout
     FROM mouvements m JOIN articles a ON a.id = m.article_id
     WHERE m.type = 'vente' AND m.annule = 0 AND m.cree_le >= ? AND m.cree_le < ?
       AND m.cout_unitaire IS NOT NULL
     GROUP BY a.id
     HAVING argent > 0`,
    [debut, fin]
  );
  const articles: ArticleMargeFaible[] = [];
  for (const r of rows) {
    const margePct = Math.round((100 * (r.argent - r.cout)) / r.argent);
    if (margePct < 15) {
      articles.push({
        id: r.id,
        nom: r.nom,
        margePct,
        aPerte: margePct < 0,
      });
    }
  }
  articles.sort((a, b) => a.margePct - b.margePct);
  const n = articles.length;
  let phrase: string;
  if (n === 0) {
    phrase = 'Aucun article à marge trop faible (< 15 %) sur la période. Vos prix tiennent.';
  } else {
    const perte = articles.filter((a) => a.aPerte).length;
    if (perte > 0) {
      phrase = `${n} article${n > 1 ? 's' : ''} à marge faible, dont ${perte} vendu${perte > 1 ? 's' : ''} à perte. Augmentez le prix ou négociez l’achat.`;
    } else {
      phrase = `${n} article${n > 1 ? 's' : ''} se vendent presque au prix d’achat (marge < 15 %). Revoir les prix.`;
    }
  }
  return { articles: articles.slice(0, 20), phrase };
}

/** Calcule les 9 blocs de statistiques pour une période. */
export async function calculerStats(
  db: BilansDb,
  kind: StatsPeriodeKind,
  now = new Date()
): Promise<StatsCompletes> {
  const periode = buildStatsPeriode(kind, now);
  const { debutIso, finIso } = periode;

  const [
    evolution,
    aRacheter,
    meilleures,
    argentDort,
    meilleursJours,
    categories,
    detailGros,
    reductions,
    marges,
  ] = await Promise.all([
    calcEvolution(db, periode),
    calcARacheter(db, finIso),
    calcMeilleures(db, debutIso, finIso),
    calcArgentDort(db, finIso),
    calcMeilleursJours(db, debutIso, finIso),
    calcCategories(db, debutIso, finIso),
    calcDetailGros(db, debutIso, finIso),
    calcReductions(db, debutIso, finIso),
    calcMarges(db, debutIso, finIso),
  ]);

  return {
    periode,
    evolution,
    aRacheter,
    meilleures,
    argentDort,
    meilleursJours,
    categories,
    detailGros,
    reductions,
    marges,
  };
}

/** Mesure le temps de chaque bloc (tests perf). */
export async function chronometrerStats(
  db: BilansDb,
  kind: StatsPeriodeKind,
  now = new Date()
): Promise<Record<string, number>> {
  const periode = buildStatsPeriode(kind, now);
  const { debutIso, finIso } = periode;
  const times: Record<string, number> = {};

  async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    const r = await fn();
    times[name] = performance.now() - t0;
    return r;
  }

  await timed('evolution', () => calcEvolution(db, periode));
  await timed('aRacheter', () => calcARacheter(db, finIso));
  await timed('meilleures', () => calcMeilleures(db, debutIso, finIso));
  await timed('argentDort', () => calcArgentDort(db, finIso));
  await timed('meilleursJours', () => calcMeilleursJours(db, debutIso, finIso));
  await timed('categories', () => calcCategories(db, debutIso, finIso));
  await timed('detailGros', () => calcDetailGros(db, debutIso, finIso));
  await timed('reductions', () => calcReductions(db, debutIso, finIso));
  await timed('marges', () => calcMarges(db, debutIso, finIso));
  await timed('tout', () => calculerStats(db, kind, now));

  return times;
}
