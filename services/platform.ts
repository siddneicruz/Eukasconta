import { Capacitor } from '@capacitor/core';

// true só dentro do app instalado no Android; no navegador (PC ou celular) continua false.
export const isNativeApp = (): boolean => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

export const APP_SCHEME = 'br.com.eukasconta.app';
// Para onde o Supabase devolve a pessoa depois do login com Google no app.
export const NATIVE_AUTH_REDIRECT = `${APP_SCHEME}://auth/callback`;
