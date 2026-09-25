import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Header } from '../components/Header';
import { ScreenScroll } from '../components/ScreenScroll';
import { Button } from '../components/Button';
import { PasswordField } from '../components/PasswordField';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useTheme } from '../theme/useTheme';
import { FONT_TITLE } from '../theme/typography';
import { useAuth, PendingSyncError } from '../lib/AuthSession';
import { useAdminSession } from '../lib/AdminSession';
import { useToast } from '../components/Toast';
import { formatTelAffiche } from '../lib/identifiant';
import { getErrorMessage } from '../lib/errors';
import { changerMotDePasse } from '../db/membres';

export default function MonCompteScreen() {
  const { colors } = useTheme();
  const { membre, session, signOut } = useAuth();
  const { lock } = useAdminSession();
  const { showToast } = useToast();

  const [telAffiche, setTelAffiche] = useState('');
  const [ancien, setAncien] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreurMdp, setErreurMdp] = useState<string | null>(null);
  const [savingMdp, setSavingMdp] = useState(false);
  const [showMdp, setShowMdp] = useState(false);

  const [confirmDeconnexion, setConfirmDeconnexion] = useState(false);
  const [confirmChanger, setConfirmChanger] = useState(false);
  const [blocage, setBlocage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setTelAffiche(formatTelAffiche(session?.user?.email ?? ''));
    }, [session])
  );

  const executerSortie = async () => {
    try {
      await signOut();
      lock();
      setConfirmDeconnexion(false);
      setConfirmChanger(false);
      router.replace('/connexion');
    } catch (e) {
      setConfirmDeconnexion(false);
      setConfirmChanger(false);
      if (e instanceof PendingSyncError) setBlocage(e.message);
      else showToast('Impossible de se déconnecter pour l’instant.');
    }
  };

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
      setShowMdp(false);
      showToast('Mot de passe changé');
    } catch (e) {
      setErreurMdp(getErrorMessage(e) || 'Impossible de changer le mot de passe.');
    } finally {
      setSavingMdp(false);
    }
  };

  const roleLabel = membre?.role === 'proprietaire' ? 'Propriétaire' : 'Vendeuse';

  return (
    <ScreenScroll>
      <Header title="Mon compte" onBack={() => router.replace('/')} />

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.prenom, { color: colors.ink, fontFamily: FONT_TITLE }]}>
          {membre?.nom ?? '—'}
        </Text>
        <InfoRow label="Boutique" value={membre?.boutiqueNom || '—'} />
        <InfoRow label="Rôle" value={roleLabel} />
        <InfoRow label="Numéro" value={telAffiche || '—'} />
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, marginTop: 16 }]}>
        {!showMdp ? (
          <Button variant="indigo-outline" onPress={() => setShowMdp(true)}>
            Changer mon mot de passe
          </Button>
        ) : (
          <>
            <Text style={[styles.section, { color: colors.ink, fontFamily: FONT_TITLE }]}>
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
            <Button variant="ghost" onPress={() => setShowMdp(false)}>
              Annuler
            </Button>
          </>
        )}
      </View>

      <View style={{ marginTop: 16 }}>
        <Button variant="indigo-outline" onPress={() => setConfirmChanger(true)}>
          Changer de compte
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
        description="Les données de cette boutique seront retirées de cet appareil (elles restent en ligne). Vous pourrez vous reconnecter ensuite."
        safeLabel="Non, rester connecté"
        onSafe={() => setConfirmDeconnexion(false)}
        dangerLabel="Oui, me déconnecter"
        onConfirmDanger={executerSortie}
      />
      <ConfirmDialog
        visible={confirmChanger}
        title="Changer de compte ?"
        description="Les données de cette boutique seront retirées de cet appareil (elles restent en ligne). Vous pourrez choisir un autre compte."
        safeLabel="Non, rester connecté"
        onSafe={() => setConfirmChanger(false)}
        dangerLabel="Oui, changer de compte"
        onConfirmDanger={executerSortie}
      />
      <ConfirmDialog
        visible={blocage != null}
        title="Pas encore"
        description={blocage ?? ''}
        safeLabel="D’accord"
        onSafe={() => setBlocage(null)}
        dangerLabel=""
        onConfirmDanger={() => setBlocage(null)}
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
  prenom: { fontSize: 28, fontWeight: '800' },
  section: { fontSize: 20 },
  infoRow: { gap: 2 },
  alert: { borderRadius: 12, padding: 12 },
  delzone: { marginTop: 40, paddingTop: 16, borderTopWidth: 2, borderStyle: 'dashed' },
});
