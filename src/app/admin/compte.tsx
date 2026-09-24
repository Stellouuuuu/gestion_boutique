import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Header } from '../../components/Header';
import { ScreenScroll } from '../../components/ScreenScroll';
import { Button } from '../../components/Button';
import { PasswordField } from '../../components/PasswordField';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { RequireUnlocked } from '../../components/RequireUnlocked';
import { useTheme } from '../../theme/useTheme';
import { FONT_TITLE } from '../../theme/typography';
import { useAuth, PendingSyncError } from '../../lib/AuthSession';
import { useToast } from '../../components/Toast';
import { formatTelAffiche } from '../../lib/identifiant';
import { getErrorMessage } from '../../lib/errors';
import { changerMotDePasse, fetchBoutique } from '../../db/membres';

export default function CompteScreen() {
  return (
    <RequireUnlocked>
      <CompteForm />
    </RequireUnlocked>
  );
}

function CompteForm() {
  const { colors } = useTheme();
  const { membre, session, signOut } = useAuth();
  const { showToast } = useToast();

  const [nomBoutique, setNomBoutique] = useState<string | null>(null);
  const [telAffiche, setTelAffiche] = useState('');
  const [chargement, setChargement] = useState(true);

  const [ancien, setAncien] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreurMdp, setErreurMdp] = useState<string | null>(null);
  const [savingMdp, setSavingMdp] = useState(false);

  const [confirmDeconnexion, setConfirmDeconnexion] = useState(false);
  const [blocageDeconnexion, setBlocageDeconnexion] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setChargement(true);
        const email = session?.user?.email ?? '';
        if (active) setTelAffiche(formatTelAffiche(email));
        if (membre) {
          try {
            const b = await fetchBoutique(membre.boutiqueId);
            if (active) setNomBoutique(b?.nom ?? null);
          } catch {
            if (active) setNomBoutique(null);
          }
        }
        if (active) setChargement(false);
      })();
      return () => {
        active = false;
      };
    }, [membre, session])
  );

  const onChangerMdp = async () => {
    if (savingMdp) return;
    if (ancien.length < 6 || nouveau.length < 6) {
      setErreurMdp('Le mot de passe doit faire au moins 6 caractères.');
      return;
    }
    if (nouveau !== confirmation) {
      setErreurMdp('Les deux nouveaux mots de passe sont différents.');
      return;
    }
    setSavingMdp(true);
    setErreurMdp(null);
    try {
      await changerMotDePasse(ancien, nouveau);
      setAncien('');
      setNouveau('');
      setConfirmation('');
      showToast('Mot de passe changé');
    } catch (e) {
      setErreurMdp(getErrorMessage(e) || 'Impossible de changer le mot de passe.');
    } finally {
      setSavingMdp(false);
    }
  };

  const onDeconnexion = async () => {
    try {
      await signOut();
      setConfirmDeconnexion(false);
      router.replace('/connexion');
    } catch (e) {
      setConfirmDeconnexion(false);
      if (e instanceof PendingSyncError) {
        setBlocageDeconnexion(e.message);
      } else {
        showToast('Impossible de se déconnecter pour l’instant.');
      }
    }
  };

  return (
    <ScreenScroll>
      <Header title="Mon compte" onBack={() => router.replace('/admin')} />

      {chargement ? (
        <ActivityIndicator size="large" color={colors.indigo} style={{ marginTop: 40 }} />
      ) : (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink, fontFamily: FONT_TITLE }]}>
            {membre?.nom ?? '—'}
          </Text>
          <InfoRow label="Téléphone" value={telAffiche || '—'} />
          <InfoRow label="Boutique" value={nomBoutique ?? '—'} />
          <InfoRow
            label="Rôle"
            value={membre?.role === 'proprietaire' ? 'Propriétaire' : 'Vendeuse'}
          />
        </View>
      )}

      <View style={[styles.card, { backgroundColor: colors.card, marginTop: 16 }]}>
        <Text style={[styles.sectionTitle, { color: colors.ink, fontFamily: FONT_TITLE }]}>
          Changer mon mot de passe
        </Text>
        <PasswordField label="Ancien mot de passe" value={ancien} onChangeText={setAncien} />
        <PasswordField label="Nouveau mot de passe" value={nouveau} onChangeText={setNouveau} />
        <PasswordField
          label="Confirmer le nouveau"
          value={confirmation}
          onChangeText={setConfirmation}
        />
        {erreurMdp ? (
          <View style={[styles.alert, { backgroundColor: colors.warnSoft }]}>
            <Text style={{ color: colors.warn, fontWeight: '700' }}>{erreurMdp}</Text>
          </View>
        ) : null}
        <Button variant="indigo-outline" disabled={savingMdp} loading={savingMdp} onPress={onChangerMdp}>
          Enregistrer le mot de passe
        </Button>
      </View>

      <View style={[styles.delzone, { borderTopColor: colors.line }]}>
        <Button variant="danger-outline" onPress={() => setConfirmDeconnexion(true)}>
          Se déconnecter
        </Button>
      </View>

      <ConfirmDialog
        visible={confirmDeconnexion}
        title="Se déconnecter ?"
        description="Vous pourrez vous reconnecter avec votre numéro et votre mot de passe."
        safeLabel="Non, rester connecté·e"
        onSafe={() => setConfirmDeconnexion(false)}
        dangerLabel="Oui, me déconnecter"
        onConfirmDanger={onDeconnexion}
      />
      <ConfirmDialog
        visible={blocageDeconnexion != null}
        title="Pas encore"
        description={blocageDeconnexion ?? ''}
        safeLabel="D’accord"
        onSafe={() => setBlocageDeconnexion(null)}
        dangerLabel=""
        onConfirmDanger={() => setBlocageDeconnexion(null)}
      />
    </ScreenScroll>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.infoRow}>
      <Text style={{ color: colors.muted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 18, gap: 14 },
  sectionTitle: { fontSize: 22, marginBottom: 4 },
  infoRow: { gap: 2 },
  alert: { borderRadius: 12, padding: 12 },
  delzone: { marginTop: 40, paddingTop: 16, borderTopWidth: 2, borderStyle: 'dashed' },
});
