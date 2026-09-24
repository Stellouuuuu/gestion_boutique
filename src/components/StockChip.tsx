import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { stockState } from '../lib/stockState';

export function StockChip({ stock }: { stock: number }) {
  const { colors } = useTheme();
  const { tone, label } = stockState(stock);
  const bg = tone === 'ok' ? colors.okSoft : tone === 'low' ? colors.warnSoft : colors.badSoft;
  const fg = tone === 'ok' ? colors.ok : tone === 'low' ? colors.warn : colors.bad;
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexShrink: 0, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  text: { fontWeight: '700', fontSize: 16 },
});
