import { useMemo, useRef } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { FONT_TITLE } from '../theme/typography';
import { formatFCFA } from '../lib/format';
import { sortArticles } from '../db/articles';
import type { Article } from '../db/types';
import { StockChip } from './StockChip';

function letterOf(nom: string): string {
  const c = nom.normalize('NFD')[0]?.toUpperCase() ?? '#';
  return /[A-Z]/.test(c) ? c : '#';
}

interface Section {
  title: string;
  data: Article[];
}

function buildSections(articles: Article[]): Section[] {
  const sorted = sortArticles(articles);
  const sections: Section[] = [];
  for (const a of sorted) {
    const l = letterOf(a.nom);
    const last = sections[sections.length - 1];
    if (last && last.title === l) last.data.push(a);
    else sections.push({ title: l, data: [a] });
  }
  return sections;
}

interface ArticleListViewProps {
  articles: Article[];
  onPressArticle?: (article: Article) => void;
  showAlphabetBar: boolean;
  ListHeaderComponent?: React.ReactElement;
  ListFooterComponent?: React.ReactElement;
}

export function ArticleListView({
  articles,
  onPressArticle,
  showAlphabetBar,
  ListHeaderComponent,
  ListFooterComponent,
}: ArticleListViewProps) {
  const { colors } = useTheme();
  const listRef = useRef<SectionList<Article, Section>>(null);
  const sections = useMemo(() => buildSections(articles), [articles]);

  return (
    <SectionList
      ref={listRef}
      sections={sections}
      keyExtractor={(item) => String(item.id)}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View>
          {ListHeaderComponent}
          {showAlphabetBar && sections.length > 0 && (
            <View style={styles.letters}>
              {sections.map((s, i) => (
                <Pressable
                  key={s.title}
                  accessibilityRole="button"
                  accessibilityLabel={`Aller à la lettre ${s.title}`}
                  onPress={() => listRef.current?.scrollToLocation({ sectionIndex: i, itemIndex: 0, viewPosition: 0 })}
                  style={[styles.letterBtn, { backgroundColor: colors.card, borderColor: colors.line }]}
                >
                  <Text style={[styles.letterText, { color: colors.ink }]}>{s.title}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text style={[styles.sectionHeader, { color: colors.muted, fontFamily: FONT_TITLE }]}>
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => (
        <ArticleRow article={item} onPress={onPressArticle ? () => onPressArticle(item) : undefined} />
      )}
      ListEmptyComponent={
        <Text style={[styles.empty, { color: colors.muted }]}>Aucun article trouvé.</Text>
      }
      ListFooterComponent={ListFooterComponent}
      contentContainerStyle={styles.list}
      scrollEnabled
      nestedScrollEnabled
      onScrollToIndexFailed={() => {
        // Hauteurs de ligne variables (noms sur 1 ou 2 lignes) : nouvel essai sans animation.
      }}
    />
  );
}

function ArticleRow({ article, onPress }: { article: Article; onPress?: () => void }) {
  const { colors } = useTheme();
  const priceLabel = article.prix_detail
    ? formatFCFA(article.prix_detail) + (article.prix_gros ? ` · gros ${formatFCFA(article.prix_gros)}` : '')
    : 'Prix à mettre';

  const content = (
    <>
      <View style={styles.rowText}>
        <Text style={[styles.rowName, { color: colors.ink }]} numberOfLines={2}>
          {article.nom}
        </Text>
        <Text style={[styles.rowPrice, { color: article.prix_detail ? colors.muted : colors.warn }]}>
          {priceLabel}
        </Text>
      </View>
      <StockChip stock={article.stock} />
    </>
  );

  if (!onPress) {
    return (
      <View style={[styles.row, { backgroundColor: colors.card, borderColor: 'transparent' }]}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${article.nom}, ${priceLabel}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card, borderColor: pressed ? colors.sun : 'transparent' },
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 48, gap: 8 },
  letters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 8 },
  letterBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letterText: { fontWeight: '700', fontSize: 16 },
  sectionHeader: { fontSize: 20, paddingVertical: 8, paddingHorizontal: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 14,
    minHeight: 68,
    borderWidth: 2,
    marginBottom: 8,
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowName: { fontWeight: '700', fontSize: 19 },
  rowPrice: { fontSize: 15 },
  empty: { textAlign: 'center', padding: 30, fontSize: 16 },
});
