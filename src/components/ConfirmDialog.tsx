import { useEffect, useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { FONT_TITLE } from '../theme/typography';
import { Button } from './Button';
import { Sheet } from './Sheet';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  description?: string;
  /** Libellé du choix dangereux (ex. "Oui, supprimer"). */
  dangerLabel: string;
  onConfirmDanger: () => void;
  /** Libellé du choix sûr, toujours affiché en premier et focus par défaut. */
  safeLabel?: string;
  onSafe: () => void;
  dangerVariant?: 'danger-solid';
}

/**
 * Confirmation à deux choix : le choix sûr est TOUJOURS en premier et reçoit le focus
 * d'accessibilité à l'ouverture (règle §4 du cahier des charges).
 */
export function ConfirmDialog({
  visible,
  title,
  description,
  dangerLabel,
  onConfirmDanger,
  safeLabel = 'Non, garder',
  onSafe,
}: ConfirmDialogProps) {
  const { colors } = useTheme();
  const safeRef = useRef<View>(null);

  useEffect(() => {
    if (!visible || Platform.OS === 'web') return;
    const t = setTimeout(() => {
      try {
        const node = safeRef.current && findNodeHandle(safeRef.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
      } catch {
        // Le focus d'accessibilité est une amélioration, jamais bloquant.
      }
    }, 120);
    return () => clearTimeout(t);
  }, [visible]);

  return (
    <Sheet visible={visible} onRequestClose={onSafe}>
      <Text style={[styles.title, { color: colors.ink, fontFamily: FONT_TITLE }]}>{title}</Text>
      {description && (
        <Text style={[styles.description, { color: colors.muted }]}>{description}</Text>
      )}
      <View style={styles.btns}>
        <Button ref={safeRef} variant="indigo-outline" onPress={onSafe} accessibilityLabel={safeLabel}>
          {safeLabel}
        </Button>
        <Button variant="danger-solid" onPress={onConfirmDanger} accessibilityLabel={dangerLabel}>
          {dangerLabel}
        </Button>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, marginBottom: 8 },
  description: { fontSize: 16, marginBottom: 6 },
  btns: { gap: 10, marginTop: 18 },
});
