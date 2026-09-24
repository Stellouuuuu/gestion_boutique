import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Header } from '../../components/Header';
import { ScreenList } from '../../components/ScreenList';
import { CategoryTabs } from '../../components/CategoryTabs';
import { SearchBar } from '../../components/SearchBar';
import { ArticleListView } from '../../components/ArticleListView';
import { RequireUnlocked } from '../../components/RequireUnlocked';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useTheme } from '../../theme/useTheme';
import { listArticles, listArticlesSansPrix, filterByQuery } from '../../db/articles';
import type { Article, Categorie } from '../../db/types';
import { useAuth, PendingSyncError } from '../../lib/AuthSession';
import { useToast } from '../../components/Toast';

type Filtre = 'tous' | 'a_completer';

export default function AdminIndexScreen() {
  return (
    <RequireUnlocked>
      <AdminList />
    </RequireUnlocked>
  );
}

function AdminList() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const { membre, signOut } = useAuth();
  const { showToast } = useToast();
  const [cat, setCat] = useState<Categorie>('meches');
  const [query, setQuery] = useState('');
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [articles, setArticles] = useState<Article[]>([]);
  const [sansPrixCount, setSansPrixCount] = useState(0);
  const [confirmDeconnexion, setConfirmDeconnexion] = useState(false);
  const [blocageDeconnexion, setBlocageDeconnexion] = useState<string | null>(null);

  const onDeconnexion = async () => {
    try {
      await signOut();
      setConfirmDeconnexion(false);
      router.replace('/connexion');
    } catch (e) {
      setConfirmDeconnexion(false);
      if (e instanceof PendingSyncError) {
        setBlocageDeconnexion(e.message);
      } else {
        showToast('Impossible de se déconnecter pour l’instant.');
      }
    }
  };

  const load = useCallback(async () => {
    const [list, sansPrix] = await Promise.all([
      filtre === 'a_completer' ? listArticlesSansPrix(db) : listArticles(db, cat),
      listArticlesSansPrix(db),
    ]);
    setArticles(list);
    setSansPrixCount(sansPrix.length);
  }, [db, cat, filtre]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const visible = filterByQuery(articles, query);

  return (
    <ScreenList>
      <ArticleListView
        articles={visible}
        onPressArticle={(a) => router.push({ pathname: '/admin/edit', params: { id: String(a.id) } })}
        showAlphabetBar={query.trim().length === 0}
        ListHeaderComponent={
          <View>
            <Header title="Gérer les articles" />
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/admin/edit', params: { id: 'new' } })}
              style={[styles.add, { backgroundColor: colors.sun }]}
            >
              <Text style={[styles.addText, { color: colors.sunInk }]}>+ Ajouter un article</Text>
            </Pressable>

            {sansPrixCount > 0 && (
              <View style={styles.filterRow}>
                <FilterTab
                  label="Tous"
                  active={filtre === 'tous'}
                  onPress={() => setFiltre('tous')}
                />
                <FilterTab
                  label={`À compléter (${sansPrixCount})`}
                  active={filtre === 'a_completer'}
                  onPress={() => setFiltre('a_completer')}
                />
              </View>
            )}

            {filtre === 'tous' && (
              <CategoryTabs
                value={cat}
                onChange={(c) => {
                  setCat(c);
                  setQuery('');
                }}
              />
            )}
            <SearchBar value={query} onChangeText={setQuery} />
          </View>
        }
        ListFooterComponent={
          <View>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/admin/change-pin')}
              style={styles.changePin}
            >
              <Text style={[styles.changePinText, { color: colors.muted }]}>Changer le code</Text>
            </Pressable>

            <View style={[styles.deconnexionZone, { borderTopColor: colors.line }]}>
              {membre && (
                <Text style={[styles.membreInfo, { color: colors.muted }]}>
                  Connecté·e en tant que {membre.nom} ({membre.role === 'proprietaire' ? 'propriétaire' : 'vendeuse'})
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirmDeconnexion(true)}
                style={[styles.deconnexionBtn, { borderColor: colors.line }]}
              >
                <Text style={[styles.deconnexionText, { color: colors.muted }]}>Se déconnecter</Text>
              </Pressable>
            </View>
          </View>
        }
      />

      <ConfirmDialog
        visible={confirmDeconnexion}
        title="Se déconnecter ?"
        description="Vous pourrez vous reconnecter avec votre numéro et votre mot de passe."
        safeLabel="Non, rester connecté·e"
        onSafe={() => setConfirmDeconnexion(false)}
        dangerLabel="Oui, me déconnecter"
        onConfirmDanger={onDeconnexion}
      />

      <ConfirmDialog
        visible={blocageDeconnexion != null}
        title="Pas encore"
        description={blocageDeconnexion ?? ''}
        safeLabel="D’accord"
        onSafe={() => setBlocageDeconnexion(null)}
        dangerLabel=""
        onConfirmDanger={() => setBlocageDeconnexion(null)}
      />
    </ScreenList>
  );
}

function FilterTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.filterTab,
        {
          backgroundColor: active ? colors.indigo : colors.card,
          borderColor: active ? colors.indigo : colors.line,
        },
      ]}
    >
      <Text style={[styles.filterText, { color: active ? colors.onSolid : colors.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  add: {
    borderRadius: 16,
    paddingVertical: 16,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  addText: { fontWeight: '700', fontSize: 20 },
  filterRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  filterTab: {
    flex: 1,
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  filterText: { fontWeight: '700', fontSize: 16, textAlign: 'center' },
  changePin: {
    marginTop: 24,
    marginBottom: 12,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePinText: { fontSize: 16, textDecorationLine: 'underline' },
  deconnexionZone: {
    marginTop: 24,
    paddingTop: 18,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    gap: 10,
  },
  membreInfo: { fontSize: 14, textAlign: 'center' },
  deconnexionBtn: {
    minHeight: 56,
    minWidth: 200,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deconnexionText: { fontSize: 16, fontWeight: '700' },
});
