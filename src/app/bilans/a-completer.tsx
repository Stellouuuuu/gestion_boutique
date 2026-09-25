import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { BilansShell } from '../../components/BilansShell';
import { useTheme } from '../../theme/useTheme';
import { articlesSansPrixAchat } from '../../db/bilans';

export default function ACompleterScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const [rows, setRows] = useState<{ id: string; nom: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const list = await articlesSansPrixAchat(db);
        if (active) {
          setRows(list);
          setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [db])
  );

  return (
    <BilansShell title="À compléter">
      <Text style={{ color: colors.muted, marginBottom: 12 }}>
        Articles sans prix d’achat — le bénéfice ne peut pas les compter.
      </Text>
      {loading ? (
        <ActivityIndicator color={colors.indigo} />
      ) : rows.length === 0 ? (
        <Text style={{ color: colors.ok, fontWeight: '700' }}>Tous les articles ont un prix d’achat.</Text>
      ) : (
        rows.map((r) => (
          <View key={r.id} style={[styles.row, { backgroundColor: colors.card }]}>
            <Text style={{ color: colors.ink, fontSize: 17, fontWeight: '700' }}>{r.nom}</Text>
          </View>
        ))
      )}
    </BilansShell>
  );
}

const styles = StyleSheet.create({
  row: { borderRadius: 14, padding: 14, marginBottom: 8 },
});
