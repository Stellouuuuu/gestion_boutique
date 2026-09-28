import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Header } from '../components/Header';
import { ScreenList } from '../components/ScreenList';
import { CategoryTabs } from '../components/CategoryTabs';
import { SearchBar } from '../components/SearchBar';
import { ArticleListView } from '../components/ArticleListView';
import { Sheet } from '../components/Sheet';
import { Button } from '../components/Button';
import { useTheme } from '../theme/useTheme';
import { FONT_TITLE } from '../theme/typography';
import { listArticles, filterByQuery } from '../db/articles';
import type { Article, Categorie } from '../db/types';

type Mode = 'vente' | 'entree';

export default function PickScreen() {
  const {
    mode: modeParam,
    retourFeuille,
    ligneKey,
    sections,
    lignes,
    dateSuggeree,
    totalEcrit,
    photoUri,
  } = useLocalSearchParams<{
    mode: string;
    retourFeuille?: string;
    ligneKey?: string;
    sections?: string;
    lignes?: string;
    dateSuggeree?: string;
    totalEcrit?: string;
    photoUri?: string;
  }>();
  const mode: Mode = modeParam === 'entree' ? 'entree' : 'vente';
  const pourFeuille = retourFeuille === '1' && !!ligneKey;
  const db = useSQLiteContext();
  const { colors } = useTheme();

  const [cat, setCat] = useState<Categorie>('meches');
  const [query, setQuery] = useState('');
  const [articles, setArticles] = useState<Article[]>([]);
  const [prixManquant, setPrixManquant] = useState<Article | null>(null);

  const load = useCallback(async () => {
    const list = await listArticles(db, cat);
    setArticles(list);
  }, [db, cat]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onPressArticle = (article: Article) => {
    if (pourFeuille) {
      router.replace({
        pathname: '/verifier-feuille',
        params: {
          sections: sections ?? '',
          lignes: lignes ?? '',
          dateSuggeree: dateSuggeree ?? '',
          totalEcrit: totalEcrit ?? '',
          photoUri: photoUri ?? '',
          articlePick: String(article.id),
          ligneKey: String(ligneKey),
        },
      });
      return;
    }
    if (mode === 'vente' && article.prix_detail == null) {
      setPrixManquant(article);
      return;
    }
    router.push({
      pathname: '/qty',
      params: { articleId: String(article.id), mode },
    });
  };

  return (
    <ScreenList>
      <ArticleListView
        articles={filterByQuery(articles, query)}
        onPressArticle={onPressArticle}
        showAlphabetBar={query.trim().length === 0}
        ListHeaderComponent={
          <View>
            <Header
              title={
                pourFeuille
                  ? 'Choisir l’article'
                  : mode === 'vente'
                    ? 'Qu’avez-vous vendu ?'
                    : 'Qu’est-ce qui est arrivé ?'
              }
            />
            <CategoryTabs
              value={cat}
              onChange={(c) => {
                setCat(c);
                setQuery('');
              }}
            />
            <SearchBar value={query} onChangeText={setQuery} />
            {mode === 'vente' && !pourFeuille && process.env.EXPO_PUBLIC_PHOTO_IA === 'true' ? (
              <Button variant="indigo-outline" onPress={() => router.push('/vente-photo')}>
                Depuis une photo de ma feuille
              </Button>
            ) : null}
          </View>
        }
      />

      <Sheet visible={prixManquant != null} onRequestClose={() => setPrixManquant(null)}>
        <Text style={[styles.title, { color: colors.ink, fontFamily: FONT_TITLE }]}>
          Prix manquant
        </Text>
        <Text style={[styles.desc, { color: colors.ink }]}>
          <Text style={{ fontWeight: '700' }}>{prixManquant?.nom}</Text> n’a pas encore de prix.
          Demandez de le mettre dans « Gérer les articles ».
        </Text>
        <View style={styles.btns}>
          <Button variant="ghost" onPress={() => setPrixManquant(null)}>
            D’accord
          </Button>
        </View>
      </Sheet>
    </ScreenList>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, marginBottom: 8 },
  desc: { fontSize: 16, marginBottom: 6 },
  btns: { marginTop: 18 },
});
