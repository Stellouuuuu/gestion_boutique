import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY doivent être définis dans .env (voir .env.admin.example pour le format, ou docs/CAHIER_DES_CHARGES_ETAPE2.md §3).'
  );
}

/**
 * Session gardée avec expo-secure-store sur mobile, localStorage sur web
 * (cahier des charges étape 2 §2 : « on reste connecté »).
 *
 * iOS a historiquement refusé les valeurs SecureStore de plus de ~2048 octets ;
 * une session Supabase (jeton d'accès + de rafraîchissement) dépasse souvent cette
 * taille. On découpe donc la valeur en blocs de 1800 caractères.
 */
const CHUNK_SIZE = 1800;

async function setChunked(key: string, value: string): Promise<void> {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) chunks.push(value.slice(i, i + CHUNK_SIZE));
  await SecureStore.setItemAsync(`${key}_n`, String(chunks.length));
  await Promise.all(chunks.map((c, i) => SecureStore.setItemAsync(`${key}_${i}`, c)));
}

async function getChunked(key: string): Promise<string | null> {
  const countRaw = await SecureStore.getItemAsync(`${key}_n`);
  if (!countRaw) return null;
  const count = Number(countRaw);
  const chunks = await Promise.all(
    Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${key}_${i}`))
  );
  if (chunks.some((c) => c == null)) return null;
  return chunks.join('');
}

async function removeChunked(key: string): Promise<void> {
  const countRaw = await SecureStore.getItemAsync(`${key}_n`);
  const count = countRaw ? Number(countRaw) : 0;
  await Promise.all([
    SecureStore.deleteItemAsync(`${key}_n`),
    ...Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(`${key}_${i}`)),
  ]);
}

const secureStoreAdapter: SupportedStorage = {
  getItem: getChunked,
  setItem: setChunked,
  removeItem: removeChunked,
};

const webStorageAdapter: SupportedStorage = {
  getItem: (key) => Promise.resolve(globalThis.localStorage?.getItem(key) ?? null),
  setItem: (key, value) => {
    globalThis.localStorage?.setItem(key, value);
    return Promise.resolve();
  },
  removeItem: (key) => {
    globalThis.localStorage?.removeItem(key);
    return Promise.resolve();
  },
};

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: Platform.OS === 'web' ? webStorageAdapter : secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
