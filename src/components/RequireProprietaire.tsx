import { PropsWithChildren } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../lib/AuthSession';
import { useTheme } from '../theme/useTheme';

/** Seule la propriétaire accède à Gérer (invitations, articles, compte). */
export function RequireProprietaire({ children }: PropsWithChildren) {
  const { loading, membre } = useAuth();
  const { colors } = useTheme();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.indigo} />
      </View>
    );
  }
  if (membre?.role !== 'proprietaire') {
    return <Redirect href="/" />;
  }
  return <>{children}</>;
}
