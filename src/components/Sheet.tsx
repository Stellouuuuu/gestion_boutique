import { PropsWithChildren } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';

interface SheetProps extends PropsWithChildren {
  visible: boolean;
  onRequestClose: () => void;
}

/** Feuille modale bas d'écran, comme .scrim/.sheet dans la maquette. */
export function Sheet({ visible, onRequestClose, children }: SheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onRequestClose}
      statusBarTranslucent
    >
      <Pressable style={styles.scrim} onPress={onRequestClose} accessibilityLabel="Fermer">
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: colors.card, paddingBottom: 22 + insets.bottom },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(10,12,30,0.55)',
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 22,
    padding: 18,
    paddingTop: 22,
  },
});
