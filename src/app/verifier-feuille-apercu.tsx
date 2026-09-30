/**
 * Aperçu DEV : rejoue une réponse IA sauvegardée (0 Gemini).
 * Ouvrir : /verifier-feuille-apercu
 */
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../theme/useTheme';
import fixture from '../../assets/data/essai-feuille-apercu.json';

export default function VerifierFeuilleApercu() {
  const { colors } = useTheme();

  useEffect(() => {
    if (!__DEV__) {
      router.replace('/');
      return;
    }
    const sections = fixture.sections;
    router.replace({
      pathname: '/verifier-feuille',
      params: {
        sections: JSON.stringify(sections),
        dateSuggeree: fixture.date_iso,
        totalEcrit: String(fixture.total_ecrit),
      },
    });
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator size="large" color={colors.indigo} />
      <Text style={{ marginTop: 12, color: colors.muted, fontWeight: '700' }}>
        Ouverture de la feuille (rejeu)…
      </Text>
    </View>
  );
}
