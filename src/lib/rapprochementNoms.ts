/**
 * Rapprochement de noms manuscrits ↔ catalogue boutique.
 * Accents, fautes, abréviations (grd/pt, etc.).
 */

const ABBREV: Record<string, string> = {
  grd: 'grand',
  gd: 'grand',
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

export function normaliserNom(s: string): string {
  let t = String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, ' ')
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
    .replace(/['’`]/g, ' ')
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
}

export interface MatchResultat {
  articleId: string | null;
  score: number; // 0..1
  nomCatalogue: string | null;
}

/**
 * Choisit le meilleur article du catalogue pour un texte lu.
 * score ≥ 0.72 → proposition ; sinon null (à vérifier).
 * opts.montant / quantite : départage par prix unitaire.
 */
export function rapprocherArticle(
  texteLu: string,
  catalogue: ArticleRef[],
  seuil = 0.72,
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

  let best: MatchResultat = { articleId: null, score: 0, nomCatalogue: null };

  for (const a of catalogue) {
    const n = normaliserNom(a.nom);
    if (!n) continue;

    let score = 0;
    if (n === q) score = 1;
    else if (n.includes(q) || q.includes(n)) {
      score = Math.min(n.length, q.length) / Math.max(n.length, q.length) + 0.15;
      score = Math.min(1, score);
    } else {
      const tq = new Set(q.split(' '));
      const tn = new Set(n.split(' '));
      let inter = 0;
      for (const t of tq) if (tn.has(t)) inter++;
      const union = new Set([...tq, ...tn]).size;
      const jaccard = union ? inter / union : 0;
      const dist = distanceLevenshtein(q, n);
      const lev = 1 - dist / Math.max(q.length, n.length, 1);
      score = Math.max(jaccard * 0.85 + lev * 0.15, lev * 0.9);
    }

    if (unit != null && a.prix_detail != null && a.prix_detail > 0) {
      const ecart = Math.abs(a.prix_detail - unit) / Math.max(unit, a.prix_detail);
      if (ecart <= 0.15) score = Math.min(1, score + 0.25);
      else if (ecart <= 0.3) score = Math.min(1, score + 0.08);
      else if (score < 0.9) score *= 0.85;
    }

    if (score > best.score) {
      best = { articleId: a.id, score, nomCatalogue: a.nom };
    }
  }

  if (best.score < seuil) {
    return { articleId: null, score: best.score, nomCatalogue: best.nomCatalogue };
  }
  return best;
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
