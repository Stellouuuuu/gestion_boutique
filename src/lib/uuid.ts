import * as Crypto from 'expo-crypto';

/** UUID v4, généré sur le téléphone (même format que Supabase). */
export function newId(): string {
  return Crypto.randomUUID();
}
