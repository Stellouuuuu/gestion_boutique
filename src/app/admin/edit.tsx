import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Header } from '../../components/Header';
import { ScreenScroll } from '../../components/ScreenScroll';
import { CategoryTabs } from '../../components/CategoryTabs';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { RequireUnlocked } from '../../components/RequireUnlocked';
import { useTheme } from '../../theme/useTheme';
import { useToast } from '../../components/Toast';
import {
  createArticle,
  DuplicateArticleError,
  getArticle,
  softDeleteArticle,
  updateArticleFields,
} from '../../db/articles';
import { recordCorrection } from '../../db/mouvements';
import type { Article, Categorie } from '../../db/types';
import { useAuth } from '../../lib/AuthSession';
export default function EditScreen() {
  return (
    <RequireUnlocked>
      <EditForm />
    </RequireUnlocked>
  );
}

function EditForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { session } = useAuth();
  const creePar = session?.user?.id ?? null;
  const [loaded, setLoaded] = useState(isNew);
  const [existing, setExisting] = useState<Article | null>(null);
  const [nom, setNom] = useState('');
  const [categorie, setCategorie] = useState<Categorie>('meches');
  const [prixDetail, setPrixDetail] = useState('');
  const [prixGros, setPrixGros] = useState('');
  const [prixAchat, setPrixAchat] = useState('');
  const [stock, setStock] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const a = await getArticle(db, String(id));
      if (a) {
        setExisting(a);
        setNom(a.nom);
        setCategorie(a.categorie);
        setPrixDetail(a.prix_detail != null ? String(a.prix_detail) : '');
        setPrixGros(a.prix_gros != null ? String(a.prix_gros) : '');
        setPrixAchat(a.prix_achat != null ? String(a.prix_achat) : '');
        setStock(String(a.stock));
      }
      setLoaded(true);
    })();
  }, [db, id, isNew]);

  const onSave = async () => {
    const nomTrim = nom.trim();
    if (!nomTrim) {
      setError('Écrivez un nom.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const prix_detail = prixDetail.trim() ? Number(prixDetail) : null;
      const prix_gros = prixGros.trim() ? Number(prixGros) : null;
      const prix_achat = prixAchat.trim() ? Number(prixAchat) : null;
      // Le stock peut être négatif (une vente peut dépasser le stock affiché, §4) :
      // on ne le force pas à 0 ici, pour ne pas créer une correction non voulue.
      const stockNum = Math.round(Number(stock) || 0);

      if (isNew) {
        await createArticle(db, {
          nom: nomTrim,
          categorie,
          prix_detail,
          prix_gros,
          prix_achat,
          stock: stockNum,
        });
      } else if (existing) {
        await updateArticleFields(db, existing.id, {
          nom: nomTrim,
          categorie,
          prix_detail,
          prix_gros,
          prix_achat,
        });
        if (stockNum !== existing.stock) {
          await recordCorrection(db, existing.id, stockNum, creePar);
        }
      }
      router.replace('/admin');
      showToast(`${nomTrim} enregistré`);
    } catch (e) {
      if (e instanceof DuplicateArticleError) {
        setError(e.message);
      } else {
        setError('Erreur : impossible d’enregistrer.');
      }
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!existing) return;
    await softDeleteArticle(db, existing.id);
    setConfirmDelete(false);
    router.replace('/admin');
    showToast(`${existing.nom} supprimé`);
  };

  if (!loaded) {
    return (
      <ScreenScroll>
        <Header title={isNew ? 'Nouvel article' : 'Modifier'} onBack={() => router.replace('/admin')} />
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll>
      <Header title={isNew ? 'Nouvel article' : 'Modifier'} onBack={() => router.replace('/admin')} />

      <View style={[styles.form, { backgroundColor: colors.card }]}>
        <Field label="Nom de l’article">
          <TextInput
            value={nom}
            onChangeText={setNom}
            style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
            placeholder="Nom"
            placeholderTextColor={colors.muted}
          />
        </Field>

        <Field label="Catégorie">
          <CategoryTabs value={categorie} onChange={setCategorie} />
        </Field>

        <Field label="Prix au détail, par pièce (F)">
          <TextInput
            value={prixDetail}
            onChangeText={setPrixDetail}
            keyboardType="numeric"
            style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
            placeholder="Laisser vide si inconnu"
            placeholderTextColor={colors.muted}
          />
        </Field>

        <Field label="Prix en gros, par pièce (F)">
          <TextInput
            value={prixGros}
            onChangeText={setPrixGros}
            keyboardType="numeric"
            style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
            placeholder="Laisser vide si pas de gros"
            placeholderTextColor={colors.muted}
          />
        </Field>

        <Field label="Prix d’achat par pièce (F)">
          <TextInput
            value={prixAchat}
            onChangeText={setPrixAchat}
            keyboardType="numeric"
            style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
            placeholder="Facultatif"
            placeholderTextColor={colors.muted}
          />
        </Field>

        <Field label="Quantité en boutique">
          <TextInput
            value={stock}
            onChangeText={setStock}
            keyboardType="numeric"
            style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
          />
        </Field>

        {error && (
          <View style={[styles.alert, { backgroundColor: colors.warnSoft }]}>
            <Text style={{ color: colors.warn, fontWeight: '700' }}>{error}</Text>
          </View>
        )}

        <Button variant="sell" big disabled={saving} loading={saving} onPress={onSave}>
          Enregistrer
        </Button>
      </View>

      {!isNew && existing && (
        <View style={[styles.delzone, { borderTopColor: colors.line }]}>
          <Button variant="danger-outline" onPress={() => setConfirmDelete(true)}>
            Supprimer cet article
          </Button>
          <Text style={[styles.note, { color: colors.muted }]}>
            L’historique des ventes est gardé.
          </Text>
        </View>
      )}

      <ConfirmDialog
        visible={confirmDelete}
        title={`Supprimer « ${existing?.nom ?? ''} » ?`}
        description="Il ne sera plus dans la liste des ventes ni des restes."
        safeLabel="Non, garder l’article"
        onSafe={() => setConfirmDelete(false)}
        dangerLabel="Oui, supprimer"
        onConfirmDanger={onDelete}
      />
    </ScreenScroll>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { borderRadius: 20, padding: 18, gap: 14 },
  field: { gap: 6 },
  label: { fontWeight: '700', fontSize: 16 },
  input: { borderWidth: 2, borderRadius: 12, padding: 14, fontSize: 18, minHeight: 56 },
  alert: { borderRadius: 12, padding: 12 },
  delzone: { marginTop: 40, paddingTop: 16, borderTopWidth: 2, borderStyle: 'dashed', gap: 10 },
  note: { fontSize: 15, textAlign: 'center' },
});
