import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNativeApp } from './platform';

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Não foi possível ler o arquivo.'));
    reader.onload = () => {
      const s = String(reader.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });

const browserDownload = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

/**
 * Entrega um arquivo gerado pelo app.
 * - Navegador: baixa direto.
 * - App Android: o WebView não baixa blobs, então grava no cache e abre a folha de compartilhar
 *   (Salvar no Drive, Arquivos, WhatsApp, e-mail...).
 * Devolve 'cancelled' quando a pessoa fecha a folha sem escolher nada.
 */
export const downloadFile = async (blob: Blob, fileName: string): Promise<'saved' | 'cancelled'> => {
  if (!isNativeApp()) {
    browserDownload(blob, fileName);
    return 'saved';
  }
  const safeName = fileName.replace(/[^\w.\-]+/g, '_');
  const data = await blobToBase64(blob);
  try { await Filesystem.rmdir({ path: 'exports', directory: Directory.Cache, recursive: true }); } catch { /* primeira vez */ }
  const written = await Filesystem.writeFile({ path: `exports/${safeName}`, data, directory: Directory.Cache, recursive: true });
  try {
    await Share.share({ title: fileName, dialogTitle: 'Salvar ou enviar arquivo', files: [written.uri] });
    return 'saved';
  } catch (e: any) {
    if (/cancel/i.test(String(e?.message || e))) return 'cancelled';
    throw e;
  }
};
