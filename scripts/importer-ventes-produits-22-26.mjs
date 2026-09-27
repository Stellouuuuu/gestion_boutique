#!/usr/bin/env node
/**
 * Ventes PRODUITS Chez Dada (22→26/09/2026) + ajustements articles.
 *
 * Usage :
 *   node --env-file=.env.admin scripts/importer-ventes-produits-22-26.mjs --essai
 *   node --env-file=.env.admin scripts/importer-ventes-produits-22-26.mjs
 *
 * Sync-safe : ids = UUID(ventes-prod-22-26|<boutique>|…)
 * JAMAIS de DELETE — UPDATE / annule=true / actif=false.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const XLSX_PATH = resolve(ROOT, 'docs/ventes-produits-22-au-26-09.xlsx');
const SHEET = 'Ventes produits';
const EMAIL = '2290197504737@boutique-maman.app';
const NOM_BOUTIQUE = 'Chez Dada';
const REF_PREFIX = 'ventes-prod-22-26';
const ESSAI = process.argv.includes('--essai');

const TOTAUX_JOUR = {
  '2026-09-22': 31750,
  '2026-09-23': 9800,
  '2026-09-24': 26050,
  '2026-09-25': 13750,
  '2026-09-26': 24650,
};

const STOCK_APRES = {
  'Elastique (paquet de 12)': 57,
  'Elastique (pièce)': 9,
  'Filet de 100f': 425,
  'Filet de 500f': 41,
  'Huile Luôdaïs carton': 8,
  'Dallas petit': 32,
  'Teinte chinois': 145,
  'Produit Méva': 12,
  'Champoing tokpa petit': 41,
  'Dissolvant petit': 64,
  'Vernis neutre': 45,
};

const STOCK_AVANT_VENTES = {
  'Filet de 100f': 442,
  'Filet de 500f': 44,
};

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
  const hash = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(ref, 'utf8')]))
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function cellStr(v) {
  if (v == null || v === '') return '';
  return String(v).trim();
}

function normNom(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDateLigne(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const t = cellStr(v);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return null;
}

/** Heure Bénin (UTC+1) → ISO UTC. */
function isoBenin(jour, h, min) {
  const [y, mo, d] = jour.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 1, min, 0, 0)).toISOString();
}

async function findUser(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) stop('Lecture comptes : ' + error.message);
    const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function allRows(table, select, filterCol, filterVal) {
  let out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from(table)
      .select(select)
      .eq(filterCol, filterVal)
      .range(from, from + 999);
    if (error) stop(`Lecture ${table} : ${error.message}`);
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function stockDepuis(mvs, articleId) {
  let s = 0;
  for (const m of mvs) {
    if (m.article_id !== articleId || m.annule) continue;
    if (m.type === 'entree' || m.type === 'correction') s += Number(m.quantite) || 0;
    else if (m.type === 'vente' || m.type === 'sortie' || m.type === 'retrait')
      s -= Number(m.quantite) || 0;
  }
  return s;
}

function lireVentes() {
  if (!existsSync(XLSX_PATH)) stop(`Fichier introuvable : ${XLSX_PATH}`);
  const wb = XLSX.read(readFileSync(XLSX_PATH), { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[SHEET];
  if (!ws) stop(`Onglet « ${SHEET} » introuvable.`);
  const data = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  const out = [];
  for (const r of data) {
    const num = Number(r['N°']);
    const jour = parseDateLigne(r['Date']);
    const conf = cellStr(r['Article CONFIRMÉ (à remplir si orange)']);
    const propose = cellStr(r["Article dans l'app (proposé)"]);
    const nom = conf || propose;
    const qte = Number(r["Quantité (unités de l'article)"]);
    const montant = Number(r['Montant (F)']);
    const ecrit = cellStr(r['Écrit sur le cahier']);
    if (!jour || !nom || !Number.isFinite(qte) || qte <= 0 || !Number.isFinite(montant)) {
      stop(`Ligne invalide N°${num}: ${JSON.stringify(r)}`);
    }
    out.push({ num, jour, nom, qte, montant, ecrit });
  }
  return out;
}

/** Comme l’app : tarif catalogue, sinon réduction, sinon prix unitaire modifié. */
function calculerPrix(art, qte, montant) {
  const d = art.prix_detail;
  const g = art.prix_gros;
  if (d != null && qte * d === montant) {
    return {
      tarif: 'detail',
      prix_unitaire: d,
      montant_normal: montant,
      montant_paye: montant,
      methode: 'prix détail',
    };
  }
  if (g != null && qte * g === montant) {
    return {
      tarif: 'gros',
      prix_unitaire: g,
      montant_normal: montant,
      montant_paye: montant,
      methode: 'prix gros',
    };
  }
  if (d != null && montant < qte * d) {
    const normal = qte * d;
    return {
      tarif: 'detail',
      prix_unitaire: d,
      montant_normal: normal,
      montant_paye: montant,
      methode: `réduction détail (−${normal - montant})`,
    };
  }
  if (g != null && montant < qte * g) {
    const normal = qte * g;
    return {
      tarif: 'gros',
      prix_unitaire: g,
      montant_normal: normal,
      montant_paye: montant,
      methode: `réduction gros (−${normal - montant})`,
    };
  }
  const pu = Math.round(montant / qte);
  return {
    tarif: 'detail',
    prix_unitaire: pu,
    montant_normal: montant,
    montant_paye: montant,
    methode: `prix unitaire modifié (${pu} × ${qte})`,
  };
}

const user = await findUser(EMAIL);
if (!user) stop(`Compte introuvable : ${EMAIL}`);
const creePar = user.id;

const { data: boutiques } = await admin.from('boutiques').select('id, nom').eq('nom', NOM_BOUTIQUE);
if (!boutiques?.length || boutiques.length > 1) stop('Boutique Chez Dada introuvable / ambiguë.');
const boutiqueId = boutiques[0].id;

const arts = await allRows(
  'articles',
  'id, nom, categorie, prix_detail, prix_gros, prix_achat, actif',
  'boutique_id',
  boutiqueId
);
const mvs = await allRows(
  'mouvements',
  'id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye, cout_unitaire, annule, cree_par, cree_le, modifie_le',
  'boutique_id',
  boutiqueId
);

const stockMechesAvant = arts
  .filter((a) => a.actif && a.categorie === 'meches')
  .reduce((s, a) => s + stockDepuis(mvs, a.id), 0);

function ref(...parts) {
  const r = `${REF_PREFIX}|${boutiqueId}|${parts.join('|')}`;
  return { ref: r, id: idDeterministe(r) };
}

const lignes = lireVentes();

const plan = {
  renommages: [],
  ajouts: [],
  archives: [],
  prix: [],
  mvsUpdate: [],
  mvsAnnule: [],
  mvsCreate: [],
  ventes: [],
  methodesPrix: new Map(),
  transferts: [],
  erreurs: [],
};

const artsSim = arts.map((a) => ({ ...a }));
const mvsSim = mvs.map((m) => ({ ...m }));

function byNomSim() {
  const m = new Map();
  for (const a of artsSim) {
    const k = normNom(a.nom);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(a);
  }
  return m;
}
function trouverSim(nom, { actifsSeulement = true } = {}) {
  const liste = byNomSim().get(normNom(nom)) || [];
  if (actifsSeulement) return liste.find((x) => x.actif) || null;
  return liste[0] || null;
}

function planPrix(art, detail, gros, nomAffiche) {
  const sim = artsSim.find((x) => x.id === art.id);
  if (art.prix_detail === detail && art.prix_gros === gros) {
    sim.prix_detail = detail;
    sim.prix_gros = gros;
    return;
  }
  plan.prix.push({
    id: art.id,
    nom: nomAffiche || art.nom,
    detailAvant: art.prix_detail,
    grosAvant: art.prix_gros,
    detailApres: detail,
    grosApres: gros,
  });
  sim.prix_detail = detail;
  sim.prix_gros = gros;
}

function planRenom(art, vers) {
  if (art.nom === vers) return art;
  plan.renommages.push({ id: art.id, de: art.nom, vers });
  const sim = artsSim.find((x) => x.id === art.id);
  sim.nom = vers;
  return sim;
}

function upsertCorrection({ id, articleId, quantite, cree_le, prix_unitaire, pourquoi }) {
  const exist = mvsSim.find((m) => m.id === id);
  const row = {
    id,
    boutique_id: boutiqueId,
    article_id: articleId,
    type: 'correction',
    quantite,
    tarif: null,
    prix_unitaire: prix_unitaire ?? 0,
    montant_normal: 0,
    montant_paye: 0,
    cout_unitaire: null,
    annule: false,
    cree_par: creePar,
    cree_le,
    modifie_le: cree_le,
  };
  if (exist) {
    plan.mvsUpdate.push({
      id,
      article_id: articleId,
      type: 'correction',
      quantiteAvant: exist.quantite,
      quantiteApres: quantite,
      cree_le,
      pourquoi,
    });
    Object.assign(exist, row);
  } else {
    plan.mvsCreate.push({ ...row, pourquoi });
    mvsSim.push(row);
  }
}

function transfertStock(fromArt, toArt, qte, cree_le, label) {
  if (qte <= 0) return;
  const { id: idFrom } = ref('transfert', label, 'from');
  const { id: idTo } = ref('transfert', label, 'to');
  upsertCorrection({
    id: idFrom,
    articleId: fromArt.id,
    quantite: -qte,
    cree_le,
    prix_unitaire: fromArt.prix_detail ?? fromArt.prix_gros ?? 0,
    pourquoi: `transfert −${qte} « ${fromArt.nom} » → « ${toArt.nom} »`,
  });
  upsertCorrection({
    id: idTo,
    articleId: toArt.id,
    quantite: qte,
    cree_le,
    prix_unitaire: toArt.prix_detail ?? toArt.prix_gros ?? 0,
    pourquoi: `transfert +${qte} « ${toArt.nom} » ← « ${fromArt.nom} »`,
  });
  plan.transferts.push({ de: fromArt.nom, vers: toArt.nom, qte });
}

function archiver(art) {
  const sim = artsSim.find((x) => x.id === art.id);
  if (!sim.actif) return;
  plan.archives.push({ id: art.id, nom: sim.nom });
  sim.actif = false;
}

// ——— A1. Chouchou ———
{
  const a = trouverSim('Chouchou en 200f') || trouverSim('Chouchou de 200');
  if (!a) plan.erreurs.push('Chouchou en 200f introuvable');
  else planRenom(a, 'Chouchou de 200');
}

// ——— A2. Élastique ———
{
  let elast = trouverSim('Elastique') || trouverSim('Elastique (paquet de 12)');
  if (!elast) plan.erreurs.push('Elastique introuvable');
  else {
    elast = planRenom(elast, 'Elastique (paquet de 12)');
    planPrix(elast, 700, 700, 'Elastique (paquet de 12)');

    // Import pièces → paquets (÷12) : correction 178→14 (+10 pièces restantes),
    // entree 600→50. Total = 64 paquets + 10 pièces (pas d’annulation).
    const mvsEl = mvsSim.filter((m) => m.article_id === elast.id && !m.annule);
    const entree = mvsEl.find((m) => m.type === 'entree' && m.quantite === 600);
    const corr = mvsEl.find((m) => m.type === 'correction' && m.quantite === 178);
    if (entree && corr) {
      plan.mvsUpdate.push({
        id: corr.id,
        article_id: elast.id,
        type: 'correction',
        quantiteAvant: corr.quantite,
        quantiteApres: 14,
        cree_le: corr.cree_le,
        pourquoi: 'Elastique paquet : correction 178 pièces → 14 paquets',
      });
      corr.quantite = 14;
      plan.mvsUpdate.push({
        id: entree.id,
        article_id: elast.id,
        type: 'entree',
        quantiteAvant: entree.quantite,
        quantiteApres: 50,
        cree_le: entree.cree_le,
        pourquoi: 'Elastique paquet : entree 600 pièces → 50 paquets',
      });
      entree.quantite = 50;
    } else if (stockDepuis(mvsSim, elast.id) === 64) {
      // déjà converti
    } else {
      plan.erreurs.push(
        `Elastique : mvs import inattendus (stock=${stockDepuis(mvsSim, elast.id)}, n=${mvsEl.length})`
      );
    }

    let piece = trouverSim('Elastique (pièce)');
    if (!piece) {
      const { id } = ref('article', 'elastique-piece');
      const now = new Date().toISOString();
      piece = {
        id,
        boutique_id: boutiqueId,
        nom: 'Elastique (pièce)',
        categorie: 'produits',
        prix_detail: 100,
        prix_gros: 100,
        prix_achat: null,
        actif: true,
        cree_le: now,
        modifie_le: now,
      };
      plan.ajouts.push({ id, nom: piece.nom, prix_detail: 100, prix_gros: 100 });
      artsSim.push(piece);
      // 10 pièces restantes de la correction 178 (178 − 14×12)
      upsertCorrection({
        id: ref('elastique-piece', 'stock10').id,
        articleId: id,
        quantite: 10,
        cree_le: corr?.cree_le || isoBenin('2026-09-22', 7, 0),
        prix_unitaire: 100,
        pourquoi: 'Elastique (pièce) stock import 10 (reste de 178−14×12)',
      });
    } else {
      planPrix(piece, 100, 100, 'Elastique (pièce)');
    }

    const coupeLe = isoBenin('2026-09-22', 8, 0);
    upsertCorrection({
      id: ref('coupe', 'elastique-paquet-2').id,
      articleId: elast.id,
      quantite: -2,
      cree_le: coupeLe,
      prix_unitaire: 700,
      pourquoi: 'coupe −2 paquets élastique',
    });
    upsertCorrection({
      id: ref('coupe', 'elastique-piece-24').id,
      articleId: piece.id,
      quantite: 24,
      cree_le: coupeLe,
      prix_unitaire: 100,
      pourquoi: 'coupe +24 pièces élastique (ouverture de 2 paquets)',
    });
  }
}

// ——— A3. Filets ———
{
  const tLe = isoBenin('2026-09-22', 7, 0);

  let f100 = trouverSim('Filet perruque') || trouverSim('Filet de 100f');
  const chignons = trouverSim('Filets chignons');
  if (!f100) plan.erreurs.push('Filet perruque introuvable');
  else {
    f100 = planRenom(f100, 'Filet de 100f');
    planPrix(f100, 100, 100, 'Filet de 100f');
    if (chignons) {
      const q = stockDepuis(mvsSim, chignons.id);
      if (q > 0) transfertStock(chignons, f100, q, tLe, 'chignons-vers-100f');
      archiver(chignons);
    }
  }

  let f500 = trouverSim('Filet closure demi') || trouverSim('Filet de 500f');
  const sources500 = ['Filet bande', 'Filet naturel perruque closure', 'Filet closure petit'];
  if (!f500) plan.erreurs.push('Filet closure demi introuvable');
  else {
    f500 = planRenom(f500, 'Filet de 500f');
    planPrix(f500, 500, 500, 'Filet de 500f');
    for (const nom of sources500) {
      const src = trouverSim(nom);
      if (!src) {
        plan.erreurs.push(`Filet source introuvable : ${nom}`);
        continue;
      }
      const q = stockDepuis(mvsSim, src.id);
      if (q > 0) transfertStock(src, f500, q, tLe, `vers-500f-${normNom(nom).replace(/\s+/g, '-')}`);
      archiver(src);
    }
  }
}

// ——— A4. Prix Maman ———
{
  const maj = [
    ['Pétal one grand', 400, 350],
    ['Faux cils détail', 400, 400],
    ['Faux cil complet', 600, 600],
    ['Super glue', 100, 100],
  ];
  for (const [nom, d, g] of maj) {
    const a = trouverSim(nom);
    if (!a) plan.erreurs.push(`Prix : « ${nom} » introuvable`);
    else planPrix(a, d, g, nom);
  }
}

// Contrôle stocks filets avant ventes
const avantFilets = {};
for (const nom of Object.keys(STOCK_AVANT_VENTES)) {
  const a = trouverSim(nom);
  avantFilets[nom] = a ? stockDepuis(mvsSim, a.id) : null;
}

// ——— B. Ventes ———
const parJourIndex = new Map();
for (let iLig = 0; iLig < lignes.length; iLig++) {
  const lig = lignes[iLig];
  const idx = parJourIndex.get(lig.jour) || 0;
  parJourIndex.set(lig.jour, idx + 1);
  const min = idx * 5;
  const hh = 9 + Math.floor(min / 60);
  const mm = min % 60;
  const cree_le = isoBenin(lig.jour, hh, mm);

  const art = trouverSim(lig.nom);
  if (!art) {
    plan.erreurs.push(`Article introuvable vente N°${lig.num} : « ${lig.nom} »`);
    continue;
  }
  if (art.prix_detail == null && art.prix_gros == null) {
    plan.erreurs.push(`Pas de prix pour « ${lig.nom} » (N°${lig.num})`);
    continue;
  }

  const prix = calculerPrix(art, lig.qte, lig.montant);
  plan.methodesPrix.set(prix.methode, (plan.methodesPrix.get(prix.methode) || 0) + 1);

  const { id } = ref('vente', `L${iLig + 1}`, String(lig.num));
  const exist = mvsSim.find((m) => m.id === id);
  const row = {
    id,
    boutique_id: boutiqueId,
    article_id: art.id,
    type: 'vente',
    quantite: lig.qte,
    tarif: prix.tarif,
    prix_unitaire: prix.prix_unitaire,
    montant_normal: prix.montant_normal,
    montant_paye: prix.montant_paye,
    cout_unitaire: art.prix_achat ?? null,
    annule: false,
    cree_par: creePar,
    cree_le,
    modifie_le: cree_le,
  };

  plan.ventes.push({
    num: lig.num,
    ligneFichier: iLig + 1,
    jour: lig.jour,
    nom: lig.nom,
    qte: lig.qte,
    montant: lig.montant,
    methode: prix.methode,
    tarif: prix.tarif,
    prix_unitaire: prix.prix_unitaire,
    montant_normal: prix.montant_normal,
    cree_le,
    mvId: id,
  });

  if (exist) {
    plan.mvsUpdate.push({
      id,
      article_id: art.id,
      type: 'vente',
      quantiteAvant: exist.quantite,
      quantiteApres: lig.qte,
      cree_le,
      pourquoi: `vente N°${lig.num} L${iLig + 1}`,
    });
    Object.assign(exist, row);
  } else {
    plan.mvsCreate.push({ ...row, pourquoi: `vente N°${lig.num} L${iLig + 1}` });
    mvsSim.push(row);
  }
}

if (plan.erreurs.length) {
  console.error('\nErreurs :');
  for (const e of plan.erreurs) console.error(' -', e);
  stop(`${plan.erreurs.length} erreur(s).`);
}

const totauxSim = {};
const nbParJour = {};
for (const v of plan.ventes) {
  totauxSim[v.jour] = (totauxSim[v.jour] || 0) + v.montant;
  nbParJour[v.jour] = (nbParJour[v.jour] || 0) + 1;
}

const stocksSim = {};
for (const nom of Object.keys(STOCK_APRES)) {
  const a = trouverSim(nom);
  stocksSim[nom] = a ? stockDepuis(mvsSim, a.id) : null;
}

const negatifs = artsSim
  .filter((a) => a.actif)
  .map((a) => ({ nom: a.nom, stock: stockDepuis(mvsSim, a.id), cat: a.categorie }))
  .filter((x) => x.stock < 0);

const stockMechesApres = artsSim
  .filter((a) => a.actif && a.categorie === 'meches')
  .reduce((s, a) => s + stockDepuis(mvsSim, a.id), 0);

console.log(`\n═══ Import ventes PRODUITS 22→26/09 — ${ESSAI ? 'ESSAI' : 'EXÉCUTION'} ═══`);
console.log('Boutique : Chez Dada\n');

console.log('— Renommages —');
for (const r of plan.renommages) console.log(`  « ${r.de} » → « ${r.vers} »`);

console.log('\n— Ajouts —');
for (const a of plan.ajouts) console.log(`  « ${a.nom} » ${a.prix_detail}/${a.prix_gros}`);
if (!plan.ajouts.length) console.log('  (aucun)');

console.log('\n— Archives (actif=false) —');
for (const a of plan.archives) console.log(`  « ${a.nom} »`);

console.log('\n— Transferts filets —');
for (const t of plan.transferts) console.log(`  ${t.qte} : « ${t.de} » → « ${t.vers} »`);

console.log('\n— Prix —');
for (const p of plan.prix) {
  console.log(
    `  « ${p.nom} » détail ${p.detailAvant ?? '∅'}→${p.detailApres} · gros ${p.grosAvant ?? '∅'}→${p.grosApres}`
  );
}

console.log('\n— Stocks filets avant ventes —');
for (const [nom, att] of Object.entries(STOCK_AVANT_VENTES)) {
  const got = avantFilets[nom];
  console.log(`  « ${nom} » : ${got} ${got === att ? '✓' : `✗ (attendu ${att})`}`);
}

console.log('\n— Mouvements spéciaux (hors ventes) —');
for (const m of [...plan.mvsUpdate, ...plan.mvsCreate, ...plan.mvsAnnule].filter(
  (x) => x.type !== 'vente'
)) {
  if (m.pourquoi?.startsWith('vente')) continue;
  const q =
    m.quantiteApres != null
      ? `${m.quantiteAvant}→${m.quantiteApres}`
      : m.annule != null && plan.mvsAnnule.includes(m)
        ? `annule q=${m.quantite}`
        : String(m.quantite ?? 'annule');
  console.log(`  ${m.pourquoi} : ${q}`);
}
for (const m of plan.mvsAnnule) {
  console.log(`  ${m.pourquoi} : annule q=${m.quantite}`);
}

console.log('\n— Méthode prix ventes —');
for (const [m, n] of [...plan.methodesPrix.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n}× ${m}`);
}

console.log('\n— Ventes par jour —');
let okTotaux = true;
for (const jour of Object.keys(TOTAUX_JOUR)) {
  const att = TOTAUX_JOUR[jour];
  const got = totauxSim[jour] || 0;
  const ok = got === att;
  if (!ok) okTotaux = false;
  console.log(
    `  ${jour} : ${nbParJour[jour] || 0} ventes, total ${got} ${ok ? '✓' : `✗ (attendu ${att})`}`
  );
}
console.log(`  TOTAL : ${Object.values(totauxSim).reduce((s, x) => s + x, 0)} F`);

console.log('\n— Stocks après (contrôles) —');
let okStocks = true;
for (const [nom, att] of Object.entries(STOCK_APRES)) {
  const got = stocksSim[nom];
  const ok = got === att;
  if (!ok) okStocks = false;
  console.log(`  « ${nom} » : ${got} ${ok ? '✓' : `✗ (attendu ${att})`}`);
}
console.log(
  `  Stocks négatifs : ${negatifs.length ? negatifs.map((n) => `${n.nom}=${n.stock}`).join(', ') : 'aucun ✓'}`
);
console.log(
  `  Stock mèches : ${stockMechesApres} (avant ${stockMechesAvant}) ${stockMechesApres === stockMechesAvant ? '✓ inchangé' : '✗ a bougé'}`
);

const okFiletsAvant = Object.entries(STOCK_AVANT_VENTES).every(
  ([n, att]) => avantFilets[n] === att
);
const okMeches = stockMechesApres === stockMechesAvant;

console.log(`\nVentes : ${plan.ventes.length}`);
console.log(
  `Mouvements create=${plan.mvsCreate.length} update=${plan.mvsUpdate.length} annule=${plan.mvsAnnule.length}`
);

if (!okTotaux || !okStocks || !okFiletsAvant || negatifs.length || !okMeches) {
  console.log('\n⚠ Contrôles incomplets — corriger avant OK réel.');
} else {
  console.log('\n✓ Tous les contrôles C passent.');
}

if (ESSAI) {
  console.log('\n→ Essai terminé. Dis « OK, importe » pour écrire en production.');
  process.exit(0);
}

// ——— Écriture ———
mkdirSync(resolve(ROOT, 'backups'), { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const backupPath = resolve(ROOT, `backups/avant-ventes-produits-22-26-${date}.json`);
writeFileSync(
  backupPath,
  JSON.stringify(
    {
      sauvegarde_le: new Date().toISOString(),
      boutique_id: boutiqueId,
      plan: {
        renommages: plan.renommages,
        ajouts: plan.ajouts,
        archives: plan.archives,
        prix: plan.prix,
        transferts: plan.transferts,
        mvsUpdate: plan.mvsUpdate,
        mvsAnnule: plan.mvsAnnule,
        mvsCreate: plan.mvsCreate.map(({ pourquoi, ...r }) => r),
        ventes: plan.ventes,
      },
      mvs_avant: mvs,
      arts_snapshot: arts,
    },
    null,
    2
  )
);
console.log('\n✓ Backup :', backupPath);

const now = new Date().toISOString();

for (const r of plan.renommages) {
  const { error } = await admin
    .from('articles')
    .update({ nom: r.vers, modifie_le: now })
    .eq('id', r.id)
    .eq('boutique_id', boutiqueId);
  if (error) stop(`Renom ${r.de} : ${error.message}`);
}
console.log(`✓ Renommages : ${plan.renommages.length}`);

for (const a of plan.ajouts) {
  const { error } = await admin.from('articles').insert({
    id: a.id,
    boutique_id: boutiqueId,
    nom: a.nom,
    categorie: 'produits',
    prix_detail: a.prix_detail,
    prix_gros: a.prix_gros,
    actif: true,
    cree_le: now,
    modifie_le: now,
  });
  if (error) stop(`Ajout ${a.nom} : ${error.message}`);
}
console.log(`✓ Ajouts : ${plan.ajouts.length}`);

for (const p of plan.prix) {
  const { error } = await admin
    .from('articles')
    .update({
      prix_detail: p.detailApres,
      prix_gros: p.grosApres,
      modifie_le: now,
    })
    .eq('id', p.id)
    .eq('boutique_id', boutiqueId);
  if (error) stop(`Prix ${p.nom} : ${error.message}`);
}
console.log(`✓ Prix : ${plan.prix.length}`);

for (const a of plan.archives) {
  const { error } = await admin
    .from('articles')
    .update({ actif: false, modifie_le: now })
    .eq('id', a.id)
    .eq('boutique_id', boutiqueId);
  if (error) stop(`Archive ${a.nom} : ${error.message}`);
}
console.log(`✓ Archives : ${plan.archives.length}`);

for (const u of plan.mvsUpdate) {
  const patch = {
    quantite: u.quantiteApres,
    modifie_le: now,
    annule: false,
  };
  if (u.cree_le) patch.cree_le = u.cree_le;
  const vente = plan.ventes.find((v) => v.mvId === u.id);
  if (vente) {
    Object.assign(patch, {
      type: 'vente',
      quantite: vente.qte,
      tarif: vente.tarif,
      prix_unitaire: vente.prix_unitaire,
      montant_normal: vente.montant_normal,
      montant_paye: vente.montant,
      cree_le: vente.cree_le,
      cree_par: creePar,
    });
  }
  const { error } = await admin
    .from('mouvements')
    .update(patch)
    .eq('id', u.id)
    .eq('boutique_id', boutiqueId);
  if (error) stop(`Update mv ${u.id} : ${error.message}`);
}

for (const a of plan.mvsAnnule) {
  const { error } = await admin
    .from('mouvements')
    .update({ annule: true, annule_le: now, modifie_le: now })
    .eq('id', a.id)
    .eq('boutique_id', boutiqueId);
  if (error) stop(`Annule mv ${a.id} : ${error.message}`);
}

for (const c of plan.mvsCreate) {
  const { pourquoi, ...row } = c;
  void pourquoi;
  const { error } = await admin.from('mouvements').upsert(
    { ...row, modifie_le: row.modifie_le || now },
    { onConflict: 'id' }
  );
  if (error) stop(`Create mv ${row.id} : ${error.message}`);
}
console.log(
  `✓ Mouvements : update=${plan.mvsUpdate.length} create=${plan.mvsCreate.length} annule=${plan.mvsAnnule.length}`
);

const mvsApres = await allRows(
  'mouvements',
  'id, article_id, type, quantite, montant_paye, annule, cree_le',
  'boutique_id',
  boutiqueId
);
const artsApres = await allRows(
  'articles',
  'id, nom, actif, categorie, prix_detail, prix_gros',
  'boutique_id',
  boutiqueId
);
function trouverApres(nom) {
  return artsApres.find((a) => a.actif && normNom(a.nom) === normNom(nom));
}

const totauxApres = {};
for (const v of plan.ventes) {
  const m = mvsApres.find((x) => x.id === v.mvId && !x.annule);
  if (!m) stop(`Vente N°${v.num} L${v.ligneFichier} absente après écriture`);
  totauxApres[v.jour] = (totauxApres[v.jour] || 0) + Number(m.montant_paye);
}
console.log('\n— Totaux après écriture —');
for (const [j, att] of Object.entries(TOTAUX_JOUR)) {
  const got = totauxApres[j] || 0;
  console.log(`  ${j} : ${got} ${got === att ? '✓' : `✗ attendu ${att}`}`);
}
console.log('\n— Stocks après écriture —');
for (const [nom, att] of Object.entries(STOCK_APRES)) {
  const a = trouverApres(nom);
  const got = a ? stockDepuis(mvsApres, a.id) : null;
  console.log(`  « ${nom} » : ${got} ${got === att ? '✓' : `✗ attendu ${att}`}`);
}
const mechesFin = artsApres
  .filter((a) => a.actif && a.categorie === 'meches')
  .reduce((s, a) => s + stockDepuis(mvsApres, a.id), 0);
console.log(`  Stock mèches : ${mechesFin} ${mechesFin === stockMechesAvant ? '✓' : '✗'}`);

console.log('\n✓ Import ventes produits terminé.');
