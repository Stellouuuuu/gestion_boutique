/**
 * Vérification des lignes lues sur une feuille photo.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Header } from '../components/Header';
import { ScreenScroll } from '../components/ScreenScroll';
import { Button } from '../components/Button';
import { Stepper } from '../components/Stepper';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Sheet } from '../components/Sheet';
import { useTheme } from '../theme/useTheme';
import { FONT_TITLE } from '../theme/typography';
import { formatFCFA } from '../lib/format';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/AuthSession';
import { createArticle, getArticle } from '../db/articles';
import { enregistrerAlias } from '../db/aliasArticles';
import {
  enregistrerLotPhoto,
  trouverLotSimilaire,
  type LigneValidee,
} from '../db/lotsPhoto';
import type { LigneLectureIa, SectionFeuille } from '../lib/feuilleTypes';
import type { Categorie, Tarif } from '../db/types';

type LigneEdit = LigneLectureIa & {
  key: string;
  montant: number;
  ecartMontant: boolean;
};

function aujourdhuiLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function midiIso(dateFeuille: string): string {
  return `${dateFeuille}T12:00:00.000Z`;
}

function parseSections(params: {
  sections?: string;
  lignes?: string;
  dateSuggeree?: string;
  totalEcrit?: string;
}): SectionFeuille[] {
  try {
    if (params.sections) {
      const s = JSON.parse(String(params.sections)) as SectionFeuille[];
      if (Array.isArray(s) && s.length) return s;
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = JSON.parse(String(params.lignes || '[]')) as LigneLectureIa[];
    return [
      {
        date_lue: null,
        date_iso:
          params.dateSuggeree && /^\d{4}-\d{2}-\d{2}$/.test(params.dateSuggeree)
            ? params.dateSuggeree
            : null,
        date_doute: false,
        total_ecrit: params.totalEcrit ? Number(params.totalEcrit) : null,
        lignes: raw,
      },
    ];
  } catch {
    return [];
  }
}

export default function VerifierFeuilleScreen() {
  const params = useLocalSearchParams<{
    sections?: string;
    lignes?: string;
    dateSuggeree?: string;
    totalEcrit?: string;
    photoUri?: string;
    articlePick?: string;
    ligneKey?: string;
  }>();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { session, membre } = useAuth();

  const sectionsInit = useMemo(() => parseSections(params), [params]);
  const multi = sectionsInit.length > 1;
  const [sectionIdx, setSectionIdx] = useState(0);
  const section = sectionsInit[Math.min(sectionIdx, sectionsInit.length - 1)];

  const initial: LigneEdit[] = useMemo(() => {
    const raw = section?.lignes || [];
    return raw.map((l, i) => {
      const montant = l.montant_lu ?? l.prix_lu ?? 0;
      return {
        ...l,
        key: `s${sectionIdx}-l${i}`,
        tarif: l.tarif === 'gros' ? 'gros' : 'detail',
        montant,
        article_nom: l.article_nom ?? null,
        ecartMontant: false,
      };
    });
  }, [section, sectionIdx]);

  const [lignes, setLignes] = useState<LigneEdit[]>(initial);
  const [dateFeuille, setDateFeuille] = useState(
    section?.date_iso && /^\d{4}-\d{2}-\d{2}$/.test(section.date_iso)
      ? section.date_iso
      : aujourdhuiLocal()
  );
  const [dateDoute, setDateDoute] = useState(!!section?.date_doute);
  const [totalEcrit, setTotalEcrit] = useState<number | null>(section?.total_ecrit ?? null);
  const [totalForceOk, setTotalForceOk] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [warnDouble, setWarnDouble] = useState(false);
  const [warnTotal, setWarnTotal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creerOpen, setCreerOpen] = useState<LigneEdit | null>(null);
  const [creerNom, setCreerNom] = useState('');
  const [creerCat, setCreerCat] = useState<Categorie>('produits');
  const [creerPrix, setCreerPrix] = useState('');

  // Changer de section → recharger
  useEffect(() => {
    setLignes(initial);
    setDateFeuille(
      section?.date_iso && /^\d{4}-\d{2}-\d{2}$/.test(section.date_iso)
        ? section.date_iso
        : aujourdhuiLocal()
    );
    setDateDoute(!!section?.date_doute);
    setTotalEcrit(section?.total_ecrit ?? null);
    setTotalForceOk(false);
  }, [initial, section]);

  // Retour pick article
  useEffect(() => {
    const id = params.articlePick;
    const key = params.ligneKey;
    if (!id || !key) return;
    void (async () => {
      const a = await getArticle(db, String(id));
      if (!a) return;
      const ligne = lignes.find((l) => l.key === key);
      const montant = ligne?.montant_lu ?? ligne?.montant ?? 0;
      const pu = a.prix_detail ?? 0;
      const ecart =
        pu > 0 && montant > 0 ? Math.abs((ligne?.quantite ?? 1) * pu - montant) / montant > 0.2 : false;
      setLignes((prev) =>
        prev.map((l) =>
          l.key === key
            ? {
                ...l,
                article_id: a.id,
                article_nom: a.nom,
                confiance: 'haute' as const,
                ecartMontant: ecart,
                quantite_suggeree: ecart
                  ? Math.max(1, Math.round(montant / pu))
                  : l.quantite_suggeree,
              }
            : l
        )
      );
      if (ligne?.texte_lu) await enregistrerAlias(db, ligne.texte_lu, a.id);
      router.setParams({ articlePick: undefined, ligneKey: undefined });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.articlePick, params.ligneKey, db]);

  useEffect(() => {
    let active = true;
    (async () => {
      const next = [...initial];
      for (let i = 0; i < next.length; i++) {
        const l = next[i]!;
        if (l.article_id) {
          const a = await getArticle(db, l.article_id);
          if (a) {
            const pu = l.tarif === 'gros' ? (a.prix_gros ?? a.prix_detail) : a.prix_detail;
            const montant = l.montant_lu ?? l.prix_lu ?? 0;
            const ecart =
              pu != null && pu > 0 && montant > 0
                ? Math.abs(l.quantite * pu - montant) / montant > 0.2
                : false;
            next[i] = {
              ...l,
              article_nom: a.nom,
              montant,
              ecartMontant: ecart || !!l.quantite_suggeree,
            };
          }
        } else {
          next[i] = { ...l, article_nom: null, montant: l.montant_lu ?? 0, ecartMontant: false };
        }
      }
      if (active) setLignes(next);
    })();
    return () => {
      active = false;
    };
  }, [db, initial]);

  const orange = (l: LigneEdit) =>
    l.confiance === 'basse' || !l.article_id || l.ecartMontant || !!l.chiffre_ambigu;

  const sommeLignes = lignes.reduce((s, l) => s + (l.montant || 0), 0);
  const totalMismatch =
    totalEcrit != null && totalEcrit > 0 && Math.abs(sommeLignes - totalEcrit) > 1;
  const bloqueLignes = lignes.some(orange);
  const bloqueTotal = totalMismatch && !totalForceOk;
  const bloque = bloqueLignes || bloqueTotal;
  const nbOk = lignes.filter((l) => !orange(l)).length;

  const updateLigne = (key: string, patch: Partial<LigneEdit>) => {
    setLignes((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const appliquerQteSuggeree = (l: LigneEdit) => {
    if (l.quantite_suggeree == null) return;
    updateLigne(l.key, {
      quantite: l.quantite_suggeree,
      confiance: 'haute',
      ecartMontant: false,
      quantite_suggeree: null,
    });
  };

  const ouvrirCreer = (l: LigneEdit) => {
    setCreerNom(l.texte_lu || '');
    setCreerCat('produits');
    const pu =
      l.quantite > 0 && l.montant > 0 ? Math.round(l.montant / l.quantite) : l.montant || 0;
    setCreerPrix(String(pu || ''));
    setCreerOpen(l);
  };

  const validerCreer = async () => {
    if (!creerOpen) return;
    const prix = Number(creerPrix) || null;
    try {
      const a = await createArticle(db, {
        nom: creerNom.trim() || creerOpen.texte_lu || 'Nouvel article',
        categorie: creerCat,
        prix_detail: prix,
        prix_gros: null,
        prix_achat: null,
        stock: 0,
      });
      if (creerOpen.texte_lu) await enregistrerAlias(db, creerOpen.texte_lu, a.id);
      updateLigne(creerOpen.key, {
        article_id: a.id,
        article_nom: a.nom,
        confiance: 'haute',
        ecartMontant: false,
      });
      setCreerOpen(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Création impossible');
    }
  };

  const lignesValides = (): LigneValidee[] =>
    lignes
      .filter((l) => l.article_id && !orange(l))
      .map((l) => ({
        article_id: l.article_id!,
        quantite: l.quantite,
        tarif: (l.tarif === 'gros' ? 'gros' : 'detail') as Tarif,
        montant_paye: l.montant,
      }));

  const tenterEnregistrement = async () => {
    if (bloqueLignes || saving) return;
    if (bloqueTotal) {
      setWarnTotal(true);
      return;
    }
    const valides = lignesValides();
    if (!valides.length) return;
    const bid = membre?.boutiqueId;
    if (!bid) return;
    const sim = await trouverLotSimilaire(db, bid, dateFeuille, valides);
    if (sim) {
      setWarnDouble(true);
      return;
    }
    setConfirm(true);
  };

  const enregistrer = async () => {
    setSaving(true);
    try {
      const valides = lignesValides();
      for (const l of lignes) {
        if (l.article_id && l.texte_lu) await enregistrerAlias(db, l.texte_lu, l.article_id);
      }
      const lot = await enregistrerLotPhoto(db, {
        dateFeuille,
        lignes: valides,
        lectureIa: { section, lignes: initial },
        photoPath: params.photoUri ? String(params.photoUri) : null,
        creePar: session?.user?.id ?? null,
        creeLeVentes: midiIso(dateFeuille),
      });
      setConfirm(false);
      setWarnDouble(false);
      showToast(`${lot.nb_lignes} ventes enregistrées · ${formatFCFA(lot.total)}`, async () => {
        const { annulerLotPhoto } = await import('../db/lotsPhoto');
        await annulerLotPhoto(db, lot.id);
      });
      router.replace('/day');
    } catch (e) {
      setConfirm(false);
      showToast(e instanceof Error ? e.message : 'Échec enregistrement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenScroll>
      <Header title="Vérifier la feuille" onBack={() => router.back()} />

      {multi ? (
        <View style={{ marginBottom: 12, gap: 8 }}>
          <Text style={{ color: colors.muted, fontWeight: '700' }}>
            Plusieurs jours sur la photo — choisissez la section :
          </Text>
          {sectionsInit.map((s, i) => (
            <Pressable
              key={i}
              onPress={() => setSectionIdx(i)}
              style={[
                styles.sectionBtn,
                {
                  borderColor: i === sectionIdx ? colors.indigo : colors.line,
                  backgroundColor: i === sectionIdx ? colors.indigoSoft : colors.card,
                },
              ]}
            >
              <Text style={{ color: colors.ink, fontWeight: '800' }}>
                {s.date_lue || s.date_iso || `Section ${i + 1}`}
                {s.total_ecrit != null ? ` · Total ${formatFCFA(s.total_ecrit)}` : ''}
                {` · ${s.lignes?.length ?? 0} lignes`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text style={[styles.label, { color: colors.muted }]}>Date de la feuille (AAAA-MM-JJ)</Text>
      <TextInput
        value={dateFeuille}
        onChangeText={(t) => {
          setDateFeuille(t);
          setDateDoute(false);
        }}
        style={[
          styles.input,
          {
            color: colors.ink,
            borderColor: dateDoute ? colors.warn : colors.line,
            backgroundColor: dateDoute ? colors.warnSoft : colors.card,
          },
        ]}
        autoCapitalize="none"
      />
      {dateDoute ? (
        <Text style={{ color: colors.warn, fontWeight: '700', marginBottom: 8 }}>
          Date ajustée (éloignée ou future) — vérifiez-la.
        </Text>
      ) : null}

      {lignes.map((l) => {
        const isOrange = orange(l);
        return (
          <View
            key={l.key}
            style={[
              styles.card,
              {
                backgroundColor: isOrange ? colors.warnSoft : colors.card,
                borderColor: isOrange ? colors.warn : colors.line,
              },
            ]}
          >
            {isOrange ? (
              <Text style={{ color: colors.warn, fontWeight: '800', marginBottom: 6 }}>À vérifier</Text>
            ) : null}
            <Text style={{ color: colors.muted, fontSize: 14 }}>Lu : {l.texte_lu || '—'}</Text>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/pick',
                  params: {
                    mode: 'vente',
                    retourFeuille: '1',
                    ligneKey: l.key,
                    sections: params.sections,
                    lignes: params.lignes,
                    dateSuggeree: dateFeuille,
                    totalEcrit: totalEcrit != null ? String(totalEcrit) : '',
                    photoUri: params.photoUri,
                  },
                })
              }
            >
              <Text style={[styles.articleNom, { color: colors.ink, fontFamily: FONT_TITLE }]}>
                {l.article_nom || (l.article_id ? 'Article' : 'Article non trouvé')}
              </Text>
            </Pressable>
            {!l.article_id ? (
              <Pressable onPress={() => ouvrirCreer(l)}>
                <Text style={{ color: colors.indigo, fontWeight: '800', marginBottom: 8 }}>
                  Créer cet article
                </Text>
              </Pressable>
            ) : null}
            <Stepper
              value={l.quantite}
              onChange={(q) => updateLigne(l.key, { quantite: q, confiance: 'haute', ecartMontant: false })}
              min={1}
            />
            {l.quantite_suggeree != null && l.quantite_suggeree !== l.quantite ? (
              <Pressable onPress={() => appliquerQteSuggeree(l)}>
                <Text style={{ color: colors.warn, fontWeight: '700', marginTop: 6 }}>
                  Quantité proposée pour le montant : {l.quantite_suggeree} — appuyer pour appliquer
                </Text>
              </Pressable>
            ) : null}
            <View style={styles.tarifRow}>
              {(['detail', 'gros'] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => updateLigne(l.key, { tarif: t })}
                  style={[
                    styles.tarifBtn,
                    {
                      backgroundColor: l.tarif === t ? colors.indigo : colors.bg,
                      borderColor: colors.line,
                    },
                  ]}
                >
                  <Text style={{ color: l.tarif === t ? colors.onSolid : colors.ink, fontWeight: '700' }}>
                    {t === 'detail' ? 'Détail' : 'Gros'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.montant, { color: colors.ink }]}>
              Montant : {formatFCFA(l.montant)}
            </Text>
            <Pressable onPress={() => setLignes((p) => p.filter((x) => x.key !== l.key))}>
              <Text style={{ color: colors.bad, fontWeight: '700', marginTop: 8 }}>
                Supprimer cette ligne
              </Text>
            </Pressable>
          </View>
        );
      })}

      <Button
        variant="ghost"
        onPress={() =>
          setLignes((p) => [
            ...p,
            {
              key: `n${Date.now()}`,
              texte_lu: '',
              article_id: null,
              article_nom: null,
              quantite: 1,
              tarif: 'detail',
              montant_lu: 0,
              prix_lu: 0,
              confiance: 'basse',
              montant: 0,
              ecartMontant: false,
            },
          ])
        }
      >
        Ajouter une ligne oubliée
      </Button>

      <View style={[styles.total, { backgroundColor: colors.indigo }]}>
        <Text style={{ color: colors.onSolid, fontSize: 16 }}>
          Somme des lignes : {formatFCFA(sommeLignes)}
        </Text>
        <Text style={{ color: colors.onSolid, fontSize: 16, marginTop: 4 }}>
          Total écrit : {totalEcrit != null ? formatFCFA(totalEcrit) : '—'}
        </Text>
        {totalMismatch ? (
          <Text style={{ color: colors.warnSoft, fontWeight: '800', marginTop: 8 }}>
            Les totaux ne correspondent pas
          </Text>
        ) : null}
      </View>

      <Button
        variant="sell"
        disabled={bloqueLignes || nbOk === 0 || saving}
        loading={saving}
        onPress={() => void tenterEnregistrement()}
      >
        {bloqueLignes
          ? 'Corrigez les lignes orange'
          : bloqueTotal
            ? 'Vérifier le total'
            : `Enregistrer ces ${nbOk} ventes`}
      </Button>

      <ConfirmDialog
        visible={warnTotal}
        title="Totaux différents"
        description={`Somme des lignes ${formatFCFA(sommeLignes)} · Total écrit ${formatFCFA(totalEcrit ?? 0)}. Corrigez les montants, ou confirmez quand même.`}
        safeLabel="Corriger"
        onSafe={() => setWarnTotal(false)}
        dangerLabel="Enregistrer quand même"
        onConfirmDanger={() => {
          setWarnTotal(false);
          setTotalForceOk(true);
          setConfirm(true);
        }}
      />
      <ConfirmDialog
        visible={warnDouble}
        title="Cette feuille semble déjà enregistrée"
        description="Un lot avec les mêmes articles, quantités et montants existe déjà pour cette date."
        safeLabel="Non, ne pas enregistrer"
        onSafe={() => setWarnDouble(false)}
        dangerLabel="Enregistrer quand même"
        onConfirmDanger={() => {
          setWarnDouble(false);
          setConfirm(true);
        }}
      />
      <ConfirmDialog
        visible={confirm}
        title="Enregistrer le lot ?"
        description={`${nbOk} ventes · ${formatFCFA(sommeLignes)}`}
        safeLabel="Non, revenir"
        onSafe={() => setConfirm(false)}
        dangerLabel="Oui, enregistrer"
        onConfirmDanger={() => void enregistrer()}
      />

      <Sheet visible={creerOpen != null} onRequestClose={() => setCreerOpen(null)}>
        <Text style={[styles.articleNom, { color: colors.ink, fontFamily: FONT_TITLE }]}>
          Créer cet article
        </Text>
        <Text style={[styles.label, { color: colors.muted }]}>Nom</Text>
        <TextInput
          value={creerNom}
          onChangeText={setCreerNom}
          style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.card }]}
        />
        <View style={styles.tarifRow}>
          {(['produits', 'meches'] as const).map((c) => (
            <Pressable
              key={c}
              onPress={() => setCreerCat(c)}
              style={[
                styles.tarifBtn,
                {
                  backgroundColor: creerCat === c ? colors.indigo : colors.bg,
                  borderColor: colors.line,
                },
              ]}
            >
              <Text style={{ color: creerCat === c ? colors.onSolid : colors.ink, fontWeight: '700' }}>
                {c === 'produits' ? 'Produits' : 'Mèches'}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.label, { color: colors.muted }]}>Prix détail (FCFA)</Text>
        <TextInput
          value={creerPrix}
          onChangeText={setCreerPrix}
          keyboardType="number-pad"
          style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.card }]}
        />
        <Button variant="sell" onPress={() => void validerCreer()}>
          Créer et associer
        </Button>
      </Sheet>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '700', marginTop: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    marginBottom: 12,
  },
  card: {
    borderWidth: 2,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  articleNom: { fontSize: 22, fontWeight: '800', marginVertical: 8 },
  tarifRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  tarifBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  montant: { fontSize: 20, fontWeight: '800', marginTop: 10 },
  total: {
    borderRadius: 16,
    padding: 16,
    marginVertical: 16,
    alignItems: 'center',
  },
  sectionBtn: {
    borderWidth: 2,
    borderRadius: 12,
    padding: 12,
  },
});
