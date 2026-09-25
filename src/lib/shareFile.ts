import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Écrit un fichier puis ouvre la feuille de partage.
 * Sur le web : téléchargement via blob (partage de fichier local indisponible).
 */
export async function shareBytes(opts: {
  filename: string;
  base64?: string;
  text?: string;
  mimeType: string;
}): Promise<void> {
  const { filename, mimeType } = opts;
  const bytes = opts.base64
    ? base64ToUint8Array(opts.base64)
    : new TextEncoder().encode(opts.text ?? '');

  if (Platform.OS === 'web') {
    downloadBlobWeb(bytes, filename, mimeType);
    return;
  }

  const file = new File(Paths.cache, filename);
  if (!file.exists) {
    file.create();
  }
  file.write(bytes);

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename });
  } else {
    throw new Error('Le partage de fichiers n’est pas disponible sur cet appareil.');
  }
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function downloadBlobWeb(data: Uint8Array, filename: string, mimeType: string): void {
  const copy = new Uint8Array(data);
  const blob = new Blob([copy.buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
