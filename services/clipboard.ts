import { Clipboard } from '@capacitor/clipboard';
import { isNativeApp } from './platform';

/* Área de transferência. No WebView do Android o navigator.clipboard.readText() é recusado, então no app instalado
   usa-se o plugin do Capacitor; no navegador, a API normal. Devolve null quando não deu para ler. */
export const readClipboardText = async (): Promise<string | null> => {
  if (isNativeApp()) {
    try { const r = await Clipboard.read(); if (r.type?.startsWith('text') || r.value) return String(r.value || ''); } catch { /* tenta a API do navegador */ }
  }
  try { return await navigator.clipboard.readText(); } catch { return null; }
};

export const writeClipboardText = async (text: string): Promise<boolean> => {
  if (isNativeApp()) {
    try { await Clipboard.write({ string: text }); return true; } catch { /* tenta a API do navegador */ }
  }
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
};
