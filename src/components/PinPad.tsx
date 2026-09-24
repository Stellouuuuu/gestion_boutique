import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';

interface PinPadProps {
  value: string;
  onChange: (next: string) => void;
  onComplete: (pin: string) => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export function PinPad({ value, onChange, onComplete }: PinPadProps) {
  const { colors } = useTheme();

  const press = (k: string) => {
    if (k === '⌫') {
      onChange(value.slice(0, -1));
      return;
    }
    if (value.length >= 4) return;
    const next = value + k;
    onChange(next);
    if (next.length === 4) onComplete(next);
  };

  return (
    <View>
      <View style={styles.dots} accessibilityLabel={`${value.length} chiffres sur 4 saisis`}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { borderColor: colors.indigo, backgroundColor: i < value.length ? colors.indigo : 'transparent' },
            ]}
          />
        ))}
      </View>
      <View style={styles.pad}>
        {KEYS.map((k, i) =>
          k === '' ? (
            <View key={i} style={styles.key} />
          ) : (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={k === '⌫' ? 'Effacer' : k}
              onPress={() => press(k)}
              style={({ pressed }) => [
                styles.key,
                { backgroundColor: colors.card, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={[styles.keyText, { color: colors.ink }]}>{k}</Text>
            </Pressable>
          )
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginVertical: 18 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 3 },
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    maxWidth: 320,
    alignSelf: 'center',
  },
  key: {
    width: 96,
    height: 70,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { fontSize: 28, fontWeight: '700' },
});
