import { createContext, PropsWithChildren, useCallback, useContext, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';

interface ToastState {
  message: string;
  onUndo?: () => void | Promise<void>;
}

interface ToastContextValue {
  showToast: (message: string, onUndo?: () => void | Promise<void>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_HIDE_MS = 10000;

export function ToastProvider({ children }: PropsWithChildren) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  const showToast = useCallback(
    (message: string, onUndo?: () => void | Promise<void>) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ message, onUndo });
      timerRef.current = setTimeout(hide, AUTO_HIDE_MS);
    },
    [hide]
  );

  const handleUndo = useCallback(async () => {
    const onUndo = toast?.onUndo;
    hide();
    if (onUndo) {
      await onUndo();
      showToast('C’est annulé, rien n’a changé.');
    }
  }, [toast, hide, showToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <View
          style={[
            styles.toast,
            { backgroundColor: colors.ink, bottom: insets.bottom + 16 },
          ]}
          accessibilityRole="alert"
        >
          <Text style={[styles.message, { color: colors.bg }]}>✓ {toast.message}</Text>
          {toast.onUndo && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Annuler"
              onPress={handleUndo}
              style={[styles.undoBtn, { backgroundColor: colors.sun }]}
            >
              <Text style={[styles.undoText, { color: colors.sunInk }]}>Annuler</Text>
            </Pressable>
          )}
        </View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé dans un ToastProvider');
  return ctx;
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    maxWidth: 528,
    alignSelf: 'center',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    zIndex: 30,
  },
  message: { flex: 1, fontWeight: '700', fontSize: 16 },
  undoBtn: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16 },
  undoText: { fontWeight: '700', fontSize: 16 },
});
