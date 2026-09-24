import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { FONT_TITLE } from '../theme/typography';

interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
}

/** Boutons −/+ d'au moins 80px (cahier des charges §3.3). */
export function Stepper({ value, onChange, min = 1, max = 999 }: StepperProps) {
  const { colors } = useTheme();
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Moins un"
        onPress={dec}
        style={[styles.btn, { backgroundColor: colors.indigoSoft }]}
      >
        <Text style={[styles.btnText, { color: colors.indigo }]}>−</Text>
      </Pressable>
      <Text
        style={[styles.output, { color: colors.ink, fontFamily: FONT_TITLE }]}
        accessibilityLiveRegion="polite"
      >
        {value}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Plus un"
        onPress={inc}
        style={[styles.btn, { backgroundColor: colors.indigoSoft }]}
      >
        <Text style={[styles.btnText, { color: colors.indigo }]}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 22 },
  btn: { width: 84, height: 84, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 40, fontWeight: '800' },
  output: { flex: 1, textAlign: 'center', fontSize: 56, fontWeight: '800' },
});
