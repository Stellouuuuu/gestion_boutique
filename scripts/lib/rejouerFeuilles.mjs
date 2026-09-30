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

  const aliasMulti = new Map();
  const { data: candRows, error: cErr } = await admin
    .from('alias_articles_candidats')
    .select('texte_norm, article_id')
    .eq('boutique_id', BOUTIQUE_TEST_ID);
  if (cErr) {
    console.log('⚠ candidats multi absents :', cErr.message);
  } else {
    for (const r of candRows || []) {
      const k = String(r.texte_norm);
      if (!aliasMulti.has(k)) aliasMulti.set(k, []);
      aliasMulti.get(k).push(String(r.article_id));
    }
  }
  console.log(
    `Catalogue ${catalogue.length} articles · ${aliases.size} alias · ${aliasMulti.size} multi`
  );

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
        const m = rapprocherAvecAlias(texte, catalogue, aliases, { montant, quantite: q }, aliasMulti);
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
    console.log('Score vs attendu.json :\n');
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
      fr.score = {
        ...sc,
        total_section: { ok: totOk, lu: fr.total_ecrit, attendu: att.total_ecrit },
        date: { ok: dateOk, lu: fr.date_suggeree, attendu: att.date_iso },
        ecart_total_attendu: !!att.ecart_total_attendu,
      };
      console.log(`  ${fr.fichier}`);
      console.log(
        `    articles justes ${sc.article.justes}/${sc.article.total} · FAUX ${sc.article.faux} · null ${sc.article.null_ok}`
      );
      console.log(
        `    qté ${sc.quantite.justes}/${sc.quantite.total} · montant ${sc.montant.justes}/${sc.montant.total} · en trop ${sc.en_trop.length} · manquantes ${sc.manquantes.length}`
      );
      if (sc.en_trop.length) {
        for (const e of sc.en_trop) {
          console.log(`      + en trop « ${e.texte_lu} » q=${e.quantite} m=${e.montant}`);
        }
      }
      const fauxArts = (sc.fausses || []).filter((x) => x.classe_article === 'faux');
      if (fauxArts.length) {
        console.log(`    propositions FAUSSES (${fauxArts.length}) :`);
        for (const x of fauxArts) {
          console.log(
            `      « ${x.texte_lu} » → ${JSON.stringify(x.lu?.article)} (attendu ${JSON.stringify(x.attendu?.article)})`
          );
        }
      }
      if (sc.tableau?.length) {
        console.log('\n    Tableau (texte | qté | montant | attendu | proposé) :');
        for (const row of sc.tableau) {
          console.log(
            `      ${row.texte_lu} | ${row.quantite} | ${row.montant} | ${row.article_attendu ?? 'null'} | ${row.article_propose ?? 'null'}  [${row.classe_article}]`
          );
        }
      }
      console.log('');
    }
  }

  writeFileSync(out, JSON.stringify(resultats, null, 2));
  console.log(`\nRésultat écrit : ${out}`);
  return resultats;
}
