import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { CAT_LABEL } from '../theme/colors';
import type { Categorie } from '../db/types';

interface CategoryTabsProps {
  value: Categorie;
  onChange: (c: Categorie) => void;
}

export function CategoryTabs({ value, onChange }: CategoryTabsProps) {
  const { colors } = useTheme();
  const cats: Categorie[] = ['meches', 'produits'];
  return (
    <View style={styles.row}>
      {cats.map((c) => {
        const active = value === c;
        const accent = c === 'meches' ? colors.mech : colors.prod;
        return (
          <Pressable
            key={c}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(c)}
            style={[
              styles.tab,
              {
                backgroundColor: active ? accent : colors.card,
                borderColor: active ? accent : colors.line,
              },
            ]}
          >
            <Text style={[styles.text, { color: active ? colors.onSolid : colors.ink }]}>
              {CAT_LABEL[c]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  tab: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 3,
    paddingVertical: 14,
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontWeight: '700', fontSize: 20 },
});
