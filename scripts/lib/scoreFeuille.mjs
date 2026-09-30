/**
 * Score feuille : appariement par proximité + ventilation articles justes / faux / null.
 */
import { normaliserNom, similariteTexte } from './rapprochementFeuille.mjs';

function scorePaire(lu, att) {
  const sim = similariteTexte(lu.texte_lu || '', att.texte_lu || '');
  let s = sim * 3;
  if (att.quantite != null && Number(lu.quantite) === Number(att.quantite)) s += 1;
  const mLu = lu.montant_lu ?? lu.prix_lu;
  if (att.montant != null && mLu != null && Math.abs(Number(mLu) - Number(att.montant)) <= 1) {
    s += 1;
  }
  return s;
}

export function apparierLignes(lues, attendues) {
  const candidats = [];
  for (let i = 0; i < lues.length; i++) {
    for (let j = 0; j < attendues.length; j++) {
      const s = scorePaire(lues[i], attendues[j]);
      if (s >= 1.2) candidats.push({ i, j, s });
    }
  }
  candidats.sort((a, b) => b.s - a.s);
  const usedLu = new Set();
  const usedAtt = new Set();
  const paires = [];
  for (const c of candidats) {
    if (usedLu.has(c.i) || usedAtt.has(c.j)) continue;
    usedLu.add(c.i);
    usedAtt.add(c.j);
    paires.push(c);
  }
  const enTrop = lues.map((l, i) => ({ i, l })).filter((x) => !usedLu.has(x.i));
  const manquantes = attendues.map((a, j) => ({ j, a })).filter((x) => !usedAtt.has(x.j));
  return { paires, enTrop, manquantes };
}

function articlesMatch(artLu, artAtt) {
  if (artAtt == null) return artLu == null;
  if (artLu == null) return false;
  const a = normaliserNom(artAtt);
  const b = normaliserNom(artLu);
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Classification article pour une paire :
 * - juste : proposition correcte (ou les deux null)
 * - faux : proposition non nulle et incorrecte
 * - null_ok : pas de proposition (Maman choisira) alors qu’un article était attendu, OU les deux null comptés dans null_ok aussi ?
 *
 * Règle demandée :
 *   justes | FAUX (proposition erronée) | null (acceptables)
 * Les deux null → null (acceptable), pas « juste » au sens proposition.
 * att X + lu null → null
 * att X + lu X → juste
 * att X + lu Y → faux
 * att null + lu null → null
 * att null + lu Y → faux
 */
function classerArticle(lu, att) {
  const artAtt = att.article == null ? null : att.article;
  const artLu = lu.article_propose || null;
  if (artLu == null) return 'null_ok';
  if (articlesMatch(artLu, artAtt)) return 'juste';
  return 'faux';
}

export function scoreLignesAppariees(luesIn, attendues) {
  const lues = (luesIn || []).filter((l) => !l.barree);
  const { paires, enTrop, manquantes } = apparierLignes(lues, attendues);

  let artJ = 0,
    artFaux = 0,
    artNull = 0,
    qJ = 0,
    mJ = 0,
    lignesCompletes = 0;
  const fausses = [];
  const details = [];
  const tableau = [];

  for (const { i, j, s } of paires) {
    const lu = lues[i];
    const att = attendues[j];
    const classe = classerArticle(lu, att);
    if (classe === 'juste') artJ++;
    else if (classe === 'faux') artFaux++;
    else artNull++;

    const qAtt = att.quantite;
    const qLu = lu.quantite;
    const qOk =
      qAtt == null || qAtt === '' ? true : Number(qLu) === Number(qAtt);

    const mAtt = att.montant;
    const mLu = lu.montant_lu ?? lu.prix_lu;
    const mOk =
      mAtt == null || mAtt === ''
        ? true
        : mLu != null && Math.abs(Number(mLu) - Number(mAtt)) <= 1;

    if (qOk) qJ++;
    if (mOk) mJ++;
    const artOk = classe === 'juste';
    // ligne complète : qté+montant OK et article juste (null n’est pas « complet »)
    const ok = artOk && qOk && mOk;
    if (ok) lignesCompletes++;
    if (classe === 'faux' || !qOk || !mOk) {
      fausses.push({
        i,
        j,
        classe_article: classe,
        texte_lu: lu.texte_lu,
        artOk,
        qOk,
        mOk,
        lu: { article: lu.article_propose, quantite: qLu, montant: mLu },
        attendu: { article: att.article, texte_lu: att.texte_lu, quantite: qAtt, montant: mAtt },
      });
    }
    details.push({ i, j, classe_article: classe, artOk, qOk, mOk, score_appariement: s });
    tableau.push({
      texte_lu: lu.texte_lu,
      quantite: qLu,
      montant: mLu,
      article_attendu: att.article,
      article_propose: lu.article_propose,
      classe_article: classe,
    });
  }

  for (const { i, l } of enTrop) {
    fausses.push({
      i,
      raison: 'ligne en trop côté IA',
      texte_lu: l.texte_lu,
      lu: l,
      attendu: null,
    });
    details.push({ i, ok: false, raison: 'en_trop' });
  }
  for (const { j, a } of manquantes) {
    fausses.push({
      j,
      raison: 'ligne manquante côté IA',
      texte_lu: a.texte_lu,
      lu: null,
      attendu: a,
    });
    details.push({ j, ok: false, raison: 'manquante' });
    // manquante = pas de proposition → plutôt null côté article pour cette attendue
    artNull++;
  }

  const den = attendues.length || 1;
  return {
    article: {
      justes: artJ,
      faux: artFaux,
      null_ok: artNull,
      total: attendues.length,
      taux_justes: Math.round((1000 * artJ) / den) / 10,
      taux_faux: Math.round((1000 * artFaux) / den) / 10,
      taux_null: Math.round((1000 * artNull) / den) / 10,
    },
    quantite: { justes: qJ, total: attendues.length, taux: Math.round((1000 * qJ) / den) / 10 },
    montant: { justes: mJ, total: attendues.length, taux: Math.round((1000 * mJ) / den) / 10 },
    ligne_complete: {
      justes: lignesCompletes,
      total: attendues.length,
      taux: Math.round((1000 * lignesCompletes) / den) / 10,
    },
    en_trop: enTrop.map((x) => ({
      texte_lu: x.l.texte_lu,
      quantite: x.l.quantite,
      montant: x.l.montant_lu ?? x.l.prix_lu,
    })),
    manquantes: manquantes.map((x) => ({
      texte_lu: x.a.texte_lu,
      article: x.a.article,
      quantite: x.a.quantite,
      montant: x.a.montant,
    })),
    tableau,
    fausses,
    details,
  };
}
