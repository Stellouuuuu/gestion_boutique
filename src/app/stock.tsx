import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Header } from '../components/Header';
import { ScreenList } from '../components/ScreenList';
import { CategoryTabs } from '../components/CategoryTabs';
import { SearchBar } from '../components/SearchBar';
import { ArticleListView } from '../components/ArticleListView';
import { listArticles, filterByQuery } from '../db/articles';
import { STOCK_BAS } from '../db/types';
import type { Article, Categorie } from '../db/types';
import { useTheme } from '../theme/useTheme';

type Filtre = 'tous' | 'racheter';

export default function StockScreen() {
  const db = useSQLiteContext();
  const [cat, setCat] = useState<Categorie>('meches');
  const [query, setQuery] = useState('');
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [articles, setArticles] = useState<Article[]>([]);

  const load = useCallback(async () => {
    const list = await listArticles(db, cat);
    setArticles(list);
  }, [db, cat]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  let visible = filterByQuery(articles, query);
  if (filtre === 'racheter') visible = visible.filter((a) => a.stock <= STOCK_BAS);

  return (
    <ScreenList>
      <ArticleListView
        articles={visible}
        showAlphabetBar={query.trim().length === 0}
        ListHeaderComponent={
          <View>
            <Header title="Les restes" />
            <CategoryTabs
              value={cat}
              onChange={(c) => {
                setCat(c);
                setQuery('');
              }}
            />
            <SearchBar value={query} onChangeText={setQuery} />
            <View style={styles.filterRow}>
              <FilterTab label="Tout voir" active={filtre === 'tous'} onPress={() => setFiltre('tous')} />
              <FilterTab
                label="À racheter"
                active={filtre === 'racheter'}
                onPress={() => setFiltre('racheter')}
              />
            </View>
          </View>
        }
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
  filterRow: { flexDirection: 'row', gap: 10, marginTop: 10, marginBottom: 4 },
  filterTab: {
    flex: 1,
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterText: { fontWeight: '700', fontSize: 17 },
});
