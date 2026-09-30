#!/usr/bin/env node
/**
 * Alias validés par Maman → TEST (source de vérité, sans filtre mot distinctif).
 * Usage : node --env-file=.env.test scripts/seed-alias-valides-maman-test.mjs
 * Aucun appel Gemini. Aucune suppression d’articles / mouvements.
 */
import { createClient } from '@supabase/supabase-js';
import { loadTestEnv } from './lib/env-test.mjs';
import { normaliserTexteAlias, normaliserNom } from './lib/rapprochementFeuille.mjs';

const BOUTIQUE = 'db88ec62-fe85-4548-8e8e-920c4f99db70';

/** Alias uniques validés (texte manuscrit → nom catalogue exact). */
const UNIQUES = [
  ['Schaly', 'Shary'],
  ['Sprait', 'Like à sec G'],
  ['Sprite', 'Like à sec G'],
  ['Pommade', 'Dallas petit'],
  ['Sabam', 'Teinte subaru 400/3000'],
  ['Koko', 'Boucle en fer'],
  ['Perle cheveux', 'Boucle en fer'],
  ['Koko ou perle cheveux', 'Boucle en fer'],
  ['Bassam petit', 'Champoing tokpa petit'],
  ['Colle IKT', 'Gomme'],
  ["L'oodais", 'Huile Luôdaïs carton'],
  ["L'uôdais", 'Huile Luôdaïs carton'],
  ['Pied de biche', 'Taille ongle'],
  ['Damado', 'Dermatol'],
];

/** Pétal / Petal → multi ; départage : unit ≥ 300 → Pétal one grand. */
const PETAL_TEXTES = ['Pétal', 'Petal', 'petals', 'pétal', 'Petals'];
const PETAL_CANDIDATS = ['Pétal one grand', 'Gel pétals petit'];

const { url, service } = loadTestEnv();
const admin = createClient(url, service, { auth: { persistSession: false } });

const { data: arts, error } = await admin
  .from('articles')
  .select('id, nom, actif')
  .eq('boutique_id', BOUTIQUE);
if (error) {
  console.error(error.message);
  process.exit(1);
}
const byNom = new Map();
for (const a of arts || []) {
  const k = normaliserNom(a.nom);
  if (!k) continue;
  const prev = byNom.get(k);
  if (!prev || (a.actif && !prev.actif)) byNom.set(k, a);
}

function art(nom) {
  const a = byNom.get(normaliserNom(nom));
  if (!a) {
    console.error('✗ Article introuvable :', nom);
    process.exit(1);
  }
  return a;
}

const now = new Date().toISOString();
const payload = [];
for (const [ecrit, nom] of UNIQUES) {
  const a = art(nom);
  payload.push({
    boutique_id: BOUTIQUE,
    texte_norm: normaliserTexteAlias(ecrit),
    article_id: a.id,
    cree_le: now,
    modifie_le: now,
  });
  console.log(`  « ${ecrit} » → ${a.nom}`);
}

const { error: upErr } = await admin.from('alias_articles').upsert(payload, {
  onConflict: 'boutique_id,texte_norm',
});
if (upErr) {
  console.error(upErr.message);
  process.exit(1);
}

const petalIds = PETAL_CANDIDATS.map((n) => art(n));
const candSeen = new Set();
const candPayload = [];
for (const texte of PETAL_TEXTES) {
  const cle = normaliserTexteAlias(texte);
  for (const a of petalIds) {
    const key = `${cle}|${a.id}`;
    if (candSeen.has(key)) continue;
    candSeen.add(key);
    candPayload.push({
      boutique_id: BOUTIQUE,
      texte_norm: cle,
      article_id: a.id,
      cree_le: now,
    });
  }
}
console.log(
  `  multi pétal/petal → ${petalIds.map((a) => a.nom).join(' | ')} (clés: ${[...new Set(PETAL_TEXTES.map(normaliserTexteAlias))].join(', ')})`
);
const { error: cErr } = await admin.from('alias_articles_candidats').upsert(candPayload, {
  onConflict: 'boutique_id,texte_norm,article_id',
});
if (cErr) {
  console.error(cErr.message);
  process.exit(1);
}

console.log(`✓ ${payload.length} alias uniques + ${candPayload.length} candidats pétal (TEST)`);
