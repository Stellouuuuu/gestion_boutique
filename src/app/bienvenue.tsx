import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScreenScroll } from '../components/ScreenScroll';
import { PinPad } from '../components/PinPad';
import { useTheme } from '../theme/useTheme';
import { FONT_TITLE } from '../theme/typography';
import { setSetting, SETTINGS_KEYS } from '../db/settings';
import { telechargerBoutiqueSiVide } from '../db/remote';
import { useAuth } from '../lib/AuthSession';

type Etape = 'pin-1' | 'pin-2' | 'telechargement' | 'erreur';

/**
 * Écran affiché une seule fois, juste après la toute première connexion sur cet appareil :
 * choix du code PIN de l'espace Gérer, puis téléchargement des articles de la boutique
 * (cahier des charges étape 2 §2, « Écrans » point 2).
 */
export default function BienvenueScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const { membre } = useAuth();

  const [etape, setEtape] = useState<Etape>('pin-1');
  const [pin, setPin] = useState('');
  const [premierPin, setPremierPin] = useState('');
  const [erreurPin, setErreurPin] = useState<string | null>(null);
  const [erreurTelechargement, setErreurTelechargement] = useState<string | null>(null);

  const lancerTelechargement = async () => {
    setEtape('telechargement');
    if (!membre) {
      setErreurTelechargement('Boutique introuvable pour ce compte.');
      setEtape('erreur');
      return;
    }
    try {
      await telechargerBoutiqueSiVide(db, membre.boutiqueId);
      router.replace('/');
    } catch {
      setErreurTelechargement(
        'Impossible de télécharger vos articles pour l’instant. Vérifiez la connexion et réessayez.'
      );
      setEtape('erreur');
    }
  };

  const onCompletePin = async (code: string) => {
    if (etape === 'pin-1') {
      setPremierPin(code);
      setPin('');
      setErreurPin(null);
      setEtape('pin-2');
      return;
    }
    if (etape === 'pin-2') {
      if (code !== premierPin) {
        setPin('');
        setErreurPin('Les deux codes sont différents. Recommencez.');
        setPremierPin('');
        setEtape('pin-1');
        return;
      }
      await setSetting(db, SETTINGS_KEYS.pin, code);
      await lancerTelechargement();
    }
  };

  return (
    <ScreenScroll>
      <View style={styles.hello}>
        <Text style={[styles.h1, { color: colors.ink, fontFamily: FONT_TITLE }]}>Bienvenue</Text>
      </View>

      {(etape === 'pin-1' || etape === 'pin-2') && (
        <View>
          <Text style={[styles.label, { color: colors.ink }]}>
            {etape === 'pin-1'
              ? 'Choisissez un code à 4 chiffres pour protéger « Gérer les articles ».'
              : 'Retapez le même code pour confirmer.'}
          </Text>
          {erreurPin && <Text style={[styles.error, { color: colors.bad }]}>{erreurPin}</Text>}
          <PinPad value={pin} onChange={setPin} onComplete={onCompletePin} />
        </View>
      )}

      {etape === 'telechargement' && (
        <View style={styles.chargement}>
          <ActivityIndicator size="large" color={colors.indigo} />
          <Text style={[styles.label, { color: colors.ink, marginTop: 16 }]}>
            Chargement de vos articles…
          </Text>
        </View>
      )}

      {etape === 'erreur' && (
        <View style={styles.chargement}>
          <Text style={[styles.error, { color: colors.bad }]}>{erreurTelechargement}</Text>
          <Text
            accessibilityRole="button"
            onPress={lancerTelechargement}
            style={[styles.reessayer, { color: colors.indigo }]}
          >
            Réessayer
          </Text>
        </View>
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  hello: { paddingTop: 20, paddingBottom: 8, alignItems: 'center' },
  h1: { fontSize: 30, fontWeight: '800' },
  label: { fontSize: 18, textAlign: 'center', marginTop: 8 },
  error: { fontSize: 16, textAlign: 'center', marginTop: 10, fontWeight: '700' },
  chargement: { alignItems: 'center', paddingVertical: 60 },
  reessayer: {
    marginTop: 18,
    fontSize: 18,
    fontWeight: '700',
    textDecorationLine: 'underline',
    minHeight: 56,
    textAlignVertical: 'center',
  },
});
