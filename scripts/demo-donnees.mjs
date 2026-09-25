#!/usr/bin/env node
/**
 * Crée / régénère la « Boutique démo » (téléphone 00 00 00 09, mdp demo1234)
 * avec 316 articles + ~3 mois de mouvements réalistes.
 *
 * Ne touche JAMAIS une autre boutique : uniquement celle nommée « Boutique démo »
 * liée à ce numéro.
 *
 * Usage :
 *   node --env-file=.env.admin scripts/demo-donnees.mjs
 *   node --env-file=.env.admin scripts/demo-donnees.mjs --essai
 */
import { randomUUID, randomInt } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) {
      acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    }
    return acc;
  }, [])
);
const ESSAI = !!args.essai;

const TEL = '00 00 00 09';
const MDP = 'demo1234';
const NOM = 'Démo';
const BOUTIQUE = 'Boutique démo';
const FICHIER = args.fichier
  ? String(args.fichier)
  : resolve(ROOT, 'articles-boutique-maman.xlsx');

function telVersIdentifiant(tel) {
  let d = String(tel).replace(/\D/g, '');
  if (!d.startsWith('229')) d = '229' + d;
  return `${d}@boutique-maman.app`;
}
const email = telVersIdentifiant(TEL);

function stop(msg) {
  console.error('\n✗ ' + msg);
  process.exit(1);
}
function* paquets(arr, n) {
  for (let i = 0; i < arr.length; i += n) yield arr.slice(i, i + n);
}
function loadEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}

const env = { ...loadEnv(resolve(ROOT, '.env')), ...loadEnv(resolve(ROOT, '.env.admin')) };
let url = (env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/^["']|["']$/g, '');
const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) stop('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (.env.admin).');
url = url.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

// ---------- Excel ----------
if (!existsSync(FICHIER)) stop(`Fichier introuvable : ${FICHIER}`);
const wb = XLSX.read(readFileSync(FICHIER), { type: 'buffer' });
const ws = wb.Sheets['Articles'];
if (!ws) stop('Onglet « Articles » introuvable.');
const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
const brut = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
const entetes = (brut[0] || []).map(norm);
const col = (debut, obligatoire = true) => {
  const i = entetes.findIndex((h) => h.startsWith(debut));
  if (i < 0 && obligatoire) stop(`Colonne « ${debut} » introuvable.`);
  return i;
};
const C = {
  cat: col('categorie'),
  nom: col('designation'),
  detail: col('prix detail'),
  gros: col('prix gros'),
  stock: col('stock'),
};
const nombre = (v) => {
  if (v === null || v === '') return null;
  const x = typeof v === 'number' ? v : Number(String(v).replace(/[\s\u202f]/g, ''));
  if (!Number.isInteger(x) || x < 0) return null;
  return x;
};

const articlesBrut = [];
for (const l of brut.slice(1)) {
  const nom = l[C.nom] == null ? '' : String(l[C.nom]).trim().replace(/\s+/g, ' ');
  if (!nom) continue;
  const cat = l[C.cat] === 'Mèches' ? 'meches' : l[C.cat] === 'Produits' ? 'produits' : null;
  if (!cat) continue;
  articlesBrut.push({
    nom,
    categorie: cat,
    prix_detail: nombre(l[C.detail]),
    prix_gros: nombre(l[C.gros]),
    stock: nombre(l[C.stock]) ?? 0,
  });
}

/** ~80 % des articles avec prix d'achat = 60–75 % du détail (arrondi 50 F). */
function prixAchatDemo(prixDetail, index) {
  if (prixDetail == null || prixDetail <= 0) return null;
  if (index % 5 === 4) return null; // ~20 % sans prix d'achat
  const pct = 0.6 + (index % 4) * 0.05; // 60, 65, 70, 75
  return Math.max(50, Math.round((prixDetail * pct) / 50) * 50);
}

const articles = articlesBrut.map((a, i) => ({
  ...a,
  // Excel souvent à 0 : stock de départ réaliste pour la démo
  stock: a.stock > 0 ? a.stock : 5 + (i % 20),
  prix_achat: prixAchatDemo(a.prix_detail, i),
}));

console.log('\nRésumé démo :');
console.table({
  identifiant: email,
  boutique: BOUTIQUE,
  articles: articles.length,
  avec_prix_achat: articles.filter((a) => a.prix_achat != null).length,
  pieces_depart: articles.reduce((s, a) => s + a.stock, 0),
});

if (ESSAI) {
  console.log('\nEssai à blanc : rien n’a été créé.');
  process.exit(0);
}

const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function trouverUtilisateur(mail) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) stop('Lecture des comptes : ' + error.message);
    const u = data.users.find((x) => x.email?.toLowerCase() === mail);
    if (u) return u.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

// 1. Compte
let userId = await trouverUtilisateur(email);
if (userId) {
  const { error } = await sb.auth.admin.updateUserById(userId, { password: MDP });
  if (error) stop('MàJ mot de passe : ' + error.message);
  console.log('✓ Compte existant réutilisé :', email);
} else {
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password: MDP,
    email_confirm: true,
    user_metadata: { nom: NOM, tel: TEL },
  });
  if (error) stop('Création compte : ' + error.message);
  userId = data.user.id;
  console.log('✓ Compte créé :', email);
}

// 2. Boutique démo uniquement
const { data: membres } = await sb.from('membres').select('boutique_id, role').eq('user_id', userId);
let boutiqueId = null;
let codeInvitation = null;

if (membres?.length) {
  for (const m of membres) {
    const { data: b } = await sb.from('boutiques').select('id, nom, code_invitation').eq('id', m.boutique_id).maybeSingle();
    if (b?.nom === BOUTIQUE) {
      boutiqueId = b.id;
      codeInvitation = b.code_invitation;
    } else {
      console.warn(`⚠ Boutique « ${b?.nom} » ignorée (on ne touche que « ${BOUTIQUE} »).`);
    }
  }
}

if (!boutiqueId) {
  const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let essai = 0; essai < 10 && !boutiqueId; essai++) {
    codeInvitation = Array.from({ length: 6 }, () => ALPHA[randomInt(ALPHA.length)]).join('');
    const { data, error } = await sb
      .from('boutiques')
      .insert({ nom: BOUTIQUE, code_invitation: codeInvitation })
      .select('id')
      .single();
    if (!error) boutiqueId = data.id;
    else if (error.code !== '23505') stop('Création boutique : ' + error.message);
  }
  if (!boutiqueId) stop('Impossible de créer la boutique démo.');
  const { error: mErr } = await sb.from('membres').insert({
    boutique_id: boutiqueId,
    user_id: userId,
    role: 'proprietaire',
    nom: NOM,
  });
  if (mErr) {
    await sb.from('boutiques').delete().eq('id', boutiqueId);
    stop('Ajout propriétaire : ' + mErr.message);
  }
  console.log('✓ Boutique créée :', BOUTIQUE);
} else {
  console.log('✓ Boutique existante réutilisée :', BOUTIQUE, boutiqueId);
}

// 3. Purge données de CETTE boutique seulement
{
  const { error: e1 } = await sb.from('inventaire_lignes').delete().eq('boutique_id', boutiqueId);
  if (e1) stop('Purge inventaire_lignes : ' + e1.message);
  const { error: e2 } = await sb.from('inventaires').delete().eq('boutique_id', boutiqueId);
  if (e2) stop('Purge inventaires : ' + e2.message);
  const { error: e3 } = await sb.from('mouvements').delete().eq('boutique_id', boutiqueId);
  if (e3) stop('Purge mouvements : ' + e3.message);
  const { error: e4 } = await sb.from('articles').delete().eq('boutique_id', boutiqueId);
  if (e4) stop('Purge articles : ' + e4.message);
  console.log('✓ Anciennes données de la boutique démo effacées');
}

// 4. Articles + stock de départ (il y a 3 mois)
const debutDemo = new Date();
debutDemo.setUTCMonth(debutDemo.getUTCMonth() - 3);
debutDemo.setUTCHours(10, 0, 0, 0);
const t0 = debutDemo.toISOString();

const rowsA = articles.map((a) => ({
  id: randomUUID(),
  boutique_id: boutiqueId,
  nom: a.nom,
  categorie: a.categorie,
  prix_detail: a.prix_detail,
  prix_gros: a.prix_gros,
  prix_achat: a.prix_achat,
  actif: true,
  cree_le: t0,
}));

const rowsM = [];
for (let i = 0; i < articles.length; i++) {
  const a = articles[i];
  if (a.stock <= 0) continue;
  rowsM.push({
    id: randomUUID(),
    boutique_id: boutiqueId,
    article_id: rowsA[i].id,
    type: 'correction',
    quantite: a.stock,
    tarif: null,
    prix_unitaire: 0,
    montant_normal: 0,
    montant_paye: 0,
    cout_unitaire: a.prix_achat,
    annule: false,
    cree_par: userId,
    cree_le: t0,
  });
}

// 5. Mouvements réalistes sur 90 jours
const stock = articles.map((a) => a.stock);
const jamaisVendus = new Set();
for (let i = 0; i < articles.length; i++) {
  if (i % 17 === 0) jamaisVendus.add(i); // ~6 % jamais vendus
}

function isoLocal(dayOffset, hour, minute) {
  const d = new Date(debutDemo.getTime());
  d.setUTCDate(d.getUTCDate() + dayOffset);
  // Porto-Novo UTC+1 : stocker en UTC = heure locale − 1
  d.setUTCHours(hour - 1, minute, 0, 0);
  return d.toISOString();
}

function pickVendable(preferLowStock) {
  const candidates = [];
  for (let i = 0; i < articles.length; i++) {
    if (jamaisVendus.has(i)) continue;
    if (articles[i].prix_detail == null) continue;
    if (preferLowStock && stock[i] > 2) continue;
    if (!preferLowStock && stock[i] <= 0) continue;
    if (stock[i] > 0) candidates.push(i);
  }
  if (!candidates.length) {
    for (let i = 0; i < articles.length; i++) {
      if (!jamaisVendus.has(i) && articles[i].prix_detail != null && stock[i] > 0) candidates.push(i);
    }
  }
  if (!candidates.length) return null;
  return candidates[randomInt(candidates.length)];
}

for (let day = 0; day < 90; day++) {
  const date = new Date(debutDemo.getTime());
  date.setUTCDate(date.getUTCDate() + day);
  const dow = (date.getUTCDay() + 1) % 7; // approx : on utilise UTC+1 day-of-week
  // Recalcul propre du jour de semaine en local UTC+1
  const local = new Date(date.getTime() + 3600e3);
  const jourSemaine = local.getUTCDay(); // 0=dim … 6=sam en « local » via offset
  const isSam = jourSemaine === 6;
  const nbVentes = isSam ? 8 + randomInt(6) : 2 + randomInt(5);

  for (let v = 0; v < nbVentes; v++) {
    const idx = pickVendable(false);
    if (idx == null) break;
    const a = articles[idx];
    const useGros = a.prix_gros != null && randomInt(10) < 2;
    const pu = useGros ? a.prix_gros : a.prix_detail;
    const qte = useGros ? 1 + randomInt(4) : 1 + randomInt(2);
    const maxQ = Math.min(qte, stock[idx]);
    if (maxQ <= 0) continue;
    const montantNormal = maxQ * pu;
    let montantPaye = montantNormal;
    // ~8 % de réductions
    if (!useGros && randomInt(100) < 8) {
      montantPaye = Math.round(montantNormal * (0.85 + randomInt(10) / 100));
    }
    const hour = 8 + randomInt(12);
    const minute = randomInt(60);
    const cree_le = isoLocal(day, hour, minute);
    const mid = randomUUID();
    rowsM.push({
      id: mid,
      boutique_id: boutiqueId,
      article_id: rowsA[idx].id,
      type: 'vente',
      quantite: maxQ,
      tarif: useGros ? 'gros' : 'detail',
      prix_unitaire: pu,
      montant_normal: montantNormal,
      montant_paye: montantPaye,
      cout_unitaire: a.prix_achat,
      annule: false,
      cree_par: userId,
      cree_le,
    });
    stock[idx] -= maxQ;
    // ~3 % d'annulations
    if (randomInt(100) < 3) {
      rowsM[rowsM.length - 1].annule = true;
      rowsM[rowsM.length - 1].annule_le = cree_le;
      stock[idx] += maxQ;
    }
  }

  // Entrées de marchandise ~2 fois / semaine
  if (jourSemaine === 1 || jourSemaine === 4) {
    const nEntrees = 1 + randomInt(3);
    for (let e = 0; e < nEntrees; e++) {
      const idx = randomInt(articles.length);
      const a = articles[idx];
      const qte = 5 + randomInt(20);
      rowsM.push({
        id: randomUUID(),
        boutique_id: boutiqueId,
        article_id: rowsA[idx].id,
        type: 'entree',
        quantite: qte,
        tarif: null,
        prix_unitaire: a.prix_detail ?? 0,
        montant_normal: qte * (a.prix_detail ?? 0),
        montant_paye: 0,
        cout_unitaire: a.prix_achat,
        annule: false,
        cree_par: userId,
        cree_le: isoLocal(day, 9, 30),
      });
      stock[idx] += qte;
    }
  }
}

// Forcer quelques ruptures (ventes jusqu’à 0 sur articles populaires)
for (let r = 0; r < 8; r++) {
  const idx = pickVendable(true) ?? pickVendable(false);
  if (idx == null || stock[idx] <= 0) continue;
  const a = articles[idx];
  const qte = stock[idx];
  const pu = a.prix_detail;
  if (pu == null) continue;
  rowsM.push({
    id: randomUUID(),
    boutique_id: boutiqueId,
    article_id: rowsA[idx].id,
    type: 'vente',
    quantite: qte,
    tarif: 'detail',
    prix_unitaire: pu,
    montant_normal: qte * pu,
    montant_paye: qte * pu,
    cout_unitaire: a.prix_achat,
    annule: false,
    cree_par: userId,
    cree_le: isoLocal(85 + (r % 5), 16, 0),
  });
  stock[idx] = 0;
}

try {
  for (const lot of paquets(rowsA, 200)) {
    const { error } = await sb.from('articles').insert(lot);
    if (error) throw error;
  }
  for (const lot of paquets(rowsM, 200)) {
    const { error } = await sb.from('mouvements').insert(lot);
    if (error) throw error;
  }
} catch (e) {
  console.error('Erreur import, rollback boutique démo :', e.message);
  await sb.from('mouvements').delete().eq('boutique_id', boutiqueId);
  await sb.from('articles').delete().eq('boutique_id', boutiqueId);
  process.exit(1);
}

const { count: nArt } = await sb
  .from('articles')
  .select('id', { count: 'exact', head: true })
  .eq('boutique_id', boutiqueId);
const { count: nMouv } = await sb
  .from('mouvements')
  .select('id', { count: 'exact', head: true })
  .eq('boutique_id', boutiqueId);

console.log(`
✓ Boutique démo prête
  Téléphone : ${TEL}
  Mot de passe : ${MDP}
  Articles : ${nArt}
  Mouvements : ${nMouv}
  Code invitation : ${codeInvitation}
  Jamais vendus (indices) : ${[...jamaisVendus].length} articles
`);
