#!/usr/bin/env node
/**
 * Vérifie étape 4 : rôle vendeuse (RLS), code invitation, retrait de membre.
 * Usage : node scripts/verifier-etape4.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadTestEnv } from './lib/env-test.mjs';
import { telVersIdentifiant } from './lib/tel.mjs';


const { url, anon, service } = loadTestEnv();


const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: authErr } = await sb.auth.signInWithPassword({
  email: telVersIdentifiant('00 00 00 01'),
  password: 'test1234',
});
if (authErr) {
  console.error(authErr.message);
  process.exit(1);
}

const userId = (await sb.auth.getUser()).data.user.id;
const { data: membre } = await sb
  .from('membres')
  .select('boutique_id, role, nom')
  .eq('user_id', userId)
  .eq('actif', true)
  .single();

ok('propriétaire connectée', membre?.role === 'proprietaire', membre?.role);

const { data: boutique } = await sb
  .from('boutiques')
  .select('id, nom, code_invitation')
  .eq('id', membre.boutique_id)
  .single();

ok(
  'code invitation 6 caractères',
  !!boutique?.code_invitation && boutique.code_invitation.length === 6,
  boutique?.code_invitation
);

const { data: membres } = await sb
  .from('membres')
  .select('user_id, nom, role, actif')
  .eq('boutique_id', membre.boutique_id)
  .eq('actif', true);

ok('liste membres lisible', (membres?.length ?? 0) >= 1, `n=${membres?.length}`);

// RLS : une vendeuse ne peut pas modifier un article (on simule avec un second client si possible)
// Sans compte vendeuse de test, on vérifie que la policy update articles exige proprietaire
// en tentant un update... on est propriétaire donc ça doit réussir (sanity).
const { data: art } = await sb
  .from('articles')
  .select('id, nom')
  .eq('boutique_id', membre.boutique_id)
  .limit(1)
  .single();

const { error: updOk } = await sb
  .from('articles')
  .update({ nom: art.nom })
  .eq('id', art.id);
ok('propriétaire peut modifier un article', !updOk, updOk?.message ?? 'ok');

// Créer un compte vendeuse temporaire via rejoindre, tester RLS, puis retirer
const code = boutique.code_invitation;
const vendTel = '00 00 00 99';
const vendEmail = telVersIdentifiant(vendTel);
const vendPass = 'vendeuse1';

// Nettoyage si un essai précédent a laissé le compte
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY || anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});
if (env.SUPABASE_SERVICE_ROLE_KEY) {
  for (let page = 1; page < 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const u = data?.users?.find((x) => x.email === vendEmail);
    if (u) {
      await admin.from('membres').delete().eq('user_id', u.id);
      await admin.auth.admin.deleteUser(u.id);
      break;
    }
    if (!data?.users || data.users.length < 200) break;
  }
}

const sbV = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: signUpErr } = await sbV.auth.signUp({
  email: vendEmail,
  password: vendPass,
});
if (signUpErr && !/already/i.test(signUpErr.message)) {
  ok('création vendeuse', false, signUpErr.message);
} else {
  if (signUpErr) {
    await sbV.auth.signInWithPassword({ email: vendEmail, password: vendPass });
  }
  const { error: joinErr } = await sbV.rpc('rejoindre_boutique', {
    p_code: code,
    p_mon_nom: 'Vendeuse Test',
  });
  ok('rejoindre avec code', !joinErr, joinErr?.message ?? 'ok');

  const { data: mv } = await sbV
    .from('membres')
    .select('role')
    .eq('user_id', (await sbV.auth.getUser()).data.user.id)
    .eq('actif', true)
    .maybeSingle();
  ok('rôle vendeuse', mv?.role === 'vendeuse', mv?.role);

  const { error: forbid } = await sbV
    .from('articles')
    .update({ nom: art.nom + ' x' })
    .eq('id', art.id);
  // RLS : update doit échouer ou ne toucher 0 ligne. supabase-js souvent ne renvoie pas d'erreur
  // si 0 rows — on re-lit le nom.
  const { data: artAfter } = await sbV.from('articles').select('nom').eq('id', art.id).single();
  ok(
    'vendeuse ne peut pas modifier un article',
    artAfter?.nom === art.nom && (!forbid || true),
    `nom=${artAfter?.nom}`
  );

  // Retrait par la propriétaire
  const vendUserId = (await sbV.auth.getUser()).data.user.id;
  await sb.auth.signInWithPassword({
    email: telVersIdentifiant('00 00 00 01'),
    password: 'test1234',
  });
  const { error: remErr } = await sb
    .from('membres')
    .update({ actif: false })
    .eq('boutique_id', membre.boutique_id)
    .eq('user_id', vendUserId);
  ok('propriétaire retire la vendeuse', !remErr, remErr?.message ?? 'ok');

  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    await admin.from('membres').delete().eq('user_id', vendUserId);
    await admin.auth.admin.deleteUser(vendUserId);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
