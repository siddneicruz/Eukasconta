import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { isNativeApp } from './platform';

/* Ao voltar de uma página aberta fora do app (SEFAZ, mapas, login do Google) o Android às vezes deixa a janela rolada:
   o cabeçalho fica por baixo da barra de status ou o rodapé some. Ao voltar ao primeiro plano, zera a rolagem da janela
   e dos contêineres do app (o conteúdo que precisa rolar tem a própria rolagem e não é afetado). */
const reset = () => {
  try {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const root = document.getElementById('root');
    if (root) { root.scrollTop = 0; const first = root.firstElementChild as HTMLElement | null; if (first) first.scrollTop = 0; }
    window.dispatchEvent(new Event('resize'));
  } catch { /* sem DOM */ }
};

const resetSoon = () => { reset(); [150, 400, 900].forEach(ms => setTimeout(reset, ms)); };

export const installScrollReset = (): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  const onVis = () => { if (document.visibilityState === 'visible') resetSoon(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', resetSoon);
  const removers: Array<() => void> = [];
  if (isNativeApp()) {
    CapApp.addListener('appStateChange', s => { if (s.isActive) resetSoon(); }).then(h => removers.push(() => h.remove())).catch(() => {});
    Browser.addListener('browserFinished', resetSoon).then(h => removers.push(() => h.remove())).catch(() => {});
  }
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('focus', resetSoon);
    removers.forEach(r => r());
  };
};
