import { flushSync } from 'react-dom';

/** Troca de tema: o tema novo é revelado de baixo para cima (≈1,3 s) com uma linha dourada na frente.
 *  Usa um único recorte circular, que são baratos. Em aparelho fraco vira um fade curto. */
export const DURATION_MS = 1300;
const EASE = 'cubic-bezier(0.45, 0, 0.2, 1)';

const weak = (): boolean => {
  try {
    const n = (navigator as any);
    return (n.hardwareConcurrency && n.hardwareConcurrency <= 4) || (n.deviceMemory && n.deviceMemory <= 3);
  } catch { return false; }
};

export const switchThemeWave = (next: 'dark' | 'light', apply: (t: 'dark' | 'light') => void) => {
  const doc = document as any;
  let reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* segue sem a preferência */ }
  if (typeof doc.startViewTransition !== 'function' || reduce) { apply(next); return; }
  try {
    const vt = doc.startViewTransition(() => {
      // sem transições/animações de CSS durante a troca: o tema novo é desenhado "ao vivo" e elas competiam com a revelação
      document.documentElement.classList.add('theme-switching');
      flushSync(() => apply(next));
      document.documentElement.classList.toggle('light-theme', next === 'light');
    });
    const done = () => document.documentElement.classList.remove('theme-switching');
    vt.finished.then(done, done);
    vt.ready.then(() => {
      const root = document.documentElement;
      if (weak()) {
        root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: 'ease-out', pseudoElement: '::view-transition-new(root)' } as any);
        return;
      }
      const w = window.innerWidth, hh = window.innerHeight, R = Math.ceil(Math.hypot(w / 2, hh)) + 4;
      root.animate([{ clipPath: `circle(0px at 50% 100%)` }, { clipPath: `circle(${R}px at 50% 100%)` }], { duration: DURATION_MS, easing: EASE, fill: 'forwards', pseudoElement: '::view-transition-new(root)' } as any);
    }).catch(() => { /* sem animação: o tema já foi trocado */ });
  } catch { apply(next); }
};
