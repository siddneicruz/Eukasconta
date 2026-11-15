import { flushSync } from 'react-dom';

/** Troca de tema: o tema novo é revelado de baixo para cima (≈1,3 s) com uma linha dourada na frente.
 *  Usa só recorte retangular + transform, que são baratos. Em aparelho fraco vira um fade curto. */
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
      flushSync(() => apply(next));
      document.documentElement.classList.toggle('light-theme', next === 'light');
    });
    vt.ready.then(() => {
      const root = document.documentElement;
      if (weak()) {
        root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: 'ease-out', pseudoElement: '::view-transition-new(root)' } as any);
        return;
      }
      root.animate([{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)' }], { duration: DURATION_MS, easing: EASE, fill: 'forwards', pseudoElement: '::view-transition-new(root)' } as any);
      // linha dourada acompanhando a borda (só transform: roda na GPU)
      const h = window.innerHeight;
      const line = document.createElement('div');
      line.style.cssText = 'position:fixed;left:0;right:0;top:0;height:46px;margin-top:-23px;pointer-events:none;z-index:2147483647;will-change:transform;background:radial-gradient(ellipse 60% 50% at 50% 50%, rgba(212,175,55,.55), rgba(212,175,55,0) 70%)';
      document.body.appendChild(line);
      const a = line.animate([{ transform: `translateY(${h}px)` }, { transform: 'translateY(0px)' }], { duration: DURATION_MS, easing: EASE, fill: 'forwards' });
      a.onfinish = () => line.remove();
      a.oncancel = () => line.remove();
    }).catch(() => { /* sem animação: o tema já foi trocado */ });
  } catch { apply(next); }
};
