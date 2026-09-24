import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useSQLiteContext } from 'expo-sqlite';
import { supabase } from './supabase';
import { telVersIdentifiant } from './identifiant';
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

interface AuthContextValue {
  /** Vrai tant qu'on n'a pas déterminé s'il y a une session (et, si oui, la boutique). */
  loading: boolean;
  session: Session | null;
  membre: Membre | null;
  /**
   * Connectée pour la navigation : session Supabase OU cache boutique local.
   * Hors ligne / jeton expiré : on reste sur l'accueil tant que le cache existe.
   */
  isLocallyAuthenticated: boolean;
  signIn: (tel: string, motDePasse: string) => Promise<void>;
  rejoindre: (code: string, nom: string, tel: string, motDePasse: string) => Promise<void>;
  /** Refuse s'il reste des lignes a_envoyer (PendingSyncError). */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Déconnexion volontaire en cours : autorise le nettoyage du membre sur SIGNED_OUT. */
let signOutIntentionnel = false;

export function AuthSessionProvider({ children }: PropsWithChildren) {
  const db = useSQLiteContext();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [membre, setMembre] = useState<Membre | null>(null);

  /** Lecture locale, rapide et hors-ligne — débloque l'écran sans attendre le réseau. */
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

  /** Confirme/rafraîchit depuis Supabase ; échoue silencieusement hors ligne (on garde le cache). */
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
          ]);
        }
      } catch {
        // Hors ligne ou erreur réseau : on garde les informations déjà en cache local.
      }
    },
    [db]
  );

  useEffect(() => {
    let active = true;
    (async () => {
      // 1. Cache local d'abord → l'accueil peut s'afficher sans réseau.
      await chargerMembreLocal();
      // 2. Session persistée (même expirée) : getSession lit le storage, ne force pas le réseau.
      try {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        setSession(data.session);
        if (data.session) {
          void rafraichirMembreDistant(data.session.user.id);
        }
      } catch {
        // Storage / réseau : on garde le membre local déjà chargé.
      }
      if (active) setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_OUT') {
        setSession(null);
        if (signOutIntentionnel) {
          signOutIntentionnel = false;
          setMembre(null);
        }
        // Sinon : échec de refresh hors ligne / transient → on garde le membre local.
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

  const signIn = useCallback(async (tel: string, motDePasse: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: telVersIdentifiant(tel),
      password: motDePasse,
    });
    if (error) throw error;
  }, []);

  const rejoindre = useCallback(
    async (code: string, nom: string, tel: string, motDePasse: string) => {
      const email = telVersIdentifiant(tel);
      const {
        data: { session: dejaConnecte },
      } = await supabase.auth.getSession();
      if (!dejaConnecte || dejaConnecte.user.email !== email) {
        const { error: errSignUp } = await supabase.auth.signUp({ email, password: motDePasse });
        if (errSignUp) throw errSignUp;
      }
      const { error: errJoin } = await supabase.rpc('rejoindre_boutique', {
        p_code: code.trim(),
        p_mon_nom: nom.trim(),
      });
      if (errJoin) throw errJoin;
    },
    []
  );

  const signOut = useCallback(async () => {
    const pending = await countPending(db);
    if (pending.total > 0) {
      throw new PendingSyncError(pending.ventes, pending.total);
    }
    signOutIntentionnel = true;
    await Promise.all([
      deleteSetting(db, SETTINGS_KEYS.boutiqueId),
      deleteSetting(db, SETTINGS_KEYS.role),
      deleteSetting(db, SETTINGS_KEYS.membreNom),
    ]);
    setMembre(null);
    setSession(null);
    try {
      await supabase.auth.signOut();
    } catch {
      // Hors ligne : le cache local est déjà vidé ; on est déconnecté pour l'app.
    }
  }, [db]);

  const isLocallyAuthenticated = session != null || membre != null;

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
