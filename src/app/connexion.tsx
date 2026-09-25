import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScreenScroll } from '../components/ScreenScroll';
import { PasswordField } from '../components/PasswordField';
import { Button } from '../components/Button';
import { useTheme } from '../theme/useTheme';
import { FONT_TITLE } from '../theme/typography';
import { useAuth, AutreComptePendingError } from '../lib/AuthSession';
import { MOT_DE_PASSE_OUBLIE_TEXTE } from '../lib/config';
import { masquerTel } from '../lib/identifiant';
import {
  listerComptesRecents,
  oublierCompte,
  type CompteRecent,
} from '../db/comptesRecents';

export default function ConnexionScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const { signIn } = useAuth();

  const [tel, setTel] = useState('229');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [recents, setRecents] = useState<CompteRecent[]>([]);

  const chargerRecents = useCallback(async () => {
    setRecents(await listerComptesRecents(db));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void chargerRecents();
    }, [chargerRecents])
  );

  const onConnexion = async () => {
    if (envoi) return;
    if (motDePasse.length < 6) {
      setErreur('Le mot de passe doit faire au moins 6 caractères.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await signIn(tel, motDePasse);
      router.replace('/');
    } catch (e) {
      if (e instanceof AutreComptePendingError) setErreur(e.message);
      else setErreur('Numéro ou mot de passe incorrect.');
    } finally {
      setEnvoi(false);
    }
  };

  const choisirRecent = (c: CompteRecent) => {
    setTel(c.telDigits.startsWith('229') ? c.telDigits : `229${c.telDigits}`);
    setMotDePasse('');
    setErreur(null);
  };

  const onOublier = async (c: CompteRecent) => {
    await oublierCompte(db, c.userId);
    await chargerRecents();
  };

  return (
    <ScreenScroll>
      <View style={styles.hello}>
        <Text style={[styles.h1, { color: colors.ink, fontFamily: FONT_TITLE }]}>Boutique de Maman</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>Connectez-vous pour continuer</Text>
      </View>

      {recents.length > 0 ? (
        <View style={[styles.recents, { backgroundColor: colors.card }]}>
          <Text style={[styles.recentsTitle, { color: colors.muted }]}>COMPTES RÉCENTS</Text>
          {recents.map((c) => (
            <View key={c.userId} style={[styles.recentRow, { borderBottomColor: colors.line }]}>
              <Pressable
                accessibilityRole="button"
                onPress={() => choisirRecent(c)}
                style={styles.recentMain}
              >
                <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 17 }}>
                  {c.prenom}
                  {c.boutiqueNom ? ` · ${c.boutiqueNom}` : ''}
                </Text>
                <Text style={{ color: colors.muted, marginTop: 2, fontSize: 15 }}>
                  {masquerTel(c.telDigits)}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Oublier ce compte"
                onPress={() => void onOublier(c)}
                hitSlop={8}
              >
                <Text style={{ color: colors.indigo, fontWeight: '700', fontSize: 14 }}>
                  Oublier
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.card, { backgroundColor: colors.card }]}>
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
          <Button variant="sell" big disabled={envoi} loading={envoi} onPress={onConnexion}>
            Se connecter
          </Button>
        </View>

        <Text style={[styles.lienDiscret, { color: colors.muted }]}>{MOT_DE_PASSE_OUBLIE_TEXTE}</Text>
      </View>

      <View style={styles.rejoindre}>
        <Button variant="in" big onPress={() => router.push('/creer-boutique')}>
          Créer ma boutique
        </Button>
        <Button variant="ghost" onPress={() => router.push('/rejoindre')}>
          Rejoindre une boutique avec un code
        </Button>
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  hello: { paddingTop: 40, paddingBottom: 24, alignItems: 'center' },
  h1: { fontSize: 30, fontWeight: '800', textAlign: 'center' },
  sub: { marginTop: 8, fontSize: 18, textAlign: 'center' },
  recents: { borderRadius: 20, padding: 16, marginBottom: 16, gap: 4 },
  recentsTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
  recentMain: { flex: 1 },
  card: { borderRadius: 20, padding: 20, gap: 14 },
  field: { gap: 6 },
  label: { fontWeight: '700', fontSize: 16 },
  input: { borderWidth: 2, borderRadius: 12, padding: 14, fontSize: 18, minHeight: 56 },
  alert: { borderRadius: 12, padding: 12 },
  lienDiscret: { marginTop: 6, fontSize: 15, textAlign: 'center', minHeight: 44, textAlignVertical: 'center' },
  rejoindre: { marginTop: 24, gap: 12 },
});
