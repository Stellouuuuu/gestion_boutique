#!/usr/bin/env node
/**
 * Tests inscription libre : créer boutique, numéro déjà pris, renommage, isolation RLS.
 * Usage : node scripts/verifier-inscription.mjs
Prérequis : coller docs/schema-complet.sql (ou docs/sql/inscription-libre-rls.sql si le schéma de base est déjà là) dans le projet TEST.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { loadTestEnv } from './lib/env-test.mjs';
import { telVersIdentifiant } from './lib/tel.mjs';

const { url, anon, service } = loadTestEnv();
if (!url || !anon || !service) {
  console.error('Variables Supabase manquantes');
  process.exit(1);
}


const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const suffix = randomBytes(3).toString('hex');
const telA = `000091${suffix.slice(0, 2)}`;
const telB = `000092${suffix.slice(2)}`;
const mdp = 'test1234';

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function ensureUser(tel, password) {
  const c = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = telVersIdentifiant(tel);
  const { data, error } = await c.auth.signUp({ email, password });
  if (error && /already/i.test(error.message)) {
    const again = await c.auth.signInWithPassword({ email, password });
    if (again.error) throw again.error;
    return { client: c, userId: again.data.user.id };
  }
  if (error) throw error;
  if (!data.session) {
    const again = await c.auth.signInWithPassword({ email, password });
    if (again.error) throw again.error;
    return { client: c, userId: again.data.user.id };
  }
  return { client: c, userId: data.user.id };
}

async function createBoutiqueAdmin(userId, nomBoutique, monNom) {
  const id = randomUUID();
  const code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
  const { error: e1 } = await admin.from('boutiques').insert({
    id,
    nom: nomBoutique,
    code_invitation: code,
  });
  if (e1) throw e1;
  const { error: e2 } = await admin.from('membres').insert({
    boutique_id: id,
    user_id: userId,
    role: 'proprietaire',
    nom: monNom,
    actif: true,
  });
  if (e2) throw e2;
  return id;
}

async function cleanupEmail(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const u = data?.users?.find((x) => x.email === email);
  if (!u) return;
  const { data: mems } = await admin.from('membres').select('boutique_id, role').eq('user_id', u.id);
  for (const m of mems ?? []) {
    if (m.role === 'proprietaire') {
      await admin.from('articles').delete().eq('boutique_id', m.boutique_id);
      await admin.from('membres').delete().eq('boutique_id', m.boutique_id);
      await admin.from('boutiques').delete().eq('id', m.boutique_id);
    } else {
      await admin.from('membres').delete().eq('user_id', u.id).eq('boutique_id', m.boutique_id);
    }
  }
  await admin.auth.admin.deleteUser(u.id);
}

try {
  await cleanupEmail(telVersIdentifiant(telA));
  await cleanupEmail(telVersIdentifiant(telB));

  const { client: ca, userId: uidA } = await ensureUser(telA, mdp);
  const { data: bidARpc, error: errA } = await ca.rpc('creer_boutique', {
    p_nom_boutique: `Boutique A ${suffix}`,
    p_mon_nom: 'Awa',
  });
  let bidA = bidARpc;
  if (errA || !bidA) {
    check(
      'RPC creer_boutique',
      false,
      `${errA?.message || 'null'} → exécutez docs/sql/inscription-libre-rls.sql`
    );
    bidA = await createBoutiqueAdmin(uidA, `Boutique A ${suffix}`, 'Awa');
    check('créer boutique A (fallback admin)', !!bidA, bidA);
  } else {
    check('RPC creer_boutique + boutique A', true, String(bidA));
  }

  const dup = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: errDup } = await dup.auth.signUp({
    email: telVersIdentifiant(telA),
    password: mdp,
  });
  check(
    'numéro déjà utilisé',
    !!errDup && /already|registered|exists/i.test(errDup.message || ''),
    errDup?.message
  );

  const { client: cb, userId: uidB } = await ensureUser(telB, mdp);
  const { data: bidBRpc, error: errB } = await cb.rpc('creer_boutique', {
    p_nom_boutique: `Boutique B ${suffix}`,
    p_mon_nom: 'Béatrice',
  });
  let bidB = bidBRpc;
  if (errB || !bidB) {
    bidB = await createBoutiqueAdmin(uidB, `Boutique B ${suffix}`, 'Béatrice');
    check('créer boutique B (fallback admin)', !!bidB);
  } else {
    check('créer boutique B via RPC', true, String(bidB));
  }

  const { data: boutiquesA } = await ca.from('boutiques').select('id, nom');
  check(
    'isolation boutiques : A ne voit pas B',
    !(boutiquesA ?? []).some((b) => b.id === bidB),
    `vu=${(boutiquesA ?? []).length}`
  );

  const artId = randomUUID();
  const now = new Date().toISOString();
  await admin.from('articles').insert({
    id: artId,
    boutique_id: bidB,
    nom: 'Secret B',
    categorie: 'meches',
    prix_detail: 1000,
    actif: true,
    cree_le: now,
    modifie_le: now,
  });
  const { data: artsA } = await ca.from('articles').select('id').eq('id', artId);
  check('isolation articles : A ne lit pas l’article de B', !(artsA ?? []).length);

  const { error: errNom } = await ca
    .from('membres')
    .update({ nom: 'Awa Plus' })
    .eq('boutique_id', bidA)
    .eq('user_id', uidA);
  check('modifier mon nom', !errNom, errNom?.message);

  const { data: memA } = await ca
    .from('membres')
    .select('nom')
    .eq('boutique_id', bidA)
    .eq('user_id', uidA)
    .maybeSingle();
  check('nom synchronisé distant', memA?.nom === 'Awa Plus', memA?.nom);

  const { data: renamed, error: errBout } = await ca
    .from('boutiques')
    .update({ nom: `Chez Awa ${suffix}` })
    .eq('id', bidA)
    .select('nom')
    .maybeSingle();
  check(
    'renommer boutique (b_modifier)',
    !errBout && renamed?.nom === `Chez Awa ${suffix}`,
    errBout?.message || renamed?.nom || '0 ligne — exécutez docs/sql/inscription-libre-rls.sql'
  );

  await cb.from('boutiques').update({ nom: 'Hack' }).eq('id', bidA);
  const { data: boutA } = await admin.from('boutiques').select('nom').eq('id', bidA).single();
  check('B ne peut pas écraser le nom de A', boutA?.nom !== 'Hack', boutA?.nom);

  const { count: nA } = await ca
    .from('articles')
    .select('*', { count: 'exact', head: true })
    .eq('boutique_id', bidA);
  check('boutique neuve : 0 article distant', (nA ?? 0) === 0, `n=${nA}`);
} catch (e) {
  check('exécution', false, String(e?.message || e));
} finally {
  await cleanupEmail(telVersIdentifiant(telA)).catch(() => {});
  await cleanupEmail(telVersIdentifiant(telB)).catch(() => {});
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
