#!/usr/bin/env node
// Crée le compte de Maman, sa boutique, ses articles et son stock de départ dans Supabase,
// à partir du fichier Excel articles-boutique-maman.xlsx.
//
// À LANCER UNIQUEMENT SUR TON ORDINATEUR. Ce script utilise la clé service_role,
// qui donne tous les droits : elle ne doit JAMAIS aller dans l'app ni sur GitHub.
//
// Installation (une fois) :  npm install @supabase/supabase-js xlsx
// Fichier .env.admin (à ajouter dans .gitignore) :
//   SUPABASE_URL=https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=eyJ...
//
// Essai à blanc (ne change rien, vérifie le fichier) :
//   node --env-file=.env.admin scripts/creer-compte-maman.mjs --fichier articles-boutique-maman.xlsx \
//     --tel "01 97 00 00 00" --mdp "motdepasse" --nom "Maman" --boutique "Boutique de Maman" --essai
// Pour de vrai : même commande sans --essai.

import { randomUUID, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

// ---------- arguments ----------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, [])
);
const need = ["fichier", "tel", "mdp", "nom", "boutique"];
const manque = need.filter((k) => !args[k] || args[k] === true);
if (manque.length) stop(`Il manque : ${manque.map((k) => "--" + k).join(", ")}`);
const ESSAI = !!args.essai;

// Même règle que dans l'app : chiffres seulement, préfixe 229 ajouté s'il manque.
// L'app DOIT utiliser exactement la même fonction, sinon Maman ne pourra pas se connecter.
export function telVersIdentifiant(tel) {
  let d = String(tel).replace(/\D/g, "");
  if (!d.startsWith("229")) d = "229" + d;
  return `${d}@boutique-maman.app`;
}
const email = telVersIdentifiant(args.tel);
if (String(args.mdp).length < 6) stop("Le mot de passe doit faire au moins 6 caractères.");

// ---------- lecture du fichier Excel ----------
const wb = XLSX.read(readFileSync(args.fichier), { type: "buffer" });
const ws = wb.Sheets["Articles"];
if (!ws) stop("Onglet « Articles » introuvable dans le fichier.");
const brut = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
// Colonnes lues par leur titre (l'ordre peut changer). Titre sans accents, en minuscules.
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const entetes = (brut[0] || []).map(norm);
const col = (debut, obligatoire = true) => {
  const i = entetes.findIndex((h) => h.startsWith(debut));
  if (i < 0 && obligatoire) stop(`Colonne « ${debut} » introuvable dans l'onglet Articles.`);
  return i;
};
const C = { cat: col("categorie"), nom: col("designation"), achat: col("prix d'achat", false),
            detail: col("prix detail"), gros: col("prix gros"), stock: col("stock") };
const lignes = brut.slice(1).map((l) => [l[C.cat], l[C.nom], l[C.detail], l[C.gros], l[C.stock], C.achat >= 0 ? l[C.achat] : null]);

const erreurs = [];
const articles = [];
const vus = new Set();
const nombre = (v, col, n) => {
  if (v === null || v === "") return null;
  const x = typeof v === "number" ? v : Number(String(v).replace(/[\s ]/g, ""));
  if (!Number.isInteger(x) || x < 0) { erreurs.push(`Ligne ${n} : « ${col} » doit être un nombre entier positif (trouvé : ${v}).`); return null; }
  return x;
};
lignes.forEach((l, i) => {
  const n = i + 2;
  const [cat, nomBrut, pd, pg, st, pa] = l;
  const nom = nomBrut == null ? "" : String(nomBrut).trim().replace(/\s+/g, " ");
  if (!nom) return; // ligne vide ou supprimée
  const categorie = cat === "Mèches" ? "meches" : cat === "Produits" ? "produits" : null;
  if (!categorie) erreurs.push(`Ligne ${n} (${nom}) : catégorie « ${cat ?? "vide"} », il faut Mèches ou Produits.`);
  const cle = `${categorie}|${nom.toLowerCase()}`;
  if (vus.has(cle)) erreurs.push(`Ligne ${n} : « ${nom} » est en double.`);
  vus.add(cle);
  articles.push({
    nom, categorie,
    prix_achat: nombre(pa, "Prix d'achat", n),
    prix_detail: nombre(pd, "Prix détail", n),
    prix_gros: nombre(pg, "Prix gros", n),
    stock: nombre(st, "Stock de départ", n) ?? 0,
  });
});

const sansPrix = articles.filter((a) => a.prix_detail == null);
const resume = {
  identifiant: email,
  boutique: args.boutique,
  articles: articles.length,
  meches: articles.filter((a) => a.categorie === "meches").length,
  produits: articles.filter((a) => a.categorie === "produits").length,
  sans_prix_detail: sansPrix.length,
  avec_prix_gros: articles.filter((a) => a.prix_gros != null).length,
  avec_prix_achat: articles.filter((a) => a.prix_achat != null).length,
  pieces_en_stock: articles.reduce((s, a) => s + a.stock, 0),
};
console.log("\nRésumé du fichier :");
console.table(resume);
if (sansPrix.length) console.log(`Sans prix (ne pourront pas être vendus avant d'avoir un prix) : ${sansPrix.slice(0, 15).map((a) => a.nom).join(", ")}${sansPrix.length > 15 ? "…" : ""}`);
if (erreurs.length) { console.error("\nÀ corriger dans le fichier avant de continuer :\n- " + erreurs.join("\n- ")); process.exit(1); }
if (ESSAI) { console.log("\nEssai à blanc : fichier correct, rien n'a été créé. Relance sans --essai pour créer le compte."); process.exit(0); }

// ---------- création dans Supabase ----------
const { createClient } = await import("@supabase/supabase-js");
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
let url = (process.env.SUPABASE_URL || "").trim().replace(/^["']|["']$/g, "");
if (!url || !key) stop("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être dans .env.admin (lancer avec node --env-file=.env.admin).");
// Tolère les copies courantes : /rest/v1 à la fin, / final, espaces
url = url.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
if (url.includes("supabase.com/dashboard")) stop("SUPABASE_URL est l'adresse du tableau de bord. Il faut l'URL du projet, du type https://abcdxyz.supabase.co (Project Settings → Data API).");
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) console.warn(`Attention : SUPABASE_URL a une forme inhabituelle (${url}). Forme attendue : https://abcdxyz.supabase.co`);
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// 1. utilisateur
let userId = await trouverUtilisateur(email);
if (userId) {
  const { data: m } = await sb.from("membres").select("boutique_id").eq("user_id", userId);
  if (m?.length) stop(`Ce numéro a déjà un compte avec une boutique (${m[0].boutique_id}). Rien n'a été modifié, pour ne pas créer de doublons.`);
  console.log("Compte déjà existant sans boutique : on le réutilise et on met à jour le mot de passe.");
  const { error } = await sb.auth.admin.updateUserById(userId, { password: String(args.mdp) });
  if (error) stop("Mise à jour du mot de passe impossible : " + error.message);
} else {
  const { data, error } = await sb.auth.admin.createUser({
    email, password: String(args.mdp), email_confirm: true, user_metadata: { nom: args.nom, tel: args.tel },
  });
  if (error) stop("Création du compte impossible : " + error.message);
  userId = data.user.id;
}
console.log("✓ Compte :", email);

// 2. boutique + propriétaire
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sans 0/O ni 1/I/L
let boutiqueId, code;
for (let essai = 0; essai < 10 && !boutiqueId; essai++) {
  code = Array.from({ length: 6 }, () => ALPHA[randomInt(ALPHA.length)]).join("");
  const { data, error } = await sb.from("boutiques").insert({ nom: args.boutique, code_invitation: code }).select("id").single();
  if (!error) boutiqueId = data.id;
  else if (error.code !== "23505") stop("Création de la boutique impossible : " + error.message);
}
if (!boutiqueId) stop("Impossible de générer un code d'invitation unique.");
{
  const { error } = await sb.from("membres").insert({ boutique_id: boutiqueId, user_id: userId, role: "proprietaire", nom: args.nom });
  if (error) { await sb.from("boutiques").delete().eq("id", boutiqueId); stop("Ajout du propriétaire impossible : " + error.message); }
}
console.log("✓ Boutique :", args.boutique);

// 3. articles + mouvements de stock de départ
const maintenant = new Date().toISOString();
const rowsA = articles.map((a) => ({
  id: randomUUID(), boutique_id: boutiqueId, nom: a.nom, categorie: a.categorie,
  prix_detail: a.prix_detail, prix_gros: a.prix_gros, actif: true, cree_le: maintenant,
  ...(a.prix_achat != null ? { prix_achat: a.prix_achat } : {}),
}));
const rowsM = articles.flatMap((a, i) => a.stock > 0 ? [{
  id: randomUUID(), boutique_id: boutiqueId, article_id: rowsA[i].id, type: "correction",
  quantite: a.stock, tarif: null, prix_unitaire: 0, montant_normal: 0, montant_paye: 0,
  annule: false, cree_par: userId, cree_le: maintenant,
  ...(a.prix_achat != null ? { cout_unitaire: a.prix_achat } : {}),
}] : []);
try {
  for (const lot of paquets(rowsA, 200)) { const { error } = await sb.from("articles").insert(lot); if (error) throw error; }
  for (const lot of paquets(rowsM, 200)) { const { error } = await sb.from("mouvements").insert(lot); if (error) throw error; }
} catch (e) {
  console.error("Erreur pendant l'import, on annule tout :", e.message);
  await sb.from("mouvements").delete().eq("boutique_id", boutiqueId);
  await sb.from("articles").delete().eq("boutique_id", boutiqueId);
  await sb.from("membres").delete().eq("boutique_id", boutiqueId);
  await sb.from("boutiques").delete().eq("id", boutiqueId);
  process.exit(1);
}
console.log(`✓ ${rowsA.length} articles, ${rowsM.length} stocks de départ`);

// 4. vérification
const { count } = await sb.from("articles").select("id", { count: "exact", head: true }).eq("boutique_id", boutiqueId);
const { data: st } = await sb.from("stock_articles").select("stock").eq("boutique_id", boutiqueId);
const total = (st ?? []).reduce((s, r) => s + r.stock, 0);
if (count !== rowsA.length || total !== resume.pieces_en_stock) stop(`Vérification : ${count} articles et ${total} pièces en ligne, attendu ${rowsA.length} et ${resume.pieces_en_stock}.`);

console.log(`
Tout est prêt.
  Connexion dans l'app :  numéro ${args.tel}  +  le mot de passe choisi
  Code pour inviter une vendeuse :  ${code}
`);

// ---------- utilitaires ----------
function stop(msg) { console.error("\n✗ " + msg); process.exit(1); }
function* paquets(arr, n) { for (let i = 0; i < arr.length; i += n) yield arr.slice(i, i + n); }
async function trouverUtilisateur(mail) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) stop("Lecture des comptes impossible : " + error.message);
    const u = data.users.find((x) => x.email?.toLowerCase() === mail);
    if (u) return u.id;
    if (data.users.length < 200) return null;
  }
  return null;
}
