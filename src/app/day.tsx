import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Header } from '../components/Header';
import { ScreenScroll } from '../components/ScreenScroll';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useTheme } from '../theme/useTheme';
import { FONT_TITLE } from '../theme/typography';
import { formatFCFA, formatHeure } from '../lib/format';
import { CAT_LABEL } from '../theme/colors';
import {
  cancelMouvement,
  listMouvementsDuJour,
  totalVentesDuJour,
  type MouvementAvecArticle,
  type TotalDuJour,
} from '../db/mouvements';

export default function DayScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const [mouvements, setMouvements] = useState<MouvementAvecArticle[]>([]);
  const [totaux, setTotaux] = useState<TotalDuJour>({
    total: 0,
    totalMeches: 0,
    totalProduits: 0,
    nbVentes: 0,
  });
  const [toCancel, setToCancel] = useState<MouvementAvecArticle | null>(null);

  const load = useCallback(async () => {
    const [m, t] = await Promise.all([listMouvementsDuJour(db), totalVentesDuJour(db)]);
    setMouvements(m);
    setTotaux(t);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const doCancel = async () => {
    if (!toCancel) return;
    await cancelMouvement(db, toCancel.id);
    setToCancel(null);
    load();
  };

  const ventes = mouvements.filter((m) => m.type === 'vente');
  const entrees = mouvements.filter((m) => m.type === 'entree');
  const ventesActives = ventes.filter((m) => !m.annule);

  return (
    <ScreenScroll>
      <Header title="Point du jour" />

      <View style={[styles.tot, { backgroundColor: colors.indigo }]}>
        <Text style={[styles.totLabel, { color: colors.onSolid }]}>Argent des ventes aujourd’hui</Text>
        <Text style={[styles.totValue, { color: colors.onSolid, fontFamily: FONT_TITLE }]}>
          {formatFCFA(totaux.total)}
        </Text>
        <View style={styles.split}>
          <Text style={{ color: colors.onSolid, opacity: 0.9 }}>
            Mèches : {formatFCFA(totaux.totalMeches)}
          </Text>
          <Text style={{ color: colors.onSolid, opacity: 0.9 }}>
            Produits : {formatFCFA(totaux.totalProduits)}
          </Text>
        </View>
      </View>

      <Text style={[styles.sec, { color: colors.muted, fontFamily: FONT_TITLE }]}>
        Ventes ({ventesActives.length})
      </Text>
      {ventes.length === 0 ? (
        <Text style={[styles.empty, { color: colors.muted }]}>Pas encore de vente.</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {ventes.map((m) => (
            <MouvementRow key={m.id} m={m} onErreur={() => setToCancel(m)} />
          ))}
        </View>
      )}

      <Text style={[styles.sec, { color: colors.muted, fontFamily: FONT_TITLE }]}>
        Marchandise arrivée
      </Text>
      {entrees.length === 0 ? (
        <Text style={[styles.empty, { color: colors.muted }]}>Rien d’ajouté aujourd’hui.</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {entrees.map((m) => (
            <MouvementRow key={m.id} m={m} onErreur={() => setToCancel(m)} />
          ))}
        </View>
      )}

      <ConfirmDialog
        visible={toCancel != null}
        title="Annuler cette ligne ?"
        description={
          toCancel
            ? `${toCancel.quantite} × ${toCancel.article_nom}. ${
                toCancel.type === 'vente'
                  ? 'Les articles reviennent dans le stock.'
                  : 'Les articles sont retirés du stock.'
              }`
            : undefined
        }
        safeLabel="Non, garder"
        onSafe={() => setToCancel(null)}
        dangerLabel="Oui, annuler la ligne"
        onConfirmDanger={doCancel}
      />
    </ScreenScroll>
  );
}

function MouvementRow({ m, onErreur }: { m: MouvementAvecArticle; onErreur: () => void }) {
  const { colors } = useTheme();
  const reduction = m.type === 'vente' && !m.annule && m.montant_paye < m.montant_normal;
  return (
    <View style={[styles.mv, { backgroundColor: colors.card }, !!m.annule && styles.mvCancel]}>
      <View style={styles.mvText}>
        <Text
          style={[
            styles.mvName,
            { color: colors.ink },
            !!m.annule && { textDecorationLine: 'line-through' },
          ]}
        >
          {m.quantite} × {m.article_nom}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15 }}>
          {formatHeure(new Date(m.cree_le))} · {CAT_LABEL[m.article_categorie]}
          {m.tarif === 'gros' ? ' · en gros' : ''}
          {m.annule ? ' · annulé' : ''}
        </Text>
        {reduction && (
          <View style={[styles.reduxBadge, { backgroundColor: colors.sun }]}>
            <Text style={{ color: colors.sunInk, fontWeight: '700', fontSize: 13 }}>
              Réduction {formatFCFA(m.montant_normal - m.montant_paye)}
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.mvAmt, { color: colors.ink }]}>
        {m.type === 'vente' ? formatFCFA(m.montant_paye) : `+${m.quantite}`}
      </Text>
      {!m.annule && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Signaler une erreur sur ${m.article_nom}`}
          onPress={onErreur}
          style={[styles.errBtn, { borderColor: colors.line }]}
        >
          <Text style={{ color: colors.muted, fontSize: 14, fontWeight: '700' }}>Erreur ?</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tot: { borderRadius: 20, padding: 18, gap: 6 },
  totLabel: { fontSize: 16 },
  totValue: { fontSize: 38 },
  split: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', marginTop: 4 },
  sec: { fontSize: 20, marginTop: 22, marginBottom: 8 },
  empty: { textAlign: 'center', padding: 20, fontSize: 16 },
  mv: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 14 },
  mvCancel: { opacity: 0.45 },
  mvText: { flex: 1, minWidth: 0, gap: 2 },
  mvName: { fontWeight: '700', fontSize: 17 },
  mvAmt: { fontWeight: '700', fontSize: 17 },
  reduxBadge: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8, marginTop: 4 },
  errBtn: {
    flexShrink: 0,
    minHeight: 56,
    minWidth: 64,
    borderWidth: 2,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
