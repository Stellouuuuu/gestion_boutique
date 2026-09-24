import { StyleSheet, TextInput } from 'react-native';
import { useTheme } from '../theme/useTheme';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
}

export function SearchBar({ value, onChangeText }: SearchBarProps) {
  const { colors } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder="Chercher un nom…"
      placeholderTextColor={colors.muted}
      autoCorrect={false}
      autoCapitalize="none"
      style={[
        styles.input,
        { backgroundColor: colors.card, borderColor: colors.line, color: colors.ink },
      ]}
      accessibilityLabel="Chercher un article par nom"
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 18,
    minHeight: 56,
    marginBottom: 10,
  },
});
