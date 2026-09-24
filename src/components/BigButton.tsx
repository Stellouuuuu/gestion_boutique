import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { FONT_BODY, FONT_TITLE } from '../theme/typography';

interface BigButtonProps {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  variant: 'sell' | 'in' | 'neutral';
  accessibilityLabel?: string;
}

export function BigButton({ icon, title, subtitle, onPress, variant, accessibilityLabel }: BigButtonProps) {
  const { colors } = useTheme();

  const container =
    variant === 'sell'
      ? { backgroundColor: colors.indigo, borderWidth: 0 }
      : variant === 'in'
        ? { backgroundColor: colors.card, borderWidth: 3, borderColor: colors.ok }
        : { backgroundColor: colors.card, borderWidth: 0 };

  const iconBg =
    variant === 'sell'
      ? 'rgba(255,255,255,0.16)'
      : variant === 'in'
        ? colors.okSoft
        : colors.indigoSoft;
  const iconColor = variant === 'sell' ? colors.onSolid : variant === 'in' ? colors.ok : colors.indigo;
  const textColor = variant === 'sell' ? colors.onSolid : colors.ink;
  const subtitleColor = variant === 'sell' ? textColor : colors.muted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${title}. ${subtitle}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        container,
        { transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: iconBg }]}>
        <Text style={[styles.iconText, { color: iconColor, fontFamily: FONT_TITLE }]}>{icon}</Text>
      </View>
      <View style={styles.textCol}>
        <Text style={[styles.title, { color: textColor }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: subtitleColor, opacity: variant === 'sell' ? 0.85 : 1 }]}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 20,
    minHeight: 96,
    shadowColor: '#1B1E3A',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  icon: {
    flexShrink: 0,
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 26, fontWeight: '800' },
  textCol: { flex: 1, gap: 2 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 15, fontFamily: FONT_BODY },
});
