import { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useTheme } from '../theme/useTheme';
import { RequireProprietaire } from './RequireProprietaire';
import { Header } from './Header';
import { ScreenScroll } from './ScreenScroll';

const TABS = [
  { href: '/bilans', label: 'Bilans', match: (p: string) => p === '/bilans' || p === '/bilans/' },
  {
    href: '/bilans/statistiques',
    label: 'Statistiques',
    match: (p: string) => p.includes('statistiques'),
  },
  {
    href: '/bilans/inventaires',
    label: 'Inventaires',
    match: (p: string) => p.includes('inventaires'),
  },
  { href: '/bilans/exporter', label: 'Exporter', match: (p: string) => p.includes('exporter') },
] as const;

/** Coquille commune des écrans Mes bilans (propriétaire, sans PIN). */
export function BilansShell({
  children,
  title = 'Mes bilans',
}: PropsWithChildren<{ title?: string }>) {
  const { colors } = useTheme();
  const pathname = usePathname();

  return (
    <RequireProprietaire>
      <ScreenScroll>
        <Header title={title} onBack={() => router.replace('/')} />
        <View style={styles.tabs}>
          {TABS.map((t) => {
            const active = t.match(pathname);
            return (
              <Pressable
                key={t.href}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  if (t.href === '/bilans') router.replace('/bilans');
                  else if (t.href === '/bilans/statistiques') router.replace('/bilans/statistiques');
                  else if (t.href === '/bilans/inventaires') router.replace('/bilans/inventaires');
                  else router.replace('/bilans/exporter');
                }}
                style={[
                  styles.tab,
                  {
                    backgroundColor: active ? colors.indigoSoft : colors.card,
                    borderBottomColor: active ? colors.indigo : 'transparent',
                  },
                ]}
              >
                <Text
                  style={{
                    color: active ? colors.indigo : colors.muted,
                    fontWeight: '700',
                    fontSize: 14,
                    textAlign: 'center',
                  }}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {children}
      </ScreenScroll>
    </RequireProprietaire>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 4, marginBottom: 16 },
  tab: {
    flex: 1,
    minHeight: 52,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderBottomWidth: 3,
    justifyContent: 'center',
  },
});
