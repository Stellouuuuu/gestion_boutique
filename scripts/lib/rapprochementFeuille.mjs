/**
 * Rapprochement texte manuscrit → article (hors Gemini).
 * Ordre : alias unique → alias multi (prix) → ressemblance prudente + prix.
 * Une proposition fausse est pire qu’un null.
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

export function normaliserTexteAlias(s) {
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
  if (!t) return '';
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

/** Tokens distinctifs (sans mots courants, longueur ≥ 3 ou chiffre). */
export function tokensDistinctifs(s) {
  return normaliserNom(s)
    .split(' ')
    .filter(Boolean)
    .filter((w) => !MOTS_COURANTS.has(w))
    .filter((w) => w.length >= 3 || /^\d/.test(w));
}

/** Indice de taille présent dans le texte (petit/grand/moyen), ou null. */
export function tailleIndice(s) {
  const n = normaliserNom(s).split(' ').filter(Boolean);
  if (n.some((w) => w === 'petit' || w === 'pt' || w === 'petite')) return 'petit';
  if (n.some((w) => w === 'grand' || w === 'gr' || w === 'grd' || w === 'grande')) return 'grand';
  if (n.some((w) => w === 'moyen' || w === 'moyenne')) return 'moyen';
  return null;
}

/** Retire les parenthèses type « (12-100) » (prix de lot, pas le nom). */
export function texteSansPack(s) {
  return String(s ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

export function similariteTexte(a, b) {
  const q = normaliserNom(a);
  const n = normaliserNom(b);
  if (!q || !n) return 0;
  if (q === n) return 1;
  const td = tokensDistinctifs(a);
  const tn = tokensDistinctifs(b);
  if (!td.length || !tn.length) return 0;
  let inter = 0;
  for (const t of td) if (tn.includes(t)) inter++;
  if (!inter) return 0;
  return inter / Math.max(td.length, tn.length);
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

export function prixCompatible(unit, article, tol = TOLERANCE_PRIX) {
  if (unit == null || !Number.isFinite(unit) || unit <= 0) return false;
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

function unitPrice(opts) {
  if (opts.montant == null) return null;
  if (opts.quantite > 0) return opts.montant / opts.quantite;
  return opts.montant;
}

/**
 * @param {Map<string, string>} aliases texte → article_id (unique)
 * @param {Map<string, string[]>} aliasMulti texte → article_ids (ambigus)
 */
export function rapprocherAvecAlias(texteLu, catalogue, aliases, opts = {}, aliasMulti = new Map()) {
  const byId = Object.fromEntries(catalogue.map((a) => [a.id, a]));
  const cle = normaliserTexteAlias(texteLu);
  const cleCompact = cle.replace(/\s+/g, '');
  const unit = unitPrice(opts);

  // 1) Alias unique = source de vérité pour le nom (pas de filtre mot distinctif).
  //    Prix : toujours vérifié si on a un montant (évite Super glue à 1000 F).
  const aliasId =
    (cle && aliases.get(cle)) || (cleCompact && aliases.get(cleCompact)) || null;
  if (aliasId && byId[aliasId]) {
    const art = byId[aliasId];
    if (unit == null || prixCompatible(unit, art)) {
      return {
        articleId: aliasId,
        score: 0.99,
        nomCatalogue: art.nom,
        via: 'alias',
        variantes: [],
      };
    }
  }

  // 2) Alias multi → départage prix (+ règle pétal ≥ 300)
  const multiIds =
    (cle && aliasMulti.get(cle)) || (cleCompact && aliasMulti.get(cleCompact)) || null;
  if (multiIds?.length) {
    const cands = multiIds.map((id) => byId[id]).filter(Boolean);
    const estPetal = /^(petal|petals)$/.test(cle) || /^(petal|petals)$/.test(cleCompact);
    if (estPetal && unit != null && unit >= 300) {
      const grand = cands.find((a) => /petal one/.test(normaliserNom(a.nom)));
      if (grand) {
        return {
          articleId: grand.id,
          score: 0.96,
          nomCatalogue: grand.nom,
          via: 'alias_multi_petal',
          variantes: [grand],
        };
      }
    }
    const okPrix = unit != null ? cands.filter((a) => prixCompatible(unit, a)) : [];
    if (okPrix.length === 1) {
      return {
        articleId: okPrix[0].id,
        score: 0.95,
        nomCatalogue: okPrix[0].nom,
        via: 'alias_multi',
        variantes: okPrix,
      };
    }
    if (okPrix.length > 1) {
      // Préférer l’écart de prix le plus petit si clairement meilleur
      const ranked = okPrix
        .map((a) => {
          const prix = [a.prix_detail, a.prix_gros]
            .filter((p) => p != null && Number(p) > 0)
            .map(Number);
          const ecart = Math.min(...prix.map((p) => Math.abs(p - unit) / p));
          return { a, ecart };
        })
        .sort((x, y) => x.ecart - y.ecart);
      if (ranked.length >= 2 && ranked[1].ecart - ranked[0].ecart >= 0.15) {
        return {
          articleId: ranked[0].a.id,
          score: 0.94,
          nomCatalogue: ranked[0].a.nom,
          via: 'alias_multi',
          variantes: okPrix,
        };
      }
    }
    return {
      articleId: null,
      score: 0,
      nomCatalogue: null,
      via: 'alias_multi_indetermine',
      variantes: okPrix.length ? okPrix : cands.slice(0, 3),
    };
  }

  // 3) Ressemblance prudente
  const texteClean = texteSansPack(texteLu);
  const distTokens = tokensDistinctifs(texteClean);
  if (!distTokens.length || !catalogue.length) {
    return { articleId: null, score: 0, nomCatalogue: null, via: 'aucun', variantes: [] };
  }
  if (unit == null) {
    return { articleId: null, score: 0, nomCatalogue: null, via: 'sans_prix', variantes: [] };
  }

  const tailleQ = tailleIndice(texteLu);

  // Mot trop court / unique SANS taille → trop ambigu (Limé).
  // « Gel Petit » a une taille → on continue (gel est distinctif).
  if (distTokens.length === 1 && distTokens[0].length <= 4 && !tailleQ) {
    return { articleId: null, score: 0, nomCatalogue: null, via: 'trop_court', variantes: [] };
  }

  function tokenMatch(t, artTokens) {
    if (artTokens.includes(t)) return true;
    if (t.length < 3) return false;
    const maxDist = t.length >= 5 ? 2 : 1;
    return artTokens.some((at) => {
      if (at.length < 3) return false;
      if (Math.abs(at.length - t.length) > maxDist) return false;
      return distanceLevenshtein(t, at) <= maxDist;
    });
  }

  const scored = [];
  for (const a of catalogue) {
    const artTokens = tokensDistinctifs(a.nom);
    if (!artTokens.length) continue;
    const commun = distTokens.filter((t) => tokenMatch(t, artTokens));
    if (commun.length !== distTokens.length) continue;
    if (!prixCompatible(unit, a)) continue;

    const tailleA = tailleIndice(a.nom);
    // Taille explicite contradictoire → skip
    if (tailleQ && tailleA && tailleQ !== tailleA) continue;

    const artCov = commun.length / artTokens.length;
    let score = 0.7 + artCov * 0.25;
    if (distTokens[0] && tokenMatch(distTokens[0], artTokens)) score = Math.min(1, score + 0.05);
    // Bonus fort si la taille demandée est présente sur l’article
    if (tailleQ && tailleA === tailleQ) score = Math.min(1, score + 0.18);
    // Pénalité si on a demandé une taille et l’article n’en a pas
    if (tailleQ && !tailleA) score -= 0.12;
    const prix = [a.prix_detail, a.prix_gros]
      .filter((p) => p != null && Number(p) > 0)
      .map(Number);
    let ecartPrix = 1;
    if (prix.length) {
      ecartPrix = Math.min(...prix.map((p) => Math.abs(p - unit) / p));
      score = Math.min(1, score + Math.max(0, 0.2 - ecartPrix * 0.2));
    }
    scored.push({ id: a.id, nom: a.nom, score, commun, ecartPrix, tailleA });
  }
  // Si une taille est demandée et qu’au moins un candidat la porte, ignorer les autres
  let pool = scored;
  if (tailleQ && scored.some((s) => s.tailleA === tailleQ)) {
    pool = scored.filter((s) => s.tailleA === tailleQ);
  }
  pool.sort((a, b) => b.score - a.score || a.ecartPrix - b.ecartPrix);
  const top = pool.filter((s) => s.score >= 0.7).slice(0, 3);
  if (!top.length) {
    return { articleId: null, score: 0, nomCatalogue: null, via: 'ressemblance', variantes: [] };
  }
  const best = top[0];
  const second = top[1];
  // Doute seulement si scores ET prix encore très proches
  if (second && best.score - second.score < 0.06 && Math.abs(best.ecartPrix - second.ecartPrix) < 0.08) {
    return {
      articleId: null,
      score: best.score,
      nomCatalogue: null,
      via: 'ressemblance_indetermine',
      variantes: top,
    };
  }
  return {
    articleId: best.id,
    score: best.score,
    nomCatalogue: best.nom,
    via: 'ressemblance',
    variantes: [best],
  };
}

export function confianceDepuis(score, articleId, ambigu, multiVariantes) {
  if (ambigu || multiVariantes || !articleId) return 'basse';
  if (score >= 0.9) return 'haute';
  if (score >= 0.72) return 'moyenne';
  return 'basse';
}
