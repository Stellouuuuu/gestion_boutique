#!/usr/bin/env node
/**
 * Wrangler Pages ignore **toute** arborescence nommée `node_modules`
 * (y compris dist/assets/node_modules généré par Expo).
 * On renomme en `npm` et on réécrit les références dans les bundles.
 * @see https://github.com/cloudflare/workers-sdk/issues/3615
 */
import { existsSync, renameSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const FROM = 'assets/node_modules';
const TO = 'assets/npm';
const FROM_DIR = join(DIST, 'assets', 'node_modules');
const TO_DIR = join(DIST, 'assets', 'npm');

if (!existsSync(DIST)) {
  console.error('dist/ introuvable — lancez expo export d’abord');
  process.exit(1);
}

if (existsSync(FROM_DIR)) {
  if (existsSync(TO_DIR)) {
    // Rebuild : nettoyer l’ancien dossier renommé
    const { rmSync } = await import('node:fs');
    rmSync(TO_DIR, { recursive: true, force: true });
  }
  renameSync(FROM_DIR, TO_DIR);
  console.log(`✓ renommé ${FROM} → ${TO}`);
} else if (existsSync(TO_DIR)) {
  console.log(`✓ ${TO} déjà présent`);
} else {
  console.warn('Aucun dossier assets/node_modules ni assets/npm — rien à renommer');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const TEXT_EXT = new Set(['.js', '.map', '.html', '.json', '.css', '.txt']);
let rewritten = 0;
for (const file of walk(DIST)) {
  const ext = file.slice(file.lastIndexOf('.'));
  if (!TEXT_EXT.has(ext)) continue;
  const raw = readFileSync(file, 'utf8');
  if (!raw.includes(FROM)) continue;
  writeFileSync(file, raw.split(FROM).join(TO));
  rewritten++;
  console.log(`  réécrit ${file.slice(DIST.length + 1)}`);
}
console.log(`✓ ${rewritten} fichier(s) mis à jour`);
