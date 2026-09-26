#!/usr/bin/env node
/**
 * Import / mise à jour stock + prix PRODUITS — PRODUCTION « Chez Dada ».
 *
 * Usage :
 *   node --env-file=.env.admin scripts/importer-stock-produits.mjs --essai
 *   node --env-file=.env.admin scripts/importer-stock-produits.mjs
 *
 * Idempotent : mouvements id = UUID(import-fiche-produits|<boutique>|L<row>|<G|H|I>).
 * Met à jour / crée / supprime (si 0) uniquement ces mouvements d’import.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const XLSX_PATH = resolve(ROOT, 'docs/import-stock-produits.xlsx');
const SHEET = 'Import produits';
const EMAIL = '2290197504737@boutique-maman.app';
const NOM_BOUTIQUE = 'Chez Dada';
const REF_PREFIX = 'import-fiche-produits';
const ESSAI = process.argv.includes('--essai');

function stop(msg) {
  console.error('\n✗ ' + msg);
  process.exit(1);
}

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) stop('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (.env.admin).');
if (url.includes('ivqbjgfxbymiizfjhygv')) stop('REFUS : projet TEST.');

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

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

function parseIntCell(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s\u202f]/g, ''));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function estVideQuantite(brut) {
  const t = cellStr(brut);
  return !t || t === '-' || t === '=' || t === '—' || t === '–';
}

function aDecimale(brut) {
  if (typeof brut === 'number') return !Number.isInteger(brut);
  const t = cellStr(brut).replace(',', '.');
  if (!t) return false;
  if (/^\d+\.\d+$/.test(t)) return true;
  return false;
}

function estIncertainTexte(s) {
  const t = cellStr(s);
  if (!t) return false;
  if (t.includes('?') || t.includes('½') || t.includes('1/2')) return true;
  if (/\d\s*\/\s*\d/.test(t) || /dz\s*\//i.test(t) || /P\s*\//i.test(t)) return true;
  return false;
}

/** Parse un fragment sans « + » : 14dz10, 07dz, 5, 05P, 5ct8, 12P1 */
function parseFragment(frag, opts) {
  const { unitesPaquet, unitesCarton } = opts;
  let t = frag.replace(/\s+/g, '');
  if (!t) return { ok: true, unites: 0 };

  let unites = 0;
  let reste = t;

  const cts = [...t.matchAll(/(\d+)ct/gi)].map((m) => Number(m[1]));
  if (cts.length) {
    if (unitesCarton == null || unitesCarton <= 0) {
      return { ok: false, raison: `carton(s) sans col. N — « ${frag} »` };
    }
    for (const n of cts) unites += n * unitesCarton;
    reste = reste.replace(/\d+ct/gi, '');
  }

  const packs = [...t.matchAll(/(\d+)P(\d+)?/gi)].map((m) => ({
    nb: Number(m[1]),
    extra: m[2] != null ? Number(m[2]) : 0,
  }));
  if (packs.length) {
    if (unitesPaquet == null || unitesPaquet <= 0) {
      return { ok: false, raison: `paquet(s) sans col. L — « ${frag} »` };
    }
    for (const p of packs) unites += p.nb * unitesPaquet + p.extra;
    reste = reste.replace(/\d+P\d*/gi, '');
  }

  const dzs = [...t.matchAll(/(\d+)dz(\d+)?/gi)].map((m) => ({
    dz: Number(m[1]),
    extra: m[2] != null ? Number(m[2]) : 0,
  }));
  if (dzs.length) {
    for (const d of dzs) unites += d.dz * 12 + d.extra;
    reste = reste.replace(/\d+dz\d*/gi, '');
  }

  reste = reste.replace(/[^0-9]/g, '');
  if (reste !== '') {
    if (!/^\d+$/.test(reste)) return { ok: false, raison: `non reconnu « ${frag} »` };
    unites += Number(reste);
  } else if (!cts.length && !packs.length && !dzs.length) {
    const seul = parseIntCell(t);
    if (seul != null) return { ok: true, unites: seul };
    return { ok: false, raison: `non reconnu « ${frag} »` };
  }
  return { ok: true, unites };
}

function convertirQuantite(brut, opts = {}) {
  const { unitesPaquet = null, unitesCarton = null, colonneRetires = false } = opts;
  if (estVideQuantite(brut)) return { ok: true, unites: 0 };

  // Décimales : partie entière (floor) — demi-unités à régler plus tard
  if (aDecimale(brut) || (typeof brut === 'number' && !Number.isInteger(brut))) {
    let n;
    if (typeof brut === 'number') n = brut;
    else {
      const t = cellStr(brut).replace(',', '.').replace(/\s+/g, '');
      if (colonneRetires) {
        const m = t.match(/^-\s*([\d.]+)$/);
        if (m) n = -Number(m[1]);
        else n = Number(t);
      } else n = Number(t);
    }
    if (!Number.isFinite(n)) return { ok: false, raison: `décimale illisible « ${cellStr(brut)} »` };
    const unites = Math.floor(Math.abs(n));
    return { ok: true, unites, floored: true, brut: cellStr(brut) };
  }

  let t = cellStr(brut);
  if (colonneRetires) {
    const m = t.match(/^-\s*(\d+)\s*$/);
    if (m) return { ok: true, unites: Number(m[1]) };
    if (estIncertainTexte(t)) return { ok: false, raison: `retirés incertains « ${t} »` };
    const n = parseIntCell(t.replace(/^\+/, ''));
    if (n != null) return { ok: true, unites: n };
    return { ok: false, raison: `retirés non reconnus « ${t} »` };
  }

  if (estIncertainTexte(t)) return { ok: false, raison: `écriture incertaine « ${t} »` };

  const parts = t.split('+').map((p) => p.trim()).filter(Boolean);
  let total = 0;
  for (const part of parts) {
    const r = parseFragment(part, { unitesPaquet, unitesCarton });
    if (!r.ok) return r;
    total += r.unites;
  }
  return { ok: true, unites: total };
}

function unitesDepuisJN(ligne) {
  const j = parseIntCell(ligne.J);
  const k = parseIntCell(ligne.K) ?? 0;
  const l = parseIntCell(ligne.L);
  const m = parseIntCell(ligne.M) ?? 0;
  const n = parseIntCell(ligne.N);
  if (k > 0 && (l == null || l <= 0)) return null;
  if (m > 0 && (n == null || n <= 0)) return null;
  if (j == null && k === 0 && m === 0) return null;
  const u = (j ?? 0) + k * (l ?? 0) + m * (n ?? 0);
  if (!Number.isInteger(u)) return null;
  return u;
}

function colonneRemplie(ligne, col) {
  const v = col === 'G' ? ligne.stockEcrit : col === 'H' ? ligne.entreesEcrites : ligne.retires;
  return !estVideQuantite(v);
}

function resoudreColonne(ligne, col, brut, orange) {
  const label = col === 'G' ? 'Stock' : col === 'H' ? 'Entrées' : 'Retirés';
  if (estVideQuantite(brut)) return { unites: 0, ignore: false };

  const parse = convertirQuantite(brut, {
    unitesPaquet: parseIntCell(ligne.L),
    unitesCarton: parseIntCell(ligne.N),
    colonneRetires: col === 'I',
  });

  if (parse.decimale) {
    return { unites: 0, ignore: true, raison: `${label} : ${parse.raison}`, decimale: true };
  }

  if (parse.ok && parse.floored) {
    return { unites: parse.unites, ignore: false, floored: true, brut: parse.brut };
  }

  if (parse.ok && !orange && !estIncertainTexte(brut)) {
    return { unites: parse.unites, ignore: false };
  }

  if (!parse.ok && /sans col\./.test(parse.raison || '')) {
    return { unites: 0, ignore: true, raison: `${label} : ${parse.raison}` };
  }

  if (orange || !parse.ok || estIncertainTexte(brut)) {
    const autres = ['G', 'H', 'I'].filter((c) => c !== col).some((c) => colonneRemplie(ligne, c));
    const jn = unitesDepuisJN(ligne);
    if (!autres && jn != null) return { unites: jn, ignore: false, viaJN: true };
    // Si parse OK malgré orange (chiffre clair) : accepter
    if (parse.ok && !estIncertainTexte(brut)) {
      return { unites: parse.unites, ignore: false };
    }
    return {
      unites: 0,
      ignore: true,
      raison: !parse.ok
        ? `${label} : ${parse.raison}`
        : `${label} : orange/incertain « ${cellStr(brut)} »`,
    };
  }
  return { unites: parse.unites, ignore: false };
}

function chargerOrange() {
  try {
    const out = execFileSync(
      'python3',
      [
        '-c',
        `from openpyxl import load_workbook
wb=load_workbook(${JSON.stringify(XLSX_PATH)}, data_only=False)
ws=wb['Import produits']
o=[]
for row in ws.iter_rows(min_row=2,max_row=ws.max_row,min_col=7,max_col=9):
  for c in row:
    fg=c.fill.fgColor
    if fg is not None and getattr(fg,'rgb',None)=='FFFDEBD3':
      o.append(f"{c.row}:{c.column_letter}")
print('\\n'.join(o))`,
      ],
      { encoding: 'utf8' }
    );
    return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function findCol(headers, pred) {
  const i = headers.findIndex(pred);
  if (i < 0) stop(`Colonne introuvable (${pred})`);
  return i;
}

function lireFeuille(orangeSet) {
  if (!existsSync(XLSX_PATH)) stop(`Fichier introuvable : ${XLSX_PATH}`);
  const wb = XLSX.read(readFileSync(XLSX_PATH), { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[SHEET];
  if (!ws) stop(`Onglet « ${SHEET} » introuvable.`);
  const brut = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const headers = (brut[0] || []).map((h) => cellStr(h));
  const cAction = findCol(headers, (h) => h === 'Action');
  const cNomApp = findCol(headers, (h) => h.startsWith('Nom actuel'));
  const cNomFinal = findCol(headers, (h) => h.startsWith('Nom final'));
  const cCat = findCol(headers, (h) => h.startsWith('Catégorie'));
  const cGros = findCol(headers, (h) => /prix\s*gros/i.test(h));
  const cDetail = findCol(headers, (h) => /prix\s*d[eé]tail/i.test(h));
  const cStock = findCol(headers, (h) => h.startsWith('Stock écrit'));
  const cEntree = findCol(headers, (h) => h.startsWith('Entrées'));
  const cRetire = findCol(headers, (h) => h.startsWith('Retirés'));
  const cJ = findCol(headers, (h) => h.startsWith('Unités (hors'));
  const cK = findCol(headers, (h) => h.startsWith('Nb paquets'));
  const cL = findCol(headers, (h) => h.startsWith('Unités dans 1 paquet'));
  const cM = findCol(headers, (h) => h.startsWith('Nb cartons'));
  const cN = findCol(headers, (h) => h.startsWith('Unités dans 1 carton'));
  const cO = findCol(headers, (h) => h.startsWith('STOCK FINAL'));
  const cVerif = headers.findIndex((h) => h.startsWith('À vérifier'));

  const lignes = [];
  for (let i = 1; i < brut.length; i++) {
    const r = brut[i];
    if (!r) continue;
    const action = cellStr(r[cAction]);
    if (!action) continue;
    const excelRow = i + 1;
    lignes.push({
      excelRow,
      action,
      nomApp: cellStr(r[cNomApp]) || null,
      nomFinal: cellStr(r[cNomFinal]) || null,
      categorie: cellStr(r[cCat]) || 'Produits',
      prixGros: parsePrix(r[cGros]),
      prixDetail: parsePrix(r[cDetail]),
      stockEcrit: r[cStock],
      entreesEcrites: r[cEntree],
      retires: r[cRetire],
      J: r[cJ],
      K: r[cK],
      L: r[cL],
      M: r[cM],
      N: r[cN],
      stockFinal: r[cO],
      aVerifier: cVerif >= 0 ? cellStr(r[cVerif]) || null : null,
      orangeG: orangeSet.has(`${excelRow}:G`),
      orangeH: orangeSet.has(`${excelRow}:H`),
      orangeI: orangeSet.has(`${excelRow}:I`),
    });
  }
  return lignes;
}

function normNom(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
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

/** Anciens noms → nom canonique (Ajouter déjà créés au 1er import). */
const RENOMMAGES_FORCES = [
  { vers: 'Fer à brosse', depuis: ['Fer à … (mot barré)', 'Fer à ... (mot barré)'] },
  { vers: 'Coris attaché', depuis: ['Cauris attaché ?', 'Cauris attaché'] },
];

function trouverParAncienNom(nomFinal) {
  for (const r of RENOMMAGES_FORCES) {
    if (normNom(r.vers) !== normNom(nomFinal)) continue;
    for (const d of r.depuis) {
      const liste = (byNom.get(normNom(d)) || []).filter((a) => a.categorie === 'produits');
      const hit = liste.find((a) => a.actif) || liste[0];
      if (hit) return { article: hit, vers: r.vers };
    }
    for (const [k, liste] of byNom) {
      if (normNom(nomFinal) === 'fer a brosse' && k.startsWith('fer a') && k.includes('mot')) {
        const hit = liste.find((a) => a.categorie === 'produits' && a.actif);
        if (hit) return { article: hit, vers: r.vers };
      }
      if (normNom(nomFinal) === 'coris attache' && k.startsWith('cauris')) {
        const hit = liste.find((a) => a.categorie === 'produits' && a.actif);
        if (hit) return { article: hit, vers: r.vers };
      }
    }
  }
  return null;
}

// ---------- main ----------
const orangeSet = chargerOrange();
const lignes = lireFeuille(orangeSet);
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
  'id, article_id, type, quantite, annule, cree_le, tarif, prix_unitaire',
  'boutique_id',
  boutiqueId
);

const byNom = new Map();
function indexArticle(a) {
  const k = normNom(a.nom);
  if (!byNom.has(k)) byNom.set(k, []);
  byNom.get(k).push(a);
}
for (const a of arts) indexArticle(a);

function trouver(nom, { produitsOnly = true } = {}) {
  if (!nom) return null;
  const k = normNom(nom);
  let liste = byNom.get(k) || [];
  if (produitsOnly) liste = liste.filter((a) => a.categorie === 'produits');
  const actif = liste.find((a) => a.actif);
  if (actif) return actif;
  return liste[0] || null;
}

const maintenant = new Date().toISOString();
const ignores = [];
const plan = {
  renommages: [],
  ajouts: [],
  archives: [],
  prix: [], // { id, nom, grosAvant, grosApres, detailAvant, detailApres }
  conflitsGros: [],
  mvsCreate: [],
  mvsUpdate: [],
  mvsAnnule: [], // annule=true (synchro OK) — jamais de DELETE
  stockChanges: [],
  notesDemi: [],
};

/** Map articleId → { stock, entree, retrait } attendus depuis le fichier */
const attenduQty = new Map();

/**
 * Id stable par article (pas par n° de ligne Excel — les lignes bougent entre versions du fichier).
 * Anciens ids (…|L<row>|col) sont détectés et remplacés.
 */
function refId(articleId, col) {
  const ref = `${REF_PREFIX}|${boutiqueId}|${articleId}|${col}`;
  return { ref, id: idDeterministe(ref) };
}

/** Tous les ids d’import « v1 » possibles (lignes 2–400 × G/H/I) pour nettoyage. */
function idsImportV1() {
  const set = new Set();
  for (let row = 2; row <= 400; row++) {
    for (const col of ['G', 'H', 'I']) {
      const ref = `${REF_PREFIX}|${boutiqueId}|L${row}|${col}`;
      set.add(idDeterministe(ref));
    }
  }
  return set;
}
const IMPORT_V1_IDS = idsImportV1();
/** Ids déjà réutilisés pour un G/H/I (évite de greffer deux colonnes sur le même mv). */
const claimedMvIds = new Set();

function upsertAttendu(articleId, nom, kind, unites) {
  if (!attenduQty.has(articleId)) {
    attenduQty.set(articleId, { nom, stock: 0, entree: 0, retrait: 0 });
  }
  const a = attenduQty.get(articleId);
  a.nom = nom;
  a[kind] += unites;
}

function trouverReutilisable(articleId, kind) {
  const candidates = mvs.filter(
    (m) =>
      m.article_id === articleId &&
      !m.annule &&
      !claimedMvIds.has(m.id) &&
      (IMPORT_V1_IDS.has(m.id) || m.id === refId(articleId, kind === 'stock' ? 'G' : kind === 'entree' ? 'H' : 'I').id)
  );
  if (kind === 'entree') return candidates.find((m) => m.type === 'entree') || null;
  if (kind === 'retrait') {
    return candidates.find((m) => m.type === 'correction' && m.quantite < 0) || null;
  }
  return candidates.find((m) => m.type === 'correction' && m.quantite > 0) || null;
}

/**
 * Réutilise un ancien id d’import si possible (UPDATE quantite → synchro pull).
 * Sinon crée un id stable article|col.
 * Surplus d’import v1 → annule=true (jamais DELETE : l’app ne tire pas les suppressions).
 */
function planifierMouvement(article, excelRow, col, kind, unites) {
  const type = kind === 'entree' ? 'entree' : 'correction';
  const quantite = kind === 'retrait' ? -unites : unites;
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
        raison: 'quantité fichier = 0',
      });
    }
    return;
  }

  if (reusable) {
    claimedMvIds.add(reusable.id);
    if (reusable.quantite !== quantite || reusable.type !== type) {
      plan.mvsUpdate.push({
        id: reusable.id,
        ref: 'reuse-v1',
        article_id: article.id,
        article_nom: article.nom,
        type,
        quantite,
        avant: reusable.quantite,
        typeAvant: reusable.type,
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
        ref,
        article_id: article.id,
        article_nom: article.nom,
        type,
        quantite,
        avant: existNew.quantite,
        typeAvant: existNew.type,
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

/** Après G/H/I : annuler les mouvements d’import v1 restants pour cet article. */
function annulerSurplusImport(article, excelRow) {
  for (const m of mvs) {
    if (m.article_id !== article.id || m.annule) continue;
    if (!IMPORT_V1_IDS.has(m.id)) continue;
    if (claimedMvIds.has(m.id)) continue;
    if (plan.mvsAnnule.some((a) => a.id === m.id)) continue;
    claimedMvIds.add(m.id);
    plan.mvsAnnule.push({
      id: m.id,
      article_id: article.id,
      article_nom: article.nom,
      avant: m.quantite,
      ligne: excelRow,
      colonne: '—',
      raison: 'surplus import v1 (remplacé)',
    });
  }
}

// Pass 1 : Retirer d’abord le doublon Tam-tam xblock vide (avant renommage overa)
for (const lig of lignes.filter((l) => l.action === 'Retirer')) {
  if (!/^produits?$/i.test(lig.categorie || 'Produits')) continue;
  let article = null;
  if (/tam-tam xblock/i.test(lig.nomApp || '') || /doublon/i.test(lig.nomFinal || '')) {
    article = (byNom.get(normNom('Tam-tam xblock')) || []).find(
      (a) => a.categorie === 'produits' && a.actif && a.prix_detail == null
    );
  } else if (/passion twist/i.test(lig.nomApp || '')) {
    article = (byNom.get(normNom('Passion twist')) || []).find(
      (a) => a.categorie === 'produits' && a.actif
    );
  } else {
    article = trouver(lig.nomApp || lig.nomFinal);
  }
  if (!article) {
    ignores.push({
      ligne: lig.excelRow,
      article: lig.nomApp || lig.nomFinal,
      colonne: '—',
      raison: 'Retirer : article introuvable',
    });
    continue;
  }
  const nbMv = mvs.filter((m) => m.article_id === article.id && !m.annule).length;
  if (nbMv > 0) {
    ignores.push({
      ligne: lig.excelRow,
      article: article.nom,
      colonne: '—',
      raison: `Retirer refusé : ${nbMv} mouvement(s) existent — demander accord`,
    });
    continue;
  }
  plan.archives.push({ id: article.id, nom: article.nom, ligne: lig.excelRow });
}

// Pass 2 : renommages / ajouts / garder + prix + stock
for (const lig of lignes) {
  if (lig.action === 'Retirer') continue;
  if (lig.categorie && !/^produits?$/i.test(lig.categorie)) continue;

  let article = null;

  if (lig.action === 'Renommer') {
    article = trouver(lig.nomApp) || trouver(lig.nomFinal);
    if (!article) {
      ignores.push({
        ligne: lig.excelRow,
        article: lig.nomApp,
        colonne: '—',
        raison: 'Renommer : introuvable',
      });
      continue;
    }
    if (normNom(article.nom) !== normNom(lig.nomFinal)) {
      plan.renommages.push({
        id: article.id,
        de: article.nom,
        vers: lig.nomFinal,
        ligne: lig.excelRow,
      });
      // ré-indexer
      const oldK = normNom(article.nom);
      byNom.set(
        oldK,
        (byNom.get(oldK) || []).filter((a) => a.id !== article.id)
      );
      article = { ...article, nom: lig.nomFinal };
      indexArticle(article);
    }
  } else if (lig.action === 'Ajouter') {
    if (!lig.nomFinal) continue;
    article = trouver(lig.nomFinal);
    if (!article) {
      const force = trouverParAncienNom(lig.nomFinal);
      if (force) {
        article = force.article;
        plan.renommages.push({
          id: article.id,
          de: article.nom,
          vers: force.vers,
          ligne: lig.excelRow,
        });
        const oldK = normNom(article.nom);
        byNom.set(
          oldK,
          (byNom.get(oldK) || []).filter((a) => a.id !== article.id)
        );
        article = { ...article, nom: force.vers };
        indexArticle(article);
      }
    }
    if (!article) {
      article = {
        id: randomUUID(),
        nom: lig.nomFinal,
        categorie: 'produits',
        prix_detail: null,
        prix_gros: null,
        actif: true,
        _nouveau: true,
      };
      plan.ajouts.push({ id: article.id, nom: article.nom, ligne: lig.excelRow });
      indexArticle(article);
    }
  } else if (lig.action === 'Garder') {
    article = trouver(lig.nomApp || lig.nomFinal);
    if (!article) {
      ignores.push({
        ligne: lig.excelRow,
        article: lig.nomApp || lig.nomFinal,
        colonne: '—',
        raison: 'Garder : introuvable',
      });
      continue;
    }
  } else {
    ignores.push({
      ligne: lig.excelRow,
      article: lig.nomFinal || lig.nomApp,
      colonne: '—',
      raison: `action « ${lig.action} »`,
    });
    continue;
  }

  // --- Prix ---
  const grosCible =
    lig.prixGros != null ? lig.prixGros : article.prix_detail != null ? article.prix_detail : article.prix_gros;
  const detailCible = lig.prixDetail;

  if (article.prix_gros != null && lig.prixGros != null && article.prix_gros !== lig.prixGros) {
    plan.conflitsGros.push({
      nom: article.nom,
      grosActuel: article.prix_gros,
      grosFichier: lig.prixGros,
      ligne: lig.excelRow,
    });
  }

  const grosAvant = article.prix_gros;
  const detailAvant = article.prix_detail;
  const grosApres = grosCible;
  const detailApres = detailCible;

  if (grosAvant !== grosApres || detailAvant !== detailApres) {
    plan.prix.push({
      id: article.id,
      nom: article.nom,
      ligne: lig.excelRow,
      grosAvant,
      grosApres,
      detailAvant,
      detailApres,
      nouveau: !!article._nouveau,
    });
    article.prix_gros = grosApres;
    article.prix_detail = detailApres;
  }

  // --- Quantités (décimales → floor, note demi-unités) ---
  const specs = [
    { col: 'G', brut: lig.stockEcrit, orange: lig.orangeG, kind: 'stock' },
    { col: 'H', brut: lig.entreesEcrites, orange: lig.orangeH, kind: 'entree' },
    { col: 'I', brut: lig.retires, orange: lig.orangeI, kind: 'retrait' },
  ];

  for (const s of specs) {
    const r = resoudreColonne(lig, s.col, s.brut, s.orange);
    if (r.ignore) {
      ignores.push({
        ligne: lig.excelRow,
        article: article.nom,
        colonne: s.col,
        raison: r.raison,
      });
      continue;
    }
    if (r.floored) {
      plan.notesDemi.push({
        ligne: lig.excelRow,
        article: article.nom,
        colonne: s.col,
        brut: r.brut,
        unites: r.unites,
        note: 'demi-unités à régler (partie entière importée)',
      });
    }
    planifierMouvement(article, lig.excelRow, s.col, s.kind, r.unites);
    if (r.unites) upsertAttendu(article.id, article.nom, s.kind, r.unites);
  }
  annulerSurplusImport(article, lig.excelRow);
}

// Stock avant/après pour articles touchés
const articleIdsTouches = new Set([
  ...attenduQty.keys(),
  ...plan.mvsCreate.map((m) => m.article_id),
  ...plan.mvsUpdate.map((m) => m.article_id),
  ...plan.mvsAnnule.map((m) => m.article_id),
]);

for (const id of articleIdsTouches) {
  const avant = stockDepuisMvs(mvs, id);
  const mvsSim = mvs.map((m) => ({ ...m }));
  for (const a of plan.mvsAnnule) {
    const i = mvsSim.findIndex((m) => m.id === a.id);
    if (i >= 0) mvsSim[i] = { ...mvsSim[i], annule: true };
  }
  for (const u of plan.mvsUpdate) {
    const i = mvsSim.findIndex((m) => m.id === u.id);
    if (i >= 0) {
      mvsSim[i] = { ...mvsSim[i], quantite: u.quantite, type: u.type, annule: false };
    }
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
  const apres = stockDepuisMvs(mvsSim, id);
  const att = attenduQty.get(id);
  const attendu = att ? att.stock + att.entree - att.retrait : apres;
  const nom = att?.nom || arts.find((a) => a.id === id)?.nom || id;
  if (avant !== apres || (att && avant !== attendu)) {
    plan.stockChanges.push({ nom, id, avant, apres, attendu });
  }
}

// ---------- résumé ----------
console.log(`
═══ Import stock/prix PRODUITS — ${ESSAI ? 'ESSAI' : 'EXÉCUTION'} ═══
Boutique : ${NOM_BOUTIQUE}

Renommages              : ${plan.renommages.length}
Ajouts                  : ${plan.ajouts.length}
Archives (actif=false)  : ${plan.archives.length}
Prix à mettre à jour    : ${plan.prix.length}
Conflits prix_gros      : ${plan.conflitsGros.length}
Mouvements à créer      : ${plan.mvsCreate.length}
Mouvements à maj        : ${plan.mvsUpdate.length}
Mouvements à annuler    : ${plan.mvsAnnule.length}
Stocks qui changent     : ${plan.stockChanges.length}
Notes demi-unités       : ${plan.notesDemi.length}
Autres ignorées         : ${ignores.length}
`);

if (plan.renommages.length) {
  console.log('— Renommages —');
  for (const r of plan.renommages) console.log(`  L${r.ligne}: « ${r.de} » → « ${r.vers} »`);
}
if (plan.ajouts.length) {
  console.log('— Ajouts —');
  for (const a of plan.ajouts) console.log(`  L${a.ligne}: « ${a.nom} »`);
}
if (plan.archives.length) {
  console.log('— Archives —');
  for (const a of plan.archives) console.log(`  L${a.ligne}: « ${a.nom} » → actif=false`);
}

if (plan.conflitsGros.length) {
  console.log('\n— Conflits prix_gros (existant ≠ F) —');
  for (const c of plan.conflitsGros) {
    console.log(`  L${c.ligne} « ${c.nom} » : actuel=${c.grosActuel} fichier=${c.grosFichier}`);
  }
}

console.log('\n— Prix (extrait, 15 premiers + total) —');
for (const p of plan.prix.slice(0, 15)) {
  console.log(
    `  « ${p.nom} » gros ${p.grosAvant ?? '∅'}→${p.grosApres ?? '∅'} · détail ${p.detailAvant ?? '∅'}→${p.detailApres ?? '∅'}`
  );
}
if (plan.prix.length > 15) console.log(`  … +${plan.prix.length - 15} autres`);

console.log('\n— Stocks qui changent —');
for (const s of plan.stockChanges.sort((a, b) => a.nom.localeCompare(b.nom))) {
  console.log(`  « ${s.nom} » ${s.avant} → ${s.apres} (attendu fichier ${s.attendu})`);
}

if (plan.notesDemi.length) {
  console.log('\n— Demi-unités (partie entière) —');
  for (const n of plan.notesDemi) {
    console.log(`  L${n.ligne} « ${n.article} » [${n.colonne}] ${n.brut} → ${n.unites} u. — ${n.note}`);
  }
}
if (ignores.length) {
  console.log('\n— Autres ignorées —');
  for (const ig of ignores) {
    console.log(`  L${ig.ligne} « ${ig.article} » [${ig.colonne}] : ${ig.raison}`);
  }
}

const CONTROLE = [
  'Barrette papillon',
  'Barrette petit',
  'Boucle en fer',
  'Champoing tokpa grand',
  'Champoing tokpa petit',
  'Elastique',
  'Faux cil complet',
  'Ongle de 250',
  'Ongle blanc 3/250',
  'Peigne afro',
  'Perle de 2500',
  'Perle de 3000',
  'Perle de 4000',
  'Perle paquet de 1800',
  'Teinte chinois',
  'Vernis couleur',
  'Chouchou bébé',
];
console.log('\n— Contrôle stock final —');
for (const nom of CONTROLE) {
  const ch = plan.stockChanges.find((s) => normNom(s.nom) === normNom(nom));
  const art = trouver(nom);
  const avant = art ? stockDepuisMvs(mvs, art.id) : '?';
  const apres = ch ? ch.apres : avant;
  console.log(
    `  ${nom}: ${avant} → ${apres}` + (ch ? ` (attendu ${ch.attendu})` : ' (inchangé)')
  );
}

if (ESSAI) {
  console.log('\n→ Essai terminé. Attendre « OK, importe » avant écriture.\n');
  process.exit(0);
}

// ---------- écriture ----------
mkdirSync(resolve(ROOT, 'backups'), { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const backupPath = resolve(ROOT, `backups/avant-import-stock-produits-maj-${date}.json`);
writeFileSync(
  backupPath,
  JSON.stringify({ sauvegarde_le: maintenant, boutique_id: boutiqueId, plan, arts, mvs }, null, 2)
);
console.log('✓ Backup :', backupPath);

for (const a of plan.archives) {
  const { error } = await admin
    .from('articles')
    .update({ actif: false, modifie_le: maintenant })
    .eq('id', a.id)
    .eq('boutique_id', boutiqueId);
  if (error) stop(`Archive « ${a.nom} » : ${error.message}`);
}
console.log(`✓ Archives : ${plan.archives.length}`);

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
    categorie: 'produits',
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
      prix_gros: p.grosApres,
      prix_detail: p.detailApres,
      modifie_le: maintenant,
    })
    .eq('id', p.id)
    .eq('boutique_id', boutiqueId);
  if (error) stop(`Prix « ${p.nom} » : ${error.message}`);
}
console.log(`✓ Prix : ${plan.prix.filter((p) => !plan.ajouts.some((a) => a.id === p.id)).length}`);

// Mouvements : annuler (sync OK) / update / create — JAMAIS delete
for (const a of plan.mvsAnnule) {
  const { error } = await admin
    .from('mouvements')
    .update({
      annule: true,
      annule_le: maintenant,
      modifie_le: maintenant,
    })
    .eq('id', a.id)
    .eq('boutique_id', boutiqueId);
  if (error) stop(`Annule mv ${a.id} : ${error.message}`);
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
  if (error) stop(`Update mv ${u.id} : ${error.message}`);
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

// Vérif stocks
const mvsApres = await allRows(
  'mouvements',
  'id, article_id, type, quantite, annule',
  'boutique_id',
  boutiqueId
);
const ecarts = [];
for (const [id, att] of attenduQty) {
  const obtenu = stockDepuisMvs(mvsApres, id);
  const attendu = att.stock + att.entree - att.retrait;
  if (obtenu !== attendu) ecarts.push({ nom: att.nom, attendu, obtenu });
}

const artsApres = await allRows('articles', 'id, nom, categorie, actif', 'boutique_id', boutiqueId);
let totalStock = 0;
const stocksFinaux = [];
for (const a of artsApres.filter((x) => x.actif && x.categorie === 'produits')) {
  const s = stockDepuisMvs(mvsApres, a.id);
  totalStock += s;
  const ch = plan.stockChanges.find((c) => c.id === a.id);
  if (ch) stocksFinaux.push({ nom: a.nom, stock: s, avant: ch.avant });
}

console.log('\n═══ Contrôle après import ═══');
console.log(`Écarts attendu/obtenu : ${ecarts.length}`);
for (const e of ecarts.slice(0, 20)) console.log(`  ⚠ « ${e.nom} » attendu=${e.attendu} obtenu=${e.obtenu}`);

console.log('\n— Stocks qui ont changé (final) —');
for (const s of stocksFinaux.sort((a, b) => a.nom.localeCompare(b.nom))) {
  console.log(`  « ${s.nom} » : ${s.avant} → ${s.stock}`);
}
console.log(`\nTotal stock PRODUITS actifs : ${totalStock} unités`);

console.log('\n— Contrôle tableau —');
for (const nom of CONTROLE) {
  const art = artsApres.find((a) => normNom(a.nom) === normNom(nom) && a.categorie === 'produits');
  const s = art ? stockDepuisMvs(mvsApres, art.id) : 'introuvable';
  console.log(`  ${nom}: ${s}`);
}

if (ecarts.length) process.exit(2);
console.log('\n✓ Import terminé.');
