import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { BilansShell } from '../../components/BilansShell';
import { useTheme } from '../../theme/useTheme';
import { formatFCFA, formatHeure } from '../../lib/format';
import { buildPeriode, type PeriodeKind } from '../../db/periodes';
import { listMouvementsPeriode, type MouvementBilan } from '../../db/bilans';

type TypeFiltre = 'tous' | 'vente' | 'entree' | 'correction';
type CatFiltre = 'tous' | 'meches' | 'produits';

export default function DetailMouvementsScreen() {
  const { kind, ancre } = useLocalSearchParams<{ kind: string; ancre: string }>();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const periode = useMemo(
    () => buildPeriode((kind as PeriodeKind) || 'semaine', ancre || '2026-01-01'),
    [kind, ancre]
  );
  const [rows, setRows] = useState<MouvementBilan[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeF, setTypeF] = useState<TypeFiltre>('tous');
  const [catF, setCatF] = useState<CatFiltre>('tous');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const list = await listMouvementsPeriode(db, periode, {
          types:
            typeF === 'tous'
              ? ['vente', 'entree', 'correction']
              : [typeF],
          categories: catF === 'tous' ? ['meches', 'produits'] : [catF],
        });
        if (active) {
          setRows(list);
          setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [db, periode, typeF, catF])
  );

  return (
    <BilansShell title="Détail">
      <Text style={{ color: colors.muted, marginBottom: 10 }}>{periode.label}</Text>
      <View style={styles.filters}>
        {(['tous', 'vente', 'entree', 'correction'] as TypeFiltre[]).map((t) => (
          <Chip key={t} active={typeF === t} label={labelType(t)} onPress={() => setTypeF(t)} />
        ))}
      </View>
      <View style={[styles.filters, { marginBottom: 14 }]}>
        {(['tous', 'meches', 'produits'] as CatFiltre[]).map((c) => (
          <Chip key={c} active={catF === c} label={labelCat(c)} onPress={() => setCatF(c)} />
        ))}
      </View>
      {loading ? (
        <ActivityIndicator color={colors.indigo} />
      ) : rows.length === 0 ? (
        <Text style={{ color: colors.muted }}>Aucun mouvement sur cette période.</Text>
      ) : (
        rows.map((r) => (
          <View key={r.id} style={[styles.row, { backgroundColor: colors.card }]}>
            <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 16 }}>{r.article_nom}</Text>
            <Text style={{ color: colors.muted, marginTop: 2 }}>
              {labelType(r.type)} · {r.quantite} · {formatHeure(new Date(r.cree_le))}
            </Text>
            {r.type === 'vente' ? (
              <Text style={{ color: colors.ink, marginTop: 4, fontWeight: '700' }}>
                {formatFCFA(r.montant_paye)}
              </Text>
            ) : null}
          </View>
        ))
      )}
    </BilansShell>
  );
}

function Chip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? colors.indigo : colors.card,
          borderColor: active ? colors.indigo : colors.line,
        },
      ]}
    >
      <Text style={{ color: active ? colors.onSolid : colors.ink, fontWeight: '700', fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function labelType(t: string) {
  if (t === 'vente') return 'Ventes';
  if (t === 'entree') return 'Entrées';
  if (t === 'correction') return 'Corrections';
  return 'Tous';
}
function labelCat(c: string) {
  if (c === 'meches') return 'Mèches';
  if (c === 'produits') return 'Produits';
  return 'Tous';
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 2,
  },
  row: { borderRadius: 14, padding: 14, marginBottom: 8 },
});
