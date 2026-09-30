import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SQLiteProvider } from 'expo-sqlite';
import { migrateDatabase } from '../db/migrate';
import { isOpfsLockError, tryAcquireWebSqliteLock } from '../db/webSqliteLock';
import { FONT_TITLE } from '../theme/typography';
import { useTheme } from '../theme/useTheme';

type Phase = 'locking' | 'ready' | 'other-tab';

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

/**
 * Une seule ouverture SQLite sur le web :
 * 1) verrou Web Locks — si un autre onglet détient la base → message clair
 *    (aucun openDatabase, donc pas de 2ᵉ worker OPFS)
 * 2) SQLiteProvider useSuspense — singleton expo-sqlite (pas de close/reopen)
 *
 * Ne supprime JAMAIS la base locale (ventes a_envoyer possibles).
 */
export function BoutiqueSQLiteProvider({ children, fallback }: Props) {
  const [phase, setPhase] = useState<Phase>(() =>
    Platform.OS === 'web' ? 'locking' : 'ready'
  );
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    let cancelled = false;

    void (async () => {
      const handle = await tryAcquireWebSqliteLock(
        retryKey > 0 ? { retry: true } : undefined
      );
      if (cancelled) return;
      if (!handle) {
        setPhase('other-tab');
        return;
      }
      setPhase('ready');
    })();

    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  if (phase === 'locking') {
    return fallback ?? <LoadingFallback />;
  }

  if (phase === 'other-tab') {
    return (
      <MessageScreen
        title="Déjà ouverte ailleurs"
        body="L’application est déjà ouverte dans un autre onglet. Fermez l’autre onglet, puis appuyez sur Réessayer. Vos ventes enregistrées sur cet appareil ne sont pas effacées."
        onRetry={() => {
          setPhase('locking');
          setRetryKey((k) => k + 1);
        }}
      />
    );
  }

  // useSuspense : une seule promesse d’ouverture pour toute la page (module expo-sqlite).
  // Suspense est fourni par le parent (_layout).
  return (
    <SQLiteProvider
      key={`sqlite-${retryKey}`}
      databaseName="boutique.db"
      onInit={migrateDatabase}
      useSuspense
    >
      {children}
    </SQLiteProvider>
  );
}

function LoadingFallback() {
  const { colors } = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <ActivityIndicator size="large" color={colors.indigo} />
    </View>
  );
}

function MessageScreen({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.box} accessibilityRole="alert">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <Pressable
        onPress={onRetry}
        style={styles.btn}
        accessibilityRole="button"
        accessibilityLabel="Réessayer"
      >
        <Text style={styles.btnText}>Réessayer</Text>
      </Pressable>
    </View>
  );
}

export { isOpfsLockError };

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  box: {
    flex: 1,
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#F3F4F8',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1B1E3A',
    fontFamily: FONT_TITLE,
    marginBottom: 12,
  },
  body: { fontSize: 17, lineHeight: 26, color: '#5C6180', marginBottom: 24 },
  btn: {
    alignSelf: 'flex-start',
    backgroundColor: '#27306B',
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 12,
  },
  btnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 17 },
});
