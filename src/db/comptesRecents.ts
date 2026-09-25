import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting, SETTINGS_KEYS } from './settings.ts';

export interface CompteRecent {
  userId: string;
  /** Chiffres du téléphone (avec ou sans 229). */
  telDigits: string;
  prenom: string;
  boutiqueNom: string;
  lastUsedIso: string;
}

const MAX = 3;

function parse(raw: string | null): CompteRecent[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (c): c is CompteRecent =>
          !!c &&
          typeof c === 'object' &&
          typeof (c as CompteRecent).userId === 'string' &&
          typeof (c as CompteRecent).telDigits === 'string' &&
          typeof (c as CompteRecent).prenom === 'string' &&
          typeof (c as CompteRecent).boutiqueNom === 'string'
      )
      .map((c) => ({
        userId: c.userId,
        telDigits: c.telDigits.replace(/\D/g, ''),
        prenom: c.prenom,
        boutiqueNom: c.boutiqueNom,
        lastUsedIso: typeof c.lastUsedIso === 'string' ? c.lastUsedIso : new Date().toISOString(),
      }))
      // Sécurité : jamais de champ mot de passe même s’il avait été injecté
      .map(({ userId, telDigits, prenom, boutiqueNom, lastUsedIso }) => ({
        userId,
        telDigits,
        prenom,
        boutiqueNom,
        lastUsedIso,
      }));
  } catch {
    return [];
  }
}

export async function listerComptesRecents(db: SQLiteDatabase): Promise<CompteRecent[]> {
  return parse(await getSetting(db, SETTINGS_KEYS.comptesRecents));
}

export async function ajouterCompteRecent(
  db: SQLiteDatabase,
  compte: Omit<CompteRecent, 'lastUsedIso'> & { lastUsedIso?: string }
): Promise<void> {
  const telDigits = compte.telDigits.replace(/\D/g, '');
  if (!telDigits || !compte.userId) return;
  const entry: CompteRecent = {
    userId: compte.userId,
    telDigits,
    prenom: compte.prenom.trim() || 'Compte',
    boutiqueNom: compte.boutiqueNom.trim() || '',
    lastUsedIso: compte.lastUsedIso ?? new Date().toISOString(),
  };
  const prev = await listerComptesRecents(db);
  const sansDoublon = prev.filter(
    (c) => c.userId !== entry.userId && c.telDigits !== entry.telDigits
  );
  const next = [entry, ...sansDoublon].slice(0, MAX);
  await setSetting(db, SETTINGS_KEYS.comptesRecents, JSON.stringify(next));
}

export async function oublierCompte(db: SQLiteDatabase, userIdOrTel: string): Promise<void> {
  const key = userIdOrTel.replace(/\D/g, '') || userIdOrTel;
  const prev = await listerComptesRecents(db);
  const next = prev.filter((c) => c.userId !== userIdOrTel && c.telDigits !== key);
  await setSetting(db, SETTINGS_KEYS.comptesRecents, JSON.stringify(next));
}
