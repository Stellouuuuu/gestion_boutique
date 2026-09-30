/**
 * Score feuille : appariement par proximité (texte + qté + montant), pas par position.
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

/**
 * Apparie chaque ligne lue à au plus une attendue (greedy sur score).
 * @returns {{ paires, enTrop, manquantes }}
 */
export function apparierLignes(lues, attendues) {
  const candidats = [];
  for (let i = 0; i < lues.length; i++) {
    for (let j = 0; j < attendues.length; j++) {
      const s = scorePaire(lues[i], attendues[j]);
      if (s >= 1.2) candidats.push({ i, j, s }); // au moins un peu de texte commun
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

function artOk(lu, att) {
  const orange =
    lu.confiance === 'basse' ||
    !lu.article_propose ||
    !!lu.chiffre_ambigu ||
    (Array.isArray(lu.variantes) && lu.variantes.length > 1);
  const artAtt = att.article == null ? null : normaliserNom(att.article);
  const artLu = lu.article_propose ? normaliserNom(lu.article_propose) : null;
  let ok =
    artAtt == null
      ? artLu == null
      : artLu != null && (artLu === artAtt || artLu.includes(artAtt) || artAtt.includes(artLu));
  if (att.chiffre_ambigu && orange) ok = true;
  return { ok, orange };
}

/**
 * Score après appariement.
 */
export function scoreLignesAppariees(luesIn, attendues) {
  // Ignorer lignes barrées côté lu
  const lues = (luesIn || []).filter((l) => !l.barree);
  const { paires, enTrop, manquantes } = apparierLignes(lues, attendues);

  let artJ = 0,
    qJ = 0,
    mJ = 0,
    lignesCompletes = 0;
  const fausses = [];
  const details = [];

  for (const { i, j, s } of paires) {
    const lu = lues[i];
    const att = attendues[j];
    const { ok: aOk, orange } = artOk(lu, att);

    const qAtt = att.quantite;
    const qLu = lu.quantite;
    let qOk =
      qAtt == null || qAtt === ''
        ? orange || att.chiffre_ambigu
        : Number(qLu) === Number(qAtt);
    if (att.chiffre_ambigu && orange) qOk = true;

    const mAtt = att.montant;
    const mLu = lu.montant_lu ?? lu.prix_lu;
    let mOk =
      mAtt == null || mAtt === ''
        ? true
        : mLu != null && Math.abs(Number(mLu) - Number(mAtt)) <= 1;

    if (aOk) artJ++;
    if (qOk) qJ++;
    if (mOk) mJ++;
    const ok = aOk && qOk && mOk;
    if (ok) lignesCompletes++;
    else {
      fausses.push({
        i,
        j,
        score_appariement: Math.round(s * 100) / 100,
        texte_lu: lu.texte_lu,
        artOk: aOk,
        qOk,
        mOk,
        orange,
        lu: { article: lu.article_propose, quantite: qLu, montant: mLu, confiance: lu.confiance },
        attendu: { article: att.article, texte_lu: att.texte_lu, quantite: qAtt, montant: mAtt },
      });
    }
    details.push({ i, j, ok, artOk: aOk, qOk, mOk, orange, score_appariement: s });
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
  }

  const den = attendues.length || 1;
  return {
    article: { justes: artJ, total: attendues.length, taux: Math.round((1000 * artJ) / den) / 10 },
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
    fausses,
    details,
  };
}
