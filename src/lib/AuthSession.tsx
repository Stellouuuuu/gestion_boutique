import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useSQLiteContext } from 'expo-sqlite';
import { supabase } from './supabase';
import { telVersIdentifiant } from './identifiant';
import { fetchMembre, type Membre } from '../db/remote';
import { getSetting, setSetting, deleteSetting, SETTINGS_KEYS } from '../db/settings';

interface AuthContextValue {
  /** Vrai tant qu'on n'a pas déterminé s'il y a une session (et, si oui, la boutique). */
  loading: boolean;
  session: Session | null;
  membre: Membre | null;
  signIn: (tel: string, motDePasse: string) => Promise<void>;
  rejoindre: (code: string, nom: string, tel: string, motDePasse: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
      const cache = await chargerMembreLocal();
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      if (data.session) {
        if (cache) rafraichirMembreDistant(data.session.user.id);
        else await rafraichirMembreDistant(data.session.user.id);
      }
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === 'SIGNED_IN' && newSession) {
        rafraichirMembreDistant(newSession.user.id);
      } else if (event === 'SIGNED_OUT') {
        setMembre(null);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
    // Ne s'exécute qu'au montage : chargerMembreLocal/rafraichirMembreDistant sont stables (useCallback sur `db`).
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
      // Si un essai précédent a réussi l'inscription mais échoué sur le code (mauvais code
      // retapé), on est déjà connecté avec ce compte : on ne réinscrit pas (ce qui échouerait
      // avec « déjà inscrit »), on retente juste rejoindre_boutique avec la session existante.
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
    await supabase.auth.signOut();
    await Promise.all([
      deleteSetting(db, SETTINGS_KEYS.boutiqueId),
      deleteSetting(db, SETTINGS_KEYS.role),
      deleteSetting(db, SETTINGS_KEYS.membreNom),
    ]);
    setMembre(null);
  }, [db]);

  return (
    <AuthContext.Provider value={{ loading, session, membre, signIn, rejoindre, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthSessionProvider');
  return ctx;
}
