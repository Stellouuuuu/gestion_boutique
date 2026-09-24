import { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';

/**
 * Conteneur standard d'écran : fond thémé, défilement, respect des zones sûres,
 * largeur maximale confortable sur les grands écrans (comme .wrap dans la maquette).
 */
export function ScreenScroll({ children }: PropsWithChildren) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 40, paddingTop: insets.top },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.wrap}>{children}</View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 16 },
  wrap: { width: '100%', maxWidth: 560, alignSelf: 'center' },
});
