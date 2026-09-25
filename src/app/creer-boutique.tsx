import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Header } from '../components/Header';
import { ScreenScroll } from '../components/ScreenScroll';
import { PasswordField } from '../components/PasswordField';
import { Button } from '../components/Button';
import { useTheme } from '../theme/useTheme';
import { useAuth, NumeroDejaPrisError } from '../lib/AuthSession';
import { getErrorMessage } from '../lib/errors';
import { setSetting, SETTINGS_KEYS, type CatalogueInitial } from '../db/settings';

export default function CreerBoutiqueScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const { creerBoutique } = useAuth();

  const [monNom, setMonNom] = useState('');
  const [nomBoutique, setNomBoutique] = useState('');
  const [tel, setTel] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [catalogue, setCatalogue] = useState<CatalogueInitial>('type');
  const [erreur, setErreur] = useState<string | null>(null);
  const [numeroPris, setNumeroPris] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  const onCreer = async () => {
    if (envoi) return;
    if (!monNom.trim()) {
      setErreur('Écrivez votre nom.');
      return;
    }
    if (!nomBoutique.trim()) {
      setErreur('Écrivez le nom de la boutique.');
      return;
    }
    if (motDePasse.length < 6) {
      setErreur('Le mot de passe doit faire au moins 6 caractères.');
      return;
    }
    if (motDePasse !== confirmation) {
      setErreur('Les deux mots de passe sont différents.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    setNumeroPris(false);
    try {
      await creerBoutique(nomBoutique, monNom, tel, motDePasse);
      await setSetting(db, SETTINGS_KEYS.catalogueInitial, catalogue);
      router.replace('/bienvenue');
    } catch (e) {
      if (e instanceof NumeroDejaPrisError) {
        setNumeroPris(true);
        setErreur(e.message);
      } else {
        const msg = getErrorMessage(e);
        if (msg.toLowerCase().includes('already')) {
          setNumeroPris(true);
          setErreur('Ce numéro a déjà un compte. Connectez-vous.');
        } else {
          setErreur(msg || 'Impossible de créer la boutique. Réessayez.');
        }
      }
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <ScreenScroll>
      <Header title="Créer ma boutique" onBack={() => router.replace('/connexion')} backLabel="← Connexion" />

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.ink }]}>Votre nom</Text>
          <TextInput
            value={monNom}
            onChangeText={setMonNom}
            placeholder="Ex. Awa"
            placeholderTextColor={colors.muted}
            style={[styles.input, { borderColor: colors.line, color: colors.ink, backgroundColor: colors.bg }]}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.ink }]}>Nom de la boutique</Text>
          <TextInput
            value={nomBoutique}
            onChangeText={setNomBoutique}
            placeholder="Ex. Chez Awa Beauté"
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
            placeholder="01 97 00 00 00"
            placeholderTextColor={colors.muted}
            style={[styles.input, { borderColor: colors.line, color: colors.ink, backgroundColor: colors.bg }]}
          />
        </View>

        <PasswordField label="Mot de passe" value={motDePasse} onChangeText={setMotDePasse} />
        <PasswordField
          label="Confirmer le mot de passe"
          value={confirmation}
          onChangeText={setConfirmation}
        />

        <Text style={[styles.label, { color: colors.ink, marginTop: 4 }]}>Liste d’articles</Text>
        <Choix
          active={catalogue === 'type'}
          title="Commencer avec la liste type"
          subtitle="316 articles mèches et produits, stock à 0"
          onPress={() => setCatalogue('type')}
        />
        <Choix
          active={catalogue === 'vide'}
          title="Commencer avec une liste vide"
          subtitle="Vous ajouterez vos articles vous-même"
          onPress={() => setCatalogue('vide')}
        />

        {erreur ? (
          <View style={[styles.alert, { backgroundColor: colors.warnSoft }]}>
            <Text style={{ color: colors.warn, fontWeight: '700' }}>{erreur}</Text>
            {numeroPris ? (
              <View style={{ marginTop: 10 }}>
                <Button variant="indigo-outline" onPress={() => router.replace('/connexion')}>
                  Aller à Connexion
                </Button>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={{ marginTop: 8 }}>
          <Button variant="sell" big disabled={envoi} loading={envoi} onPress={onCreer}>
            Créer ma boutique
          </Button>
        </View>
        <Text style={{ color: colors.muted, fontSize: 14, textAlign: 'center' }}>
          Ensuite vous choisirez un code PIN pour protéger « Gérer ».
        </Text>
      </View>
    </ScreenScroll>
  );
}

function Choix({
  active,
  title,
  subtitle,
  onPress,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={[
        styles.choix,
        {
          borderColor: active ? colors.indigo : colors.line,
          backgroundColor: active ? colors.indigoSoft : colors.bg,
        },
      ]}
    >
      <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 16 }}>{title}</Text>
      <Text style={{ color: colors.muted, fontSize: 14, marginTop: 4 }}>{subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 20, gap: 14 },
  field: { gap: 6 },
  label: { fontWeight: '700', fontSize: 16 },
  input: { borderWidth: 2, borderRadius: 12, padding: 14, fontSize: 18, minHeight: 56 },
  alert: { borderRadius: 12, padding: 12, gap: 4 },
  choix: { borderWidth: 2, borderRadius: 14, padding: 14 },
});
