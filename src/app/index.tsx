import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useTheme } from '../theme/useTheme';
import { FONT_TITLE } from '../theme/typography';
import { ScreenScroll } from '../components/ScreenScroll';
import { BigButton } from '../components/BigButton';
import { formatDateAujourdhui, formatFCFA } from '../lib/format';
import { totalVentesDuJour, countArticlesFinis } from '../db/mouvements';
import { countArticles } from '../db/articles';
import { telechargerBoutiqueSiVide } from '../db/remote';
import { getSetting, SETTINGS_KEYS } from '../db/settings';
import { useAdminSession } from '../lib/AdminSession';
import { useAuth } from '../lib/AuthSession';

export default function HomeScreen() {
  const { colors } = useTheme();
  const db = useSQLiteContext();
  const { unlocked } = useAdminSession();
  const { loading: authLoading, session, membre } = useAuth();
  const [totalJour, setTotalJour] = useState(0);
  const [finis, setFinis] = useState(0);
  const [pinReady, setPinReady] = useState<boolean | null>(null);
  /** boutiqueId pour laquelle le téléchargement initial (si vide) est terminé. */
  const [articlesReadyFor, setArticlesReadyFor] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!session) {
        setPinReady(null);
        return;
      }
      let active = true;
      (async () => {
        const p = await getSetting(db, SETTINGS_KEYS.pin);
        if (active) setPinReady(!!p);
      })();
      return () => {
        active = false;
      };
    }, [db, session])
  );

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      router.replace('/connexion');
      return;
    }
    if (pinReady === false) {
      router.replace('/bienvenue');
    }
  }, [authLoading, session, pinReady]);

  // Après une mise à jour de schéma (tables vidées), retélécharge si la boutique est vide.
  useEffect(() => {
    if (!session || !membre || pinReady !== true) return;
    const boutiqueId = membre.boutiqueId;
    let active = true;
    (async () => {
      try {
        const n = await countArticles(db, boutiqueId);
        if (n === 0) {
          await telechargerBoutiqueSiVide(db, boutiqueId);
        }
      } catch {
        // Hors ligne : on laisse l'écran s'afficher ; les ventes locales déjà là restent.
      }
      if (active) setArticlesReadyFor(boutiqueId);
    })();
    return () => {
      active = false;
    };
  }, [db, session, membre, pinReady]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [totaux, nbFinis] = await Promise.all([
          totalVentesDuJour(db),
          countArticlesFinis(db),
        ]);
        if (active) {
          setTotalJour(totaux.total);
          setFinis(nbFinis);
        }
      })();
      return () => {
        active = false;
      };
    }, [db])
  );

  const articlesReady = !!membre && articlesReadyFor === membre.boutiqueId;
  const pret = !authLoading && !!session && pinReady === true && articlesReady;
  if (!pret) {
    return (
      <ScreenScroll>
        <View style={styles.chargementGate}>
          <ActivityIndicator size="large" color={colors.indigo} />
        </View>
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll>
      <View style={styles.hello}>
        <Text style={[styles.h1, { color: colors.ink, fontFamily: FONT_TITLE }]}>
          Bonjour {membre?.nom ?? 'Maman'}
        </Text>
        <Text style={[styles.date, { color: colors.muted }]}>
          Aujourd’hui, {formatDateAujourdhui()}
        </Text>
      </View>

      <View style={styles.today}>
        <View style={[styles.stat, { backgroundColor: colors.card }]}>
          <Text style={[styles.statLabel, { color: colors.muted }]}>VENDU AUJOURD’HUI</Text>
          <Text style={[styles.statValue, { color: colors.ink, fontFamily: FONT_TITLE }]}>
            {formatFCFA(totalJour)}
          </Text>
        </View>
        <View style={[styles.stat, { backgroundColor: colors.card }]}>
          <Text style={[styles.statLabel, { color: colors.muted }]}>ARTICLES FINIS</Text>
          <Text style={[styles.statValue, { color: colors.ink, fontFamily: FONT_TITLE }]}>
            {finis}
          </Text>
        </View>
      </View>

      <View style={styles.big}>
        <BigButton
          icon="F"
          title="J’ai vendu"
          subtitle="Enregistrer une vente"
          variant="sell"
          onPress={() => router.push({ pathname: '/pick', params: { mode: 'vente' } })}
        />
        <BigButton
          icon="+"
          title="Nouvelle marchandise"
          subtitle="Ajouter ce qui est arrivé"
          variant="in"
          onPress={() => router.push({ pathname: '/pick', params: { mode: 'entree' } })}
        />
        <BigButton
          icon="≡"
          title="Voir les restes"
          subtitle="Ce qu’il y a en boutique"
          variant="neutral"
          onPress={() => router.push('/stock')}
        />
        <BigButton
          icon="✓"
          title="Point du jour"
          subtitle="Ventes et argent de la journée"
          variant="neutral"
          onPress={() => router.push('/day')}
        />
      </View>

      <View style={[styles.gestion, { borderTopColor: colors.line }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(unlocked ? '/admin' : '/admin/pin')}
          style={[styles.gestionBtn, { borderColor: colors.line }]}
        >
          <Text style={[styles.gestionText, { color: colors.muted }]}>Gérer les articles (code)</Text>
        </Pressable>
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  hello: { paddingTop: 20, paddingBottom: 8 },
  h1: { fontSize: 34, fontWeight: '800' },
  date: { marginTop: 6, fontSize: 18 },
  today: { flexDirection: 'row', gap: 12, marginVertical: 16 },
  stat: { flex: 1, borderRadius: 16, padding: 16 },
  statLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.6 },
  statValue: { fontSize: 26, marginTop: 4 },
  big: { gap: 14 },
  gestion: {
    marginTop: 36,
    paddingTop: 18,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  gestionBtn: {
    minHeight: 56,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gestionText: { fontSize: 16 },
  chargementGate: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 120 },
});
