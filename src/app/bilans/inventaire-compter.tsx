import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Header } from '../../components/Header';
import { ScreenScroll } from '../../components/ScreenScroll';
import { Stepper } from '../../components/Stepper';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { RequireProprietaire } from '../../components/RequireProprietaire';
import { useTheme } from '../../theme/useTheme';
import { useAuth } from '../../lib/AuthSession';
import { useToast } from '../../components/Toast';
import {
  abandonnerInventaire,
  compterArticle,
  compterProgression,
  getInventaire,
  listArticlesACompter,
  resumeEcarts,
  validerInventaire,
  type InventairesDb,
} from '../../db/inventaires';
import { formatFCFA } from '../../lib/format';

export default function InventaireCompterScreen() {
  return (
    <RequireProprietaire>
      <CompterForm />
    </RequireProprietaire>
  );
}

function CompterForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext() as InventairesDb;
  const { colors } = useTheme();
  const { session } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [aCompter, setACompter] = useState<
    { id: string; nom: string; categorie: string; stock: number }[]
  >([]);
  const [comptes, setComptes] = useState(0);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<{
    id: string;
    nom: string;
    stock: number;
  } | null>(null);
  const [qte, setQte] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [resumeText, setResumeText] = useState('');
  const [validating, setValidating] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const inv = await getInventaire(db, id);
      if (!inv || inv.statut !== 'en_cours') {
        router.replace('/bilans/inventaires');
        return;
      }
      const [arts, prog] = await Promise.all([
        listArticlesACompter(db, id),
        compterProgression(db, id),
      ]);
      setACompter(arts);
      setComptes(prog.comptes);
      setTotal(prog.total);
    } finally {
      setLoading(false);
    }
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return aCompter;
    return aCompter.filter((a) => a.nom.toLowerCase().includes(q));
  }, [aCompter, search]);

  const openArticle = (a: { id: string; nom: string; stock: number }) => {
    setSelected(a);
    setQte(Math.max(0, a.stock));
  };

  const validerCompte = async () => {
    if (!selected || !id || saving) return;
    setSaving(true);
    try {
      await compterArticle(db, id, selected.id, qte);
      setSelected(null);
      showToast(`${selected.nom} : ✓ compté`);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const preparerFin = async () => {
    if (!id) return;
    const r = await resumeEcarts(db, id);
    setResumeText(
      `${r.nbArticlesEcart} article${r.nbArticlesEcart > 1 ? 's' : ''} avec un écart. Manque : ${r.manquePieces} pièces (valeur ${formatFCFA(r.manqueValeur)}). En trop : ${r.tropPieces} pièces.`
    );
    setConfirmFinish(true);
  };

  const valider = async () => {
    if (!id || validating) return;
    setValidating(true);
    try {
      await validerInventaire(db, id, session?.user?.id ?? null);
      setConfirmFinish(false);
      showToast('Stock corrigé');
      router.replace('/bilans/inventaires');
    } finally {
      setValidating(false);
    }
  };

  const abandonner = async () => {
    if (!id) return;
    await abandonnerInventaire(db, id);
    setConfirmAbandon(false);
    router.replace('/bilans/inventaires');
  };

  if (selected) {
    return (
      <ScreenScroll>
        <Header title={selected.nom} onBack={() => setSelected(null)} />
        <Text style={{ color: colors.muted, marginBottom: 8 }}>
          Stock attendu : {selected.stock}
        </Text>
        <Text style={{ color: colors.ink, fontWeight: '700', marginBottom: 8 }}>
          Nombre compté
        </Text>
        <Stepper value={qte} onChange={setQte} min={0} />
        <View style={{ marginTop: 20, gap: 10 }}>
          <Button variant="indigo-outline" loading={saving} onPress={validerCompte}>
            Valider ce compte
          </Button>
          <Button variant="ghost" onPress={() => setSelected(null)}>
            Retour à la liste
          </Button>
        </View>
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll>
      <Header title="Comptage" onBack={() => router.replace('/bilans/inventaires')} />
      <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 18, marginBottom: 8 }}>
        {comptes} / {total} comptés
      </Text>
      <View style={[styles.barBg, { backgroundColor: colors.line }]}>
        <View
          style={[
            styles.barFg,
            {
              backgroundColor: colors.indigo,
              width: `${total ? Math.min(100, (100 * comptes) / total) : 0}%`,
            },
          ]}
        />
      </View>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Rechercher…"
        placeholderTextColor={colors.muted}
        style={[
          styles.search,
          { borderColor: colors.line, color: colors.ink, backgroundColor: colors.card },
        ]}
      />
      {loading ? (
        <ActivityIndicator color={colors.indigo} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          scrollEnabled={false}
          ListEmptyComponent={
            <Text style={{ color: colors.ok, fontWeight: '700', marginVertical: 16 }}>
              Tous les articles du périmètre sont comptés.
            </Text>
          }
          renderItem={({ item }) => (
            <Button variant="ghost" onPress={() => openArticle(item)}>
              {item.nom} (attendu {item.stock})
            </Button>
          )}
        />
      )}
      <View style={{ gap: 10, marginTop: 20 }}>
        <Button variant="indigo-outline" onPress={preparerFin}>
          Terminer l’inventaire
        </Button>
        <Button variant="danger-outline" onPress={() => setConfirmAbandon(true)}>
          Abandonner
        </Button>
      </View>

      <ConfirmDialog
        visible={confirmAbandon}
        title="Abandonner l’inventaire ?"
        description="Aucune correction de stock ne sera faite. L’inventaire restera dans l’historique comme abandonné."
        safeLabel="Non, continuer"
        onSafe={() => setConfirmAbandon(false)}
        dangerLabel="Oui, abandonner"
        onConfirmDanger={abandonner}
      />
      <ConfirmDialog
        visible={confirmFinish}
        title="Résumé des écarts"
        description={resumeText + '\n\nValider et corriger le stock ?'}
        safeLabel="Revenir"
        onSafe={() => setConfirmFinish(false)}
        dangerLabel="Valider et corriger le stock"
        onConfirmDanger={valider}
      />
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  barBg: { height: 10, borderRadius: 999, overflow: 'hidden', marginBottom: 14 },
  barFg: { height: '100%' },
  search: {
    borderWidth: 2,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
  },
});
