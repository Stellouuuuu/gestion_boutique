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
 * - volontaire → toujours purger le cache membre (pas les ventes SQLite) ;
 * - hors ligne / réseau inconnu → garder le cache (session expirée OK, on peut vendre) ;
 * - en ligne → session révoquée (ex. mot de passe changé ailleurs) → purger membre → Connexion.
 *
 * Important : la purge ne touche JAMAIS les tables articles/mouvements (a_envoyer).
 */
export function doitPurgerApresSignedOut(opts: {
  intentionnel: boolean;
  isOnline: boolean | null;
}): boolean {
  if (opts.intentionnel) return true;
  if (opts.isOnline === false || opts.isOnline == null) return false;
  return true;
}

/**
 * Empêche qu’un autre compte se connecte tant qu’il reste des lignes a_envoyer
 * appartenant au précédent utilisateur.
 */
export function peutConnecterAvecPending(opts: {
  pendingTotal: number;
  lastUserId: string | null;
  newUserId: string;
}): { ok: true } | { ok: false; message: string } {
  if (opts.pendingTotal <= 0) return { ok: true };
  if (!opts.lastUserId || opts.lastUserId === opts.newUserId) return { ok: true };
  return {
    ok: false,
    message:
      'Des ventes de l’autre compte attendent encore d’être envoyées sur ce téléphone. Reconnectez-vous avec le même numéro pour les sauvegarder, sinon elles seraient mélangées.',
  };
}
