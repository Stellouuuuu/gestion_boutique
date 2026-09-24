import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Header } from '../../components/Header';
import { ScreenScroll } from '../../components/ScreenScroll';
import { Button } from '../../components/Button';
import { RequireUnlocked } from '../../components/RequireUnlocked';
import { useTheme } from '../../theme/useTheme';
import { FONT_TITLE } from '../../theme/typography';
import { useAuth } from '../../lib/AuthSession';
import { fetchBoutique } from '../../db/membres';

export default function InviterScreen() {
  return (
    <RequireUnlocked>
      <InviterForm />
    </RequireUnlocked>
  );
}

function InviterForm() {
  const { colors } = useTheme();
  const { membre } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [nomBoutique, setNomBoutique] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!membre) return;
      let active = true;
      (async () => {
        try {
          const b = await fetchBoutique(membre.boutiqueId);
          if (!active) return;
          if (!b) {
            setErreur('Boutique introuvable.');
            return;
          }
          setCode(b.codeInvitation);
          setNomBoutique(b.nom);
          setErreur(null);
        } catch {
          if (active) setErreur('Impossible de charger le code. Vérifiez la connexion.');
        }
      })();
      return () => {
        active = false;
      };
    }, [membre])
  );

  const onPartager = async () => {
    if (!code) return;
    const message = `Rejoins la boutique « ${nomBoutique || 'Boutique'} » avec l’app Boutique de Maman.\nCode d’invitation : ${code}`;
    try {
      await Share.share({ message, title: 'Invitation boutique' });
    } catch {
      // Annulé par l'utilisatrice : rien à faire.
    }
  };

  return (
    <ScreenScroll>
      <Header title="Inviter quelqu’un" onBack={() => router.replace('/admin')} />

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.help, { color: colors.ink }]}>
          Donnez ce code à la personne. Elle l’entre dans « Rejoindre une boutique ».
        </Text>

        {!code && !erreur ? (
          <ActivityIndicator size="large" color={colors.indigo} style={{ marginVertical: 40 }} />
        ) : null}

        {erreur ? (
          <View style={[styles.alert, { backgroundColor: colors.warnSoft }]}>
            <Text style={{ color: colors.warn, fontWeight: '700' }}>{erreur}</Text>
          </View>
        ) : null}

        {code ? (
          <>
            <Text style={[styles.code, { color: colors.indigo, fontFamily: FONT_TITLE }]}>{code}</Text>
            <Text style={[styles.hint, { color: colors.muted }]}>
              Code à 6 caractères (sans 0, O, 1 ni I)
            </Text>
            <View style={{ marginTop: 24 }}>
              <Button variant="sell" big onPress={onPartager}>
                Partager (WhatsApp…)
              </Button>
            </View>
          </>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.replace('/admin')}
        style={styles.backLink}
      >
        <Text style={{ color: colors.muted, fontSize: 16 }}>← Retour à Gérer</Text>
      </Pressable>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 24, alignItems: 'center' },
  help: { fontSize: 17, textAlign: 'center', marginBottom: 8 },
  code: { fontSize: 48, fontWeight: '800', letterSpacing: 8, marginTop: 28 },
  hint: { fontSize: 14, marginTop: 10, textAlign: 'center' },
  alert: { borderRadius: 12, padding: 12, marginTop: 16, alignSelf: 'stretch' },
  backLink: { marginTop: 28, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
});
