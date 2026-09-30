/**
 * Rapprochement texte manuscrit → article (hors Gemini).
 * Ordre : alias exact → ressemblance nom → départage par prix unitaire.
 */

const ABBREV = {
  grd: 'grand',
  gd: 'grand',
  gr: 'grand',
  gde: 'grande',
  pt: 'petit',
  pte: 'petite',
  ptt: 'petit',
  shamp: 'shampooing',
  shampo: 'shampooing',
  shampoing: 'shampooing',
  bte: 'boite',
  bt: 'boite',
  mch: 'meche',
  mec: 'meche',
};

/** Minuscules, sans accents, abréviations, sans quantités type 1P / 02 / ½. */
export function normaliserTexteAlias(s) {
  let t = String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/½/g, ' 1/2 ')
    .replace(/[''`]/g, ' ')
    // "tam-tam" → "tamtam"
    .replace(/(\w)-(\w)/g, '$1$2')
    .replace(/[_/]+/g, ' ')
    .replace(/[^a-z0-9\s/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  // Quantités collées / tokens
  t = t
    .replace(/\b\d+p\b/g, ' ')
    .replace(/\b1\/2\b/g, ' ')
    .replace(/\s+\d{1,2}$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t
    .split(' ')
    .filter(Boolean)
    .map((w) => ABBREV[w] || w)
    .join(' ');
}

export function normaliserNom(s) {
  let t = String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`]/g, ' ')
    .replace(/[-_/]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  return t
    .split(' ')
    .map((w) => ABBREV[w] || w)
    .join(' ');
}

export function distanceLevenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const n = b.length;
  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  const cur = new Array(n + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

export function similariteTexte(a, b) {
  const q = normaliserNom(a);
  const n = normaliserNom(b);
  if (!q || !n) return 0;
  if (q === n) return 1;
  if (n.includes(q) || q.includes(n)) {
    return Math.min(1, Math.min(n.length, q.length) / Math.max(n.length, q.length) + 0.15);
  }
  const tq = new Set(q.split(' '));
  const tn = new Set(n.split(' '));
  let inter = 0;
  for (const t of tq) if (tn.has(t)) inter++;
  const union = new Set([...tq, ...tn]).size;
  const jaccard = union ? inter / union : 0;
  const dist = distanceLevenshtein(q, n);
  const lev = 1 - dist / Math.max(q.length, n.length, 1);
  return Math.max(jaccard * 0.85 + lev * 0.15, lev * 0.9);
}

/**
 * @param {string} texteLu
 * @param {{ id: string, nom: string, prix_detail?: number|null }[]} catalogue
 * @param {Map<string, string>} aliases texte_norm → article_id
 * @param {{ montant?: number|null, quantite?: number }} opts
 */
export function rapprocherAvecAlias(texteLu, catalogue, aliases, opts = {}) {
  const byId = Object.fromEntries(catalogue.map((a) => [a.id, a]));
  const cle = normaliserTexteAlias(texteLu);
  const cleCompact = cle.replace(/\s+/g, '');
  const aliasId =
    (cle && aliases.get(cle)) || (cleCompact && aliases.get(cleCompact)) || null;
  if (aliasId && byId[aliasId]) {
    return {
      articleId: aliasId,
      score: 0.99,
      nomCatalogue: byId[aliasId].nom,
      via: 'alias',
      variantes: [],
    };
  }

  const q = normaliserNom(texteLu);
  if (!q || !catalogue.length) {
    return { articleId: null, score: 0, nomCatalogue: null, via: 'aucun', variantes: [] };
  }

  const unit =
    opts.montant != null && opts.quantite > 0
      ? opts.montant / opts.quantite
      : opts.montant != null
        ? opts.montant
        : null;

  const scored = [];
  for (const a of catalogue) {
    let score = similariteTexte(texteLu, a.nom);
    if (unit != null && a.prix_detail != null && a.prix_detail > 0) {
      const ecart = Math.abs(a.prix_detail - unit) / Math.max(unit, a.prix_detail);
      if (ecart <= 0.15) score = Math.min(1, score + 0.25);
      else if (ecart <= 0.3) score = Math.min(1, score + 0.08);
      else if (score < 0.9) score *= 0.85;
    }
    scored.push({ id: a.id, nom: a.nom, score: Math.min(1, score) });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3).filter((s) => s.score >= 0.55);
  const best = scored[0];
  if (!best || best.score < 0.72) {
    return {
      articleId: null,
      score: best?.score ?? 0,
      nomCatalogue: best?.nom ?? null,
      via: 'ressemblance',
      variantes: top,
    };
  }
  const second = scored[1];
  const incertain = second && second.score >= 0.72 && best.score - second.score < 0.08;
  return {
    articleId: best.id,
    score: best.score,
    nomCatalogue: best.nom,
    via: 'ressemblance',
    variantes: incertain ? top : top.slice(0, 1),
  };
}

export function confianceDepuis(score, articleId, ambigu, multiVariantes) {
  if (ambigu || multiVariantes || !articleId) return 'basse';
  if (score >= 0.9) return 'haute';
  if (score >= 0.72) return 'moyenne';
  return 'basse';
}
