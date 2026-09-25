import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Header } from '../../components/Header';
import { ScreenScroll } from '../../components/ScreenScroll';
import { RequireProprietaire } from '../../components/RequireProprietaire';
import { useTheme } from '../../theme/useTheme';
import {
  getInventaire,
  labelPerimetre,
  labelStatut,
  listLignesInventaire,
  type InventaireLigneAvecArticle,
  type InventairesDb,
} from '../../db/inventaires';

export default function InventaireFicheScreen() {
  return (
    <RequireProprietaire>
      <Fiche />
    </RequireProprietaire>
  );
}

function Fiche() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext() as InventairesDb;
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [titre, setTitre] = useState('');
  const [lignes, setLignes] = useState<InventaireLigneAvecArticle[]>([]);
  const [ecartsSeulement, setEcartsSeulement] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        if (!id) return;
        const inv = await getInventaire(db, id);
        const list = await listLignesInventaire(db, id);
        if (!active) return;
        if (inv) {
          setTitre(
            `${new Date(inv.commence_le).toLocaleDateString('fr-FR')} · ${labelPerimetre(inv.perimetre)} · ${labelStatut(inv.statut)}`
          );
        }
        setLignes(list);
        setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [db, id])
  );

  const shown = ecartsSeulement
    ? lignes.filter((l) => l.stock_compte !== l.stock_attendu)
    : lignes;

  return (
    <ScreenScroll>
      <Header title="Fiche inventaire" onBack={() => router.replace('/bilans/inventaires')} />
      <Text style={{ color: colors.muted, marginBottom: 12 }}>{titre}</Text>
      <Pressable onPress={() => setEcartsSeulement((v) => !v)} style={{ marginBottom: 12 }}>
        <Text style={{ color: colors.indigo, fontWeight: '700' }}>
          {ecartsSeulement ? 'Voir toutes les lignes' : 'Écarts seulement'}
        </Text>
      </Pressable>
      {loading ? (
        <ActivityIndicator color={colors.indigo} />
      ) : shown.length === 0 ? (
        <Text style={{ color: colors.muted }}>Aucune ligne.</Text>
      ) : (
        shown.map((l) => {
          const ecart = l.stock_compte - l.stock_attendu;
          return (
            <View key={l.id} style={[styles.row, { backgroundColor: colors.card }]}>
              <Text style={{ color: colors.ink, fontWeight: '700' }}>{l.article_nom}</Text>
              <Text style={{ color: colors.muted, marginTop: 2 }}>
                Attendu {l.stock_attendu} · Compté {l.stock_compte}
                {ecart !== 0 ? ` · Écart ${ecart > 0 ? '+' : ''}${ecart}` : ''}
              </Text>
            </View>
          );
        })
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  row: { borderRadius: 14, padding: 14, marginBottom: 8 },
});
