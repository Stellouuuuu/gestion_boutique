/**
 * Règles de connexion hors-ligne vs session révoquée.
 * Voir tests dans src/db/securite.test.ts.
 */

/** Connectée pour la navigation : session Supabase OU cache boutique local. */
export function isLocallyAuthenticated(session: unknown, membre: unknown): boolean {
  return session != null || membre != null;
}

/**
 * Après un événement SIGNED_OUT :
 * - volontaire → toujours purger ;
 * - hors ligne / réseau inconnu → garder le cache (session expirée OK, on peut vendre) ;
 * - en ligne → session révoquée (ex. mot de passe changé ailleurs) → purger → Connexion.
 */
export function doitPurgerApresSignedOut(opts: {
  intentionnel: boolean;
  isOnline: boolean | null;
}): boolean {
  if (opts.intentionnel) return true;
  if (opts.isOnline === false || opts.isOnline == null) return false;
  return true;
}
