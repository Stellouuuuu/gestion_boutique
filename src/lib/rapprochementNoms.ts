/**
 * Rapprochement de noms manuscrits ↔ catalogue boutique.
 * Prudent : mots courants ignorés, mot distinctif requis, prix ±40 %.
 * Une proposition fausse est pire qu’un null.
 */

const ABBREV: Record<string, string> = {
  grd: 'grand',
  gd: 'grand',
  gr: 'grand',
  gde: 'grande',
  pt: 'petit',
  pte: 'petite',
  ptt: 'petit',
  nbr: 'nombre',
  pcs: 'pieces',
  pc: 'piece',
  bte: 'boite',
  bt: 'boite',
  fl: 'flacon',
  flc: 'flacon',
  sch: 'sachet',
  sht: 'sachet',
  mec: 'meche',
  mch: 'meche',
  tress: 'tresse',
  trs: 'tresse',
  shamp: 'shampooing',
  shampo: 'shampooing',
  shampoing: 'shampooing',
  cond: 'conditioner',
  apres: 'apres',
  'a/s': 'apres shampooing',
};

/** Mots trop courants — ignorés pour la ressemblance. */
export const MOTS_COURANTS = new Set([
  'petit',
  'pt',
  'petite',
  'grand',
  'gr',
  'grd',
  'grande',
  'moyen',
  'moyenne',
  'de',
  'du',
  'le',
  'la',
  'les',
  'et',
  'un',
  'une',
  'des',
  'en',
  'a',
  'au',
  'aux',
]);

/** Tolérance prix unitaire vs détail/gros (−40 % … +40 %). */
export const TOLERANCE_PRIX = 0.4;

export function normaliserNom(s: string): string {
  let t = String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`]/g, ' ')
    .replace(/[-_/]+/g, ' ')
    .replace(/[^a-z0-9\s/+.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  const parts = t.split(' ').map((w) => ABBREV[w] ?? w);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Clé d’alias : retire aussi les quantités type 1P, 02, ½. */
export function normaliserTexteAlias(s: string): string {
  let t = String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/½/g, ' 1/2 ')
    .replace(/[''`]/g, ' ')
    .replace(/(\w)-(\w)/g, '$1$2')
    .replace(/[_/]+/g, ' ')
    .replace(/[^a-z0-9\s/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  t = t
    .replace(/\b\d+p\b/g, ' ')
    .replace(/\b1\/2\b/g, ' ')
    .replace(/\s+\d{1,2}$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  return t
    .split(' ')
    .filter(Boolean)
    .map((w) => ABBREV[w] ?? w)
    .join(' ');
}

export function tokensDistinctifs(s: string): string[] {
  return normaliserNom(s)
    .split(' ')
    .filter(Boolean)
    .filter((w) => !MOTS_COURANTS.has(w))
    .filter((w) => w.length >= 3 || /^\d/.test(w));
}

export function tailleIndice(s: string): 'petit' | 'grand' | 'moyen' | null {
  const n = normaliserNom(s).split(' ').filter(Boolean);
  if (n.some((w) => w === 'petit' || w === 'pt' || w === 'petite')) return 'petit';
  if (n.some((w) => w === 'grand' || w === 'gr' || w === 'grd' || w === 'grande')) {
    return 'grand';
  }
  if (n.some((w) => w === 'moyen' || w === 'moyenne')) return 'moyen';
  return null;
}

function texteSansPack(s: string): string {
  return String(s ?? '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distance de Levenshtein bornée (pour scores rapides). */
export function distanceLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  const prev = new Array<number>(n + 1);
  const cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j]!;
  }
  return prev[n]!;
}

export interface ArticleRef {
  id: string;
  nom: string;
  prix_detail?: number | null;
  prix_gros?: number | null;
}

export interface MatchResultat {
  articleId: string | null;
  score: number; // 0..1
  nomCatalogue: string | null;
}

export function prixCompatible(
  unit: number,
  article: ArticleRef,
  tol = TOLERANCE_PRIX
): boolean {
  if (!Number.isFinite(unit) || unit <= 0) return false;
  const prix = [article.prix_detail, article.prix_gros].filter(
    (p) => p != null && Number(p) > 0
  );
  if (!prix.length) return false;
  for (const p of prix) {
    const ratio = unit / Number(p);
    if (ratio >= 1 - tol && ratio <= 1 + tol) return true;
  }
  return false;
}

/**
 * Choisit le meilleur article du catalogue pour un texte lu.
 * opts.montant / quantite : prix unitaire pour filtrer (±40 %).
 * Sans prix : uniquement match exact (normalisé).
 */
export function rapprocherArticle(
  texteLu: string,
  catalogue: ArticleRef[],
  seuil = 0.62,
  opts?: { montant?: number | null; quantite?: number }
): MatchResultat {
  const q = normaliserNom(texteLu);
  if (!q || catalogue.length === 0) {
    return { articleId: null, score: 0, nomCatalogue: null };
  }

  const unit =
    opts?.montant != null && opts?.quantite && opts.quantite > 0
      ? opts.montant / opts.quantite
      : opts?.montant != null
        ? opts.montant
        : null;

  // Match exact (normalisé) — avant toute comparaison de prix
  for (const a of catalogue) {
    const n = normaliserNom(a.nom);
    if (n && n === q) {
      return { articleId: a.id, score: 1, nomCatalogue: a.nom };
    }
  }

  const distTokens = tokensDistinctifs(texteSansPack(texteLu));
  if (!distTokens.length) {
    return { articleId: null, score: 0, nomCatalogue: null };
  }
  // Sans prix : trop risqué pour une proposition floue
  if (unit == null) {
    return { articleId: null, score: 0, nomCatalogue: null };
  }

  const tailleQ = tailleIndice(texteLu);
  const scored: Array<{ id: string; nom: string; score: number; tailleA?: string }> = [];
  for (const a of catalogue) {
    const artTokens = tokensDistinctifs(a.nom);
    if (!artTokens.length) continue;
    const commun = distTokens.filter((t) => {
      if (artTokens.includes(t)) return true;
      if (t.length < 3) return false;
      const maxDist = t.length >= 5 ? 2 : 1;
      return artTokens.some((at) => {
        if (at.length < 3) return false;
        if (Math.abs(at.length - t.length) > maxDist) return false;
        return distanceLevenshtein(t, at) <= maxDist;
      });
    });
    if (commun.length !== distTokens.length) continue;
    if (!prixCompatible(unit, a)) continue;
    const tailleA = tailleIndice(a.nom);
    if (tailleQ && tailleA && tailleQ !== tailleA) continue;

    const artCov = commun.length / artTokens.length;
    let score = 0.7 + artCov * 0.25;
    if (distTokens[0] && commun.includes(distTokens[0])) {
      score = Math.min(1, score + 0.05);
    }
    if (tailleQ && tailleA === tailleQ) score = Math.min(1, score + 0.18);
    if (tailleQ && !tailleA) score -= 0.12;
    scored.push({ id: a.id, nom: a.nom, score, tailleA: tailleA ?? undefined });
  }
  let pool = scored;
  if (tailleQ && scored.some((s) => s.tailleA === tailleQ)) {
    pool = scored.filter((s) => s.tailleA === tailleQ);
  }
  pool.sort((a, b) => b.score - a.score);
  const top = pool.filter((s) => s.score >= 0.7).slice(0, 3);
  if (!top.length) return { articleId: null, score: 0, nomCatalogue: null };
  const best = top[0]!;
  const second = top[1];
  if (second && best.score - second.score < 0.06) {
    return { articleId: null, score: best.score, nomCatalogue: null };
  }
  if (best.score < seuil) {
    return { articleId: null, score: best.score, nomCatalogue: best.nom };
  }
  return { articleId: best.id, score: best.score, nomCatalogue: best.nom };
}

export function confianceDepuisScore(
  score: number,
  articleId: string | null
): 'haute' | 'moyenne' | 'basse' {
  if (!articleId) return 'basse';
  if (score >= 0.9) return 'haute';
  if (score >= 0.72) return 'moyenne';
  return 'basse';
}
