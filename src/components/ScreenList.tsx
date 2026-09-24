import { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';

/**
 * Conteneur plein écran pour un SectionList/FlatList unique (évite d'imbriquer une
 * VirtualizedList dans une ScrollView). Le SectionList doit être l'unique enfant.
 */
export function ScreenList({ children }: PropsWithChildren) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.wrap}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 16 },
});
