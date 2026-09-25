#!/usr/bin/env node
/**
 * Vérifications §8 Bilans sur la Boutique démo (données réelles Supabase).
 * Usage : node scripts/verifier-bilans-demo.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { loadTestEnv } from './lib/env-test.mjs';
import { telVersIdentifiant } from './lib/tel.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');


const { url, anon, service } = loadTestEnv();
if (!url || !(anon || service)) {
  console.error('Variables Supabase manquantes');
  process.exit(1);
}

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const sb = createClient(url, anon || service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Login compte démo
const { error: authErr } = await sb.auth.signInWithPassword({
  email: telVersIdentifiant('00 00 00 09'),
  password: 'demo1234',
});
if (authErr) {
  console.error('Connexion démo impossible :', authErr.message);
  process.exit(1);
}
const user = (await sb.auth.getUser()).data.user;
const { data: membre } = await sb
  .from('membres')
  .select('boutique_id')
  .eq('user_id', user.id)
  .eq('actif', true)
  .single();
const boutiqueId = membre.boutique_id;
const { data: bout } = await sb.from('boutiques').select('nom').eq('id', boutiqueId).single();
if (bout?.nom !== 'Boutique démo') {
  console.error(`Attendu « Boutique démo », trouvé « ${bout?.nom} »`);
  process.exit(1);
}

const { data: articles, error: aErr } = await sb
  .from('articles')
  .select('*')
  .eq('boutique_id', boutiqueId);
const { data: mouvements, error: mErr } = await sb
  .from('mouvements')
  .select('*')
  .eq('boutique_id', boutiqueId);
if (aErr || mErr) {
  console.error(aErr || mErr);
  process.exit(1);
}
console.log(`\nBoutique démo : ${articles.length} articles, ${mouvements.length} mouvements\n`);

// --- SQLite local miroir + modules bilans ---
const SCHEMA = readFileSync(resolve(ROOT, 'src/db/schema.ts'), 'utf8');
const schemaSql = SCHEMA.match(/export const SCHEMA_SQL = `([\s\S]*?)`;/)?.[1];
if (!schemaSql) {
  console.error('SCHEMA_SQL introuvable');
  process.exit(1);
}

const raw = new DatabaseSync(':memory:');
raw.exec(schemaSql);

for (const a of articles) {
  raw.prepare(
    `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
     VALUES (?,?,?,?,?,?,?,?,?,?,0)`
  ).run(
    a.id,
    a.boutique_id,
    a.nom,
    a.categorie,
    a.prix_detail,
    a.prix_gros,
    a.prix_achat,
    a.actif ? 1 : 0,
    a.cree_le,
    a.modifie_le
  );
}
for (const m of mouvements) {
  raw.prepare(
    `INSERT INTO mouvements
       (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
        cout_unitaire, annule, annule_le, cree_par, cree_le, modifie_le, a_envoyer)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`
  ).run(
    m.id,
    m.boutique_id,
    m.article_id,
    m.type,
    m.quantite,
    m.tarif,
    m.prix_unitaire ?? 0,
    m.montant_normal ?? 0,
    m.montant_paye ?? 0,
    m.cout_unitaire,
    m.annule ? 1 : 0,
    m.annule_le,
    m.cree_par,
    m.cree_le,
    m.modifie_le
  );
}

const db = {
  async getAllAsync(sql, params = []) {
    return raw.prepare(sql).all(...params);
  },
  async getFirstAsync(sql, params = []) {
    return raw.prepare(sql).get(...params) ?? null;
  },
};

const { buildPeriode, shiftPeriode, fromLocal, toAncre, periodeAujourdhui } = await import(
  '../src/db/periodes.ts'
);
const { calculerBilan, listStockFinPeriode } = await import('../src/db/bilans.ts');
const { buildExcelRapport } = await import('../src/db/export.ts');

// Pick a week that has sales in demo data
const sampleVente = mouvements.find((m) => m.type === 'vente' && !m.annule);
const ancreSample = toAncre(new Date(sampleVente.cree_le));

// 1) somme 7 jours = semaine
{
  const semaine = buildPeriode('semaine', ancreSample);
  const bSem = await calculerBilan(db, semaine);
  let somme = 0;
  for (let i = 0; i < 7; i++) {
    const j = shiftPeriode(buildPeriode('jour', semaine.ancre), i);
    somme += (await calculerBilan(db, j)).argentEncaisse;
  }
  ok(
    'somme des 7 jours = total de la semaine',
    somme === bSem.argentEncaisse,
    `jours=${somme} semaine=${bSem.argentEncaisse} (${semaine.label})`
  );
}

// 2) somme 12 mois = année (année de la vente sample)
{
  const y = Number(ancreSample.slice(0, 4));
  const annee = buildPeriode('annee', `${y}-01-01`);
  const bAn = await calculerBilan(db, annee);
  let somme = 0;
  for (let m = 0; m < 12; m++) {
    const mois = buildPeriode('mois', `${y}-${String(m + 1).padStart(2, '0')}-01`);
    somme += (await calculerBilan(db, mois)).argentEncaisse;
  }
  ok(
    'somme des 12 mois = total de l’année',
    somme === bAn.argentEncaisse,
    `mois=${somme} année=${bAn.argentEncaisse} (${y})`
  );
}

// 3) vente annulée non comptée — injecte une vente annulée isolée
{
  const art = articles[0];
  const id = randomUUID();
  const t = fromLocal(2026, 5, 15, 12).toISOString();
  raw.prepare(
    `INSERT INTO mouvements
       (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
        cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
     VALUES (?,?,?,'vente',1,'detail',5000,5000,5000,NULL,1,'u',?,?,0)`
  ).run(id, boutiqueId, art.id, t, t);
  const jour = buildPeriode('jour', '2026-06-15');
  const avant = await calculerBilan(db, jour);
  // Only this injected cancelled sale on that day ideally — check it's not in encaisse from this id
  const row = raw.prepare(
    `SELECT SUM(montant_paye) AS s FROM mouvements WHERE type='vente' AND annule=0 AND cree_le>=? AND cree_le<?`
  ).get(jour.debutIso, jour.finIso);
  const rowAll = raw.prepare(
    `SELECT SUM(montant_paye) AS s FROM mouvements WHERE type='vente' AND id=?`
  ).get(id);
  ok(
    'une vente annulée n’est comptée nulle part',
    (row?.s ?? 0) === avant.argentEncaisse && rowAll?.s === 5000,
    `bilan=${avant.argentEncaisse} actifs_jour=${row?.s ?? 0} annulée_montant=${rowAll?.s}`
  );
}

// 4) 23h30 locale → bon jour
{
  const art = articles[0];
  const id = randomUUID();
  const t = fromLocal(2026, 6, 20, 23, 30).toISOString();
  raw.prepare(
    `INSERT INTO mouvements
       (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
        cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
     VALUES (?,?,?,'vente',1,'detail',1000,1000,1000,NULL,0,'u',?,?,0)`
  ).run(id, boutiqueId, art.id, t, t);
  const bon = await calculerBilan(db, buildPeriode('jour', '2026-07-20'));
  const mauvais = await calculerBilan(db, buildPeriode('jour', '2026-07-21'));
  // Check this specific sale lands on 20th: count ventes with this id in period
  const inBon = raw
    .prepare(`SELECT COUNT(*) AS n FROM mouvements WHERE id=? AND cree_le>=? AND cree_le<?`)
    .get(id, buildPeriode('jour', '2026-07-20').debutIso, buildPeriode('jour', '2026-07-20').finIso);
  const inMauvais = raw
    .prepare(`SELECT COUNT(*) AS n FROM mouvements WHERE id=? AND cree_le>=? AND cree_le<?`)
    .get(id, buildPeriode('jour', '2026-07-21').debutIso, buildPeriode('jour', '2026-07-21').finIso);
  ok(
    'vente à 23h30 locale tombe dans le bon jour',
    inBon.n === 1 && inMauvais.n === 0,
    `iso=${t} jour20=${inBon.n} jour21=${inMauvais.n} encaisse20+=${bon.argentEncaisse}`
  );
  void mauvais;
}

// 5) stock fin « aujourd’hui » = stock actuel
{
  const far = periodeAujourdhui('jour');
  // Use end of today as fin — listStockFinPeriode uses cree_le < finIso
  // For "aujourd'hui" period, fin is tomorrow 00:00 local = all mouvements so far today included
  // Stock actuel = all mouvements ever
  const stocks = await listStockFinPeriode(db, far);
  let okAll = true;
  let checked = 0;
  for (const s of stocks.slice(0, 50)) {
    const actuel = raw
      .prepare(
        `SELECT COALESCE((
          SELECT SUM(CASE WHEN m.annule=1 THEN 0 WHEN m.type='vente' THEN -m.quantite ELSE m.quantite END)
          FROM mouvements m WHERE m.article_id=?
        ),0) AS stock`
      )
      .get(s.id);
    if (actuel.stock !== s.stock) {
      okAll = false;
      break;
    }
    checked++;
  }
  // Also full check count
  const allStocks = await listStockFinPeriode(db, buildPeriode('jour', '2099-01-01'));
  let mismatches = 0;
  for (const s of allStocks) {
    const actuel = raw
      .prepare(
        `SELECT COALESCE((
          SELECT SUM(CASE WHEN m.annule=1 THEN 0 WHEN m.type='vente' THEN -m.quantite ELSE m.quantite END)
          FROM mouvements m WHERE m.article_id=?
        ),0) AS stock`
      )
      .get(s.id);
    if (actuel.stock !== s.stock) mismatches++;
  }
  ok(
    'stock fin de période « aujourd’hui » / futur = stock actuel',
    mismatches === 0 && okAll,
    `vérifiés=${allStocks.length} écarts=${mismatches} sample50=${checked}`
  );
}

// 6) changer prix_achat ne change pas bénéfice passé
{
  const vente = mouvements.find((m) => m.type === 'vente' && !m.annule && m.cout_unitaire != null);
  if (!vente) {
    ok('bénéfice stable si prix_achat change', false, 'aucune vente avec cout_unitaire');
  } else {
    const jour = buildPeriode('jour', toAncre(new Date(vente.cree_le)));
    const avant = await calculerBilan(db, jour);
    raw.prepare('UPDATE articles SET prix_achat = 999999 WHERE id = ?').run(vente.article_id);
    const apres = await calculerBilan(db, jour);
    ok(
      'changer le prix d’achat ne change pas le bénéfice des ventes passées',
      avant.benefice.montant === apres.benefice.montant,
      `avant=${avant.benefice.montant} apres=${apres.benefice.montant}`
    );
  }
}

// 7) Excel Résumé = écran
{
  const mois = buildPeriode('mois', ancreSample.slice(0, 7) + '-01');
  const bilan = await calculerBilan(db, mois);
  const excel = await buildExcelRapport(db, mois, 'Boutique-demo');
  const wb = XLSX.read(excel.base64, { type: 'base64' });
  const resume = XLSX.utils.sheet_to_json(wb.Sheets['Résumé'], { header: 1 });
  const map = Object.fromEntries(resume.filter((r) => r.length >= 2).map((r) => [r[0], r[1]]));
  ok(
    'total onglet Résumé Excel = total écran',
    map['Argent encaissé'] === bilan.argentEncaisse &&
      map['Bénéfice estimé'] === bilan.benefice.montant,
    `écran=${bilan.argentEncaisse}/${bilan.benefice.montant} excel=${map['Argent encaissé']}/${map['Bénéfice estimé']}`
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
