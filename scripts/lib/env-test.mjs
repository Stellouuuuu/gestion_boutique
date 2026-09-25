/**
 * Charge .env.test pour les scripts d’essai. Refuse d’exécuter si l’URL
 * pointe vers le projet de production (.env / .env.admin).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [
          l.slice(0, i).trim(),
          l.slice(i + 1).trim().replace(/^["']|["']$/g, ''),
        ];
      })
  );
}

function normalizeUrl(u) {
  return String(u || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\/rest\/v1\/?$/, '')
    .replace(/\/+$/, '');
}

/**
 * @returns {{ env: Record<string,string>, url: string, anon: string, service: string }}
 */
export function loadTestEnv() {
  const prod = {
    ...loadEnvFile(resolve(ROOT, '.env')),
    ...loadEnvFile(resolve(ROOT, '.env.admin')),
  };
  const testPath = resolve(ROOT, '.env.test');
  if (!existsSync(testPath)) {
    console.error(
      '\n✗ .env.test introuvable. Copie .env.test.example → .env.test et remplis les clés du projet boutique-test.\n' +
        '  Les scripts d’essai ne doivent JAMAIS tourner sur la production.\n'
    );
    process.exit(1);
  }
  const env = { ...loadEnvFile(testPath), ...process.env };
  const url = normalizeUrl(env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL);
  const prodUrl = normalizeUrl(prod.SUPABASE_URL || prod.EXPO_PUBLIC_SUPABASE_URL);
  const anon = (env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  const service = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!url) {
    console.error('\n✗ SUPABASE_URL manquant dans .env.test\n');
    process.exit(1);
  }
  if (prodUrl && url === prodUrl) {
    console.error(
      '\n✗ REFUS : .env.test pointe vers le même projet que la production (.env / .env.admin).\n' +
        `  URL : ${url}\n` +
        '  Utilise le projet Supabase « boutique-test », pas la production.\n'
    );
    process.exit(1);
  }
  const prodService = (prod.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (service && prodService && service === prodService) {
    console.error(
      '\n✗ REFUS : la clé service_role de .env.test est identique à celle de production.\n'
    );
    process.exit(1);
  }

  return { env, url, anon, service, root: ROOT };
}
