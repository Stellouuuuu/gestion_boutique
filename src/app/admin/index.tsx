import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { listMembres, retirerMembre, type MembreListe } from '../../db/membres';
import type { Article, Categorie } from '../../db/types';
import { useAuth } from '../../lib/AuthSession';
import { useToast } from '../../components/Toast';
import { getErrorMessage } from '../../lib/errors';

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
  const { membre, session } = useAuth();
  const { showToast } = useToast();
  const [cat, setCat] = useState<Categorie>('meches');
  const [query, setQuery] = useState('');
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [articles, setArticles] = useState<Article[]>([]);
  const [sansPrixCount, setSansPrixCount] = useState(0);
  const [membres, setMembres] = useState<MembreListe[]>([]);
  const [membresLoading, setMembresLoading] = useState(false);
  const [aRetirer, setARetirer] = useState<MembreListe | null>(null);

  const monUserId = session?.user?.id;

  const load = useCallback(async () => {
    const [list, sansPrix] = await Promise.all([
      filtre === 'a_completer' ? listArticlesSansPrix(db) : listArticles(db, cat),
      listArticlesSansPrix(db),
    ]);
    setArticles(list);
    setSansPrixCount(sansPrix.length);
  }, [db, cat, filtre]);

  const loadMembres = useCallback(async () => {
    if (!membre) return;
    setMembresLoading(true);
    try {
      const list = await listMembres(membre.boutiqueId);
      setMembres(list);
    } catch {
      // Hors ligne : on garde la dernière liste connue.
    } finally {
      setMembresLoading(false);
    }
  }, [membre]);

  useFocusEffect(
    useCallback(() => {
      load();
      loadMembres();
    }, [load, loadMembres])
  );

  const onConfirmRetirer = async () => {
    if (!membre || !aRetirer) return;
    try {
      await retirerMembre(membre.boutiqueId, aRetirer.userId);
      showToast(`${aRetirer.nom} a été retiré·e`);
      setARetirer(null);
      await loadMembres();
    } catch (e) {
      setARetirer(null);
      showToast(getErrorMessage(e) || 'Impossible de retirer cette personne.');
    }
  };

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
            <View style={[styles.section, { borderTopColor: colors.line }]}>
              <Text style={[styles.sectionTitle, { color: colors.ink }]}>Équipe</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/admin/inviter')}
                style={[styles.inviteBtn, { backgroundColor: colors.indigoSoft }]}
              >
                <Text style={[styles.inviteText, { color: colors.indigo }]}>Inviter quelqu’un</Text>
              </Pressable>

              {membresLoading && membres.length === 0 ? (
                <ActivityIndicator color={colors.indigo} style={{ marginVertical: 12 }} />
              ) : (
                membres.map((m) => {
                  const isMe = m.userId === monUserId;
                  const roleLabel = m.role === 'proprietaire' ? 'Propriétaire' : 'Vendeuse';
                  return (
                    <View
                      key={m.userId}
                      style={[styles.membreRow, { borderColor: colors.line, backgroundColor: colors.card }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 17 }}>
                          {m.nom}
                          {isMe ? ' (vous)' : ''}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 14 }}>{roleLabel}</Text>
                      </View>
                      {!isMe && m.role !== 'proprietaire' ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setARetirer(m)}
                          style={styles.retirerBtn}
                        >
                          <Text style={{ color: colors.bad, fontWeight: '700' }}>Retirer</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })
              )}
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/admin/compte')}
              style={styles.linkRow}
            >
              <Text style={[styles.linkText, { color: colors.indigo }]}>Mon compte</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/admin/change-pin')}
              style={styles.changePin}
            >
              <Text style={[styles.changePinText, { color: colors.muted }]}>Changer le code PIN</Text>
            </Pressable>
          </View>
        }
      />

      <ConfirmDialog
        visible={aRetirer != null}
        title={`Retirer « ${aRetirer?.nom ?? ''} » ?`}
        description="Cette personne ne pourra plus utiliser la boutique. Elle pourra être réinvitée plus tard."
        safeLabel="Non, la garder"
        onSafe={() => setARetirer(null)}
        dangerLabel="Oui, retirer"
        onConfirmDanger={onConfirmRetirer}
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
  section: {
    marginTop: 28,
    paddingTop: 18,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    gap: 10,
  },
  sectionTitle: { fontWeight: '800', fontSize: 18, marginBottom: 4 },
  inviteBtn: {
    borderRadius: 14,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  inviteText: { fontWeight: '700', fontSize: 18 },
  membreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  retirerBtn: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
  linkRow: {
    marginTop: 20,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: { fontSize: 18, fontWeight: '700', textDecorationLine: 'underline' },
  changePin: {
    marginTop: 4,
    marginBottom: 24,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePinText: { fontSize: 16, textDecorationLine: 'underline' },
});
