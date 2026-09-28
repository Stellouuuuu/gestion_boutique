#!/usr/bin/env node
/**
 * Inventaire lecture seule : triggers / cron / webhooks susceptibles d’appeler lire-feuille.
 * Usage :
 *   node --env-file=.env.test scripts/inventaire-supabase-auto-ia.mjs
 *   node --env-file=.env.admin scripts/inventaire-supabase-auto-ia.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      })
  );
}

const fileEnv = {
  ...loadEnv(resolve(ROOT, '.env')),
  ...loadEnv(resolve(ROOT, '.env.admin')),
  ...loadEnv(resolve(ROOT, '.env.test')),
  ...process.env,
};
// Prefer explicit argv --prod | --test
const mode = process.argv.includes('--prod') ? 'prod' : 'test';
const url = (
  mode === 'prod'
    ? loadEnv(resolve(ROOT, '.env.admin')).SUPABASE_URL || loadEnv(resolve(ROOT, '.env')).SUPABASE_URL
    : loadEnv(resolve(ROOT, '.env.test')).SUPABASE_URL
)?.replace(/\/+$/, '');
const key =
  mode === 'prod'
    ? loadEnv(resolve(ROOT, '.env.admin')).SUPABASE_SERVICE_ROLE_KEY
    : loadEnv(resolve(ROOT, '.env.test')).SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('URL/clé manquants');
  process.exit(1);
}

const admin = createClient(url.trim(), key.trim(), {
  auth: { persistSession: false },
});

console.log(`\n═══ Inventaire auto-IA — ${mode.toUpperCase()} — ${url} ═══\n`);

async function trySql(label, sql) {
  // PostgREST ne permet pas SQL arbitraire ; on tente via rpc si une fonction existe
  const { data, error } = await admin.rpc('exec_sql', { q: sql }).maybeSingle?.() 
    ?? await admin.rpc('exec_sql', { q: sql });
  if (error) {
    console.log(`· ${label} : non accessible via RPC (${error.message})`);
    return null;
  }
  console.log(`· ${label} :`, JSON.stringify(data, null, 2)?.slice(0, 800));
  return data;
}

// Tables métier photo
for (const t of ['lots_photo', 'quotas_photo', 'alias_articles']) {
  const { count, error } = await admin.from(t).select('id', { count: 'exact', head: true });
  console.log(`· table ${t} : ${error ? 'ABSENTE (' + error.message + ')' : count + ' lignes (count)'}`);
}

await trySql(
  'triggers',
  `select event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation
   from information_schema.triggers
   where event_object_schema = 'public'
   order by 1,2,3`
);
await trySql('cron.job', `select jobid, jobname, schedule, command, active from cron.job`);
await trySql(
  'supabase_functions.hooks',
  `select id, hook_name, enabled, created_at from supabase_functions.hooks`
);

console.log(`
Notes :
- Sans accès SQL direct (Dashboard → SQL), vérifie manuellement :
  Database → Webhooks | Database → Extensions (pg_cron) | Database → Triggers
  Storage → buckets feuilles-photo (policies seulement, pas de webhook auto-IA dans le repo)
- Edge Functions listées via : npx supabase functions list --project-ref <REF>
`);
