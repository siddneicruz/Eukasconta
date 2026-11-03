import { isNativeApp } from './platform';

/* Leitor de código de barras (EAN-13/EAN-8/UPC) pela câmera do celular. No app Android usa o leitor do Google (ML Kit);
   no navegador lê de uma foto, quando o navegador sabe (BarcodeDetector). Sempre dá para digitar o código. */

export type ScanOutcome = { code: string } | { cancelled: true } | { error: string };

const clean = (v: string) => String(v || '').replace(/\D/g, '');

export const scanBarcode = async (): Promise<ScanOutcome> => {
  if (!isNativeApp()) return { error: 'No navegador, use "Foto do código" ou digite o número.' };
  try {
    const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');
    const avail = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!avail.available) {
      try { await BarcodeScanner.installGoogleBarcodeScannerModule(); } catch { /* segue: o aviso abaixo explica */ }
      return { error: 'Estou baixando o leitor do Google (só na primeira vez). Espere alguns segundos e toque de novo.' };
    }
    const res = await BarcodeScanner.scan({ formats: [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.UpcE] });
    const v = clean(res.barcodes?.[0]?.rawValue || res.barcodes?.[0]?.displayValue || '');
    return v ? { code: v } : { cancelled: true };
  } catch (e: any) {
    const m = String(e?.message || e || '');
    if (/cancel/i.test(m)) return { cancelled: true };
    return { error: 'Não consegui abrir a câmera para ler o código. Digite o número abaixo do código de barras.' };
  }
};

/** Foto de um código de barras (navegador com BarcodeDetector). */
export const barcodeFromPhoto = async (file: File): Promise<string | null> => {
  try {
    const BD = (window as any).BarcodeDetector;
    if (!BD) return null;
    const det = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    const bmp = await createImageBitmap(file);
    const hit = await det.detect(bmp);
    bmp.close?.();
    const v = clean(hit?.[0]?.rawValue || '');
    return v || null;
  } catch { return null; }
};
