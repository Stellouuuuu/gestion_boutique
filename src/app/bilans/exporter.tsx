import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as Print from 'expo-print';
import { BilansShell } from '../../components/BilansShell';
import { PeriodeSelector } from '../../components/PeriodeSelector';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useTheme } from '../../theme/useTheme';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../lib/AuthSession';
import { shareBytes } from '../../lib/shareFile';
import { getErrorMessage } from '../../lib/errors';
import {
  buildExcelRapport,
  buildPdfHtml,
  buildSauvegardeJson,
  restaurerSauvegarde,
  type SauvegardeJson,
} from '../../db/export';
import {
  periodeAujourdhui,
  shiftPeriode,
  nomFichierPeriode,
  type PeriodeBounds,
  type PeriodeKind,
} from '../../db/periodes';

export default function ExporterScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { membre } = useAuth();
  const [kind, setKind] = useState<PeriodeKind>('mois');
  const [periode, setPeriode] = useState<PeriodeBounds>(() => periodeAujourdhui('mois'));
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<SauvegardeJson | null>(null);

  useFocusEffect(
    useCallback(() => {
      // rafraîchit juste l’état
    }, [])
  );

  const boutiqueNom = 'Boutique-Maman';

  const run = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      showToast(getErrorMessage(e) || 'Échec de l’export.');
    } finally {
      setBusy(null);
    }
  };

  const onExcel = () =>
    run('excel', async () => {
      const { filename, base64 } = await buildExcelRapport(db, periode, boutiqueNom);
      await shareBytes({
        filename,
        base64,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      showToast('Excel prêt');
    });

  const onPdf = () =>
    run('pdf', async () => {
      const { bilan } = await buildExcelRapport(db, periode, boutiqueNom);
      const html = buildPdfHtml(bilan, boutiqueNom);
      const filename = nomFichierPeriode(boutiqueNom, periode, 'pdf');
      if (Platform.OS === 'web') {
        // expo-print limité sur web : on télécharge le HTML imprimable
        await shareBytes({
          filename: filename.replace(/\.pdf$/, '.html'),
          text: html,
          mimeType: 'text/html',
        });
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        const { shareAsync, isAvailableAsync } = await import('expo-sharing');
        if (await isAvailableAsync()) {
          await shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: filename });
        }
      }
      showToast('PDF prêt');
    });

  const onSauvegarde = () =>
    run('json', async () => {
      if (!membre?.boutiqueId) throw new Error('Boutique inconnue.');
      const { filename, json } = await buildSauvegardeJson(db, membre.boutiqueId);
      await shareBytes({ filename, text: json, mimeType: 'application/json' });
      showToast('Sauvegarde prête');
    });

  const onPickRestore = () =>
    run('pick', async () => {
      if (Platform.OS === 'web') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        const file: globalThis.File | null = await new Promise((resolve) => {
          input.onchange = () => resolve(input.files?.[0] ?? null);
          input.click();
        });
        if (!file) return;
        const text = await file.text();
        const data = JSON.parse(text) as SauvegardeJson;
        setPendingRestore(data);
        setConfirmRestore(true);
        return;
      }
      const { File } = await import('expo-file-system');
      const picked = await File.pickFileAsync({ mimeTypes: ['application/json'] });
      if (!picked || (picked as { canceled?: boolean }).canceled) return;
      const file =
        'files' in picked && Array.isArray(picked.files)
          ? picked.files[0]
          : 'uri' in picked
            ? picked
            : null;
      if (!file || !('text' in file) || typeof file.text !== 'function') {
        throw new Error('Fichier JSON introuvable.');
      }
      const text = await file.text();
      const data = JSON.parse(text) as SauvegardeJson;
      setPendingRestore(data);
      setConfirmRestore(true);
    });

  const doRestore = async () => {
    if (!pendingRestore) return;
    setConfirmRestore(false);
    await run('restore', async () => {
      await restaurerSauvegarde(db, pendingRestore);
      setPendingRestore(null);
      showToast('Sauvegarde restaurée');
    });
  };

  return (
    <BilansShell title="Exporter">
      <PeriodeSelector
        kind={kind}
        label={periode.label}
        onKind={(k) => {
          setKind(k);
          setPeriode(periodeAujourdhui(k));
        }}
        onPrev={() => setPeriode((p) => shiftPeriode(p, -1))}
        onNext={() => setPeriode((p) => shiftPeriode(p, 1))}
      />

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.title, { color: colors.ink }]}>Rapport Excel</Text>
        <Text style={{ color: colors.muted, marginBottom: 12 }}>
          Résumé, ventes, entrées, corrections, stock et annulées pour {periode.label}.
        </Text>
        <Button variant="indigo-outline" disabled={!!busy} loading={busy === 'excel'} onPress={onExcel}>
          Créer le fichier Excel
        </Button>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, marginTop: 14 }]}>
        <Text style={[styles.title, { color: colors.ink }]}>Rapport PDF</Text>
        <Text style={{ color: colors.muted, marginBottom: 12 }}>
          Une page résumé, facile à lire ou imprimer.
        </Text>
        <Button variant="indigo-outline" disabled={!!busy} loading={busy === 'pdf'} onPress={onPdf}>
          Créer le PDF
        </Button>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, marginTop: 14 }]}>
        <Text style={[styles.title, { color: colors.ink }]}>Sauvegarde complète</Text>
        <Text style={{ color: colors.muted, marginBottom: 12 }}>
          Fichier JSON de toutes les données de la boutique (articles, mouvements…).
        </Text>
        <Button
          variant="indigo-outline"
          disabled={!!busy}
          loading={busy === 'json'}
          onPress={onSauvegarde}
        >
          Créer la sauvegarde
        </Button>
        <View style={{ height: 10 }} />
        <Button
          variant="ghost"
          disabled={!!busy}
          loading={busy === 'pick'}
          onPress={onPickRestore}
        >
          Restaurer une sauvegarde…
        </Button>
      </View>

      {busy ? (
        <ActivityIndicator color={colors.indigo} style={{ marginTop: 20 }} />
      ) : null}

      <ConfirmDialog
        visible={confirmRestore}
        title="Restaurer cette sauvegarde ?"
        description="Les données actuelles de la boutique seront remplacées. Cette action ne peut pas être annulée facilement."
        safeLabel="Non, garder mes données"
        onSafe={() => {
          setConfirmRestore(false);
          setPendingRestore(null);
        }}
        dangerLabel="Oui, restaurer"
        onConfirmDanger={doRestore}
      />
    </BilansShell>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 6 },
});
