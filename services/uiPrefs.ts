import { useEffect, useState } from 'react';

/* Preferências de uso guardadas neste aparelho:
   - movimento: brilho, vibração e empurrão com o dedo ao rolar (cada pessoa decide; padrão ligado);
   - visão: só para o administrador, escolhe trabalhar vendo o app como administrador ou como usuário comum. */

const EVT = 'ek-prefs-change';
const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } window.dispatchEvent(new Event(EVT)); };

export const motionOn = (): boolean => read('eukasconta_motion') !== '0';
export const setMotion = (on: boolean) => write('eukasconta_motion', on ? '1' : '0');
export const viewAsUser = (): boolean => read('eukasconta_view_as') === 'user';
export const setViewAsUser = (user: boolean) => write('eukasconta_view_as', user ? 'user' : 'admin');

function usePref<T>(get: () => T): T {
  const [v, setV] = useState<T>(get);
  useEffect(() => {
    const f = () => setV(get());
    window.addEventListener(EVT, f); window.addEventListener('storage', f);
    return () => { window.removeEventListener(EVT, f); window.removeEventListener('storage', f); };
  }, []);
  return v;
}
export const useMotionPref = () => usePref(motionOn);
export const useViewAsUser = () => usePref(viewAsUser);
