import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { labelStatsKind, type StatsPeriodeKind } from '../db/statsPeriodes';

const KINDS: StatsPeriodeKind[] = ['30j', '3mois', '12mois'];

type Props = {
  kind: StatsPeriodeKind;
  label: string;
  onKind: (k: StatsPeriodeKind) => void;
};

export function StatsPeriodeSelector({ kind, label, onKind }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {KINDS.map((k) => {
          const active = k === kind;
          return (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onKind(k)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.indigo : colors.card,
                  borderColor: active ? colors.indigo : colors.line,
                },
              ]}
            >
              <Text
                style={{
                  color: active ? colors.onSolid : colors.ink,
                  fontWeight: '700',
                  fontSize: 14,
                }}
              >
                {labelStatsKind(k)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: colors.muted, fontSize: 14, marginTop: 8 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
});
