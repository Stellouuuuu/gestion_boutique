import { useCallback, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Header } from '../components/Header';
import { ScreenScroll } from '../components/ScreenScroll';
import { Stepper } from '../components/Stepper';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { useTheme } from '../theme/useTheme';
import { FONT_TITLE } from '../theme/typography';
import { formatFCFA } from '../lib/format';
import { getArticle } from '../db/articles';
import { cancelMouvement, recordEntree, recordVente } from '../db/mouvements';
import type { Article, Tarif } from '../db/types';
import { CAT_LABEL } from '../theme/colors';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/AuthSession';

type Mode = 'vente' | 'entree';

export default function QtyScreen() {
  const { articleId, mode: modeParam } = useLocalSearchParams<{
    articleId: string;
    mode: string;
  }>();
  const mode: Mode = modeParam === 'entree' ? 'entree' : 'vente';
  const isVente = mode === 'vente';
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { session } = useAuth();
  const creePar = session?.user?.id ?? null;

  const [article, setArticle] = useState<Article | null>(null);
  const [qte, setQte] = useState(1);
  const [tarif, setTarif] = useState<Tarif>('detail');
  const [remise, setRemise] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prixAchatInput, setPrixAchatInput] = useState('');

  const [remiseVisible, setRemiseVisible] = useState(false);
  const [remiseInput, setRemiseInput] = useState('');
  const [remiseError, setRemiseError] = useState<string | null>(null);
  const [remiseWarnPending, setRemiseWarnPending] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!articleId) return;
      let active = true;
      (async () => {
        const a = await getArticle(db, articleId);
        if (active) {
          setArticle(a);
          if (a?.prix_achat != null) setPrixAchatInput(String(a.prix_achat));
          else setPrixAchatInput('');
        }
      })();
      return () => {
        active = false;
      };
    }, [db, articleId])
  );
  if (!article) {
    return (
      <ScreenScroll>
        <Header title={isVente ? 'Vente' : 'Nouvelle marchandise'} />
      </ScreenScroll>
    );
  }

  const pu = tarif === 'gros' ? article.prix_gros : article.prix_detail;
  const normal = qte * (pu ?? 0);
  const total = remise ?? normal;
  const trop = isVente && qte > article.stock;
  const after = isVente ? article.stock - qte : article.stock + qte;
  const tagColor = article.categorie === 'meches' ? colors.mech : colors.prod;
  const tagBg = article.categorie === 'meches' ? colors.mechSoft : colors.prodSoft;

  const changeQte = (next: number) => {
    setQte(next);
    setRemise(null);
  };
  const changeTarif = (next: Tarif) => {
    setTarif(next);
    setRemise(null);
  };

  const openRemise = () => {
    setRemiseInput('');
    setRemiseError(null);
    setRemiseWarnPending(false);
    setRemiseVisible(true);
  };

  const confirmRemise = () => {
    const v = Number(remiseInput);
    if (!v || v <= 0) {
      setRemiseError('Écrivez le montant payé.');
      return;
    }
    if (v >= normal) {
      setRemiseError('Ce montant n’est pas plus petit que le prix normal.');
      return;
    }
    if (v < normal * 0.5 && !remiseWarnPending) {
      setRemiseError('Plus de la moitié de réduction : vérifiez le montant, puis validez à nouveau.');
      setRemiseWarnPending(true);
      return;
    }
    setRemise(v);
    setRemiseVisible(false);
  };

  const onValider = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (isVente) {
        const { mouvement } = await recordVente(db, {
          articleId: article.id,
          quantite: qte,
          tarif,
          montantPaye: remise,
          creePar,
        });
        router.replace({ pathname: '/pick', params: { mode } });
        showToast(`Vendu : ${qte} ${article.nom} = ${formatFCFA(mouvement.montant_paye)}`, () =>
          cancelMouvement(db, mouvement.id)
        );
      } else {
        const trimmed = prixAchatInput.trim();
        const prixAchat =
          trimmed === ''
            ? undefined
            : Number.isFinite(Number(trimmed)) && Number(trimmed) >= 0
              ? Math.round(Number(trimmed))
              : undefined;
        const { mouvement } = await recordEntree(db, {
          articleId: article.id,
          quantite: qte,
          creePar,
          ...(prixAchat !== undefined ? { prixAchat } : {}),
        });
        router.replace({ pathname: '/pick', params: { mode } });
        showToast(`Ajouté : ${qte} ${article.nom}`, () => cancelMouvement(db, mouvement.id));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenScroll>
      <Header title={isVente ? 'Vente' : 'Nouvelle marchandise'} />

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={[styles.tag, { backgroundColor: tagBg }]}>
          <Text style={[styles.tagText, { color: tagColor }]}>{CAT_LABEL[article.categorie]}</Text>
        </View>
        <Text style={[styles.name, { color: colors.ink, fontFamily: FONT_TITLE }]}>
          {article.nom}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>
          {article.prix_detail ? `${formatFCFA(article.prix_detail)} l’unité` : 'Prix à mettre'} ·
          {' '}reste actuel : {article.stock}
        </Text>

        <Stepper value={qte} onChange={changeQte} />

        {!isVente ? (
          <View style={[styles.achatBox, { backgroundColor: colors.bg }]}>
            <Text style={{ color: colors.muted, fontSize: 14, fontWeight: '700', marginBottom: 6 }}>
              Prix d’achat par pièce (facultatif)
            </Text>
            <TextInput
              value={prixAchatInput}
              onChangeText={setPrixAchatInput}
              keyboardType="numeric"
              placeholder={
                article.prix_achat != null ? String(article.prix_achat) : 'ex. 3000'
              }
              placeholderTextColor={colors.muted}
              style={[
                styles.input,
                {
                  borderColor: colors.line,
                  color: colors.ink,
                  backgroundColor: colors.card,
                  width: '100%',
                },
              ]}
            />
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
              Si vous le changez, il sera mémorisé pour les prochaines fois.
            </Text>
          </View>
        ) : null}

        {isVente && (
          <View style={[styles.tarif, { backgroundColor: colors.bg }]}>
            <View style={styles.tarifBtn}>
              <Button
                variant={tarif === 'detail' ? 'indigo-outline' : 'ghost'}
                onPress={() => changeTarif('detail')}
              >
                {`Détail\n${article.prix_detail ? formatFCFA(article.prix_detail) : '—'} / pièce`}
              </Button>
            </View>
            <View style={styles.tarifBtn}>
              <Button
                variant={tarif === 'gros' ? 'indigo-outline' : 'ghost'}
                onPress={() => changeTarif('gros')}
                disabled={!article.prix_gros}
              >
                {`En gros\n${article.prix_gros ? formatFCFA(article.prix_gros) + ' / pièce' : 'pas de prix gros'}`}
              </Button>
            </View>
          </View>
        )}

        <View style={[styles.summary, { backgroundColor: colors.bg }]}>
          {isVente ? (
            remise != null ? (
              <Text style={styles.summaryText}>
                <Text style={{ color: colors.ink }}>
                  {qte} × {formatFCFA(pu ?? 0)} ={' '}
                </Text>
                <Text style={{ color: colors.muted, textDecorationLine: 'line-through' }}>
                  {formatFCFA(normal)}
                </Text>
                <Text style={{ color: colors.ink, fontWeight: '800' }}> {formatFCFA(total)}</Text>
              </Text>
            ) : (
              <Text style={[styles.summaryText, { color: colors.ink }]}>
                {qte} × {formatFCFA(pu ?? 0)} = <Text style={{ fontWeight: '800' }}>{formatFCFA(normal)}</Text>
              </Text>
            )
          ) : (
            <Text style={[styles.summaryText, { color: colors.ink }]}>
              On ajoute <Text style={{ fontWeight: '800' }}>{qte}</Text> au stock
            </Text>
          )}
          {isVente && remise != null && (
            <View style={[styles.reduxBadge, { backgroundColor: colors.sun }]}>
              <Text style={{ color: colors.sunInk, fontWeight: '700', fontSize: 13 }}>
                Réduction de {formatFCFA(normal - total)}
              </Text>
            </View>
          )}
          <Text style={[styles.afterText, { color: colors.muted }]}>Après : il restera {after}</Text>
        </View>

        {trop && (
          <View style={[styles.alert, { backgroundColor: colors.warnSoft }]}>
            <Text style={{ color: colors.warn, fontWeight: '700' }}>
              Attention : le stock dit qu’il n’en reste que {article.stock}. Vérifiez le nombre.
            </Text>
          </View>
        )}

        {isVente &&
          (remise != null ? (
            <Text
              accessibilityRole="button"
              onPress={() => setRemise(null)}
              style={[styles.remiseLink, { color: colors.indigo }]}
            >
              Enlever la réduction
            </Text>
          ) : (
            <Text
              accessibilityRole="button"
              onPress={openRemise}
              style={[styles.remiseLink, { color: colors.indigo }]}
            >
              Faire une réduction
            </Text>
          ))}

        <View style={{ marginTop: 18 }}>
          <Button
            variant={isVente ? 'sell' : 'in'}
            big
            disabled={submitting || (isVente && pu == null)}
            loading={submitting}
            onPress={onValider}
          >
            {isVente ? 'Oui, j’ai vendu' : 'Oui, ajouter au stock'}
          </Button>
          <View style={{ marginTop: 10 }}>
            <Button variant="ghost" onPress={() => router.replace({ pathname: '/pick', params: { mode } })}>
              Non, choisir un autre article
            </Button>
          </View>
        </View>
      </View>

      <Sheet visible={remiseVisible} onRequestClose={() => setRemiseVisible(false)}>
        <Text style={[styles.title, { color: colors.ink, fontFamily: FONT_TITLE }]}>Réduction</Text>
        <Text style={{ color: colors.ink, fontSize: 16, marginBottom: 12 }}>
          Prix normal : <Text style={{ fontWeight: '800' }}>{formatFCFA(normal)}</Text>
        </Text>
        <Text style={{ color: colors.ink, fontWeight: '700', marginBottom: 6 }}>
          Combien la cliente paie au total ?
        </Text>
        <TextInput
          value={remiseInput}
          onChangeText={(t) => {
            setRemiseInput(t);
            setRemiseError(null);
            setRemiseWarnPending(false);
          }}
          keyboardType="numeric"
          placeholder={`ex. ${Math.round((normal * 0.9) / 50) * 50}`}
          placeholderTextColor={colors.muted}
          style={[styles.input, { borderColor: colors.line, color: colors.ink, backgroundColor: colors.card }]}
        />
        {remiseError && (
          <View style={[styles.alert, { backgroundColor: colors.warnSoft, marginTop: 10 }]}>
            <Text style={{ color: colors.warn, fontWeight: '700' }}>{remiseError}</Text>
          </View>
        )}
        <View style={{ gap: 10, marginTop: 18 }}>
          <Button variant="sell" onPress={confirmRemise}>
            Valider ce prix
          </Button>
          <Button variant="ghost" onPress={() => setRemiseVisible(false)}>
            Pas de réduction
          </Button>
        </View>
      </Sheet>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 20, alignItems: 'center' },
  tag: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12 },
  tagText: { fontWeight: '700', fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
  name: { fontSize: 28, marginTop: 10, textAlign: 'center' },
  sub: { fontSize: 16, marginTop: 4, textAlign: 'center' },
  tarif: { flexDirection: 'row', gap: 8, borderRadius: 16, padding: 6, marginTop: 18, width: '100%' },
  tarifBtn: { flex: 1 },
  achatBox: { width: '100%', borderRadius: 14, padding: 14, marginTop: 16 },
  summary: { width: '100%', borderRadius: 14, padding: 14, marginTop: 16, gap: 6 },
  summaryText: { fontSize: 20, textAlign: 'left' },
  afterText: { fontSize: 16 },
  reduxBadge: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  alert: { width: '100%', borderRadius: 12, padding: 12, marginTop: 12 },
  remiseLink: {
    marginTop: 10,
    fontWeight: '700',
    fontSize: 16,
    textDecorationLine: 'underline',
    paddingVertical: 18,
    minHeight: 56,
    textAlignVertical: 'center',
  },
  title: { fontSize: 24, marginBottom: 8 },
  input: { borderWidth: 2, borderRadius: 12, padding: 14, fontSize: 18, minHeight: 56 },
});
