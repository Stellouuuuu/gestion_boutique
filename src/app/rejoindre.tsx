import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Header } from '../components/Header';
import { ScreenScroll } from '../components/ScreenScroll';
import { PasswordField } from '../components/PasswordField';
import { Button } from '../components/Button';
import { useTheme } from '../theme/useTheme';
import { useAuth, NumeroDejaPrisError } from '../lib/AuthSession';
import { getErrorMessage } from '../lib/errors';

export default function RejoindreScreen() {
  const { colors } = useTheme();
  const { rejoindre } = useAuth();

  const [code, setCode] = useState('');
  const [nom, setNom] = useState('');
  const [tel, setTel] = useState('229');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const onRejoindre = async () => {
    if (envoi) return;
    if (code.trim().length !== 6) {
      setErreur('Le code fait 6 caractères.');
      return;
    }
    if (!nom.trim()) {
      setErreur('Écrivez votre nom.');
      return;
    }
    if (motDePasse.length < 6) {
      setErreur('Le mot de passe doit faire au moins 6 caractères.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await rejoindre(code, nom, tel, motDePasse);
      router.replace('/');
    } catch (e) {
      if (e instanceof NumeroDejaPrisError) {
        setErreur(e.message);
      } else {
        const msg = getErrorMessage(e);
        if (msg.includes('code_invalide')) setErreur('Ce code d’invitation n’existe pas.');
        else if (
          msg.toLowerCase().includes('already registered') ||
          msg.toLowerCase().includes('already been registered')
        ) {
          setErreur('Ce numéro a déjà un compte. Connectez-vous.');
        } else setErreur('Impossible de rejoindre la boutique. Vérifiez le code et réessayez.');
      }
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <ScreenScroll>
      <Header title="Rejoindre une boutique" onBack={() => router.replace('/connexion')} backLabel="← Connexion" />

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.ink }]}>Code d’invitation</Text>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase().slice(0, 6))}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="Ex. AB3D9K"
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.inputCode, { borderColor: colors.line, color: colors.ink, backgroundColor: colors.bg }]}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.ink }]}>Votre nom</Text>
          <TextInput
            value={nom}
            onChangeText={setNom}
            placeholder="Votre prénom"
            placeholderTextColor={colors.muted}
            style={[styles.input, { borderColor: colors.line, color: colors.ink, backgroundColor: colors.bg }]}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.ink }]}>Numéro de téléphone</Text>
          <TextInput
            value={tel}
            onChangeText={setTel}
            keyboardType="phone-pad"
            style={[styles.input, { borderColor: colors.line, color: colors.ink, backgroundColor: colors.bg }]}
          />
        </View>

        <PasswordField label="Mot de passe" value={motDePasse} onChangeText={setMotDePasse} />

        {erreur && (
          <View style={[styles.alert, { backgroundColor: colors.warnSoft }]}>
            <Text style={{ color: colors.warn, fontWeight: '700' }}>{erreur}</Text>
          </View>
        )}

        <View style={{ marginTop: 8 }}>
          <Button variant="in" big disabled={envoi} loading={envoi} onPress={onRejoindre}>
            Rejoindre
          </Button>
        </View>
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 20, gap: 14 },
  field: { gap: 6 },
  label: { fontWeight: '700', fontSize: 16 },
  input: { borderWidth: 2, borderRadius: 12, padding: 14, fontSize: 18, minHeight: 56 },
  inputCode: { fontSize: 24, fontWeight: '800', letterSpacing: 4, textAlign: 'center' },
  alert: { borderRadius: 12, padding: 12 },
});
