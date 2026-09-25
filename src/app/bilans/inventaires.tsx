import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { BilansShell } from '../../components/BilansShell';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useTheme } from '../../theme/useTheme';
import { formatFCFA } from '../../lib/format';
import { useAuth } from '../../lib/AuthSession';
import {
  commencerInventaire,
  getInventaireEnCours,
  joursDepuisDernierInventaireTermine,
  labelPerimetre,
  labelStatut,
  listInventaires,
  pertesDepuisJanvier,
  type InventairesDb,
} from '../../db/inventaires';
import type { Inventaire, PerimetreInventaire } from '../../db/types';

export default function InventairesScreen() {
  const db = useSQLiteContext() as InventairesDb;
  const { colors } = useTheme();
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [enCours, setEnCours] = useState<Inventaire | null>(null);
  const [historique, setHistorique] = useState<Inventaire[]>([]);
  const [pertes, setPertes] = useState({ pieces: 0, valeur: 0 });
  const [jours, setJours] = useState<number | null>(null);
  const [confirmStart, setConfirmStart] = useState(false);
  const [choixPerimetre, setChoixPerimetre] = useState(false);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ec, hist, p, j] = await Promise.all([
        getInventaireEnCours(db),
        listInventaires(db),
        pertesDepuisJanvier(db),
        joursDepuisDernierInventaireTermine(db),
      ]);
      setEnCours(ec);
      setHistorique(hist);
      setPertes(p);
      setJours(j);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const lancer = async (perimetre: PerimetreInventaire) => {
    if (starting) return;
    setStarting(true);
    setChoixPerimetre(false);
    try {
      const inv = await commencerInventaire(db, perimetre, session?.user?.id ?? null);
      router.push({ pathname: '/bilans/inventaire-compter', params: { id: inv.id } });
    } finally {
      setStarting(false);
    }
  };

  return (
    <BilansShell title="Inventaires">
      {jours != null && jours > 35 ? (
        <Text style={{ color: colors.warn, marginBottom: 12, fontWeight: '700' }}>
          Dernier inventaire il y a {jours} jours
        </Text>
      ) : null}

      {loading ? (
        <ActivityIndicator color={colors.indigo} />
      ) : (
        <>
          {enCours ? (
            <View style={[styles.card, { backgroundColor: colors.warnSoft }]}>
              <Text style={{ color: colors.warn, fontWeight: '700', fontSize: 17 }}>
                Inventaire en cours ({labelPerimetre(enCours.perimetre)})
              </Text>
              <View style={{ marginTop: 12 }}>
                <Button
                  variant="indigo-outline"
                  onPress={() =>
                    router.push({
                      pathname: '/bilans/inventaire-compter',
                      params: { id: enCours.id },
                    })
                  }
                >
                  Reprendre
                </Button>
              </View>
            </View>
          ) : (
            <Button variant="indigo-outline" onPress={() => setConfirmStart(true)}>
              Commencer un inventaire
            </Button>
          )}

          <View style={[styles.card, { backgroundColor: colors.card, marginTop: 16 }]}>
            <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700' }}>
              PERTES DEPUIS JANVIER
            </Text>
            <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700', marginTop: 4 }}>
              {pertes.pieces} pièces · {formatFCFA(pertes.valeur)}
            </Text>
          </View>

          <Text style={[styles.h, { color: colors.ink }]}>Historique</Text>
          {historique.length === 0 ? (
            <Text style={{ color: colors.muted }}>Aucun inventaire pour l’instant.</Text>
          ) : (
            historique.map((inv) => (
              <Pressable
                key={inv.id}
                onPress={() =>
                  router.push({ pathname: '/bilans/inventaire-fiche', params: { id: inv.id } })
                }
                style={[styles.row, { backgroundColor: colors.card }]}
              >
                <Text style={{ color: colors.ink, fontWeight: '700' }}>
                  {new Date(inv.commence_le).toLocaleDateString('fr-FR')} ·{' '}
                  {labelPerimetre(inv.perimetre)}
                </Text>
                <Text style={{ color: colors.muted, marginTop: 2 }}>{labelStatut(inv.statut)}</Text>
              </Pressable>
            ))
          )}
        </>
      )}

      <ConfirmDialog
        visible={confirmStart}
        title="Commencer un inventaire ?"
        description="Vous allez recompter les articles un par un. Vous pouvez vous arrêter et reprendre plus tard."
        safeLabel="Non, pas maintenant"
        onSafe={() => setConfirmStart(false)}
        dangerLabel="Oui, commencer"
        onConfirmDanger={() => {
          setConfirmStart(false);
          setChoixPerimetre(true);
        }}
      />

      {choixPerimetre ? (
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 18, marginBottom: 8 }}>
            Que recompter ?
          </Text>
          <Button variant="indigo-outline" disabled={starting} onPress={() => lancer('tout')}>
            Tout
          </Button>
          <Button variant="ghost" disabled={starting} onPress={() => lancer('meches')}>
            Mèches seulement
          </Button>
          <Button variant="ghost" disabled={starting} onPress={() => lancer('produits')}>
            Produits seulement
          </Button>
          <Button variant="ghost" onPress={() => setChoixPerimetre(false)}>
            Annuler
          </Button>
        </View>
      ) : null}
    </BilansShell>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16 },
  h: { fontSize: 20, fontWeight: '700', marginTop: 24, marginBottom: 10 },
  row: { borderRadius: 14, padding: 14, marginBottom: 8 },
  sheet: { marginTop: 16, borderRadius: 16, padding: 14, gap: 8 },
});
