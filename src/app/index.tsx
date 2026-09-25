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
import { getInventaireEnCours } from '../db/inventaires';
import { telechargerBoutiqueSiVide } from '../db/remote';
import { getSetting, SETTINGS_KEYS, type CatalogueInitial } from '../db/settings';
import { useAdminSession } from '../lib/AdminSession';
import { useAuth } from '../lib/AuthSession';
import { useSync } from '../lib/SyncSession';

export default function HomeScreen() {
  const { colors } = useTheme();
  const db = useSQLiteContext();
  const { unlocked } = useAdminSession();
  const { loading: authLoading, isLocallyAuthenticated, membre } = useAuth();
  const { indicateur, refreshIndicateur } = useSync();
  const [totalJour, setTotalJour] = useState(0);
  const [finis, setFinis] = useState(0);
  const [inventaireEnCours, setInventaireEnCours] = useState(false);
  const [pinReady, setPinReady] = useState<boolean | null>(null);
  /** boutiqueId pour laquelle le téléchargement initial (si vide) est terminé. */
  const [articlesReadyFor, setArticlesReadyFor] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!isLocallyAuthenticated) {
        setPinReady(null);
        return;
      }
      // La vendeuse n'a pas besoin du PIN (réservé à Gérer).
      if (membre?.role === 'vendeuse') {
        setPinReady(true);
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
    }, [db, isLocallyAuthenticated, membre?.role])
  );

  useEffect(() => {
    if (authLoading) return;
    if (!isLocallyAuthenticated) {
      router.replace('/connexion');
      return;
    }
    // PIN uniquement pour la propriétaire
    if (membre?.role !== 'vendeuse' && pinReady === false) {
      router.replace('/bienvenue');
    }
  }, [authLoading, isLocallyAuthenticated, pinReady, membre?.role]);

  // Après une mise à jour de schéma (tables vidées), retélécharge si la boutique est vide.
  useEffect(() => {
    if (!isLocallyAuthenticated || !membre || pinReady !== true) return;
    const boutiqueId = membre.boutiqueId;
    let active = true;
    (async () => {
      try {
        const n = await countArticles(db, boutiqueId);
        if (n === 0) {
          const cat = (await getSetting(db, SETTINGS_KEYS.catalogueInitial)) as CatalogueInitial | null;
          await telechargerBoutiqueSiVide(db, boutiqueId, cat === 'vide' ? 'vide' : 'type');
        }
      } catch {
        // Hors ligne : on laisse l'écran s'afficher ; les ventes locales déjà là restent.
      }
      if (active) setArticlesReadyFor(boutiqueId);
    })();
    return () => {
      active = false;
    };
  }, [db, isLocallyAuthenticated, membre, pinReady]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [totaux, nbFinis, inv] = await Promise.all([
          totalVentesDuJour(db),
          countArticlesFinis(db),
          membre?.role === 'proprietaire' ? getInventaireEnCours(db) : Promise.resolve(null),
        ]);
        if (active) {
          setTotalJour(totaux.total);
          setFinis(nbFinis);
          setInventaireEnCours(!!inv);
        }
        await refreshIndicateur();
      })();
      return () => {
        active = false;
      };
    }, [db, refreshIndicateur, membre?.role])
  );

  const articlesReady = !!membre && articlesReadyFor === membre.boutiqueId;
  const pret = !authLoading && isLocallyAuthenticated && pinReady === true && articlesReady;
  if (!pret) {
    return (
      <ScreenScroll>
        <View style={styles.chargementGate}>
          <ActivityIndicator size="large" color={colors.indigo} />
        </View>
      </ScreenScroll>
    );
  }

  const indicateurColor =
    indicateur.kind === 'ok'
      ? colors.ok
      : indicateur.kind === 'stale' || indicateur.kind === 'error'
        ? colors.warn
        : colors.muted;

  return (
    <ScreenScroll>
      <View style={styles.hello}>
        <Text style={[styles.h1, { color: colors.ink, fontFamily: FONT_TITLE }]}>
          Bonjour {membre?.nom ?? 'Maman'}
        </Text>
        {membre?.boutiqueNom ? (
          <Text style={[styles.boutique, { color: colors.muted }]}>{membre.boutiqueNom}</Text>
        ) : null}
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

      <Text
        accessibilityRole="text"
        style={[styles.syncHint, { color: indicateurColor }]}
      >
        {indicateur.label}
      </Text>

      {membre?.role === 'proprietaire' && inventaireEnCours ? (
        <Pressable
          onPress={() => router.push('/bilans/inventaires')}
          style={[styles.invBanner, { backgroundColor: colors.warnSoft }]}
        >
          <Text style={{ color: colors.warn, fontWeight: '700', textAlign: 'center' }}>
            Inventaire en cours : reprendre
          </Text>
        </Pressable>
      ) : null}

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
        {membre?.role === 'proprietaire' ? (
          <BigButton
            icon="≡"
            title="Mes bilans"
            subtitle="Semaine, mois, bénéfice"
            variant="neutral"
            onPress={() => router.push('/bilans')}
          />
        ) : null}
      </View>

      {membre?.role === 'proprietaire' ? (
        <View style={[styles.gestion, { borderTopColor: colors.line }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(unlocked ? '/admin' : '/admin/pin')}
            style={[styles.gestionBtn, { borderColor: colors.line }]}
          >
            <Text style={[styles.gestionText, { color: colors.muted }]}>Gérer les articles (code)</Text>
          </Pressable>
        </View>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  hello: { paddingTop: 20, paddingBottom: 8 },
  h1: { fontSize: 34, fontWeight: '800' },
  boutique: { marginTop: 4, fontSize: 15 },
  date: { marginTop: 6, fontSize: 18 },
  today: { flexDirection: 'row', gap: 12, marginVertical: 16 },
  stat: { flex: 1, borderRadius: 16, padding: 16 },
  statLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.6 },
  statValue: { fontSize: 26, marginTop: 4 },
  syncHint: {
    fontSize: 14,
    marginBottom: 14,
    marginTop: -4,
    textAlign: 'center',
  },
  invBanner: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
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
