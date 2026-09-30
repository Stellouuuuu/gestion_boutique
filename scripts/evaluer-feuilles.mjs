#!/usr/bin/env node
/**
 * Évalue la lecture IA des photos d’exemple — projet TEST uniquement.
 *
 * Usage :
 *   node --env-file=.env.test scripts/evaluer-feuilles.mjs
 *   node --env-file=.env.test scripts/evaluer-feuilles.mjs --une-photo NOM.JPG
 *   node --env-file=.env.test scripts/evaluer-feuilles.mjs --rejouer [--une-photo NOM]
 *
 * --rejouer : score depuis docs/exemples-feuilles/reponses-ia/ (0 Gemini).
 * Crée si besoin un compte / boutique de test, envoie chaque JPEG/PNG de
 * docs/exemples-feuilles/ à la Edge Function lire-feuille, écrit
 * docs/exemples-feuilles/resultats.json et affiche un résumé compact
 * (modèle, HTTP, nb essais — pas le détail de chaque essai).
 */
import { randomInt } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadTestEnv } from './lib/env-test.mjs';
import { telVersIdentifiant } from './lib/tel.mjs';
import { scoreLignesAppariees } from './lib/scoreFeuille.mjs';
import { runRejouer } from './lib/rejouerFeuilles.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'docs/exemples-feuilles');
const OUT = resolve(DIR, 'resultats.json');
const ATTENDU_PATH = resolve(DIR, 'attendu.json');
const REPONSES_IA = resolve(DIR, 'reponses-ia');
/** Aligné sur supabase/functions/lire-feuille/cascade.ts */
const VERSION_ATTENDUE = 'lire-feuille-v2-single-call';

function scoreLignes(lues, attendues) {
  return scoreLignesAppariees(lues, attendues);
}

function sauvegarderReponseIa(fichier, data) {
  mkdirSync(REPONSES_IA, { recursive: true });
  const stem = basename(fichier, extname(fichier));
  const path = resolve(REPONSES_IA, `${stem}.json`);
  const section =
    Array.isArray(data.sections) && data.sections.length ? data.sections[0] : null;
  const lignesSrc = section?.lignes || data.lignes || [];
  writeFileSync(
    path,
    JSON.stringify(
      {
        _source: 'evaluer-feuilles après appel lire-feuille',
        fichier,
        modele: data.modele ?? null,
        evalue_le: new Date().toISOString(),
        sections: [
          {
            date_lue: section?.date_lue ?? null,
            date_iso: section?.date_iso ?? data.date_suggeree ?? null,
            date_doute: section?.date_doute ?? false,
            total_ecrit: section?.total_ecrit ?? data.total_ecrit ?? null,
            lignes: lignesSrc.map((l) => ({
              texte_lu: l.texte_lu,
              quantite: l.quantite,
              montant_lu: l.montant_lu ?? l.prix_lu ?? null,
              tarif: l.tarif ?? null,
              chiffre_ambigu: !!l.chiffre_ambigu,
              barree: !!l.barree,
            })),
          },
        ],
      },
      null,
      2
    )
  );
  console.log(`  (réponse IA sauvée : ${path})`);
}
const TEL = '01 99 00 00 01';
const MDP = 'test1234';
const NOM = 'Test feuilles';
const BOUTIQUE = 'Boutique test feuilles';
const email = telVersIdentifiant(TEL);

function stop(msg) {
  console.error('\n✗ ' + msg);
  process.exit(1);
}

const { url, anon, service } = loadTestEnv();
if (!url || !anon || !service) {
  stop('SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY requis dans .env.test.');
}
if (!existsSync(DIR)) stop(`Dossier introuvable : ${DIR}`);

/** --une-photo NOM : ne traite qu’un fichier (sous-chaîne ou nom exact). */
function parseUnePhotoArg(argv) {
  const i = argv.indexOf('--une-photo');
  if (i < 0) return null;
  const nom = argv[i + 1];
  if (!nom || nom.startsWith('-')) stop('--une-photo nécessite un nom de fichier');
  return nom;
}
const filtreUnePhoto = parseUnePhotoArg(process.argv.slice(2));

if (process.argv.includes('--rejouer')) {
  await runRejouer({
    dir: DIR,
    out: OUT,
    attenduPath: ATTENDU_PATH,
    reponsesIa: REPONSES_IA,
    filtreUnePhoto,
  });
  process.exit(0);
}

/** --max-appels N : plafond d’appels lire-feuille dans ce run (défaut 1). */
function parseMaxAppels(argv) {
  const i = argv.indexOf('--max-appels');
  if (i < 0) return 1;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) stop('--max-appels nécessite un entier ≥ 1');
  return n;
}
const MAX_APPELS = parseMaxAppels(process.argv.slice(2));
console.log(`Plafond run : ${MAX_APPELS} appel(s) lire-feuille (VERSION attendue ${VERSION_ATTENDUE})`);

let images = readdirSync(DIR)
  .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  .sort();
if (filtreUnePhoto) {
  const exact = images.filter((f) => f === filtreUnePhoto);
  const partiel = images.filter((f) => f.toLowerCase().includes(filtreUnePhoto.toLowerCase()));
  images = exact.length ? exact : partiel;
  if (!images.length) {
    stop(`Aucune image ne correspond à --une-photo ${filtreUnePhoto}`);
  }
  console.log(`Mode --une-photo : ${images.join(', ')}`);
}
if (!images.length) stop('Aucune image dans docs/exemples-feuilles/.');

/** Résumé compact des essais IA (pas le JSON complet). */
function resumeEssais(essais) {
  if (!Array.isArray(essais) || !essais.length) return 'aucun essai';
  const parModele = new Map();
  for (const e of essais) {
    const cle = `${e.provider || '?'}:${e.modele || '?'}`;
    const cur = parModele.get(cle) || { n: 0, https: [] };
    cur.n += 1;
    if (e.http != null) cur.https.push(e.http);
    parModele.set(cle, cur);
  }
  return [...parModele.entries()]
    .map(([m, v]) => `${m} HTTP ${[...new Set(v.https)].join('/') || '—'} ×${v.n}`)
    .join(' · ');
}
const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const client = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function trouverUtilisateur(mail) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) stop('Lecture des comptes : ' + error.message);
    const u = data.users.find((x) => x.email?.toLowerCase() === mail.toLowerCase());
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}

console.log(`Projet TEST : ${url}`);
console.log(`Compte      : ${email} / ${MDP}`);
console.log(`Photos      : ${images.length}\n`);

// --- 1. Compte ---
let user = await trouverUtilisateur(email);
if (user) {
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password: MDP,
    email_confirm: true,
  });
  if (error) stop('MàJ mot de passe : ' + error.message);
  console.log('✓ Compte existant réutilisé');
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: MDP,
    email_confirm: true,
    user_metadata: { nom: NOM, tel: TEL },
  });
  if (error) stop('Création compte : ' + error.message);
  user = data.user;
  console.log('✓ Compte créé');
}
const userId = user.id;

// --- 2. Boutique ---
const { data: membres, error: mListErr } = await admin
  .from('membres')
  .select('boutique_id, role')
  .eq('user_id', userId)
  .eq('actif', true);
if (mListErr) stop('Lecture membres : ' + mListErr.message);

let boutiqueId = null;
if (membres?.length) {
  for (const m of membres) {
    const { data: b } = await admin
      .from('boutiques')
      .select('id, nom')
      .eq('id', m.boutique_id)
      .maybeSingle();
    if (b?.nom === BOUTIQUE) {
      boutiqueId = b.id;
      break;
    }
  }
  if (!boutiqueId && membres[0]) boutiqueId = membres[0].boutique_id;
}

if (!boutiqueId) {
  const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = null;
  for (let essai = 0; essai < 10 && !boutiqueId; essai++) {
    code = Array.from({ length: 6 }, () => ALPHA[randomInt(ALPHA.length)]).join('');
    const { data, error } = await admin
      .from('boutiques')
      .insert({ nom: BOUTIQUE, code_invitation: code })
      .select('id')
      .single();
    if (!error) boutiqueId = data.id;
    else if (error.code !== '23505') stop('Création boutique : ' + error.message);
  }
  if (!boutiqueId) stop('Impossible de créer la boutique de test.');
  const { error: mErr } = await admin.from('membres').insert({
    boutique_id: boutiqueId,
    user_id: userId,
    role: 'proprietaire',
    nom: NOM,
  });
  if (mErr) stop('Ajout membre : ' + mErr.message);
  console.log('✓ Boutique créée :', BOUTIQUE);
} else {
  console.log('✓ Boutique :', boutiqueId);
}

// --- 3. Catalogue déjà synchronisé (Chez Dada → TEST) ---
// Ne pas réinjecter l’Excel ni réactiver les archivés : le script
// sync-catalogue-dada-vers-test.mjs doit avoir tourné juste avant.
const { data: arts, error: aErr } = await admin
  .from('articles')
  .select('id, nom')
  .eq('boutique_id', boutiqueId)
  .eq('actif', true);
if (aErr) stop('Lecture articles : ' + aErr.message);
if (!arts?.length) {
  stop(
    'Aucun article actif dans la boutique TEST. Lance d’abord :\n' +
      '  node --env-file=.env.test scripts/sync-catalogue-dada-vers-test.mjs'
  );
}
console.log(`✓ Catalogue TEST : ${arts.length} articles actifs (pas de seed Excel)`);
const nomParId = Object.fromEntries(arts.map((a) => [a.id, a.nom]));

// --- 4. Session utilisateur (anon) pour appeler la fonction ---
const { error: signErr } = await client.auth.signInWithPassword({
  email,
  password: MDP,
});
if (signErr) stop('Connexion : ' + signErr.message);
console.log('✓ Session ouverte\n');

const mimeOf = (f) => {
  const e = extname(f).toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.webp') return 'image/webp';
  return 'image/jpeg';
};

const resultats = {
  projet: url,
  boutique_id: boutiqueId,
  compte: email,
  evalue_le: new Date().toISOString(),
  version_attendue: VERSION_ATTENDUE,
  max_appels: MAX_APPELS,
  feuilles: [],
};

let appelsFaits = 0;

for (const f of images) {
  if (appelsFaits >= MAX_APPELS) {
    console.log(`\n✗ Plafond --max-appels=${MAX_APPELS} atteint — arrêt (photo non traitée : ${f}).`);
    stop(`Arrêt : plafond ${MAX_APPELS} appel(s) atteint.`);
  }
  const path = resolve(DIR, f);
  const buf = readFileSync(path);
  const b64 = buf.toString('base64');
  console.log(`→ ${f} (${Math.round(buf.length / 1024)} Ko)…`);

  const t0 = Date.now();
  appelsFaits += 1;
  const { data, error } = await client.functions.invoke('lire-feuille', {
    body: { image_base64: b64, mime: mimeOf(f) },
  });
  const ms = Date.now() - t0;

  /** Extrait HTTP + corps quand functions.invoke échoue. */
  async function corpsErreurInvoke(err) {
    const out = { http: null, body: null, message: err?.message || String(err) };
    try {
      const ctx = err?.context;
      if (ctx) {
        out.http = ctx.status ?? null;
        if (typeof ctx.json === 'function') {
          try {
            out.body = await ctx.json();
          } catch {
            out.body = typeof ctx.text === 'function' ? await ctx.text() : null;
          }
        } else if (typeof ctx.text === 'function') {
          out.body = await ctx.text();
        }
      }
    } catch {
      /* ignore */
    }
    return out;
  }

  if (error) {
    const info = await corpsErreurInvoke(error);
    const body = info.body && typeof info.body === 'object' ? info.body : null;
    const version = body?.version ?? null;
    if (version && version !== VERSION_ATTENDUE) {
      stop(
        `VERSION déployée « ${version} » ≠ repo « ${VERSION_ATTENDUE} ». Redeploie lire-feuille sur TEST.`
      );
    }
    if (!version) {
      stop(
        `Réponse sans VERSION (attendait ${VERSION_ATTENDUE}). La fonction déployée est trop ancienne — redeploie sur TEST.`
      );
    }
    const detail =
      body?.detail ||
      (typeof info.body === 'string' ? info.body : null) ||
      info.message;
    const resume = resumeEssais(body?.essais);
    console.log(
      `  ✗ HTTP ${info.http ?? '—'} · ${body?.code || 'échec'} · version=${version} · ${resume} · ${ms} ms`
    );
    if (body?.message) console.log(`    ${body.message}`);
    else if (detail && detail !== info.message) console.log(`    detail : ${String(detail).slice(0, 120)}`);
    resultats.feuilles.push({
      fichier: f,
      ok: false,
      http: info.http,
      erreur: info.message,
      detail: detail ?? null,
      code: body?.code ?? null,
      version,
      modele: body?.modele ?? null,
      nb_appels_ia: body?.nb_appels_ia ?? (Array.isArray(body?.essais) ? body.essais.length : null),
      retry_delay: body?.retry_delay ?? null,
      essais_resume: resume,
      duree_ms: ms,
      lignes: [],
    });
    writeFileSync(OUT, JSON.stringify(resultats, null, 2));
    stop(`Arrêt net à la première erreur (${f}).`);
  }

  if (!data?.ok) {
    const version = data?.version ?? null;
    if (version && version !== VERSION_ATTENDUE) {
      stop(
        `VERSION déployée « ${version} » ≠ repo « ${VERSION_ATTENDUE} ». Redeploie lire-feuille sur TEST.`
      );
    }
    if (!version) {
      stop(
        `Réponse sans VERSION (attendait ${VERSION_ATTENDUE}). La fonction déployée est trop ancienne — redeploie sur TEST.`
      );
    }
    const resume = resumeEssais(data?.essais);
    console.log(
      `  ✗ ${data?.code || 'échec'} · version=${version} · ${resume} · ${ms} ms`
    );
    if (data?.message) console.log(`    ${data.message}`);
    resultats.feuilles.push({
      fichier: f,
      ok: false,
      http: data?.code === 'quota' ? 429 : 503,
      erreur: data?.message || 'réponse non ok',
      detail: data?.detail ?? null,
      code: data?.code ?? null,
      version,
      modele: data?.modele ?? null,
      nb_appels_ia: data?.nb_appels_ia ?? null,
      retry_delay: data?.retry_delay ?? null,
      essais_resume: resume,
      duree_ms: ms,
      lignes: [],
    });
    writeFileSync(OUT, JSON.stringify(resultats, null, 2));
    stop(`Arrêt net à la première erreur (${f}).`);
  }

  if (data.version !== VERSION_ATTENDUE) {
    stop(
      `VERSION déployée « ${data.version} » ≠ repo « ${VERSION_ATTENDUE} ». Redeploie lire-feuille sur TEST.`
    );
  }

  // Préférer la 1re section (ou la seule) renvoyée par la nouvelle API
  const section =
    Array.isArray(data.sections) && data.sections.length ? data.sections[0] : null;
  const lignesSrc = section?.lignes || data.lignes || [];
  const lignes = lignesSrc.map((l) => ({
    texte_lu: l.texte_lu,
    article_id: l.article_id,
    article_propose: l.article_nom || (l.article_id ? nomParId[l.article_id] ?? null : null),
    quantite: l.quantite,
    tarif: l.tarif ?? null,
    montant_lu: l.montant_lu ?? l.prix_lu ?? null,
    prix_lu: l.montant_lu ?? l.prix_lu ?? null,
    confiance: l.confiance,
    chiffre_ambigu: !!l.chiffre_ambigu,
    variantes: l.variantes ?? null,
  }));

  const resume = resumeEssais(data.essais);
  const feuilleRes = {
    fichier: f,
    ok: true,
    date_suggeree: section?.date_iso ?? data.date_suggeree ?? null,
    date_doute: section?.date_doute ?? false,
    total_ecrit: section?.total_ecrit ?? data.total_ecrit ?? null,
    nb_sections: Array.isArray(data.sections) ? data.sections.length : 1,
    modele: data.modele ?? null,
    nb_appels_ia: data.nb_appels_ia ?? (Array.isArray(data.essais) ? data.essais.length : null),
    essais_resume: resume,
    duree_ms: ms,
    nb_lignes: lignes.length,
    lignes,
    score: null,
  };
  resultats.feuilles.push(feuilleRes);

  console.log(
    `  ✓ ${lignes.length} ligne(s) · ${data.modele ?? '—'} · ${resume} · ${ms} ms · date ${feuilleRes.date_suggeree ?? '—'} · total ${feuilleRes.total_ecrit ?? '—'}`
  );
  if (feuilleRes.nb_sections > 1) {
    console.log(`    (${feuilleRes.nb_sections} sections — score sur la 1re)`);
  }
  for (const l of lignes) {
    const art = l.article_propose ? `→ ${l.article_propose}` : '→ (aucun)';
    console.log(
      `    • « ${l.texte_lu} » ${art}  qté=${l.quantite}  montant=${l.montant_lu ?? '—'}  [${l.confiance}]`
    );
  }
  sauvegarderReponseIa(f, data);
  console.log('');
}

// Scores vs attendu.json
let attenduDoc = null;
if (existsSync(ATTENDU_PATH)) {
  attenduDoc = JSON.parse(readFileSync(ATTENDU_PATH, 'utf8'));
  const byFile = Object.fromEntries((attenduDoc.feuilles || []).map((x) => [x.fichier, x]));
  console.log('─'.repeat(60));
  console.log('Score vs attendu.json :\n');
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
    if (att.exclue) {
      console.log(`  ${fr.fichier} : EXCLUE du score (${att.note || ''})`);
      fr.score = { exclue: true };
      continue;
    }
    if (!fr.ok) {
      console.log(`  ${fr.fichier} : lecture échouée`);
      fr.score = { echec: true };
      continue;
    }
    const sc = scoreLignes(fr.lignes, att.lignes);
    const totOk =
      att.total_ecrit == null
        ? true
        : fr.total_ecrit != null && Math.abs(fr.total_ecrit - att.total_ecrit) <= 1;
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

    const dateOk = !att.date_iso || fr.date_suggeree === att.date_iso;
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
      `    ligne complète ${sc.ligne_complete.justes}/${sc.ligne_complete.total} (${sc.ligne_complete.taux} %) · en trop ${sc.en_trop?.length ?? 0} · manquantes ${sc.manquantes?.length ?? 0} · total section ${totOk ? 'OK' : `≠ ${att.total_ecrit}`} · date ${dateOk ? 'OK' : `≠ ${att.date_iso}`}`
    );
    if (att.ecart_total_attendu) {
      console.log('    (écart somme/total écrit attendu — l’app doit le signaler)');
    }
    if (sc.en_trop?.length) {
      for (const e of sc.en_trop) {
        console.log(`      + en trop « ${e.texte_lu} » q=${e.quantite} m=${e.montant}`);
      }
    }
    if (sc.manquantes?.length) {
      for (const e of sc.manquantes) {
        console.log(`      − manquante « ${e.texte_lu} » → ${e.article}`);
      }
    }
    const faussesPaires = (sc.fausses || []).filter((x) => !x.raison);
    if (faussesPaires.length) {
      console.log(`    paires incorrectes (${faussesPaires.length}) :`);
      for (const f of faussesPaires.slice(0, 12)) {
        console.log(
          `      « ${f.texte_lu || ''} » art=${f.artOk} q=${f.qOk} m=${f.mOk} → lu ${JSON.stringify(f.lu?.article)}/${f.lu?.quantite}/${f.lu?.montant} attendu ${JSON.stringify(f.attendu?.article)}/${f.attendu?.quantite}/${f.attendu?.montant}`
        );
      }
    }
    console.log('');
  }
  const pct = (j, t) => (t ? Math.round((1000 * j) / t) / 10 : 0);
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
    `    article ${resultats.score_global.article.taux} % · qté ${resultats.score_global.quantite.taux} % · montant ${resultats.score_global.montant.taux} % · ligne ${resultats.score_global.ligne_complete.taux} % · total section ${resultats.score_global.total_section.taux} %`
  );
} else {
  console.log('\n(Pas de docs/exemples-feuilles/attendu.json — score non calculé.)');
}

writeFileSync(OUT, JSON.stringify(resultats, null, 2), 'utf8');
console.log('─'.repeat(60));
console.log(`Résultat écrit : ${OUT}`);
const ok = resultats.feuilles.filter((f) => f.ok).length;
const ko = resultats.feuilles.length - ok;
const totalLignes = resultats.feuilles.reduce((s, f) => s + (f.lignes?.length || 0), 0);
console.log(`Résumé : ${ok} feuille(s) OK, ${ko} échec(s), ${totalLignes} ligne(s) lues au total.`);
