import { forwardRef, PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { MIN_TAP_SIZE } from '../theme/typography';

type Variant = 'sell' | 'in' | 'ghost' | 'danger-solid' | 'danger-outline' | 'sun' | 'indigo-outline';

interface ButtonProps extends PropsWithChildren {
  onPress: () => void;
  variant: Variant;
  disabled?: boolean;
  loading?: boolean;
  big?: boolean;
  accessibilityLabel?: string;
}

export const Button = forwardRef<View, ButtonProps>(function Button(
  { onPress, variant, disabled, loading, big, children, accessibilityLabel },
  ref
) {
  const { colors } = useTheme();

  let bg = 'transparent';
  let fg = colors.ink;
  let borderColor: string | undefined;
  let borderWidth = 0;

  switch (variant) {
    case 'sell':
      bg = colors.indigo;
      fg = colors.onSolid;
      break;
    case 'in':
      bg = colors.ok;
      fg = colors.onSolid;
      break;
    case 'sun':
      bg = colors.sun;
      fg = colors.sunInk;
      break;
    case 'danger-solid':
      bg = colors.bad;
      fg = colors.onSolid;
      break;
    case 'danger-outline':
      bg = 'transparent';
      fg = colors.bad;
      borderColor = colors.bad;
      borderWidth = 2;
      break;
    case 'indigo-outline':
      bg = 'transparent';
      fg = colors.indigo;
      borderColor = colors.indigo;
      borderWidth = 2;
      break;
    case 'ghost':
      bg = 'transparent';
      fg = colors.muted;
      borderColor = colors.line;
      borderWidth = 2;
      break;
  }

  const isDisabled = disabled || loading;

  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled }}
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        big && styles.big,
        { backgroundColor: bg, borderColor, borderWidth },
        isDisabled && styles.disabled,
        pressed && !isDisabled && { opacity: 0.9 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.text, big && styles.bigText, { color: fg }]}>{children}</Text>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: {
    width: '100%',
    minHeight: MIN_TAP_SIZE,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  big: { minHeight: 76, borderRadius: 18, paddingVertical: 20 },
  text: { fontSize: 18, fontWeight: '700' },
  bigText: { fontSize: 22 },
  disabled: { opacity: 0.4 },
});
