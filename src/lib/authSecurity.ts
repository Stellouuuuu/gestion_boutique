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

export const MSG_AUTRE_COMPTE_PENDING =
  'Des ventes de l’autre compte attendent encore d’être envoyées sur ce téléphone. Reconnectez-vous avec le même numéro pour les sauvegarder, sinon elles seraient mélangées.';

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
    message: MSG_AUTRE_COMPTE_PENDING,
  };
}

/**
 * À la connexion à la boutique B : si la base locale a encore des données
 * d’une autre boutique A —
 * - a_envoyer > 0 → bloquer (ne pas perdre / mélanger) ;
 * - sinon → purger le local avant téléchargement de B.
 */
export function decisionAutreBoutiqueLocale(opts: {
  boutiqueCourante: string;
  boutiqueIdsLocaux: string[];
  pendingTotal: number;
}): 'ok' | 'purge' | 'bloque' {
  const autres = opts.boutiqueIdsLocaux.filter((id) => id !== opts.boutiqueCourante);
  if (autres.length === 0) return 'ok';
  if (opts.pendingTotal > 0) return 'bloque';
  return 'purge';
}
