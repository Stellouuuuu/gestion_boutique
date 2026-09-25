#!/usr/bin/env node
/**
 * Vérifie pour de vrai les points de sécurité (réseau + Supabase).
 * Usage : node --env-file=.env.admin scripts/verifier-securite.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
const url = (env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const {
  doitPurgerApresSignedOut,
  isLocallyAuthenticated,
  peutConnecterAvecPending,
} = await import('../src/lib/authSecurity.ts');

const SCHEMA = readFileSync(resolve(ROOT, 'src/db/schema.ts'), 'utf8');
const schemaSql = SCHEMA.match(/export const SCHEMA_SQL = `([\s\S]*?)`;/)?.[1];

// --- a) ---
{
  const membre = { boutiqueId: 'b', role: 'proprietaire', nom: 'X' };
  ok(
    'a) hors ligne + session null → Accueil (membre local)',
    isLocallyAuthenticated(null, membre) &&
      !doitPurgerApresSignedOut({ intentionnel: false, isOnline: false }),
    'isLocallyAuthenticated && ne purge pas'
  );
}

// --- b) ---
{
  const raw = new DatabaseSync(':memory:');
  raw.exec(schemaSql);
  const now = '2026-09-20T12:00:00.000Z';
  const older = '2026-09-01T12:00:00.000Z';
  raw.prepare(
    `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
     VALUES ('a1','b1','Pending local','meches',100,null,50,1,?,?,1)`
  ).run(now, now);
  const local = raw.prepare('SELECT a_envoyer, nom FROM articles WHERE id=?').get('a1');
  if (local.a_envoyer !== 1) {
    raw.prepare('UPDATE articles SET nom=?, modifie_le=? WHERE id=?').run('Remote vieux', older, 'a1');
  }
  const after = raw.prepare('SELECT nom, a_envoyer FROM articles WHERE id=?').get('a1');
  ok(
    'b) a_envoyer=1 non écrasé par pull plus ancien',
    after.nom === 'Pending local' && after.a_envoyer === 1,
    `nom=${after.nom} a_envoyer=${after.a_envoyer}`
  );
}

// --- c) mdp changé + a_envoyer conservé + autre compte bloqué ---
{
  const raw = new DatabaseSync(':memory:');
  raw.exec(schemaSql);
  const now = new Date().toISOString();
  raw.prepare(`INSERT INTO settings (key, value) VALUES ('boutique_id', 'b1')`).run();
  raw.prepare(`INSERT INTO settings (key, value) VALUES ('role', 'proprietaire')`).run();
  raw.prepare(`INSERT INTO settings (key, value) VALUES ('membre_nom', 'Alice')`).run();
  raw.prepare(`INSERT INTO settings (key, value) VALUES ('last_user_id', 'user-alice')`).run();
  raw.prepare(
    `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
     VALUES ('a1','b1','X','meches',100,null,50,1,?,?,0)`
  ).run(now, now);
  raw.prepare(
    `INSERT INTO mouvements
       (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
        cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
     VALUES ('m1','b1','a1','vente',1,'detail',100,100,100,50,0,'user-alice',?,?,1)`
  ).run(now, now);

  const pendingAvant = raw.prepare(`SELECT COUNT(*) AS n FROM mouvements WHERE a_envoyer=1`).get().n;

  // Simule purgerCacheMembreSeulement (comme AuthSession)
  raw.prepare(`DELETE FROM settings WHERE key IN ('boutique_id','role','membre_nom')`).run();
  // last_user_id et mouvements restent

  const pendingApres = raw.prepare(`SELECT COUNT(*) AS n FROM mouvements WHERE a_envoyer=1`).get().n;
  const lastUser = raw.prepare(`SELECT value FROM settings WHERE key='last_user_id'`).get()?.value;
  const membreGone = !raw.prepare(`SELECT value FROM settings WHERE key='boutique_id'`).get();

  ok(
    'c1) purge SIGNED_OUT ne supprime JAMAIS a_envoyer',
    pendingAvant === 1 && pendingApres === 1 && lastUser === 'user-alice' && membreGone,
    `pending ${pendingAvant}→${pendingApres} lastUser=${lastUser} membreGone=${membreGone}`
  );

  const memeCompte = peutConnecterAvecPending({
    pendingTotal: pendingApres,
    lastUserId: lastUser,
    newUserId: 'user-alice',
  });
  const autreCompte = peutConnecterAvecPending({
    pendingTotal: pendingApres,
    lastUserId: lastUser,
    newUserId: 'user-bob',
  });
  ok(
    'c2) même compte peut se reconnecter (enverra les ventes)',
    memeCompte.ok === true,
    JSON.stringify(memeCompte)
  );
  ok(
    'c3) autre compte bloqué tant que a_envoyer>0',
    autreCompte.ok === false && /mélang/.test(autreCompte.message || ''),
    autreCompte.ok ? 'aurait dû bloquer' : autreCompte.message
  );
}

// --- c live) refresh token invalidé ---
{
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = '22900000003@boutique-maman.app';
  const mdp1 = 'test1234';
  const mdp2 = 'test5678_' + randomUUID().slice(0, 6);

  let userId = null;
  for (let page = 1; page < 20 && !userId; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const u = data.users.find((x) => x.email === email);
    if (u) userId = u.id;
    if (data.users.length < 200) break;
  }
  if (!userId) {
    ok('c4) mdp changé ailleurs → session invalidée', false, 'user 00000003 introuvable');
  } else {
    await admin.auth.admin.updateUserById(userId, { password: mdp1 });
    const { data: login1, error: e1 } = await sb.auth.signInWithPassword({ email, password: mdp1 });
    if (e1 || !login1.session) {
      ok('c4) mdp changé ailleurs → session invalidée', false, 'login1: ' + e1?.message);
    } else {
      const refreshToken = login1.session.refresh_token;
      await admin.auth.admin.updateUserById(userId, { password: mdp2 });
      const { error: refreshErr } = await sb.auth.refreshSession({ refresh_token: refreshToken });
      const purge = doitPurgerApresSignedOut({ intentionnel: false, isOnline: true });
      ok(
        'c4) mdp changé ailleurs → session invalidée + purge Connexion',
        !!refreshErr && purge,
        `refreshErr=${refreshErr?.message ?? 'none'} purge=${purge}`
      );
      await admin.auth.admin.updateUserById(userId, { password: mdp1 });
    }
  }
}

// --- RLS inventaire vendeuse ---
{
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  // Cherche une vendeuse active, sinon crée le scénario avec 00000002 si vendeuse
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: vendeuses } = await admin
    .from('membres')
    .select('user_id, boutique_id, role')
    .eq('role', 'vendeuse')
    .eq('actif', true)
    .limit(5);

  let tested = false;
  for (const v of vendeuses ?? []) {
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
    const u = users.users.find((x) => x.id === v.user_id);
    if (!u?.email) continue;
    // Reset password and login
    await admin.auth.admin.updateUserById(v.user_id, { password: 'test1234' });
    const { error: loginErr } = await sb.auth.signInWithPassword({
      email: u.email,
      password: 'test1234',
    });
    if (loginErr) continue;
    const { error: insErr } = await sb.from('inventaires').insert({
      id: randomUUID(),
      boutique_id: v.boutique_id,
      perimetre: 'tout',
      statut: 'en_cours',
      fait_par: v.user_id,
      commence_le: new Date().toISOString(),
    });
    ok(
      'RLS) vendeuse ne peut pas créer d’inventaire',
      !!insErr,
      insErr ? insErr.message : 'INSERT a réussi (RLS cassée !)'
    );
    tested = true;
    await sb.auth.signOut();
    break;
  }
  if (!tested) {
    ok('RLS) vendeuse ne peut pas créer d’inventaire', false, 'aucune vendeuse de test trouvée');
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
