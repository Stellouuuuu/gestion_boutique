/**
 * Prendre / choisir une photo de feuille → lecture IA → vérification.
 * En cas d’échec, la photo est conservée pour « Réessayer ».
 */
import { useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import NetInfo from '@react-native-community/netinfo';
import { Header } from '../components/Header';
import { ScreenScroll } from '../components/ScreenScroll';
import { Button } from '../components/Button';
import { useTheme } from '../theme/useTheme';
import { FONT_TITLE } from '../theme/typography';
import { lireFeuillePhoto } from '../lib/lireFeuille';
import {
  MSG_HORS_LIGNE,
  MSG_LECTURE_ECHEC,
  MSG_LECTURE_SURCHARGE,
} from '../lib/feuilleTypes';

async function compresserUri(uri: string): Promise<{ base64: string; mime: string }> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1400 } }],
    { compress: 0.55, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  if (!result.base64) throw new Error('compression');
  return { base64: result.base64, mime: 'image/jpeg' };
}

export default function VentePhotoScreen() {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const photoRef = useRef<string | null>(null);

  const lancerLecture = async (uri: string) => {
    photoRef.current = uri;
    setPhotoUri(uri);
    setBusy(true);
    setErreur(null);
    try {
      const net = await NetInfo.fetch();
      if (net.isConnected === false) {
        setErreur(MSG_HORS_LIGNE);
        return;
      }
      const { base64, mime } = await compresserUri(uri);
      const res = await lireFeuillePhoto({ imageBase64: base64, mime });
      if (!res.ok) {
        setErreur(res.message || MSG_LECTURE_SURCHARGE);
        return;
      }
      router.replace({
        pathname: '/verifier-feuille',
        params: {
          sections: JSON.stringify(res.sections),
          lignes: JSON.stringify(res.lignes),
          dateSuggeree: res.date_suggeree ?? '',
          totalEcrit: res.total_ecrit != null ? String(res.total_ecrit) : '',
          photoUri: uri,
        },
      });
    } catch {
      setErreur(MSG_LECTURE_ECHEC);
    } finally {
      setBusy(false);
    }
  };

  const depuisCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setErreur('Autorisez l’appareil photo pour photographier la feuille.');
      return;
    }
    const pick = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: false,
    });
    if (!pick.canceled && pick.assets[0]?.uri) await lancerLecture(pick.assets[0].uri);
  };

  const depuisGalerie = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted && Platform.OS !== 'web') {
      setErreur('Autorisez l’accès aux photos.');
      return;
    }
    const pick = await ImagePicker.launchImageLibraryAsync({
      quality: 0.7,
      mediaTypes: ['images'],
    });
    if (!pick.canceled && pick.assets[0]?.uri) await lancerLecture(pick.assets[0].uri);
  };

  const relancer = () => {
    const uri = photoRef.current || photoUri;
    if (uri) void lancerLecture(uri);
  };

  return (
    <ScreenScroll>
      <Header title="Photo de ma feuille" onBack={() => router.back()} />
      {busy ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.indigo} />
          <Text style={[styles.msg, { color: colors.ink, fontFamily: FONT_TITLE }]}>
            Je lis votre feuille…
          </Text>
          <Text style={[styles.sub, { color: colors.muted }]}>
            Un instant, je m’applique — cela peut prendre jusqu’à une minute.
          </Text>
        </View>
      ) : (
        <View style={styles.body}>
          <Text style={[styles.hint, { color: colors.muted }]}>
            Photographiez la feuille manuscrite. Vérifiez ensuite chaque ligne avant d’enregistrer.
          </Text>
          {erreur ? <Text style={[styles.err, { color: colors.bad }]}>{erreur}</Text> : null}
          {erreur && (photoUri || photoRef.current) ? (
            <>
              <Button variant="sell" onPress={relancer}>
                Réessayer
              </Button>
              <View style={{ height: 12 }} />
            </>
          ) : null}
          <Button variant={erreur ? 'indigo-outline' : 'sell'} onPress={() => void depuisCamera()}>
            {erreur ? 'Nouvelle photo' : 'Prendre une photo'}
          </Button>
          <View style={{ height: 12 }} />
          <Button variant="indigo-outline" onPress={() => void depuisGalerie()}>
            {Platform.OS === 'web' ? 'Choisir un fichier' : 'Choisir dans la galerie'}
          </Button>
          {erreur ? (
            <>
              <View style={{ height: 20 }} />
              <Button
                variant="ghost"
                onPress={() => router.replace({ pathname: '/pick', params: { mode: 'vente' } })}
              >
                Saisir à la main
              </Button>
            </>
          ) : null}
        </View>
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 16, gap: 8 },
  hint: { fontSize: 17, marginBottom: 16, lineHeight: 24 },
  err: { fontSize: 17, fontWeight: '700', marginBottom: 16, lineHeight: 24 },
  center: { alignItems: 'center', paddingVertical: 80, paddingHorizontal: 16 },
  msg: { marginTop: 20, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  sub: { marginTop: 12, fontSize: 16, textAlign: 'center', lineHeight: 22 },
});
