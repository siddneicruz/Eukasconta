import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import { DocumentScanner, GoogleDocumentScannerModuleInstallState } from '@capacitor-mlkit/document-scanner';
import { isNativeApp } from './platform';

// Scanner de documentos nativo do Android (o mesmo "Digitalizar" do Google Drive): acha o cupom na foto,
// recorta, endireita e limpa o fundo — o resultado já sai quase em preto e branco, ótimo para a IA ler.
// Só existe no app instalado; no navegador o Scanner continua usando a câmera comum.

export type NativeScanOutcome =
  | { status: 'ok'; files: File[] }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: string };

export const nativeScannerSupported = (): boolean => isNativeApp();

const INSTALL_TIMEOUT_MS = 120_000;

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(typeof e === 'string' ? e : (e as any)?.message || String(e)));

// A primeira vez o Google baixa o módulo do scanner (alguns MB). Espera terminar, com limite de tempo.
const ensureModule = async (onStatus?: (msg: string) => void): Promise<void> => {
  const { available } = await DocumentScanner.isGoogleDocumentScannerModuleAvailable();
  if (available) return;

  onStatus?.('Baixando o scanner do Google (só na primeira vez)…');
  let handle: { remove: () => Promise<void> } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('O download do scanner demorou demais.')), INSTALL_TIMEOUT_MS);
      DocumentScanner.addListener('googleDocumentScannerModuleInstallProgress', (e) => {
        if (e.state === GoogleDocumentScannerModuleInstallState.COMPLETED) resolve();
        else if (e.state === GoogleDocumentScannerModuleInstallState.FAILED || e.state === GoogleDocumentScannerModuleInstallState.CANCELED) {
          reject(new Error('Não foi possível baixar o scanner do Google.'));
        } else if (typeof e.progress === 'number' && e.progress > 0) {
          onStatus?.(`Baixando o scanner do Google… ${e.progress}%`);
        }
      }).then(h => { handle = h; }).catch(reject);
      DocumentScanner.installGoogleDocumentScannerModule().catch(err => {
        // "já instalado" não é problema: o módulo ficou pronto entre a checagem e o pedido.
        if (/already installed/i.test(toError(err).message)) resolve(); else reject(toError(err));
      });
    });
  } finally {
    if (timer) clearTimeout(timer);
    try { await handle?.remove(); } catch { /* ignora */ }
  }
};

// O scanner devolve caminhos de arquivo (file://...). O WebView lê esses caminhos por convertFileSrc;
// se isso falhar em algum aparelho, cai para a leitura pelo plugin de arquivos.
const uriToFile = async (uri: string, name: string): Promise<File> => {
  try {
    const res = await fetch(Capacitor.convertFileSrc(uri));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (blob.size === 0) throw new Error('arquivo vazio');
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    const { data } = await Filesystem.readFile({ path: uri });
    if (typeof data !== 'string' && !(data instanceof Blob)) throw new Error('o aparelho não entregou o arquivo');
    const b64 = typeof data === 'string' ? data : await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(data);
    });
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type: 'image/jpeg' });
  }
};

export const scanWithNativeScanner = async (onStatus?: (msg: string) => void): Promise<NativeScanOutcome> => {
  if (!isNativeApp()) return { status: 'unavailable', reason: 'Disponível só no app instalado.' };

  try {
    await ensureModule(onStatus);
  } catch (e) {
    return { status: 'unavailable', reason: toError(e).message };
  }

  onStatus?.('Abrindo o scanner…');
  let uris: string[];
  try {
    const result = await DocumentScanner.scanDocument({
      galleryImportAllowed: true, // dá para escolher uma foto da galeria dentro do scanner
      pageLimit: 10,              // cada página vira um cupom
      resultFormats: 'JPEG',
      scannerMode: 'FULL',        // recorte automático + filtros (P&B, limpar manchas e dedos)
    });
    uris = result.scannedImages || [];
  } catch (e) {
    const msg = toError(e).message;
    // O plugin recusa com "Scan cancelled or failed. Result code: 0" quando a pessoa fecha o scanner.
    if (/cancel/i.test(msg)) return { status: 'cancelled' };
    return { status: 'unavailable', reason: msg };
  }
  if (uris.length === 0) return { status: 'cancelled' };

  try {
    onStatus?.('Preparando as imagens…');
    const stamp = Date.now();
    const files: File[] = [];
    for (let i = 0; i < uris.length; i++) {
      files.push(await uriToFile(uris[i], `cupom-${stamp}-${i + 1}.jpg`));
    }
    return { status: 'ok', files };
  } catch (e) {
    return { status: 'unavailable', reason: `Não consegui ler a imagem do scanner: ${toError(e).message}` };
  }
};
