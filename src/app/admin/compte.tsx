import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Header } from '../../components/Header';
import { ScreenScroll } from '../../components/ScreenScroll';
import { Button } from '../../components/Button';
import { RequireUnlocked } from '../../components/RequireUnlocked';
import { useTheme } from '../../theme/useTheme';
import { FONT_TITLE } from '../../theme/typography';
import { useAuth } from '../../lib/AuthSession';
import { useSync } from '../../lib/SyncSession';
import { useToast } from '../../components/Toast';
import { formatTelAffiche } from '../../lib/identifiant';
import { getErrorMessage } from '../../lib/errors';
import { fetchBoutique, updateMonNom, updateNomBoutique } from '../../db/membres';
import { setSetting, SETTINGS_KEYS } from '../../db/settings';

export default function CompteScreen() {
  return (
    <RequireUnlocked>
      <CompteForm />
    </RequireUnlocked>
  );
}

function formatDateHeure(iso: string | null | undefined): string {
  if (!iso) return 'Jamais';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const jj = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const aa = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${jj}/${mm}/${aa} à ${hh}:${min}`;
}

function CompteForm() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const { membre, session, rafraichirMembre } = useAuth();
  const { showToast } = useToast();
  const {
    derniereSynchroOk,
    derniereErreur,
    pendingTotal,
    retryNow,
    refreshIndicateur,
  } = useSync();

  const [nomBoutique, setNomBoutique] = useState('');
  const [monNom, setMonNom] = useState('');
  const [telAffiche, setTelAffiche] = useState('');
  const [chargement, setChargement] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [savingProfil, setSavingProfil] = useState(false);
  const [erreurProfil, setErreurProfil] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setChargement(true);
        await refreshIndicateur();
        const email = session?.user?.email ?? '';
        if (active) {
          setTelAffiche(formatTelAffiche(email));
          setMonNom(membre?.nom ?? '');
        }
        if (membre) {
          try {
            const b = await fetchBoutique(membre.boutiqueId);
            if (active) setNomBoutique(b?.nom ?? membre.boutiqueNom ?? '');
          } catch {
            if (active) setNomBoutique(membre.boutiqueNom ?? '');
          }
        }
        if (active) setChargement(false);
      })();
      return () => {
        active = false;
      };
    }, [membre, session, refreshIndicateur])
  );

  const onSauverProfil = async () => {
    if (savingProfil || !membre) return;
    if (!monNom.trim()) {
      setErreurProfil('Écrivez votre nom.');
      return;
    }
    if (membre.role === 'proprietaire' && !nomBoutique.trim()) {
      setErreurProfil('Écrivez le nom de la boutique.');
      return;
    }
    setSavingProfil(true);
    setErreurProfil(null);
    try {
      await updateMonNom(membre.boutiqueId, monNom);
      await setSetting(db, SETTINGS_KEYS.membreNom, monNom.trim());
      if (membre.role === 'proprietaire') {
        await updateNomBoutique(membre.boutiqueId, nomBoutique);
        await setSetting(db, SETTINGS_KEYS.boutiqueNom, nomBoutique.trim());
      }
      await rafraichirMembre();
      showToast('Profil enregistré');
    } catch (e) {
      setErreurProfil(getErrorMessage(e) || 'Impossible d’enregistrer.');
    } finally {
      setSavingProfil(false);
    }
  };

  const onRetrySync = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await retryNow();
      showToast('Synchronisation relancée');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <ScreenScroll>
      <Header title="Profil boutique" onBack={() => router.replace('/admin')} />

      {chargement ? (
        <ActivityIndicator size="large" color={colors.indigo} style={{ marginTop: 40 }} />
      ) : (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink, fontFamily: FONT_TITLE }]}>
            Noms affichés
          </Text>
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.ink }]}>Mon nom</Text>
            <TextInput
              value={monNom}
              onChangeText={setMonNom}
              style={[
                styles.input,
                { borderColor: colors.line, color: colors.ink, backgroundColor: colors.bg },
              ]}
            />
          </View>
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.ink }]}>Nom de la boutique</Text>
            <TextInput
              value={nomBoutique}
              onChangeText={setNomBoutique}
              style={[
                styles.input,
                { borderColor: colors.line, color: colors.ink, backgroundColor: colors.bg },
              ]}
            />
          </View>
          <InfoRow label="Téléphone" value={telAffiche || '—'} />
          {erreurProfil ? (
            <View style={[styles.alert, { backgroundColor: colors.warnSoft }]}>
              <Text style={{ color: colors.warn, fontWeight: '700' }}>{erreurProfil}</Text>
            </View>
          ) : null}
          <Button
            variant="indigo-outline"
            disabled={savingProfil}
            loading={savingProfil}
            onPress={onSauverProfil}
          >
            Enregistrer le profil
          </Button>
        </View>
      )}

      <View style={[styles.card, { backgroundColor: colors.card, marginTop: 16 }]}>
        <Text style={[styles.sectionTitle, { color: colors.ink, fontFamily: FONT_TITLE }]}>
          Sauvegarde en ligne
        </Text>
        <InfoRow label="Dernier succès" value={formatDateHeure(derniereSynchroOk)} />
        <InfoRow
          label="En attente"
          value={
            pendingTotal === 0
              ? 'Rien'
              : pendingTotal === 1
                ? '1 ligne'
                : `${pendingTotal} lignes`
          }
        />
        {derniereErreur ? (
          <View style={[styles.alert, { backgroundColor: colors.warnSoft }]}>
            <Text style={{ color: colors.warn, fontWeight: '700', marginBottom: 4 }}>
              Dernière erreur ({formatDateHeure(derniereErreur.le)})
            </Text>
            <Text style={{ color: colors.ink, fontSize: 13 }} selectable>
              {derniereErreur.message}
            </Text>
          </View>
        ) : (
          <InfoRow label="Dernière erreur" value="Aucune" />
        )}
        <Button variant="indigo-outline" disabled={retrying} loading={retrying} onPress={onRetrySync}>
          Réessayer maintenant
        </Button>
      </View>

      <View style={{ marginTop: 24 }}>
        <Button variant="ghost" onPress={() => router.push('/mon-compte')}>
          Mot de passe et déconnexion →
        </Button>
      </View>
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
  field: { gap: 6 },
  label: { fontWeight: '700', fontSize: 16 },
  input: { borderWidth: 2, borderRadius: 12, padding: 14, fontSize: 18, minHeight: 56 },
  infoRow: { gap: 2 },
  alert: { borderRadius: 12, padding: 12 },
});
