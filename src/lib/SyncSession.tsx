import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useSQLiteContext } from 'expo-sqlite';
import { synchroniserBoutique } from '../db/sync';
import {
  buildSyncIndicateur,
  countPending,
  getDerniereSynchroOk,
  type SyncIndicateur,
} from '../db/syncStatus';
import { onLocalDataChange } from './syncBus';
import { useAuth } from './AuthSession';

interface SyncContextValue {
  indicateur: SyncIndicateur;
  pendingTotal: number;
  pendingVentes: number;
  /** Déclenche une synchro (debounced). Ne bloque pas l'écran. */
  requestSync: () => void;
  refreshIndicateur: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

const DEBOUNCE_MS = 3000;
const INTERVAL_MS = 2 * 60 * 1000;

export function SyncSessionProvider({ children }: PropsWithChildren) {
  const db = useSQLiteContext();
  const { session, membre } = useAuth();
  const [indicateur, setIndicateur] = useState<SyncIndicateur>({
    kind: 'ok',
    label: '✓ Tout est sauvegardé',
  });
  const [pendingTotal, setPendingTotal] = useState(0);
  const [pendingVentes, setPendingVentes] = useState(0);

  const running = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boutiqueIdRef = useRef<string | null>(null);
  const sessionRef = useRef(session);

  useEffect(() => {
    boutiqueIdRef.current = membre?.boutiqueId ?? null;
  }, [membre?.boutiqueId]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const refreshIndicateur = useCallback(async () => {
    const [pending, lastOk] = await Promise.all([countPending(db), getDerniereSynchroOk(db)]);
    setPendingTotal(pending.total);
    setPendingVentes(pending.ventes);
    setIndicateur(buildSyncIndicateur(pending, lastOk));
  }, [db]);

  const runSync = useCallback(async () => {
    const boutiqueId = boutiqueIdRef.current;
    if (!boutiqueId || !sessionRef.current || running.current) {
      await refreshIndicateur();
      return;
    }
    const net = await NetInfo.fetch();
    if (net.isConnected === false) {
      await refreshIndicateur();
      return;
    }
    running.current = true;
    try {
      await synchroniserBoutique(db, boutiqueId);
    } finally {
      running.current = false;
      await refreshIndicateur();
    }
  }, [db, refreshIndicateur]);

  const requestSync = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void runSync();
    }, DEBOUNCE_MS);
  }, [runSync]);

  // Indicateur + synchro initiale (différé pour ne pas setState synchrone dans l'effet)
  useEffect(() => {
    const t = setTimeout(() => {
      void refreshIndicateur();
      if (sessionRef.current && boutiqueIdRef.current) void runSync();
    }, 0);
    return () => clearTimeout(t);
  }, [refreshIndicateur, runSync, membre?.boutiqueId, session]);

  // 3 s après chaque écriture locale
  useEffect(() => {
    return onLocalDataChange(() => {
      void refreshIndicateur();
      requestSync();
    });
  }, [refreshIndicateur, requestSync]);

  // Toutes les 2 min si connecté
  useEffect(() => {
    if (!session || !membre) return;
    const id = setInterval(() => {
      void runSync();
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [session, membre, runSync]);

  // Retour réseau
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected) void runSync();
      else void refreshIndicateur();
    });
    return unsub;
  }, [runSync, refreshIndicateur]);

  // Retour au premier plan
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'active') void runSync();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [runSync]);

  return (
    <SyncContext.Provider
      value={{ indicateur, pendingTotal, pendingVentes, requestSync, refreshIndicateur }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync doit être utilisé dans un SyncSessionProvider');
  return ctx;
}
