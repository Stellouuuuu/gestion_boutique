/**
 * Vérification des lignes lues sur une feuille photo.
 * Liste compacte + panneau bas pour modifier / créer.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '../components/Header';
import { Button } from '../components/Button';
import { Stepper } from '../components/Stepper';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Sheet } from '../components/Sheet';
import { useTheme } from '../theme/useTheme';
import { FONT_TITLE } from '../theme/typography';
import { formatFCFA } from '../lib/format';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/AuthSession';
import { createArticle, getArticle, listArticlesActifs } from '../db/articles';
import { enregistrerAlias } from '../db/aliasArticles';
import {
  enregistrerLotPhoto,
  trouverLotSimilaire,
  type LigneValidee,
} from '../db/lotsPhoto';
import type { LigneLectureIa, SectionFeuille } from '../lib/feuilleTypes';
import type { Article, Categorie, Tarif } from '../db/types';

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

function dateAffichee(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export default function VerifierFeuilleScreen() {
  const params = useLocalSearchParams<{
    sections?: string;
    lignes?: string;
    dateSuggeree?: string;
    totalEcrit?: string;
    photoUri?: string;
    reponseIa?: string;
    articlePick?: string;
    ligneKey?: string;
  }>();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { session, membre } = useAuth();
  const insets = useSafeAreaInsets();

  const sectionsParam = typeof params.sections === 'string' ? params.sections : '';
  const lignesParam = typeof params.lignes === 'string' ? params.lignes : '';
  const dateSuggereeParam =
    typeof params.dateSuggeree === 'string' ? params.dateSuggeree : '';
  const totalEcritParam = typeof params.totalEcrit === 'string' ? params.totalEcrit : '';
  const reponseIaParam =
    typeof params.reponseIa === 'string' ? params.reponseIa : '';
  const photoUriParam = typeof params.photoUri === 'string' ? params.photoUri : '';
  const articlePickParam =
    typeof params.articlePick === 'string' ? params.articlePick : '';
  const ligneKeyParam = typeof params.ligneKey === 'string' ? params.ligneKey : '';

  // Dépendances en strings stables : l’objet `params` change d’identité à chaque rendu
  // (cause historique du toast « Maximum update depth exceeded »).
  const sectionsInit = useMemo(
    () =>
      parseSections({
        sections: sectionsParam,
        lignes: lignesParam,
        dateSuggeree: dateSuggereeParam,
        totalEcrit: totalEcritParam,
      }),
    [sectionsParam, lignesParam, dateSuggereeParam, totalEcritParam]
  );
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

  const [editKey, setEditKey] = useState<string | null>(null);
  const [recherche, setRecherche] = useState('');
  const [catalogue, setCatalogue] = useState<Article[]>([]);
  const [montantEdit, setMontantEdit] = useState('');

  const [creerOpen, setCreerOpen] = useState(false);
  const [creerNom, setCreerNom] = useState('');
  const [creerCat, setCreerCat] = useState<Categorie>('produits');
  const [creerPrixDetail, setCreerPrixDetail] = useState('');
  const [creerPrixGros, setCreerPrixGros] = useState('');
  const [creerStock, setCreerStock] = useState('');

  // Un seul effet pour réinitialiser + enrichir les lignes quand la section change.
  useEffect(() => {
    let active = true;
    setDateFeuille(
      section?.date_iso && /^\d{4}-\d{2}-\d{2}$/.test(section.date_iso)
        ? section.date_iso
        : aujourdhuiLocal()
    );
    setDateDoute(!!section?.date_doute);
    setTotalEcrit(section?.total_ecrit ?? null);
    setTotalForceOk(false);
    setEditKey(null);
    setLignes(initial);

    void (async () => {
      const next = initial.map((l) => ({ ...l }));
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
          next[i] = {
            ...l,
            article_nom: null,
            montant: l.montant_lu ?? 0,
            ecartMontant: false,
          };
        }
      }
      if (active) setLignes(next);
    })();

    return () => {
      active = false;
    };
    // initial est mémorisé sur sectionsParam… + sectionIdx (stables)
  }, [db, initial, section]);

  useEffect(() => {
    void listArticlesActifs(db).then(setCatalogue);
  }, [db]);

  useEffect(() => {
    const id = articlePickParam;
    const key = ligneKeyParam;
    if (!id || !key) return;
    let cancelled = false;
    void (async () => {
      const a = await getArticle(db, String(id));
      if (!a || cancelled) return;
      let texteLu: string | null = null;
      setLignes((prev) => {
        const ligne = prev.find((l) => l.key === key);
        texteLu = ligne?.texte_lu ?? null;
        const montant = ligne?.montant_lu ?? ligne?.montant ?? 0;
        const pu = a.prix_detail ?? 0;
        const ecart =
          pu > 0 && montant > 0
            ? Math.abs((ligne?.quantite ?? 1) * pu - montant) / montant > 0.2
            : false;
        return prev.map((l) =>
          l.key === key
            ? {
                ...l,
                article_id: a.id,
                article_nom: a.nom,
                confiance: 'haute' as const,
                ecartMontant: ecart,
              }
            : l
        );
      });
      if (texteLu) await enregistrerAlias(db, texteLu, a.id);
      if (!cancelled) router.setParams({ articlePick: '', ligneKey: '' });
    })();
    return () => {
      cancelled = true;
    };
  }, [articlePickParam, ligneKeyParam, db]);

  const orange = useCallback(
    (l: LigneEdit) =>
      l.confiance === 'basse' || !l.article_id || l.ecartMontant || !!l.chiffre_ambigu,
    []
  );

  const sommeLignes = lignes.reduce((s, l) => s + (l.montant || 0), 0);
  const totalMismatch =
    totalEcrit != null && totalEcrit > 0 && Math.abs(sommeLignes - totalEcrit) > 1;
  const bloqueLignes = lignes.some(orange);
  const bloqueTotal = totalMismatch && !totalForceOk;
  const nbOk = lignes.filter((l) => !orange(l)).length;

  const updateLigne = (key: string, patch: Partial<LigneEdit>) => {
    setLignes((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const editLigne = editKey ? lignes.find((l) => l.key === editKey) ?? null : null;

  const ouvrirEdit = (l: LigneEdit) => {
    setEditKey(l.key);
    setRecherche('');
    setMontantEdit(String(l.montant || ''));
    setCreerOpen(false);
  };

  const fermerEdit = () => {
    setEditKey(null);
    setCreerOpen(false);
    setRecherche('');
  };

  const choisirArticle = async (a: Article) => {
    if (!editLigne) return;
    const montant = editLigne.montant || 0;
    const pu = editLigne.tarif === 'gros' ? (a.prix_gros ?? a.prix_detail) : a.prix_detail;
    const ecart =
      pu != null && pu > 0 && montant > 0
        ? Math.abs(editLigne.quantite * pu - montant) / montant > 0.2
        : false;
    updateLigne(editLigne.key, {
      article_id: a.id,
      article_nom: a.nom,
      confiance: 'haute',
      ecartMontant: ecart,
    });
    if (editLigne.texte_lu) await enregistrerAlias(db, editLigne.texte_lu, a.id);
    fermerEdit();
  };

  const ouvrirCreer = () => {
    if (!editLigne) return;
    const pu =
      editLigne.quantite > 0 && editLigne.montant > 0
        ? Math.round(editLigne.montant / editLigne.quantite)
        : editLigne.montant || 0;
    setCreerNom(editLigne.texte_lu || '');
    setCreerCat('produits');
    setCreerPrixDetail(String(pu || ''));
    setCreerPrixGros(String(pu || ''));
    setCreerStock(String(editLigne.quantite || 1));
    setCreerOpen(true);
  };

  const validerCreer = async () => {
    if (!editLigne) return;
    const prixD = Number(creerPrixDetail) || null;
    const prixG = Number(creerPrixGros) || prixD;
    const stock = Math.max(0, Math.round(Number(creerStock) || 0));
    if (!creerNom.trim()) {
      showToast('Indiquez un nom');
      return;
    }
    if (!Number.isFinite(stock)) {
      showToast('Indiquez le stock actuel');
      return;
    }
    try {
      const a = await createArticle(db, {
        nom: creerNom.trim(),
        categorie: creerCat,
        prix_detail: prixD,
        prix_gros: prixG,
        prix_achat: null,
        stock,
      });
      const texteAlias = editLigne.texte_lu || creerNom.trim();
      if (texteAlias) await enregistrerAlias(db, texteAlias, a.id);
      updateLigne(editLigne.key, {
        article_id: a.id,
        article_nom: a.nom,
        confiance: 'haute',
        ecartMontant: false,
        texte_lu: editLigne.texte_lu || a.nom,
      });
      setCatalogue(await listArticlesActifs(db));
      setCreerOpen(false);
      fermerEdit();
      showToast('Article créé');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Création impossible');
    }
  };

  const validerEdit = () => {
    if (!editLigne) return;
    const m = Math.round(Number(montantEdit));
    if (!Number.isFinite(m) || m < 0) {
      showToast('Montant incorrect');
      return;
    }
    updateLigne(editLigne.key, {
      montant: m,
      montant_lu: m,
      prix_lu: m,
      confiance: editLigne.article_id ? 'haute' : editLigne.confiance,
      ecartMontant: false,
    });
    fermerEdit();
  };

  const supprimerLigne = () => {
    if (!editLigne) return;
    setLignes((p) => p.filter((x) => x.key !== editLigne.key));
    fermerEdit();
  };

  const ajouterLigne = () => {
    const key = `n${Date.now()}`;
    const l: LigneEdit = {
      key,
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
    };
    setLignes((p) => [...p, l]);
    ouvrirEdit(l);
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
      let reponseIa: unknown = { section, lignes: initial };
      if (reponseIaParam) {
        try {
          reponseIa = JSON.parse(reponseIaParam);
        } catch {
          reponseIa = { brut: reponseIaParam, section, lignes: initial };
        }
      }
      const lot = await enregistrerLotPhoto(db, {
        dateFeuille,
        lignes: valides,
        lectureIa: { section, lignes: initial },
        reponseIa,
        photoPath: photoUriParam || null,
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

  const q = recherche.trim().toLowerCase();
  const suggestions = catalogue
    .filter((a) => !q || a.nom.toLowerCase().includes(q))
    .slice(0, 12);

  const footerH = 150 + insets.bottom;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingBottom: footerH }]}>
      <Header title="Vérifier la feuille" onBack={() => router.back()} />

      {multi ? (
        <View style={{ paddingHorizontal: 16, marginBottom: 8, gap: 8 }}>
          <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 16 }}>
            Plusieurs jours — choisissez :
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
              <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 17 }}>
                {s.date_lue || s.date_iso || `Section ${i + 1}`}
                {s.total_ecrit != null ? ` · ${formatFCFA(s.total_ecrit)}` : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.dateRow}>
        <Text style={[styles.dateLabel, { color: colors.muted }]}>Date</Text>
        <TextInput
          value={dateFeuille}
          onChangeText={(t) => {
            setDateFeuille(t);
            setDateDoute(false);
          }}
          style={[
            styles.dateInput,
            {
              color: colors.ink,
              borderColor: dateDoute ? colors.warn : colors.line,
              backgroundColor: colors.card,
              fontFamily: FONT_TITLE,
            },
          ]}
          autoCapitalize="none"
        />
        <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700' }}>
          {dateAffichee(dateFeuille)}
        </Text>
      </View>
      {dateDoute ? (
        <Text style={{ color: colors.warn, fontWeight: '700', marginHorizontal: 16, marginBottom: 6 }}>
          Vérifiez la date.
        </Text>
      ) : null}

      <FlatList
        style={{ flex: 1 }}
        data={lignes}
        keyExtractor={(l) => l.key}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
        ListFooterComponent={
          <Pressable
            onPress={ajouterLigne}
            style={[styles.addBtn, { borderColor: colors.indigo, backgroundColor: colors.indigoSoft }]}
          >
            <Text style={{ color: colors.indigo, fontWeight: '800', fontSize: 18 }}>+ Ajouter une ligne</Text>
          </Pressable>
        }
        renderItem={({ item: l }) => {
          const isOrange = orange(l);
          const label = l.article_nom
            ? l.article_nom
            : l.texte_lu
              ? `${l.texte_lu} ?`
              : 'Article ?';
          return (
            <Pressable
              onPress={() => ouvrirEdit(l)}
              style={[styles.row, { borderBottomColor: colors.line }]}
              accessibilityRole="button"
              accessibilityLabel={`Modifier ${label}`}
            >
              <Text style={{ fontSize: 22, width: 28, color: isOrange ? colors.warn : '#1B7F3A' }}>
                {isOrange ? '●' : '✓'}
              </Text>
              <Text
                numberOfLines={2}
                style={[
                  styles.rowNom,
                  {
                    color: colors.ink,
                    fontStyle: l.article_nom ? 'normal' : 'italic',
                    fontWeight: l.article_nom ? '700' : '600',
                  },
                ]}
              >
                {label}
              </Text>
              <Text style={[styles.rowQte, { color: colors.muted }]}>×{l.quantite}</Text>
              <Text style={[styles.rowMontant, { color: colors.ink }]}>{formatFCFA(l.montant)}</Text>
            </Pressable>
          );
        }}
      />

      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.line,
            paddingBottom: 12 + insets.bottom,
          },
        ]}
      >
        <View style={styles.totaux}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 14, fontWeight: '700' }}>Total des lignes</Text>
            <Text
              style={{
                color: totalMismatch ? colors.bad : colors.ink,
                fontSize: 22,
                fontWeight: '800',
                fontFamily: FONT_TITLE,
              }}
            >
              {formatFCFA(sommeLignes)}
            </Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={{ color: colors.muted, fontSize: 14, fontWeight: '700' }}>
              Total écrit sur la feuille
            </Text>
            <Text
              style={{
                color: totalMismatch ? colors.bad : colors.ink,
                fontSize: 22,
                fontWeight: '800',
                fontFamily: FONT_TITLE,
              }}
            >
              {totalEcrit != null ? formatFCFA(totalEcrit) : '—'}
            </Text>
          </View>
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
              : `Enregistrer (${nbOk})`}
        </Button>
      </View>

      <Sheet visible={!!editLigne && !creerOpen} onRequestClose={fermerEdit}>
        {editLigne ? (
          <View style={{ gap: 12, maxHeight: '85%' }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink, fontFamily: FONT_TITLE }}>
              Modifier la ligne
            </Text>
            {editLigne.texte_lu ? (
              <Text style={{ color: colors.muted, fontSize: 16 }}>
                Lu sur la feuille : « {editLigne.texte_lu} »
              </Text>
            ) : null}

            <Text style={styles.fieldLabel}>Article</Text>
            <TextInput
              value={recherche}
              onChangeText={setRecherche}
              placeholder="Tapez quelques lettres…"
              placeholderTextColor={colors.muted}
              style={[styles.field, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.bg }]}
            />
            <View style={{ maxHeight: 160 }}>
              {suggestions.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => void choisirArticle(a)}
                  style={[styles.suggest, { borderBottomColor: colors.line }]}
                >
                  <Text style={{ color: colors.ink, fontSize: 17, fontWeight: '700' }}>{a.nom}</Text>
                </Pressable>
              ))}
            </View>
            <Button variant="indigo-outline" onPress={ouvrirCreer}>
              Créer un nouvel article
            </Button>

            <Text style={styles.fieldLabel}>Quantité</Text>
            <Stepper
              value={editLigne.quantite}
              onChange={(qte) =>
                updateLigne(editLigne.key, { quantite: qte, confiance: 'haute', ecartMontant: false })
              }
              min={1}
            />

            <Text style={styles.fieldLabel}>Tarif</Text>
            <View style={styles.tarifRow}>
              {(['detail', 'gros'] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => updateLigne(editLigne.key, { tarif: t })}
                  style={[
                    styles.tarifBtn,
                    {
                      backgroundColor: editLigne.tarif === t ? colors.indigo : colors.bg,
                      borderColor: colors.line,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: editLigne.tarif === t ? colors.onSolid : colors.ink,
                      fontWeight: '800',
                      fontSize: 17,
                    }}
                  >
                    {t === 'detail' ? 'Détail' : 'Gros'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Montant (F)</Text>
            <TextInput
              value={montantEdit}
              onChangeText={setMontantEdit}
              keyboardType="number-pad"
              style={[styles.field, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.bg }]}
            />

            <Button variant="sell" onPress={validerEdit}>
              Valider
            </Button>
            <Button variant="ghost" onPress={supprimerLigne}>
              Supprimer cette ligne
            </Button>
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={creerOpen} onRequestClose={() => setCreerOpen(false)}>
        <View style={{ gap: 12 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink, fontFamily: FONT_TITLE }}>
            Nouvel article
          </Text>
          <Text style={styles.fieldLabel}>Nom</Text>
          <TextInput
            value={creerNom}
            onChangeText={setCreerNom}
            style={[styles.field, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.bg }]}
          />
          <Text style={styles.fieldLabel}>Catégorie</Text>
          <View style={styles.tarifRow}>
            {(
              [
                ['produits', 'Produits'],
                ['meches', 'Mèches'],
              ] as const
            ).map(([id, lab]) => (
              <Pressable
                key={id}
                onPress={() => setCreerCat(id)}
                style={[
                  styles.tarifBtn,
                  {
                    backgroundColor: creerCat === id ? colors.indigo : colors.bg,
                    borderColor: colors.line,
                  },
                ]}
              >
                <Text
                  style={{
                    color: creerCat === id ? colors.onSolid : colors.ink,
                    fontWeight: '800',
                    fontSize: 17,
                  }}
                >
                  {lab}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.fieldLabel}>Prix détail</Text>
          <TextInput
            value={creerPrixDetail}
            onChangeText={setCreerPrixDetail}
            keyboardType="number-pad"
            style={[styles.field, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.bg }]}
          />
          <Text style={styles.fieldLabel}>Prix gros</Text>
          <TextInput
            value={creerPrixGros}
            onChangeText={setCreerPrixGros}
            keyboardType="number-pad"
            style={[styles.field, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.bg }]}
          />
          <Text style={styles.fieldLabel}>Stock actuel en boutique</Text>
          <TextInput
            value={creerStock}
            onChangeText={setCreerStock}
            keyboardType="number-pad"
            style={[styles.field, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.bg }]}
          />
          <Button variant="sell" onPress={() => void validerCreer()}>
            Créer et utiliser
          </Button>
          <Button variant="ghost" onPress={() => setCreerOpen(false)}>
            Annuler
          </Button>
        </View>
      </Sheet>

      <ConfirmDialog
        visible={confirm}
        title="Enregistrer le lot ?"
        description={`${nbOk} ventes · ${formatFCFA(sommeLignes)}`}
        safeLabel="Pas encore"
        onSafe={() => setConfirm(false)}
        dangerLabel="Oui, enregistrer"
        onConfirmDanger={() => void enregistrer()}
      />
      <ConfirmDialog
        visible={warnTotal}
        title="Totaux différents"
        description={`Lignes ${formatFCFA(sommeLignes)} · Écrit ${formatFCFA(totalEcrit ?? 0)}`}
        safeLabel="Corriger"
        onSafe={() => setWarnTotal(false)}
        dangerLabel="Enregistrer quand même"
        onConfirmDanger={() => {
          setTotalForceOk(true);
          setWarnTotal(false);
          setConfirm(true);
        }}
      />
      <ConfirmDialog
        visible={warnDouble}
        title="Lot semblable déjà enregistré"
        description="Un lot proche existe déjà pour cette date."
        safeLabel="Annuler"
        onSafe={() => setWarnDouble(false)}
        dangerLabel="Enregistrer quand même"
        onConfirmDanger={() => {
          setWarnDouble(false);
          setConfirm(true);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  dateLabel: { fontWeight: '700', fontSize: 16 },
  dateInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 18,
    minWidth: 130,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowNom: { flex: 1, fontSize: 18, lineHeight: 24 },
  rowQte: { fontSize: 17, fontWeight: '700', minWidth: 36, textAlign: 'right' },
  rowMontant: { fontSize: 17, fontWeight: '800', minWidth: 88, textAlign: 'right' },
  addBtn: {
    marginTop: 12,
    borderWidth: 2,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  totaux: { flexDirection: 'row', gap: 12 },
  sectionBtn: { borderWidth: 2, borderRadius: 14, padding: 14 },
  fieldLabel: { fontWeight: '800', fontSize: 16 },
  field: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
  },
  suggest: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  tarifRow: { flexDirection: 'row', gap: 10 },
  tarifBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
});
