/**
 * Mode --rejouer : matching + score depuis reponses-ia/, 0 Gemini.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadTestEnv } from './env-test.mjs';
import { rapprocherAvecAlias, confianceDepuis } from './rapprochementFeuille.mjs';
import { scoreLignesAppariees } from './scoreFeuille.mjs';

const BOUTIQUE_TEST_ID = 'db88ec62-fe85-4548-8e8e-920c4f99db70';
const VERSION_ATTENDUE = 'lire-feuille-v2-single-call';

function pct(j, t) {
  return t ? Math.round((1000 * j) / t) / 10 : 0;
}

function stop(msg) {
  console.error('\n✗ ' + msg);
  process.exit(1);
}

export async function runRejouer({ dir, out, attenduPath, reponsesIa, filtreUnePhoto }) {
  console.log('Mode --rejouer : 0 appel Gemini / lire-feuille');
  const { url, service } = loadTestEnv();
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: arts, error } = await admin
    .from('articles')
    .select('id, nom, prix_detail, prix_gros')
    .eq('boutique_id', BOUTIQUE_TEST_ID)
    .eq('actif', true);
  if (error) stop('Catalogue : ' + error.message);
  const catalogue = arts || [];

  const { data: aliasRows, error: alErr } = await admin
    .from('alias_articles')
    .select('texte_norm, article_id')
    .eq('boutique_id', BOUTIQUE_TEST_ID);
  if (alErr) stop('Alias : ' + alErr.message);
  const aliases = new Map();
  for (const r of aliasRows || []) aliases.set(String(r.texte_norm), String(r.article_id));
  console.log(`Catalogue ${catalogue.length} articles · ${aliases.size} alias`);

  let fichiers = existsSync(reponsesIa)
    ? readdirSync(reponsesIa).filter((f) => f.endsWith('.json')).sort()
    : [];
  if (filtreUnePhoto) {
    fichiers = fichiers.filter((f) => f.toLowerCase().includes(filtreUnePhoto.toLowerCase()));
  }
  if (!fichiers.length) stop('Aucune réponse dans docs/exemples-feuilles/reponses-ia/');

  const attenduDoc = existsSync(attenduPath)
    ? JSON.parse(readFileSync(attenduPath, 'utf8'))
    : null;
  const resultats = {
    projet: url,
    boutique_id: BOUTIQUE_TEST_ID,
    mode: 'rejouer',
    evalue_le: new Date().toISOString(),
    version_attendue: VERSION_ATTENDUE,
    feuilles: [],
  };

  for (const f of fichiers) {
    const raw = JSON.parse(readFileSync(resolve(reponsesIa, f), 'utf8'));
    const fichier = raw.fichier || f.replace(/\.json$/i, '.JPG');
    const sec = raw.sections?.[0] || {};
    const lignes = (sec.lignes || [])
      .filter((l) => !l.barree)
      .map((l) => {
        const texte = String(l.texte_lu || '').trim();
        const montant = l.montant_lu != null ? Number(l.montant_lu) : null;
        const q = Number(l.quantite) > 0 ? Math.round(Number(l.quantite)) : 1;
        const m = rapprocherAvecAlias(texte, catalogue, aliases, { montant, quantite: q });
        const multi = (m.variantes || []).length > 1;
        return {
          texte_lu: texte,
          article_id: m.articleId,
          article_propose: m.nomCatalogue,
          quantite: q,
          tarif: l.tarif ?? null,
          montant_lu: montant,
          prix_lu: montant,
          confiance: confianceDepuis(m.score, m.articleId, !!l.chiffre_ambigu, multi),
          chiffre_ambigu: !!l.chiffre_ambigu,
          variantes: multi ? m.variantes : null,
          via: m.via,
          barree: false,
        };
      });

    resultats.feuilles.push({
      fichier,
      ok: true,
      date_suggeree: sec.date_iso ?? null,
      date_doute: !!sec.date_doute,
      total_ecrit: sec.total_ecrit ?? null,
      nb_sections: Array.isArray(raw.sections) ? raw.sections.length : 1,
      modele: raw.modele ?? null,
      nb_appels_ia: 0,
      essais_resume: 'rejouer (0 Gemini)',
      duree_ms: null,
      nb_lignes: lignes.length,
      lignes,
      score: null,
    });

    console.log(`\n→ ${fichier} (${lignes.length} lignes)`);
    for (const l of lignes) {
      const art = l.article_propose ? `→ ${l.article_propose}` : '→ (aucun)';
      console.log(
        `    • « ${l.texte_lu} » ${art}  qté=${l.quantite}  montant=${l.montant_lu ?? '—'}  [${l.confiance}/${l.via}]`
      );
    }
  }

  if (attenduDoc) {
    const byFile = Object.fromEntries((attenduDoc.feuilles || []).map((x) => [x.fichier, x]));
    console.log('\n' + '─'.repeat(60));
    console.log('Score vs attendu.json (appariement par proximité) :\n');
    const glob = {
      article: { j: 0, t: 0 },
      quantite: { j: 0, t: 0 },
      montant: { j: 0, t: 0 },
      ligne: { j: 0, t: 0 },
      total_section: { j: 0, t: 0 },
    };
    for (const fr of resultats.feuilles) {
      const att = byFile[fr.fichier];
      if (!att) {
        console.log(`  ${fr.fichier} : pas d’attendu`);
        continue;
      }
      const sc = scoreLignesAppariees(fr.lignes, att.lignes);
      const totOk =
        att.total_ecrit == null
          ? true
          : fr.total_ecrit != null && Math.abs(fr.total_ecrit - att.total_ecrit) <= 1;
      const dateOk = !att.date_iso || fr.date_suggeree === att.date_iso;
      if (att.total_ecrit != null) {
        glob.total_section.t++;
        if (totOk) glob.total_section.j++;
      }
      for (const k of ['article', 'quantite', 'montant']) {
        glob[k].j += sc[k].justes;
        glob[k].t += sc[k].total;
      }
      glob.ligne.j += sc.ligne_complete.justes;
      glob.ligne.t += sc.ligne_complete.total;
      fr.score = {
        ...sc,
        total_section: { ok: totOk, lu: fr.total_ecrit, attendu: att.total_ecrit },
        date: { ok: dateOk, lu: fr.date_suggeree, attendu: att.date_iso },
        ecart_total_attendu: !!att.ecart_total_attendu,
      };
      console.log(`  ${fr.fichier}`);
      console.log(
        `    article ${sc.article.justes}/${sc.article.total} (${sc.article.taux} %) · qté ${sc.quantite.justes}/${sc.quantite.total} (${sc.quantite.taux} %) · montant ${sc.montant.justes}/${sc.montant.total} (${sc.montant.taux} %)`
      );
      console.log(
        `    ligne complète ${sc.ligne_complete.justes}/${sc.ligne_complete.total} (${sc.ligne_complete.taux} %) · en trop ${sc.en_trop.length} · manquantes ${sc.manquantes.length} · total ${totOk ? 'OK' : '≠'} · date ${dateOk ? 'OK' : '≠'}`
      );
      if (sc.en_trop.length) {
        console.log('    en trop :');
        for (const e of sc.en_trop) {
          console.log(`      + « ${e.texte_lu} » q=${e.quantite} m=${e.montant}`);
        }
      }
      if (sc.manquantes.length) {
        console.log('    manquantes :');
        for (const e of sc.manquantes) {
          console.log(
            `      − « ${e.texte_lu} » → ${e.article ?? 'null'} q=${e.quantite} m=${e.montant}`
          );
        }
      }
      const faussesPaires = sc.fausses.filter((x) => !x.raison);
      if (faussesPaires.length) {
        console.log(`    paires incorrectes (${faussesPaires.length}) :`);
        for (const x of faussesPaires) {
          console.log(
            `      « ${x.texte_lu} » art=${x.artOk} q=${x.qOk} m=${x.mOk} → lu ${JSON.stringify(x.lu?.article)}/${x.lu?.quantite}/${x.lu?.montant} attendu ${JSON.stringify(x.attendu?.article)}/${x.attendu?.quantite}/${x.attendu?.montant}`
          );
        }
      }
      console.log('');
    }
    resultats.score_global = {
      article: { ...glob.article, taux: pct(glob.article.j, glob.article.t) },
      quantite: { ...glob.quantite, taux: pct(glob.quantite.j, glob.quantite.t) },
      montant: { ...glob.montant, taux: pct(glob.montant.j, glob.montant.t) },
      ligne_complete: { ...glob.ligne, taux: pct(glob.ligne.j, glob.ligne.t) },
      total_section: {
        ...glob.total_section,
        taux: pct(glob.total_section.j, glob.total_section.t),
      },
    };
    console.log('  GLOBAL');
    console.log(
      `    article ${resultats.score_global.article.j}/${resultats.score_global.article.t} (${resultats.score_global.article.taux} %) · montant ${resultats.score_global.montant.j}/${resultats.score_global.montant.t} (${resultats.score_global.montant.taux} %) · ligne ${resultats.score_global.ligne_complete.taux} %`
    );
  }

  writeFileSync(out, JSON.stringify(resultats, null, 2));
  console.log(`\nRésultat écrit : ${out}`);
  return resultats;
}
