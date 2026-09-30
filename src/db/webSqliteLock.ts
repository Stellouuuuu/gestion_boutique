/**
 * Verrou exclusif navigateur pour expo-sqlite / OPFS (web).
 *
 * AccessHandlePoolVFS ne permet qu’une seule connexion : un 2ᵉ onglet
 * (ou un worker encore vivant) lève NoModificationAllowedError.
 * On prend `navigator.locks` AVANT d’ouvrir SQLite, et on le garde
 * jusqu’à la fermeture de la page — sans jamais supprimer la base.
 *
 * Singleton par onglet : un remount React (Strict Mode) ne redemande pas
 * le verrou (sinon l’effet croirait à tort qu’un autre onglet le détient).
 */

export const SQLITE_WEB_LOCK_NAME = 'boutique-sqlite-opfs';

export class AutreOngletSqliteError extends Error {
  constructor(message = 'L’application est déjà ouverte dans un autre onglet') {
    super(message);
    this.name = 'AutreOngletSqliteError';
  }
}

export function isOpfsLockError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
  return (
    /NoModificationAllowedError/i.test(msg) ||
    /Access Handles cannot be created/i.test(msg) ||
    /createSyncAccessHandle/i.test(msg) ||
    error instanceof AutreOngletSqliteError
  );
}

export type WebSqliteLockHandle = {
  /** Promesse qui se résout quand le verrou est libéré (pagehide). */
  held: Promise<void>;
};

/** Handle acquis pour cet onglet (module = un seul realm JS). */
let heldInThisTab: WebSqliteLockHandle | null = null;
/** In-flight pour coalescer les appels parallèles / remounts. */
let inFlight: Promise<WebSqliteLockHandle | null> | null = null;

/**
 * Tente d’acquérir le verrou exclusif sans attendre.
 * @returns handle si acquis (ou déjà acquis dans cet onglet), `null` si un autre onglet le détient.
 */
export async function tryAcquireWebSqliteLock(options?: {
  /** Après un refus (autre onglet), permet une nouvelle tentative. */
  retry?: boolean;
}): Promise<WebSqliteLockHandle | null> {
  if (heldInThisTab) return heldInThisTab;

  if (inFlight && !options?.retry) return inFlight;

  if (options?.retry) {
    inFlight = null;
  }

  inFlight = acquireOnce();
  const result = await inFlight;
  if (result) heldInThisTab = result;
  else inFlight = null; // autoriser retry plus tard
  return result;
}

async function acquireOnce(): Promise<WebSqliteLockHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) {
    const handle = { held: new Promise<void>(() => {}) };
    return handle;
  }

  return new Promise((resolve) => {
    let settled = false;
    const safeResolve = (v: WebSqliteLockHandle | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    navigator.locks
      .request(SQLITE_WEB_LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          safeResolve(null);
          return;
        }
        const held = new Promise<void>((release) => {
          if (typeof window === 'undefined') return;
          const done = () => release();
          window.addEventListener('pagehide', done, { once: true });
          window.addEventListener('beforeunload', done, { once: true });
        });
        safeResolve({ held });
        await held;
      })
      .catch(() => {
        // API locks indisponible → laisser SQLite tenter l’ouverture.
        safeResolve({ held: new Promise(() => {}) });
      });
  });
}

/** Réservé aux tests unitaires. */
export function __resetWebSqliteLockForTests(): void {
  heldInThisTab = null;
  inFlight = null;
}
