import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme/useTheme';

interface PasswordFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

/** Champ mot de passe avec un bouton pour l'afficher (cahier des charges étape 2 §2). */
export function PasswordField({ label, value, onChangeText, placeholder }: PasswordFieldProps) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <View style={styles.row}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { borderColor: colors.line, color: colors.ink, backgroundColor: colors.card }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Cacher le mot de passe' : 'Afficher le mot de passe'}
          onPress={() => setVisible((v) => !v)}
          style={[styles.toggle, { borderColor: colors.line, backgroundColor: colors.card }]}
        >
          <Text style={{ color: colors.indigo, fontWeight: '700' }}>{visible ? 'Cacher' : 'Voir'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontWeight: '700', fontSize: 16 },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    borderWidth: 2,
    borderRadius: 12,
    padding: 14,
    fontSize: 18,
    minHeight: 56,
  },
  toggle: {
    flexShrink: 0,
    minWidth: 72,
    minHeight: 56,
    borderWidth: 2,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
});
