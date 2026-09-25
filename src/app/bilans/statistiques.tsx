import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { BilansShell } from '../../components/BilansShell';
import { StatsPeriodeSelector } from '../../components/StatsPeriodeSelector';
import {
  HorizontalBarChart,
  SimpleBarChart,
  Stacked100Bar,
} from '../../components/charts/SimpleCharts';
import { useTheme } from '../../theme/useTheme';
import { FONT_TITLE } from '../../theme/typography';
import { formatFCFA } from '../../lib/format';
import { calculerStats, type StatsCompletes } from '../../db/stats';
import type { StatsPeriodeKind } from '../../db/statsPeriodes';

function Bloc({
  titre,
  phrase,
  children,
}: {
  titre: string;
  phrase: string;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }]}>
      <Text style={[styles.titre, { color: colors.ink, fontFamily: FONT_TITLE }]}>{titre}</Text>
      {children}
      <Text style={[styles.phrase, { color: colors.ink }]}>{phrase}</Text>
    </View>
  );
}

export default function StatistiquesScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const [kind, setKind] = useState<StatsPeriodeKind>('30j');
  const [stats, setStats] = useState<StatsCompletes | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (k: StatsPeriodeKind) => {
      setLoading(true);
      try {
        setStats(await calculerStats(db, k));
      } finally {
        setLoading(false);
      }
    },
    [db]
  );

  useFocusEffect(
    useCallback(() => {
      void load(kind);
    }, [load, kind])
  );

  return (
    <BilansShell title="Statistiques">
      <StatsPeriodeSelector
        kind={kind}
        label={stats?.periode.label ?? '…'}
        onKind={(k) => {
          setKind(k);
        }}
      />

      {loading || !stats ? (
        <ActivityIndicator size="large" color={colors.indigo} style={{ marginTop: 40 }} />
      ) : (
        <View style={styles.blocks}>
          <Bloc titre="Évolution des ventes" phrase={stats.evolution.phrase}>
            <SimpleBarChart
              data={stats.evolution.points.map((p) => ({
                label: p.label,
                valeur: p.valeur,
                couleur: colors.indigo,
              }))}
              ligneMoyenne={stats.evolution.moyenne}
            />
          </Bloc>

          <Bloc
            titre="À racheter en priorité"
            phrase={
              stats.aRacheter[0]?.phrase ??
              'Rien d’urgent : aucun article presque fini qui se vend bien.'
            }
          >
            {stats.aRacheter.length === 0 ? (
              <Text style={{ color: colors.muted }}>Liste vide pour le moment.</Text>
            ) : (
              <View style={{ gap: 10 }}>
                {stats.aRacheter.map((a) => (
                  <View key={a.id} style={[styles.ligne, { borderBottomColor: colors.line }]}>
                    <Text style={{ color: colors.ink, fontWeight: '700', flex: 1 }}>{a.nom}</Text>
                    <Text style={{ color: colors.warn, fontWeight: '700' }}>reste {a.stock}</Text>
                  </View>
                ))}
              </View>
            )}
          </Bloc>

          <Bloc titre="Meilleures ventes" phrase={stats.meilleures.phrase}>
            <Text style={[styles.sous, { color: colors.muted }]}>Par argent encaissé</Text>
            <HorizontalBarChart
              data={stats.meilleures.topArgent.map((a) => ({
                label: a.nom,
                valeur: a.valeur,
                couleur: colors.indigo,
              }))}
            />
            {stats.meilleures.topBenefice.length > 0 ? (
              <>
                <Text style={[styles.sous, { color: colors.muted, marginTop: 16 }]}>
                  Par bénéfice (prix d’achat connus)
                </Text>
                <HorizontalBarChart
                  data={stats.meilleures.topBenefice.map((a) => ({
                    label: a.nom,
                    valeur: a.valeur,
                    couleur: colors.ok,
                  }))}
                />
              </>
            ) : (
              <Text style={{ color: colors.muted, marginTop: 8 }}>
                Complétez les prix d’achat pour voir le classement par bénéfice.
              </Text>
            )}
          </Bloc>

          <Bloc titre="Argent qui dort" phrase={stats.argentDort.phrase}>
            {stats.argentDort.nb === 0 ? (
              <Text style={{ color: colors.ok, fontWeight: '700' }}>Rien qui dort.</Text>
            ) : (
              <View style={{ gap: 8 }}>
                <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700' }}>
                  {stats.argentDort.valeurAchatTotal != null
                    ? formatFCFA(stats.argentDort.valeurAchatTotal)
                    : `${stats.argentDort.nb} articles`}
                </Text>
                {stats.argentDort.articles.slice(0, 8).map((a) => (
                  <Text key={a.id} style={{ color: colors.muted }}>
                    {a.nom} × {a.stock}
                    {a.valeurAchat != null ? ` — ${formatFCFA(a.valeurAchat)}` : ''}
                  </Text>
                ))}
              </View>
            )}
          </Bloc>

          <Bloc titre="Meilleurs jours de la semaine" phrase={stats.meilleursJours.phrase}>
            <SimpleBarChart
              data={stats.meilleursJours.jours.map((j) => ({
                label: j.labelCourt,
                valeur: j.moyenne,
                couleur: colors.indigo,
              }))}
              hauteur={160}
            />
          </Bloc>

          <Bloc titre="Mèches et produits" phrase={stats.categories.phrase}>
            <Stacked100Bar
              titre="Part de l’argent"
              parts={[
                { label: 'Mèches', valeur: stats.categories.mechesArgent, couleur: colors.mech },
                {
                  label: 'Produits',
                  valeur: stats.categories.produitsArgent,
                  couleur: colors.prod,
                },
              ]}
            />
            <View style={{ height: 12 }} />
            <Stacked100Bar
              titre="Part du bénéfice"
              parts={[
                {
                  label: 'Mèches',
                  valeur: Math.max(0, stats.categories.mechesBenefice),
                  couleur: colors.mech,
                },
                {
                  label: 'Produits',
                  valeur: Math.max(0, stats.categories.produitsBenefice),
                  couleur: colors.prod,
                },
              ]}
            />
          </Bloc>

          <Bloc titre="Détail et gros" phrase={stats.detailGros.phrase}>
            <Stacked100Bar
              titre="Part des ventes"
              parts={[
                { label: 'Détail', valeur: stats.detailGros.detail, couleur: colors.indigo },
                { label: 'Gros', valeur: stats.detailGros.gros, couleur: colors.sun },
              ]}
            />
            <Text style={{ color: colors.muted, marginTop: 8 }}>
              Détail {formatFCFA(stats.detailGros.detail)} · Gros {formatFCFA(stats.detailGros.gros)}
            </Text>
          </Bloc>

          <Bloc titre="Réductions" phrase={stats.reductions.phrase}>
            <Text style={{ color: colors.ink, fontSize: 28, fontWeight: '700', fontFamily: FONT_TITLE }}>
              {formatFCFA(stats.reductions.total)}
            </Text>
            <View
              style={[styles.hTrack, { backgroundColor: colors.line, marginTop: 12 }]}
            >
              <View
                style={{
                  width: `${Math.min(100, stats.reductions.pct ?? 0)}%`,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: (stats.reductions.pct ?? 0) >= 10 ? colors.warn : colors.indigo,
                }}
              />
            </View>
            <Text style={{ color: colors.muted, marginTop: 6 }}>
              {stats.reductions.pct == null
                ? '—'
                : `${stats.reductions.pct} % du chiffre (${formatFCFA(stats.reductions.chiffre)})`}
            </Text>
          </Bloc>

          <Bloc titre="Marge par article" phrase={stats.marges.phrase}>
            {stats.marges.articles.length === 0 ? (
              <Text style={{ color: colors.ok, fontWeight: '700' }}>Rien à signaler.</Text>
            ) : (
              <View style={{ gap: 8 }}>
                {stats.marges.articles.map((a) => (
                  <View key={a.id} style={styles.ligne}>
                    <Text style={{ color: colors.ink, flex: 1, fontWeight: '600' }}>{a.nom}</Text>
                    <Text
                      style={{
                        color: a.aPerte ? colors.bad : colors.warn,
                        fontWeight: '700',
                      }}
                    >
                      {a.margePct} %
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </Bloc>
        </View>
      )}
    </BilansShell>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: 16, paddingBottom: 32 },
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  titre: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  phrase: { fontSize: 16, lineHeight: 24, marginTop: 14, fontWeight: '600' },
  sous: { fontSize: 13, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase' },
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hTrack: { height: 14, borderRadius: 7, overflow: 'hidden' },
});
