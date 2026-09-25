import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { BilansShell } from '../../components/BilansShell';
import { PeriodeSelector } from '../../components/PeriodeSelector';
import { useTheme } from '../../theme/useTheme';
import { FONT_TITLE } from '../../theme/typography';
import { formatFCFA } from '../../lib/format';
import {
  calculerBilan,
  variationLabel,
  type BilanPeriode,
} from '../../db/bilans';
import {
  periodeAujourdhui,
  shiftPeriode,
  type PeriodeBounds,
  type PeriodeKind,
} from '../../db/periodes';

export default function BilansScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const [kind, setKind] = useState<PeriodeKind>('semaine');
  const [periode, setPeriode] = useState<PeriodeBounds>(() => periodeAujourdhui('semaine'));
  const [bilan, setBilan] = useState<BilanPeriode | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (p: PeriodeBounds) => {
      setLoading(true);
      try {
        const b = await calculerBilan(db, p);
        setBilan(b);
      } finally {
        setLoading(false);
      }
    },
    [db]
  );

  useFocusEffect(
    useCallback(() => {
      void load(periode);
    }, [load, periode])
  );

  const onKind = (k: PeriodeKind) => {
    setKind(k);
    const next = periodeAujourdhui(k);
    setPeriode(next);
  };

  const varLabel = bilan ? variationLabel(bilan.variationPct, bilan.precedente) : null;
  const varColor =
    bilan?.variationPct == null
      ? colors.muted
      : bilan.variationPct >= 0
        ? colors.ok
        : colors.warn;

  return (
    <BilansShell>
      <PeriodeSelector
        kind={kind}
        label={periode.label}
        onKind={onKind}
        onPrev={() => setPeriode((p) => shiftPeriode(p, -1))}
        onNext={() => setPeriode((p) => shiftPeriode(p, 1))}
      />

      {loading || !bilan ? (
        <ActivityIndicator size="large" color={colors.indigo} style={{ marginTop: 40 }} />
      ) : (
        <View style={styles.blocks}>
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={[styles.cardLabel, { color: colors.muted }]}>ARGENT ENCAISSÉ</Text>
            <Text style={[styles.big, { color: colors.ink, fontFamily: FONT_TITLE }]}>
              {formatFCFA(bilan.argentEncaisse)}
            </Text>
            {varLabel ? (
              <Text style={{ color: varColor, fontWeight: '700', marginTop: 6 }}>{varLabel}</Text>
            ) : null}
          </View>

          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={{ color: colors.ink, fontSize: 17, fontWeight: '700' }}>
              {bilan.benefice.label}
            </Text>
            {bilan.benefice.articlesSansPrix > 0 ? (
              <Pressable onPress={() => router.push('/bilans/a-completer')}>
                <Text style={{ color: colors.indigo, marginTop: 8, fontWeight: '700' }}>
                  Voir les articles à compléter →
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.row2}>
            <Mini
              title="Mèches"
              line1={formatFCFA(bilan.mechesMontant)}
              line2={`${bilan.mechesPieces} pièces`}
            />
            <Mini
              title="Produits"
              line1={formatFCFA(bilan.produitsMontant)}
              line2={`${bilan.produitsPieces} pièces`}
            />
          </View>
          <View style={styles.row2}>
            <Mini title="Détail" line1={formatFCFA(bilan.detailMontant)} line2="" />
            <Mini title="Gros" line1={formatFCFA(bilan.grosMontant)} line2="" />
          </View>

          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={[styles.cardLabel, { color: colors.muted }]}>RÉDUCTIONS ACCORDÉES</Text>
            <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '700' }}>
              {formatFCFA(bilan.reductionsTotal)}
            </Text>
            <Text style={{ color: colors.muted, marginTop: 4 }}>
              {bilan.reductionsNb === 0
                ? 'Aucune vente concernée'
                : bilan.reductionsNb === 1
                  ? '1 vente concernée'
                  : `${bilan.reductionsNb} ventes concernées`}
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={[styles.cardLabel, { color: colors.muted }]}>MARCHANDISE ARRIVÉE</Text>
            <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '700' }}>
              {bilan.entreesPieces} pièces
            </Text>
            <Text style={{ color: colors.muted, marginTop: 4 }}>
              {bilan.entreesCout != null
                ? `Coût : ${formatFCFA(bilan.entreesCout)}`
                : bilan.entreesPieces === 0
                  ? 'Aucune entrée'
                  : 'Coût partiel (prix d’achat manquants)'}
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={[styles.cardLabel, { color: colors.muted }]}>STOCK EN FIN DE PÉRIODE</Text>
            <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700' }}>
              {bilan.stockPieces} pièces
            </Text>
            <Text style={{ color: colors.muted, marginTop: 4 }}>
              Au détail : {formatFCFA(bilan.stockValeurDetail)}
            </Text>
            <Text style={{ color: colors.muted, marginTop: 2 }}>
              {bilan.stockValeurAchat != null
                ? `À l’achat : ${formatFCFA(bilan.stockValeurAchat)}`
                : 'Valeur à l’achat : inconnue'}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: '/bilans/detail',
                params: { kind: periode.kind, ancre: periode.ancre },
              })
            }
            style={[styles.linkBtn, { borderColor: colors.line }]}
          >
            <Text style={{ color: colors.indigo, fontWeight: '700', fontSize: 17 }}>
              Voir le détail
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: '/bilans/stock-date',
                params: { kind: periode.kind, ancre: periode.ancre },
              })
            }
            style={[styles.linkBtn, { borderColor: colors.line }]}
          >
            <Text style={{ color: colors.indigo, fontWeight: '700', fontSize: 17 }}>
              Voir le stock à cette date
            </Text>
          </Pressable>
        </View>
      )}
    </BilansShell>
  );
}

function Mini({ title, line1, line2 }: { title: string; line1: string; line2: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.mini, { backgroundColor: colors.card }]}>
      <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700' }}>{title}</Text>
      <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700', marginTop: 4 }}>{line1}</Text>
      {line2 ? <Text style={{ color: colors.muted, marginTop: 2 }}>{line2}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: 12, paddingBottom: 24 },
  card: { borderRadius: 16, padding: 16 },
  cardLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  big: { fontSize: 36 },
  row2: { flexDirection: 'row', gap: 10 },
  mini: { flex: 1, borderRadius: 16, padding: 14 },
  linkBtn: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
