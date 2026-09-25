#!/usr/bin/env node
/**
 * Vérifie comptes récents (sans password) + purge boutique + refus si a_envoyer.
 * Usage : node --experimental-strip-types scripts/verifier-comptes.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const schemaSrc = readFileSync(resolve(ROOT, 'src/db/schema.ts'), 'utf8');
const m = schemaSrc.match(/export const SCHEMA_SQL = `([\s\S]*?)`;/);
if (!m) {
  console.error('SCHEMA_SQL introuvable');
  process.exit(1);
}
const schemaSql = m[1];

function adapt(raw) {
  return {
    async getAllAsync(sql, params = []) {
      return raw.prepare(sql).all(...params);
    },
    async getFirstAsync(sql, params = []) {
      return raw.prepare(sql).get(...params) ?? null;
    },
    async runAsync(sql, params = []) {
      return raw.prepare(sql).run(...params);
    },
    async withTransactionAsync(fn) {
      raw.exec('BEGIN');
      try {
        await fn();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

const { ajouterCompteRecent, listerComptesRecents, oublierCompte } = await import(
  pathToFileURL(resolve(ROOT, 'src/db/comptesRecents.ts')).href
);
const { purgerDonneesBoutiqueLocale } = await import(
  pathToFileURL(resolve(ROOT, 'src/db/purgeBoutique.ts')).href
);
const { countPending } = await import(pathToFileURL(resolve(ROOT, 'src/db/syncStatus.ts')).href);
const { masquerTel } = await import(pathToFileURL(resolve(ROOT, 'src/lib/identifiant.ts')).href);

const raw = new DatabaseSync(':memory:');
raw.exec(schemaSql);
const db = adapt(raw);

await ajouterCompteRecent(db, {
  userId: 'u1',
  telDigits: '0197000011',
  prenom: 'Awa',
  boutiqueNom: 'Chez Awa',
});
await ajouterCompteRecent(db, {
  userId: 'u2',
  telDigits: '0197000022',
  prenom: 'Béa',
  boutiqueNom: 'Chez Béa',
});
const list = await listerComptesRecents(db);
ok('récents sans password', !/password|motDePasse/i.test(JSON.stringify(list)), `${list.length} comptes`);
ok('masquerTel', masquerTel('0197000011') === '01 97 •• •• 11', masquerTel('0197000011'));

const t = '2026-01-01T00:00:00.000Z';
raw
  .prepare(
    `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
     VALUES ('a1','bA','X','meches',1000,null,null,1,?,?,0)`
  )
  .run(t, t);
raw
  .prepare(
    `INSERT INTO mouvements
       (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
        cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
     VALUES ('m1','bA','a1','vente',1,'detail',1000,1000,1000,null,0,'u',?,?,0)`
  )
  .run(t, t);
raw
  .prepare(
    `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
     VALUES ('a2','bB','Y','meches',1000,null,null,1,?,?,0)`
  )
  .run(t, t);

await purgerDonneesBoutiqueLocale(db, 'bA');
const nA = raw.prepare('SELECT COUNT(*) as n FROM articles WHERE boutique_id=?').get('bA').n;
const nB = raw.prepare('SELECT COUNT(*) as n FROM articles WHERE boutique_id=?').get('bB').n;
ok('purge A → 0 articles', nA === 0, `nA=${nA}`);
ok('isolation B intacte', nB === 1, `nB=${nB}`);

raw
  .prepare(
    `INSERT INTO mouvements
       (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
        cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
     VALUES ('m2','bB','a2','vente',1,'detail',1000,1000,1000,null,0,'u',?,?,1)`
  )
  .run(t, t);
const pending = await countPending(db);
ok('signOut refuse si a_envoyer', pending.total > 0, `pending=${pending.total}`);

await oublierCompte(db, 'u1');
ok('oublierCompte', (await listerComptesRecents(db)).every((c) => c.userId !== 'u1'));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
