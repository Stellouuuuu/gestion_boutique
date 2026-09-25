import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { BilansShell } from '../../components/BilansShell';
import { useTheme } from '../../theme/useTheme';
import { formatFCFA } from '../../lib/format';
import { buildPeriode, type PeriodeKind } from '../../db/periodes';
import { listStockFinPeriode, type StockArticleFin } from '../../db/bilans';
import { CAT_LABEL } from '../../theme/colors';

export default function StockDateScreen() {
  const { kind, ancre } = useLocalSearchParams<{ kind: string; ancre: string }>();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const periode = useMemo(
    () => buildPeriode((kind as PeriodeKind) || 'semaine', ancre || '2026-01-01'),
    [kind, ancre]
  );
  const [rows, setRows] = useState<StockArticleFin[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const list = await listStockFinPeriode(db, periode);
        if (active) {
          setRows(list.filter((r) => r.stock !== 0));
          setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [db, periode])
  );

  return (
    <BilansShell title="Stock à cette date">
      <Text style={{ color: colors.muted, marginBottom: 12 }}>
        Fin de {periode.label} — articles avec un reste ≠ 0
      </Text>
      {loading ? (
        <ActivityIndicator color={colors.indigo} />
      ) : (
        rows.map((r) => (
          <View key={r.id} style={[styles.row, { backgroundColor: colors.card }]}>
            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>
              {CAT_LABEL[r.categorie]}
            </Text>
            <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 17 }}>{r.nom}</Text>
            <Text style={{ color: colors.ink, marginTop: 4 }}>Reste : {r.stock}</Text>
            <Text style={{ color: colors.muted, marginTop: 2 }}>
              Détail : {formatFCFA(r.valeur_detail)}
              {r.valeur_achat != null ? ` · Achat : ${formatFCFA(r.valeur_achat)}` : ''}
            </Text>
          </View>
        ))
      )}
    </BilansShell>
  );
}

const styles = StyleSheet.create({
  row: { borderRadius: 14, padding: 14, marginBottom: 8 },
});
