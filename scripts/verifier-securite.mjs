#!/usr/bin/env node
/**
 * Vérifie pour de vrai les 3 points de sécurité (réseau + Supabase).
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

const { doitPurgerApresSignedOut, isLocallyAuthenticated } = await import(
  '../src/lib/authSecurity.ts'
);

// --- a) hors ligne session expirée ---
{
  const membre = { boutiqueId: 'b', role: 'proprietaire', nom: 'X' };
  ok(
    'a) hors ligne + session null → Accueil (membre local)',
    isLocallyAuthenticated(null, membre) &&
      !doitPurgerApresSignedOut({ intentionnel: false, isOnline: false }),
    'isLocallyAuthenticated && ne purge pas'
  );
}

// --- b) a_envoyer non écrasé : utilise la vraie logique pull de sync (extrait) ---
{
  const SCHEMA = readFileSync(resolve(ROOT, 'src/db/schema.ts'), 'utf8');
  const schemaSql = SCHEMA.match(/export const SCHEMA_SQL = `([\s\S]*?)`;/)?.[1];
  const raw = new DatabaseSync(':memory:');
  raw.exec(schemaSql);
  const now = '2026-09-20T12:00:00.000Z';
  const older = '2026-09-01T12:00:00.000Z';
  raw.prepare(
    `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
     VALUES ('a1','b1','Pending local','meches',100,null,50,1,?,?,1)`
  ).run(now, now);

  // Même garde que sync.ts pullArticles
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

// --- c) mdp changé ailleurs → refresh token invalide ---
{
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  // Compte jetable : vendeuse éphémère sur démo ou user test 00000003
  const email = '22900000003@boutique-maman.app';
  const mdp1 = 'test1234';
  const mdp2 = 'test5678_' + randomUUID().slice(0, 6);

  // Find user
  let userId = null;
  for (let page = 1; page < 20 && !userId; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const u = data.users.find((x) => x.email === email);
    if (u) userId = u.id;
    if (data.users.length < 200) break;
  }
  if (!userId) {
    ok('c) mdp changé ailleurs → session invalidée', false, 'user 00000003 introuvable');
  } else {
    await admin.auth.admin.updateUserById(userId, { password: mdp1 });
    const { data: login1, error: e1 } = await sb.auth.signInWithPassword({
      email,
      password: mdp1,
    });
    if (e1 || !login1.session) {
      ok('c) mdp changé ailleurs → session invalidée', false, 'login1: ' + e1?.message);
    } else {
      const refreshToken = login1.session.refresh_token;
      // Change password elsewhere (admin)
      await admin.auth.admin.updateUserById(userId, { password: mdp2 });
      // Old refresh should fail
      const { error: refreshErr } = await sb.auth.refreshSession({ refresh_token: refreshToken });
      const purge = doitPurgerApresSignedOut({ intentionnel: false, isOnline: true });
      ok(
        'c) mdp changé ailleurs → session invalidée + purge Connexion',
        !!refreshErr && purge,
        `refreshErr=${refreshErr?.message ?? 'none'} purge=${purge}`
      );
      // Restore password for other scripts
      await admin.auth.admin.updateUserById(userId, { password: mdp1 });
    }
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
