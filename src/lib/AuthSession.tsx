import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import NetInfo from '@react-native-community/netinfo';
import { useSQLiteContext } from 'expo-sqlite';
import { supabase } from './supabase';
import { telVersIdentifiant } from './identifiant';
import {
  doitPurgerApresSignedOut,
  isLocallyAuthenticated as calcLocalAuth,
  peutConnecterAvecPending,
} from './authSecurity';
import { fetchMembre, type Membre } from '../db/remote';
import { countPending } from '../db/syncStatus';
import { getSetting, setSetting, deleteSetting, SETTINGS_KEYS } from '../db/settings';

export class PendingSyncError extends Error {
  readonly pendingVentes: number;
  readonly pendingTotal: number;
  constructor(pendingVentes: number, pendingTotal: number) {
    const n = pendingVentes > 0 ? pendingVentes : pendingTotal;
    const label =
      pendingVentes > 0
        ? n === 1
          ? '1 vente n’est pas encore sauvegardée'
          : `${n} ventes ne sont pas encore sauvegardées`
        : n === 1
          ? '1 modification n’est pas encore sauvegardée'
          : `${n} modifications ne sont pas encore sauvegardées`;
    super(`${label} en ligne. Connectez-vous à Internet et réessayez.`);
    this.name = 'PendingSyncError';
    this.pendingVentes = pendingVentes;
    this.pendingTotal = pendingTotal;
  }
}

export class AutreComptePendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutreComptePendingError';
  }
}

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  membre: Membre | null;
  isLocallyAuthenticated: boolean;
  signIn: (tel: string, motDePasse: string) => Promise<void>;
  rejoindre: (code: string, nom: string, tel: string, motDePasse: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

let signOutIntentionnel = false;

/**
 * Purge uniquement le cache « qui est connecté » (settings membre).
 * Ne touche JAMAIS articles / mouvements / inventaires (a_envoyer conservé).
 */
export async function purgerCacheMembreSeulement(
  db: Parameters<typeof deleteSetting>[0]
): Promise<void> {
  await Promise.all([
    deleteSetting(db, SETTINGS_KEYS.boutiqueId),
    deleteSetting(db, SETTINGS_KEYS.role),
    deleteSetting(db, SETTINGS_KEYS.membreNom),
  ]);
}

export function AuthSessionProvider({ children }: PropsWithChildren) {
  const db = useSQLiteContext();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [membre, setMembre] = useState<Membre | null>(null);

  const purgerCacheLocal = useCallback(async () => {
    await purgerCacheMembreSeulement(db);
    setMembre(null);
  }, [db]);

  const chargerMembreLocal = useCallback(async (): Promise<Membre | null> => {
    const [boutiqueId, role, nom] = await Promise.all([
      getSetting(db, SETTINGS_KEYS.boutiqueId),
      getSetting(db, SETTINGS_KEYS.role),
      getSetting(db, SETTINGS_KEYS.membreNom),
    ]);
    if (boutiqueId && role && nom) {
      const m: Membre = { boutiqueId, role: role as Membre['role'], nom };
      setMembre(m);
      return m;
    }
    return null;
  }, [db]);

  const rafraichirMembreDistant = useCallback(
    async (userId: string): Promise<void> => {
      try {
        const m = await fetchMembre(userId);
        if (m) {
          setMembre(m);
          await Promise.all([
            setSetting(db, SETTINGS_KEYS.boutiqueId, m.boutiqueId),
            setSetting(db, SETTINGS_KEYS.role, m.role),
            setSetting(db, SETTINGS_KEYS.membreNom, m.nom),
            setSetting(db, SETTINGS_KEYS.lastUserId, userId),
          ]);
        }
      } catch {
        // Hors ligne : on garde le cache.
      }
    },
    [db]
  );

  /** Après login : refuse si un autre compte a laissé des a_envoyer. */
  const verifierPasAutreCompte = useCallback(
    async (newUserId: string) => {
      const [pending, lastUserId] = await Promise.all([
        countPending(db),
        getSetting(db, SETTINGS_KEYS.lastUserId),
      ]);
      const check = peutConnecterAvecPending({
        pendingTotal: pending.total,
        lastUserId,
        newUserId,
      });
      if (!check.ok) {
        await supabase.auth.signOut().catch(() => {});
        throw new AutreComptePendingError(check.message);
      }
    },
    [db]
  );

  useEffect(() => {
    let active = true;
    (async () => {
      await chargerMembreLocal();
      try {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        setSession(data.session);
        if (data.session) {
          void rafraichirMembreDistant(data.session.user.id);
        }
      } catch {
        // ignore
      }
      if (active) setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_OUT') {
        setSession(null);
        const intentionnel = signOutIntentionnel;
        if (intentionnel) signOutIntentionnel = false;
        void (async () => {
          let isOnline: boolean | null = null;
          try {
            const net = await NetInfo.fetch();
            if (net.isConnected === false) isOnline = false;
            else if (net.isConnected === true) isOnline = true;
            else isOnline = null;
          } catch {
            isOnline = null;
          }
          if (doitPurgerApresSignedOut({ intentionnel, isOnline })) {
            // last_user_id et a_envoyer restent — reconnexion même compte = push OK.
            await purgerCacheLocal();
          }
        })();
        return;
      }
      setSession(newSession);
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && newSession) {
        void rafraichirMembreDistant(newSession.user.id);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(
    async (tel: string, motDePasse: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: telVersIdentifiant(tel),
        password: motDePasse,
      });
      if (error) throw error;
      if (data.user) await verifierPasAutreCompte(data.user.id);
    },
    [verifierPasAutreCompte]
  );

  const rejoindre = useCallback(
    async (code: string, nom: string, tel: string, motDePasse: string) => {
      const email = telVersIdentifiant(tel);
      const {
        data: { session: dejaConnecte },
      } = await supabase.auth.getSession();
      if (!dejaConnecte || dejaConnecte.user.email !== email) {
        const { data, error: errSignUp } = await supabase.auth.signUp({
          email,
          password: motDePasse,
        });
        if (errSignUp) throw errSignUp;
        if (data.user) await verifierPasAutreCompte(data.user.id);
      }
      const { error: errJoin } = await supabase.rpc('rejoindre_boutique', {
        p_code: code.trim(),
        p_mon_nom: nom.trim(),
      });
      if (errJoin) throw errJoin;
    },
    [verifierPasAutreCompte]
  );

  const signOut = useCallback(async () => {
    const pending = await countPending(db);
    if (pending.total > 0) {
      throw new PendingSyncError(pending.ventes, pending.total);
    }
    signOutIntentionnel = true;
    await deleteSetting(db, SETTINGS_KEYS.lastUserId);
    await purgerCacheLocal();
    setSession(null);
    try {
      await supabase.auth.signOut();
    } catch {
      // Hors ligne OK
    }
  }, [db, purgerCacheLocal]);

  const isLocallyAuthenticated = calcLocalAuth(session, membre);

  return (
    <AuthContext.Provider
      value={{
        loading,
        session,
        membre,
        isLocallyAuthenticated,
        signIn,
        rejoindre,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthSessionProvider');
  return ctx;
}
