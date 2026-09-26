#!/usr/bin/env node
/**
 * Import stock + prix MÈCHES — PRODUCTION « Chez Dada ».
 *
 * Usage :
 *   node --env-file=.env.admin scripts/importer-stock-meches.mjs --essai
 *   node --env-file=.env.admin scripts/importer-stock-meches.mjs
 *
 * Sync-safe : ids = UUID(import-fiche-meches|<boutique>|<articleId>|<J|K>)
 * JAMAIS de DELETE — UPDATE quantite ou annule=true.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const XLSX_PATH = resolve(ROOT, 'docs/import-stock-meches.xlsx');
const SHEET = 'Import mèches';
const EMAIL = '2290197504737@boutique-maman.app';
const NOM_BOUTIQUE = 'Chez Dada';
const REF_PREFIX = 'import-fiche-meches';
const CAT = 'meches';
const ESSAI = process.argv.includes('--essai');

function stop(msg) {
  console.error('\n✗ ' + msg);
  process.exit(1);
}

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) stop('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (.env.admin).');
if (url.includes('ivqbjgfxbymiizfjhygv')) stop('REFUS : projet TEST.');

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function idDeterministe(ref) {
  const ns = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(ref, 'utf8')])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function cellStr(v) {
  if (v == null || v === '') return '';
  return String(v).trim();
}

function parsePrix(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s\u202f]/g, ''));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function parseUnites(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return Math.max(0, Math.floor(v));
  }
  const t = cellStr(v).toLowerCase();
  if (!t || t === '-' || t === '=' || t === '(vide)' || t === 'vide') return 0;
  const n = Number(t.replace(/[\s\u202f]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function normNom(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function findCol(headers, pred, label) {
  const i = headers.findIndex(pred);
  if (i < 0) stop(`Colonne introuvable : ${label}`);
  return i;
}

function lireFeuille() {
  if (!existsSync(XLSX_PATH)) stop(`Fichier introuvable : ${XLSX_PATH}`);
  const wb = XLSX.read(readFileSync(XLSX_PATH), { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[SHEET];
  if (!ws) stop(`Onglet « ${SHEET} » introuvable.`);
  const brut = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const headers = (brut[0] || []).map((h) => cellStr(h));
  const cAction = findCol(headers, (h) => h === 'Action', 'Action');
  const cNomApp = findCol(headers, (h) => h.startsWith('Nom actuel'), 'Nom actuel');
  const cNomFinal = findCol(headers, (h) => h.startsWith('Nom final'), 'Nom final');
  const cCat = findCol(headers, (h) => h.startsWith('Catégorie'), 'Catégorie');
  const cPrix = findCol(headers, (h) => /prix\s*gros\s*=\s*d[eé]tail/i.test(h), 'Prix gros = détail');
  const cStock = findCol(headers, (h) => h === 'Stock (unités)', 'Stock (unités)');
  const cEntree = findCol(headers, (h) => h === 'Entrées (unités)', 'Entrées (unités)');
  const cFinal = findCol(headers, (h) => h.startsWith('STOCK FINAL'), 'STOCK FINAL');
  const cVerif = headers.findIndex((h) => h.startsWith('À vérifier'));

  const lignes = [];
  for (let i = 1; i < brut.length; i++) {
    const r = brut[i];
    if (!r) continue;
    const action = cellStr(r[cAction]);
    if (!action) continue;
    lignes.push({
      excelRow: i + 1,
      action,
      nomApp: cellStr(r[cNomApp]) || null,
      nomFinal: cellStr(r[cNomFinal]) || null,
      categorie: cellStr(r[cCat]) || 'Mèches',
      prix: parsePrix(r[cPrix]),
      stock: parseUnites(r[cStock]),
      entree: parseUnites(r[cEntree]),
      stockFinal: r[cFinal],
      aVerifier: cVerif >= 0 ? cellStr(r[cVerif]) || null : null,
    });
  }
  return lignes;
}

async function findUser(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function allRows(table, select, filterCol, filterVal) {
  const out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from(table)
      .select(select)
      .eq(filterCol, filterVal)
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function stockDepuisMvs(mvs, articleId) {
  let s = 0;
  for (const m of mvs) {
    if (m.article_id !== articleId || m.annule) continue;
    s += m.type === 'vente' ? -m.quantite : m.quantite;
  }
  return s;
}

// ---------- main ----------
const lignes = lireFeuille();
const user = await findUser(EMAIL);
if (!user) stop(`Compte introuvable : ${EMAIL}`);

const { data: boutiques } = await admin.from('boutiques').select('id, nom').eq('nom', NOM_BOUTIQUE);
if (!boutiques?.length || boutiques.length > 1) stop('Boutique Chez Dada introuvable / ambiguë.');
const boutiqueId = boutiques[0].id;

const arts = await allRows(
  'articles',
  'id, nom, categorie, prix_detail, prix_gros, actif',
  'boutique_id',
  boutiqueId
);
const mvs = await allRows(
  'mouvements',
  'id, article_id, type, quantite, annule',
  'boutique_id',
  boutiqueId
);

const byNomMeches = new Map();
function indexArticle(a) {
  if (a.categorie !== CAT) return;
  const k = normNom(a.nom);
  if (!byNomMeches.has(k)) byNomMeches.set(k, []);
  byNomMeches.get(k).push(a);
}
for (const a of arts) indexArticle(a);

function trouverMeche(nom) {
  if (!nom) return null;
  const liste = byNomMeches.get(normNom(nom)) || [];
  return liste.find((a) => a.actif) || liste[0] || null;
}

function refId(articleId, col) {
  const ref = `${REF_PREFIX}|${boutiqueId}|${articleId}|${col}`;
  return { ref, id: idDeterministe(ref) };
}

/** Anciens ids éventuels (si un jour on avait ancré sur n° de ligne) — pour annulation. */
function idsImportLegacy() {
  const set = new Set();
  for (let row = 2; row <= 400; row++) {
    for (const col of ['J', 'K', 'G', 'H']) {
      set.add(idDeterministe(`${REF_PREFIX}|${boutiqueId}|L${row}|${col}`));
    }
  }
  return set;
}
const LEGACY_IDS = idsImportLegacy();

const maintenant = new Date().toISOString();
const claimedMvIds = new Set();
const ignores = [];
const conflitsNom = [];
const plan = {
  gardes: 0,
  renommages: [],
  ajouts: [],
  prix: [],
  mvsCreate: [],
  mvsUpdate: [],
  mvsAnnule: [],
  stockChanges: [],
  sansPrix: [],
  attenduQty: new Map(),
};

function upsertAttendu(articleId, nom, kind, unites) {
  if (!plan.attenduQty.has(articleId)) {
    plan.attenduQty.set(articleId, { nom, stock: 0, entree: 0 });
  }
  const a = plan.attenduQty.get(articleId);
  a.nom = nom;
  a[kind] += unites;
}

function trouverReutilisable(articleId, kind) {
  const stableId = refId(articleId, kind === 'stock' ? 'J' : 'K').id;
  const candidates = mvs.filter(
    (m) =>
      m.article_id === articleId &&
      !m.annule &&
      !claimedMvIds.has(m.id) &&
      (LEGACY_IDS.has(m.id) || m.id === stableId)
  );
  if (kind === 'entree') return candidates.find((m) => m.type === 'entree') || null;
  return candidates.find((m) => m.type === 'correction' && m.quantite > 0) || null;
}

function planifierMouvement(article, excelRow, col, kind, unites) {
  if (unites == null) {
    ignores.push({
      ligne: excelRow,
      article: article.nom,
      colonne: col,
      raison: 'quantité invalide',
    });
    return;
  }
  const type = kind === 'entree' ? 'entree' : 'correction';
  const quantite = unites;
  const { ref, id: newId } = refId(article.id, col);
  const reusable = trouverReutilisable(article.id, kind);

  if (unites === 0) {
    if (reusable) {
      claimedMvIds.add(reusable.id);
      plan.mvsAnnule.push({
        id: reusable.id,
        article_id: article.id,
        article_nom: article.nom,
        avant: reusable.quantite,
        ligne: excelRow,
        colonne: col,
      });
    }
    return;
  }

  if (reusable) {
    claimedMvIds.add(reusable.id);
    if (reusable.quantite !== quantite || reusable.type !== type) {
      plan.mvsUpdate.push({
        id: reusable.id,
        article_id: article.id,
        article_nom: article.nom,
        type,
        quantite,
        avant: reusable.quantite,
        ligne: excelRow,
        colonne: col,
      });
    }
    return;
  }

  const existNew = mvs.find((m) => m.id === newId && !m.annule);
  if (existNew) {
    claimedMvIds.add(newId);
    if (existNew.quantite !== quantite || existNew.type !== type) {
      plan.mvsUpdate.push({
        id: newId,
        article_id: article.id,
        article_nom: article.nom,
        type,
        quantite,
        avant: existNew.quantite,
        ligne: excelRow,
        colonne: col,
      });
    }
    return;
  }

  if (!plan.mvsCreate.some((c) => c.id === newId)) {
    plan.mvsCreate.push({
      id: newId,
      ref,
      article_id: article.id,
      article_nom: article.nom,
      type,
      quantite,
      ligne: excelRow,
      colonne: col,
    });
  }
}

function annulerSurplus(article, excelRow) {
  for (const m of mvs) {
    if (m.article_id !== article.id || m.annule) continue;
    if (!LEGACY_IDS.has(m.id) && m.id !== refId(article.id, 'J').id && m.id !== refId(article.id, 'K').id) {
      continue;
    }
    if (claimedMvIds.has(m.id)) continue;
    // Ne pas annuler un id stable J/K qu'on vient de créer/garder — déjà claimed
    // Surplus = legacy non réclamé seulement
    if (!LEGACY_IDS.has(m.id)) continue;
    claimedMvIds.add(m.id);
    plan.mvsAnnule.push({
      id: m.id,
      article_id: article.id,
      article_nom: article.nom,
      avant: m.quantite,
      ligne: excelRow,
      colonne: '—',
      raison: 'surplus import legacy',
    });
  }
}

// ---------- plan ----------
for (const lig of lignes) {
  if (lig.categorie && !/^m[eè]ches?$/i.test(lig.categorie)) {
    ignores.push({
      ligne: lig.excelRow,
      article: lig.nomFinal || lig.nomApp,
      colonne: '—',
      raison: `catégorie « ${lig.categorie} » (mèches seulement)`,
    });
    continue;
  }
  if (lig.stock == null || lig.entree == null) {
    ignores.push({
      ligne: lig.excelRow,
      article: lig.nomFinal || lig.nomApp,
      colonne: 'J/K',
      raison: 'Stock ou Entrées non numériques',
    });
    continue;
  }

  let article = null;

  if (lig.action === 'Renommer') {
    article = trouverMeche(lig.nomApp);
    if (!article) {
      // déjà renommé ?
      article = trouverMeche(lig.nomFinal);
      if (!article) {
        ignores.push({
          ligne: lig.excelRow,
          article: lig.nomApp,
          colonne: '—',
          raison: 'Renommer : article mèches introuvable',
        });
        continue;
      }
    } else if (normNom(article.nom) !== normNom(lig.nomFinal)) {
      const collision = trouverMeche(lig.nomFinal);
      if (collision && collision.id !== article.id) {
        conflitsNom.push({
          ligne: lig.excelRow,
          type: 'renommage',
          de: article.nom,
          vers: lig.nomFinal,
          conflit: collision.nom,
          conflitId: collision.id,
        });
        continue;
      }
      plan.renommages.push({
        id: article.id,
        de: article.nom,
        vers: lig.nomFinal,
        ligne: lig.excelRow,
      });
      const oldK = normNom(article.nom);
      byNomMeches.set(
        oldK,
        (byNomMeches.get(oldK) || []).filter((a) => a.id !== article.id)
      );
      article = { ...article, nom: lig.nomFinal };
      indexArticle(article);
    }
  } else if (lig.action === 'Ajouter') {
    if (!lig.nomFinal) {
      ignores.push({ ligne: lig.excelRow, article: '?', colonne: '—', raison: 'Ajouter sans nom' });
      continue;
    }
    article = trouverMeche(lig.nomFinal);
    if (article) {
      // déjà créé (relance) — ne pas doublonner
      conflitsNom.push({
        ligne: lig.excelRow,
        type: 'ajout-existe',
        vers: lig.nomFinal,
        conflit: article.nom,
        conflitId: article.id,
        note: 'réutilise l’existant (pas de doublon)',
      });
    } else {
      // conflit soft : nom proche dans une autre catégorie ?
      const autres = arts.filter(
        (a) => normNom(a.nom) === normNom(lig.nomFinal) && a.categorie !== CAT
      );
      if (autres.length) {
        conflitsNom.push({
          ligne: lig.excelRow,
          type: 'homonyme-autre-cat',
          vers: lig.nomFinal,
          autres: autres.map((a) => `${a.nom} (${a.categorie}, actif=${a.actif})`),
          note: 'OK : on crée quand même en mèches (catégories séparées)',
        });
      }
      article = {
        id: randomUUID(),
        nom: lig.nomFinal,
        categorie: CAT,
        prix_detail: null,
        prix_gros: null,
        actif: true,
        _nouveau: true,
      };
      plan.ajouts.push({ id: article.id, nom: article.nom, ligne: lig.excelRow });
      indexArticle(article);
    }
  } else if (lig.action === 'Garder') {
    article = trouverMeche(lig.nomApp || lig.nomFinal);
    if (!article) {
      ignores.push({
        ligne: lig.excelRow,
        article: lig.nomApp || lig.nomFinal,
        colonne: '—',
        raison: 'Garder : mèche introuvable',
      });
      continue;
    }
    plan.gardes += 1;
  } else {
    ignores.push({
      ligne: lig.excelRow,
      article: lig.nomFinal || lig.nomApp,
      colonne: '—',
      raison: `action « ${lig.action} »`,
    });
    continue;
  }

  // Prix : gros = détail = G (ou les deux vides)
  const prixCible = lig.prix; // null = à compléter
  const detailAvant = article.prix_detail;
  const grosAvant = article.prix_gros;
  if (detailAvant !== prixCible || grosAvant !== prixCible) {
    plan.prix.push({
      id: article.id,
      nom: article.nom,
      ligne: lig.excelRow,
      detailAvant,
      grosAvant,
      detailApres: prixCible,
      grosApres: prixCible,
    });
    article.prix_detail = prixCible;
    article.prix_gros = prixCible;
  }
  if (prixCible == null) {
    plan.sansPrix.push({ nom: article.nom, ligne: lig.excelRow });
  }

  // Mouvements J / K
  planifierMouvement(article, lig.excelRow, 'J', 'stock', lig.stock);
  if (lig.stock) upsertAttendu(article.id, article.nom, 'stock', lig.stock);
  planifierMouvement(article, lig.excelRow, 'K', 'entree', lig.entree);
  if (lig.entree) upsertAttendu(article.id, article.nom, 'entree', lig.entree);
  annulerSurplus(article, lig.excelRow);
}

// Simulation stocks
const articleIds = new Set([
  ...plan.attenduQty.keys(),
  ...plan.mvsCreate.map((m) => m.article_id),
  ...plan.mvsUpdate.map((m) => m.article_id),
  ...plan.mvsAnnule.map((m) => m.article_id),
]);

let totalApres = 0;
const mvsSim = mvs.map((m) => ({ ...m }));
for (const a of plan.mvsAnnule) {
  const i = mvsSim.findIndex((m) => m.id === a.id);
  if (i >= 0) mvsSim[i] = { ...mvsSim[i], annule: true };
}
for (const u of plan.mvsUpdate) {
  const i = mvsSim.findIndex((m) => m.id === u.id);
  if (i >= 0) mvsSim[i] = { ...mvsSim[i], quantite: u.quantite, type: u.type, annule: false };
}
for (const c of plan.mvsCreate) {
  mvsSim.push({
    id: c.id,
    article_id: c.article_id,
    type: c.type,
    quantite: c.quantite,
    annule: false,
  });
}

// Total = tous les articles mèches actifs après opérations (y compris inchangés)
const mechesActives = new Map();
for (const a of arts.filter((x) => x.categorie === CAT && x.actif)) {
  mechesActives.set(a.id, a.nom);
}
for (const a of plan.ajouts) mechesActives.set(a.id, a.nom);
// renommages déjà dans arts

for (const [id, nom] of mechesActives) {
  const avant = stockDepuisMvs(mvs, id);
  const apres = stockDepuisMvs(mvsSim, id);
  totalApres += apres;
  const att = plan.attenduQty.get(id);
  const attendu = att ? att.stock + att.entree : null;
  if (avant !== apres || (attendu != null && apres !== attendu)) {
    plan.stockChanges.push({
      nom: att?.nom || nom,
      id,
      avant,
      apres,
      attendu: attendu ?? apres,
    });
  }
}

// Contrôle total fichier
const totalFichier = lignes.reduce((s, l) => s + (l.stock || 0) + (l.entree || 0), 0);

console.log(`
═══ Import stock/prix MÈCHES — ${ESSAI ? 'ESSAI' : 'EXÉCUTION'} ═══
Boutique : ${NOM_BOUTIQUE}

Garder                  : ${plan.gardes}
Renommages              : ${plan.renommages.length}
Ajouts                  : ${plan.ajouts.length}
Prix à mettre à jour    : ${plan.prix.length}
Sans prix (à compléter) : ${plan.sansPrix.length}
Mouvements à créer      : ${plan.mvsCreate.length}
Mouvements à maj        : ${plan.mvsUpdate.length}
Mouvements à annuler    : ${plan.mvsAnnule.length}
Stocks qui changent     : ${plan.stockChanges.length}
Conflits de nom         : ${conflitsNom.length}
Ignorées                : ${ignores.length}

Stock total simulé (mèches actives) : ${totalApres}
Stock total fichier (Σ J+K)         : ${totalFichier}
`);

if (plan.renommages.length) {
  console.log('— Renommages —');
  for (const r of plan.renommages) console.log(`  L${r.ligne}: « ${r.de} » → « ${r.vers} »`);
}
if (plan.ajouts.length) {
  console.log('— Ajouts (extrait) —');
  for (const a of plan.ajouts.slice(0, 20)) console.log(`  L${a.ligne}: « ${a.nom} »`);
  if (plan.ajouts.length > 20) console.log(`  … +${plan.ajouts.length - 20}`);
}

console.log('\n— Prix (ancien → nouveau) —');
for (const p of plan.prix) {
  console.log(
    `  L${p.ligne} « ${p.nom} » détail ${p.detailAvant ?? '∅'}→${p.detailApres ?? '∅'} · gros ${p.grosAvant ?? '∅'}→${p.grosApres ?? '∅'}`
  );
}

if (plan.sansPrix.length) {
  console.log('\n— Sans prix —');
  for (const s of plan.sansPrix) console.log(`  L${s.ligne} « ${s.nom} »`);
}

if (conflitsNom.length) {
  console.log('\n— Conflits / homonymes —');
  for (const c of conflitsNom) {
    console.log(
      `  L${c.ligne} [${c.type}] « ${c.vers || c.de} »` +
        (c.conflit ? ` ↔ « ${c.conflit} »` : '') +
        (c.autres ? ` / ${c.autres.join(', ')}` : '') +
        (c.note ? ` — ${c.note}` : '')
    );
  }
}

if (plan.stockChanges.length) {
  console.log('\n— Stocks qui changent (extrait 30) —');
  for (const s of plan.stockChanges.sort((a, b) => a.nom.localeCompare(b.nom)).slice(0, 30)) {
    console.log(`  « ${s.nom} » ${s.avant} → ${s.apres}`);
  }
  if (plan.stockChanges.length > 30) console.log(`  … +${plan.stockChanges.length - 30}`);
}

if (ignores.length) {
  console.log('\n— Ignorées —');
  for (const ig of ignores) {
    console.log(`  L${ig.ligne} « ${ig.article} » [${ig.colonne}] : ${ig.raison}`);
  }
}

// Cas particuliers rappel
console.log('\n— Cas particuliers —');
const cordeDz = [...plan.renommages, ...plan.ajouts, ...plan.prix].find(
  (x) => x.vers === 'Corde noir Baby (douzaine)' || x.nom === 'Corde noir Baby (douzaine)' || x.de === 'Corde noir1500 Baby'
);
const cordePc = plan.ajouts.find((a) => a.nom === 'Corde noir Baby (pièce)');
const pCordeDz = plan.prix.find((p) => p.nom === 'Corde noir Baby (douzaine)' || p.nom?.includes('douzaine'));
console.log(
  `  Corde noir Baby (douzaine) : renom=${!!plan.renommages.find((r) => r.vers.includes('douzaine'))} prix=${pCordeDz ? `${pCordeDz.detailAvant}→${pCordeDz.detailApres}` : '?'} stock=${plan.stockChanges.find((s) => s.nom.includes('douzaine'))?.apres ?? '?'}`
);
console.log(
  `  Corde noir Baby (pièce) : ajout=${!!cordePc} sansPrix=${plan.sansPrix.some((s) => s.nom.includes('pièce'))} stock=${plan.stockChanges.find((s) => s.nom.includes('pièce'))?.apres ?? '?'}`
);

if (totalApres !== 1072) {
  console.log(`\n⚠ Stock total simulé ${totalApres} ≠ 1072 attendu`);
} else {
  console.log('\n✓ Stock total = 1072');
}

if (ESSAI) {
  console.log('\n→ Essai terminé. Dis « OK, importe » pour écrire en production.\n');
  process.exit(totalApres === 1072 && ignores.length === 0 ? 0 : 0);
}

// ---------- écriture ----------
mkdirSync(resolve(ROOT, 'backups'), { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const backupPath = resolve(ROOT, `backups/avant-import-stock-meches-${date}.json`);
writeFileSync(
  backupPath,
  JSON.stringify(
    {
      sauvegarde_le: maintenant,
      boutique_id: boutiqueId,
      plan,
      arts_meches: arts.filter((a) => a.categorie === CAT),
      mvs,
    },
    null,
    2
  )
);
console.log('✓ Backup :', backupPath);

for (const r of plan.renommages) {
  const { error } = await admin
    .from('articles')
    .update({ nom: r.vers, modifie_le: maintenant })
    .eq('id', r.id)
    .eq('boutique_id', boutiqueId);
  if (error) stop(`Renommage « ${r.de} » : ${error.message}`);
}
console.log(`✓ Renommages : ${plan.renommages.length}`);

for (const a of plan.ajouts) {
  const prix = plan.prix.find((p) => p.id === a.id);
  const { error } = await admin.from('articles').insert({
    id: a.id,
    boutique_id: boutiqueId,
    nom: a.nom,
    categorie: CAT,
    prix_detail: prix?.detailApres ?? null,
    prix_gros: prix?.grosApres ?? null,
    actif: true,
    cree_le: maintenant,
    modifie_le: maintenant,
  });
  if (error) stop(`Ajout « ${a.nom} » : ${error.message}`);
}
console.log(`✓ Ajouts : ${plan.ajouts.length}`);

for (const p of plan.prix) {
  if (plan.ajouts.some((a) => a.id === p.id)) continue;
  const { error } = await admin
    .from('articles')
    .update({
      prix_detail: p.detailApres,
      prix_gros: p.grosApres,
      modifie_le: maintenant,
    })
    .eq('id', p.id)
    .eq('boutique_id', boutiqueId);
  if (error) stop(`Prix « ${p.nom} » : ${error.message}`);
}
console.log(`✓ Prix : ${plan.prix.filter((p) => !plan.ajouts.some((a) => a.id === p.id)).length}`);

for (const a of plan.mvsAnnule) {
  const { error } = await admin
    .from('mouvements')
    .update({ annule: true, annule_le: maintenant, modifie_le: maintenant })
    .eq('id', a.id)
    .eq('boutique_id', boutiqueId);
  if (error) stop(`Annule ${a.id} : ${error.message}`);
}
for (const u of plan.mvsUpdate) {
  const { error } = await admin
    .from('mouvements')
    .update({
      quantite: u.quantite,
      type: u.type,
      annule: false,
      modifie_le: maintenant,
    })
    .eq('id', u.id)
    .eq('boutique_id', boutiqueId);
  if (error) stop(`Update ${u.id} : ${error.message}`);
}
const aInserer = plan.mvsCreate.map((m) => ({
  id: m.id,
  boutique_id: boutiqueId,
  article_id: m.article_id,
  type: m.type,
  quantite: m.quantite,
  tarif: null,
  prix_unitaire: 0,
  montant_normal: 0,
  montant_paye: 0,
  annule: false,
  cree_par: user.id,
  cree_le: maintenant,
  modifie_le: maintenant,
}));
for (let i = 0; i < aInserer.length; i += 100) {
  const { error } = await admin.from('mouvements').insert(aInserer.slice(i, i + 100));
  if (error) stop(`Insert mvs : ${error.message}`);
}
console.log(
  `✓ Mouvements : annulés=${plan.mvsAnnule.length} maj=${plan.mvsUpdate.length} créés=${plan.mvsCreate.length}`
);

const mvsApres = await allRows('mouvements', 'id, article_id, type, quantite, annule', 'boutique_id', boutiqueId);
const artsApres = await allRows('articles', 'id, nom, categorie, actif', 'boutique_id', boutiqueId);
let total = 0;
const ecarts = [];
for (const a of artsApres.filter((x) => x.categorie === CAT && x.actif)) {
  const s = stockDepuisMvs(mvsApres, a.id);
  total += s;
  const att = plan.attenduQty.get(a.id);
  if (att) {
    const attendu = att.stock + att.entree;
    if (s !== attendu) ecarts.push({ nom: a.nom, attendu, obtenu: s });
  }
}
console.log(`\nStock total mèches actives : ${total}`);
console.log(`Écarts : ${ecarts.length}`);
for (const e of ecarts.slice(0, 15)) console.log(`  ⚠ « ${e.nom} » attendu=${e.attendu} obtenu=${e.obtenu}`);
if (total !== 1072 || ecarts.length) process.exit(2);
console.log('\n✓ Import mèches terminé.');
