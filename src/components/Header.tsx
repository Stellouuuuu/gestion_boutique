import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { FONT_BODY_BOLD, FONT_TITLE } from '../theme/typography';

interface HeaderProps {
  title: string;
  /** Par défaut, retourne à l'accueil (comportement de la maquette). */
  onBack?: () => void;
  /** Texte du bouton retour (par défaut « ← Accueil »). */
  backLabel?: string;
}

export function Header({ title, onBack, backLabel = '← Accueil' }: HeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={backLabel === '← Accueil' ? "Retour à l'accueil" : backLabel.replace('← ', 'Retour à ')}
        onPress={onBack ?? (() => router.navigate('/'))}
        style={({ pressed }) => [
          styles.back,
          { backgroundColor: colors.card, borderColor: colors.line, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={[styles.backText, { color: colors.ink, fontFamily: FONT_BODY_BOLD }]}>
          {backLabel}
        </Text>
      </Pressable>
      <Text
        style={[styles.title, { color: colors.ink, fontFamily: FONT_TITLE }]}
        numberOfLines={2}
      >
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  back: {
    flexShrink: 0,
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 2,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backText: { fontSize: 16, fontWeight: '700' },
  title: { flex: 1, fontSize: 21, lineHeight: 25 },
});
