#!/usr/bin/env node
/**
 * Enregistre les ventes Chez Dada (23→26/09/2026) + ajustements articles.
 *
 * Usage :
 *   node --env-file=.env.admin scripts/importer-ventes-23-26.mjs --essai
 *   node --env-file=.env.admin scripts/importer-ventes-23-26.mjs
 *
 * Sync-safe : ids = UUID(ventes-23-26|<boutique>|…)
 * JAMAIS de DELETE — UPDATE quantite / champs, ou annule=true.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const XLSX_PATH = resolve(ROOT, 'docs/ventes-23-au-26-09.xlsx');
const SHEET = 'Ventes';
const EMAIL = '2290197504737@boutique-maman.app';
const NOM_BOUTIQUE = 'Chez Dada';
const REF_PREFIX = 'ventes-23-26';
const ESSAI = process.argv.includes('--essai');

/** Totaux attendus (F) */
const TOTAUX_JOUR = {
  '2026-09-23': 15850,
  '2026-09-24': 103350,
  '2026-09-25': 127650,
  '2026-09-26': 27450,
};

/** Stocks après ventes attendus */
const STOCK_APRES = {
  'X-pression détail': 633,
  'Xpression curly': 28,
  'Bouncy kinky': 24,
  'Fashion Royal': 0,
  'Corde noir (paquet de 12)': 1,
  'Corde noir (pièce)': 2,
  Multi: 86,
  Ceres: 51,
  Leine: 30,
  Janet: 18,
  Shary: 9,
  '4 flowers': 3,
  Durable: 2,
  'Produit Méva': 23,
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

/** Date Excel / texte → YYYY-MM-DD */
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

/**
 * Heure locale Bénin (UTC+1) → ISO UTC.
 * ex. jour=2026-09-23, h=9, min=0 → 2026-09-23T08:00:00.000Z
 */
function isoBenin(jour, h, min) {
  const [y, mo, d] = jour.split('-').map(Number);
  const utc = Date.UTC(y, mo - 1, d, h - 1, min, 0, 0);
  return new Date(utc).toISOString();
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
    const num = Number(r['N°'] ?? r.N);
    const jour = parseDateLigne(r['Date']);
    const nom = cellStr(r["Article dans l'app"]);
    const qte = Number(r['Quantité']);
    const montant = Number(r['Montant encaissé (F)']);
    const remarque = cellStr(r['Remarque']);
    const ecrit = cellStr(r['Écrit sur la feuille']);
    if (!jour || !nom || !Number.isFinite(qte) || qte <= 0 || !Number.isFinite(montant)) {
      stop(`Ligne invalide N°${num}: ${JSON.stringify(r)}`);
    }
    out.push({ num, jour, nom, qte, montant, remarque, ecrit });
  }
  return out;
}

/**
 * Prix d’une vente (comme l’app : tarif + montant_normal / montant_paye).
 * - égalité exacte détail ou gros → tarif correspondant ;
 * - montant < normal → réduction ;
 * - montant > normal → prix_unitaire modifié (montant_normal = montant_paye).
 */
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
  if (g != null && g !== d && montant < qte * g) {
    const normal = qte * g;
    return {
      tarif: 'gros',
      prix_unitaire: g,
      montant_normal: normal,
      montant_paye: montant,
      methode: `réduction gros (−${normal - montant})`,
    };
  }
  // Au-dessus du tarif catalogue (Durable 7000, Shary 1700, curly 1500…)
  const pu = Math.round(montant / qte);
  return {
    tarif: 'detail',
    prix_unitaire: pu,
    montant_normal: montant,
    montant_paye: montant,
    methode: `prix unitaire modifié (${pu} × ${qte})`,
  };
}

// --- Lecture PROD ---
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

const byNom = new Map();
for (const a of arts) {
  const k = normNom(a.nom);
  if (!byNom.has(k)) byNom.set(k, []);
  byNom.get(k).push(a);
}
function trouver(nom, { actifOnly = true } = {}) {
  const liste = byNom.get(normNom(nom)) || [];
  if (actifOnly) {
    const a = liste.find((x) => x.actif);
    return a || null;
  }
  return liste[0] || null;
}

function ref(...parts) {
  const r = `${REF_PREFIX}|${boutiqueId}|${parts.join('|')}`;
  return { ref: r, id: idDeterministe(r) };
}

const lignes = lireVentes();

// --- Plan A : articles ---
const plan = {
  renommages: [],
  ajouts: [],
  prix: [],
  mvsUpdate: [],
  mvsCreate: [],
  ventes: [],
  methodesPrix: new Map(),
  erreurs: [],
};

// Simuler articles / mvs
const artsSim = arts.map((a) => ({ ...a }));
const mvsSim = mvs.map((m) => ({ ...m }));
const byNomSim = () => {
  const m = new Map();
  for (const a of artsSim) {
    const k = normNom(a.nom);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(a);
  }
  return m;
};
function trouverSim(nom) {
  const liste = byNomSim().get(normNom(nom)) || [];
  return liste.find((x) => x.actif) || null;
}

// A1. Produit Béba → Produit Méva
{
  const a = trouver('Produit Béba');
  if (!a) plan.erreurs.push('Produit Béba introuvable');
  else {
    plan.renommages.push({ id: a.id, de: a.nom, vers: 'Produit Méva' });
    const sim = artsSim.find((x) => x.id === a.id);
    sim.nom = 'Produit Méva';
  }
}

// A2. X-pression détail : prix 1500 + stock 765 au 22/09 20:00
{
  const a = trouver('X-pression détail');
  if (!a) plan.erreurs.push('X-pression détail introuvable');
  else {
    const sim = artsSim.find((x) => x.id === a.id);
    if (a.prix_detail !== 1500 || a.prix_gros !== 1500) {
      plan.prix.push({
        id: a.id,
        nom: a.nom,
        detailAvant: a.prix_detail,
        grosAvant: a.prix_gros,
        detailApres: 1500,
        grosApres: 1500,
      });
      sim.prix_detail = 1500;
      sim.prix_gros = 1500;
    }
    const stockAvant = stockDepuis(mvsSim, a.id);
    const delta = 765 - stockAvant;
    if (delta !== 0) {
      const { id } = ref('xpression', 'stock765');
      const cree_le = isoBenin('2026-09-22', 20, 0);
      const exist = mvsSim.find((m) => m.id === id);
      if (exist) {
        plan.mvsUpdate.push({
          id,
          article_id: a.id,
          type: 'correction',
          quantiteAvant: exist.quantite,
          quantiteApres: delta,
          cree_le,
          pourquoi: 'X-pression stock → 765',
        });
        exist.quantite = delta;
        exist.annule = false;
        exist.cree_le = cree_le;
      } else {
        const row = {
          id,
          boutique_id: boutiqueId,
          article_id: a.id,
          type: 'correction',
          quantite: delta,
          tarif: null,
          prix_unitaire: 1500,
          montant_normal: 0,
          montant_paye: 0,
          cout_unitaire: a.prix_achat,
          annule: false,
          cree_par: creePar,
          cree_le,
          modifie_le: cree_le,
        };
        plan.mvsCreate.push({ ...row, pourquoi: 'X-pression stock → 765' });
        mvsSim.push(row);
      }
    }
  }
}

// A3. Corde noir → paquet de 12 ; créer pièce ; UPDATE stock import 269→22 ; coupe
{
  const corde = trouver('Corde noir') || trouver('Corde noir (paquet de 12)');
  if (!corde) plan.erreurs.push('Corde noir introuvable');
  else {
    const sim = artsSim.find((x) => x.id === corde.id);
    if (corde.nom !== 'Corde noir (paquet de 12)') {
      plan.renommages.push({ id: corde.id, de: corde.nom, vers: 'Corde noir (paquet de 12)' });
      sim.nom = 'Corde noir (paquet de 12)';
    }
    if (corde.prix_detail !== 500 || corde.prix_gros !== 500) {
      plan.prix.push({
        id: corde.id,
        nom: 'Corde noir (paquet de 12)',
        detailAvant: corde.prix_detail,
        grosAvant: corde.prix_gros,
        detailApres: 500,
        grosApres: 500,
      });
      sim.prix_detail = 500;
      sim.prix_gros = 500;
    }

    // UPDATE mouvement import (même id) 269 → 22
    const importMvs = mvsSim
      .filter((m) => m.article_id === corde.id && !m.annule && m.type === 'correction' && m.quantite === 269)
      .concat(
        mvsSim.filter(
          (m) =>
            m.article_id === corde.id &&
            !m.annule &&
            (m.type === 'correction' || m.type === 'entree') &&
            m.quantite === 269
        )
      );
    const uniq = [...new Map(importMvs.map((m) => [m.id, m])).values()];
    if (!uniq.length) {
      // déjà à 22 ?
      const a22 = mvsSim.find(
        (m) => m.article_id === corde.id && !m.annule && m.quantite === 22 && m.type === 'correction'
      );
      if (!a22) plan.erreurs.push('Mouvement import Corde noir (269) introuvable pour UPDATE→22');
    } else {
      const m = uniq[0];
      if (m.quantite !== 22) {
        plan.mvsUpdate.push({
          id: m.id,
          article_id: corde.id,
          type: m.type,
          quantiteAvant: m.quantite,
          quantiteApres: 22,
          cree_le: m.cree_le,
          pourquoi: 'Corde noir paquet : stock import 269→22',
        });
        m.quantite = 22;
      }
    }

    // Créer Corde noir (pièce) si absent
    let piece = trouverSim('Corde noir (pièce)');
    if (!piece) {
      const { id } = ref('article', 'corde-noir-piece');
      const now = new Date().toISOString();
      piece = {
        id,
        boutique_id: boutiqueId,
        nom: 'Corde noir (pièce)',
        categorie: 'meches',
        prix_detail: 50,
        prix_gros: 50,
        prix_achat: null,
        actif: true,
        cree_le: now,
        modifie_le: now,
      };
      plan.ajouts.push({ id, nom: piece.nom, prix_detail: 50, prix_gros: 50 });
      artsSim.push(piece);

      // Stock import 5
      const { id: mid } = ref('corde-piece', 'stock5');
      const cree_le = isoBenin('2026-09-22', 20, 0);
      const row = {
        id: mid,
        boutique_id: boutiqueId,
        article_id: id,
        type: 'correction',
        quantite: 5,
        tarif: null,
        prix_unitaire: 50,
        montant_normal: 0,
        montant_paye: 0,
        cout_unitaire: null,
        annule: false,
        cree_par: creePar,
        cree_le,
        modifie_le: cree_le,
      };
      plan.mvsCreate.push({ ...row, pourquoi: 'Corde noir (pièce) stock 5' });
      mvsSim.push(row);
    } else {
      const simP = artsSim.find((x) => x.id === piece.id);
      if (piece.prix_detail !== 50 || piece.prix_gros !== 50) {
        plan.prix.push({
          id: piece.id,
          nom: piece.nom,
          detailAvant: piece.prix_detail,
          grosAvant: piece.prix_gros,
          detailApres: 50,
          grosApres: 50,
        });
        simP.prix_detail = 50;
        simP.prix_gros = 50;
      }
    }

    // Coupe 23/09 08:00 : −3 paquet, +36 pièce
    const coupeLe = isoBenin('2026-09-23', 8, 0);
    const { id: idCoupeP } = ref('coupe', 'paquet-3');
    const { id: idCoupeC } = ref('coupe', 'piece-36');
    for (const [mid, artId, q, pourquoi] of [
      [idCoupeP, corde.id, -3, 'coupe −3 paquets (ouverture)'],
      [idCoupeC, piece.id, 36, 'coupe +36 pièces (ouverture de 3 paquets)'],
    ]) {
      const exist = mvsSim.find((m) => m.id === mid);
      if (exist) {
        if (exist.quantite !== q || exist.annule) {
          plan.mvsUpdate.push({
            id: mid,
            article_id: artId,
            type: 'correction',
            quantiteAvant: exist.quantite,
            quantiteApres: q,
            cree_le: coupeLe,
            pourquoi,
          });
          exist.quantite = q;
          exist.annule = false;
          exist.cree_le = coupeLe;
        }
      } else {
        const row = {
          id: mid,
          boutique_id: boutiqueId,
          article_id: artId,
          type: 'correction',
          quantite: q,
          tarif: null,
          prix_unitaire: artId === corde.id ? 500 : 50,
          montant_normal: 0,
          montant_paye: 0,
          cout_unitaire: null,
          annule: false,
          cree_par: creePar,
          cree_le: coupeLe,
          modifie_le: coupeLe,
        };
        plan.mvsCreate.push({ ...row, pourquoi });
        mvsSim.push(row);
      }
    }
  }
}

// --- B. Ventes ---
// Ids stables par index de ligne fichier (le N° Excel peut doubler, ex. N°9 ×2).
const parJourIndex = new Map();
for (let iLig = 0; iLig < lignes.length; iLig++) {
  const lig = lignes[iLig];
  const idx = parJourIndex.get(lig.jour) || 0;
  parJourIndex.set(lig.jour, idx + 1);
  const h = 9;
  const min = idx * 5; // 09:00, 09:05, …
  const hh = h + Math.floor(min / 60);
  const mm = min % 60;
  const cree_le = isoBenin(lig.jour, hh, mm);

  const art = trouverSim(lig.nom);
  if (!art) {
    plan.erreurs.push(`Article introuvable pour vente N°${lig.num} : « ${lig.nom} »`);
    continue;
  }
  if (art.prix_detail == null && art.prix_gros == null) {
    plan.erreurs.push(`Pas de prix pour « ${lig.nom} » (vente N°${lig.num})`);
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
      pourquoi: `vente N°${lig.num} L${iLig + 1} (rejouée)`,
    });
    Object.assign(exist, row);
  } else {
    plan.mvsCreate.push({ ...row, pourquoi: `vente N°${lig.num} L${iLig + 1}` });
    mvsSim.push(row);
  }
}

if (plan.erreurs.length) {
  console.error('\nErreurs de plan :');
  for (const e of plan.erreurs) console.error(' -', e);
  stop(`${plan.erreurs.length} erreur(s) — corriger avant écriture.`);
}

// --- Contrôles ---
const totauxSim = {};
for (const v of plan.ventes) {
  totauxSim[v.jour] = (totauxSim[v.jour] || 0) + v.montant;
}
const nbParJour = {};
for (const v of plan.ventes) nbParJour[v.jour] = (nbParJour[v.jour] || 0) + 1;

const stocksSim = {};
for (const nom of Object.keys(STOCK_APRES)) {
  const a = trouverSim(nom);
  stocksSim[nom] = a ? stockDepuis(mvsSim, a.id) : null;
}

const negatifs = artsSim
  .filter((a) => a.actif)
  .map((a) => ({ nom: a.nom, stock: stockDepuis(mvsSim, a.id) }))
  .filter((x) => x.stock < 0);

console.log(`\n═══ Import ventes 23→26/09 — ${ESSAI ? 'ESSAI' : 'EXÉCUTION'} ═══`);
console.log('Boutique : Chez Dada\n');

console.log('— Renommages —');
for (const r of plan.renommages) console.log(`  « ${r.de} » → « ${r.vers} »`);
if (!plan.renommages.length) console.log('  (aucun)');

console.log('\n— Ajouts —');
for (const a of plan.ajouts) console.log(`  « ${a.nom} » prix ${a.prix_detail}/${a.prix_gros}`);
if (!plan.ajouts.length) console.log('  (aucun)');

console.log('\n— Prix —');
for (const p of plan.prix) {
  console.log(
    `  « ${p.nom} » détail ${p.detailAvant ?? '∅'}→${p.detailApres} · gros ${p.grosAvant ?? '∅'}→${p.grosApres}`
  );
}
if (!plan.prix.length) console.log('  (inchangés hors catalogue déjà bon)');

console.log('\n— Mouvements spéciaux —');
for (const m of [...plan.mvsUpdate, ...plan.mvsCreate].filter((x) => x.type !== 'vente')) {
  const q =
    m.quantiteApres != null
      ? `${m.quantiteAvant}→${m.quantiteApres}`
      : String(m.quantite);
  console.log(`  ${m.pourquoi || m.type} : q=${q} @ ${m.cree_le}`);
}

console.log('\n— Méthode prix des ventes —');
for (const [m, n] of [...plan.methodesPrix.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n}× ${m}`);
}
const lots = plan.ventes.filter((v) => v.methode !== 'prix détail' && v.methode !== 'prix gros');
if (lots.length) {
  console.log('  Détail non-tarif catalogue :');
  for (const v of lots) {
    console.log(
      `    N°${v.num} ${v.nom} q=${v.qte} → ${v.montant} F (${v.methode}, tarif=${v.tarif}, pu=${v.prix_unitaire}, normal=${v.montant_normal})`
    );
  }
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
console.log(`  Stocks négatifs : ${negatifs.length ? negatifs.map((n) => `${n.nom}=${n.stock}`).join(', ') : 'aucun ✓'}`);

console.log(`\nVentes à créer/maj : ${plan.ventes.length}`);
console.log(`Mouvements create : ${plan.mvsCreate.length} · update : ${plan.mvsUpdate.length}`);

if (!okTotaux || !okStocks || negatifs.length) {
  console.log('\n⚠ Contrôles incomplets — corriger avant OK réel.');
} else {
  console.log('\n✓ Tous les contrôles C passent.');
}

if (ESSAI) {
  console.log('\n→ Essai terminé. Dis « OK, importe » pour écrire en production.');
  process.exit(0);
}

// --- Écriture ---
mkdirSync(resolve(ROOT, 'backups'), { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const backupPath = resolve(ROOT, `backups/avant-ventes-23-26-${date}.json`);
writeFileSync(
  backupPath,
  JSON.stringify(
    {
      sauvegarde_le: new Date().toISOString(),
      boutique_id: boutiqueId,
      plan: {
        renommages: plan.renommages,
        ajouts: plan.ajouts,
        prix: plan.prix,
        mvsUpdate: plan.mvsUpdate,
        mvsCreate: plan.mvsCreate.map(({ pourquoi, ...r }) => r),
        ventes: plan.ventes,
      },
      arts_concernes: artsSim.filter((a) =>
        [
          ...plan.renommages.map((r) => r.id),
          ...plan.ajouts.map((a) => a.id),
          ...plan.prix.map((p) => p.id),
          ...plan.ventes.map((v) => trouverSim(v.nom)?.id),
        ].includes(a.id)
      ),
      mvs_avant: mvs,
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
    categorie: 'meches',
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

for (const u of plan.mvsUpdate) {
  const patch = {
    quantite: u.quantiteApres,
    modifie_le: now,
    annule: false,
  };
  if (u.cree_le) patch.cree_le = u.cree_le;
  // Pour ventes rejouées, champs complets déjà dans mvsCreate path — ici update quantite surtout
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
  const { error } = await admin.from('mouvements').update(patch).eq('id', u.id).eq('boutique_id', boutiqueId);
  if (error) stop(`Update mv ${u.id} : ${error.message}`);
}

for (const c of plan.mvsCreate) {
  const { pourquoi, ...row } = c;
  void pourquoi;
  const { error } = await admin.from('mouvements').upsert(
    {
      ...row,
      modifie_le: row.modifie_le || now,
    },
    { onConflict: 'id' }
  );
  if (error) stop(`Create mv ${row.id} : ${error.message}`);
}
console.log(`✓ Mouvements : update=${plan.mvsUpdate.length} create=${plan.mvsCreate.length}`);

// Vérif finale
const mvsApres = await allRows(
  'mouvements',
  'id, article_id, type, quantite, montant_paye, annule, cree_le',
  'boutique_id',
  boutiqueId
);
const artsApres = await allRows(
  'articles',
  'id, nom, actif, prix_detail, prix_gros',
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

console.log('\n✓ Import ventes terminé.');
