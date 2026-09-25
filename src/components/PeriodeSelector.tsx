import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import type { PeriodeKind } from '../db/periodes';

const KINDS: { kind: PeriodeKind; label: string }[] = [
  { kind: 'jour', label: 'Jour' },
  { kind: 'semaine', label: 'Semaine' },
  { kind: 'mois', label: 'Mois' },
  { kind: 'annee', label: 'Année' },
];

interface Props {
  kind: PeriodeKind;
  label: string;
  onKind: (k: PeriodeKind) => void;
  onPrev: () => void;
  onNext: () => void;
}

export function PeriodeSelector({ kind, label, onKind, onPrev, onNext }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={styles.kinds}>
        {KINDS.map((k) => {
          const active = k.kind === kind;
          return (
            <Pressable
              key={k.kind}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onKind(k.kind)}
              style={[
                styles.kindBtn,
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
                  fontSize: 15,
                }}
              >
                {k.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.nav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Période précédente"
          onPress={onPrev}
          style={[styles.arrow, { backgroundColor: colors.card }]}
        >
          <Text style={{ color: colors.ink, fontSize: 22, fontWeight: '700' }}>◀</Text>
        </Pressable>
        <Text style={[styles.title, { color: colors.ink }]}>{label}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Période suivante"
          onPress={onNext}
          style={[styles.arrow, { backgroundColor: colors.card }]}
        >
          <Text style={{ color: colors.ink, fontSize: 22, fontWeight: '700' }}>▶</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14, marginBottom: 8 },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kindBtn: {
    flexGrow: 1,
    minWidth: '22%',
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  arrow: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700' },
});
