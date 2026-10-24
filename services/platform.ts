import { Capacitor } from '@capacitor/core';

// true só dentro do app instalado no Android; no navegador (PC ou celular) continua false.
export const isNativeApp = (): boolean => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

export const APP_SCHEME = 'br.com.eukasconta.app';
// Para onde o Supabase devolve a pessoa depois do login com Google no app.
export const NATIVE_AUTH_REDIRECT = `${APP_SCHEME}://auth/callback`;

// Versão web publicada (build com VITE_WEB_LOGIN_REQUIRED=1): só entra quem fizer login. O app Android e o ambiente de
// desenvolvimento continuam abrindo direto, como sempre.
export const WEB_LOGIN_REQUIRED = (import.meta as any).env?.VITE_WEB_LOGIN_REQUIRED === '1';
