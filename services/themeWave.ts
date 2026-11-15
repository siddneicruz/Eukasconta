import { flushSync } from 'react-dom';

/** Troca de tema com uma onda que sobe de baixo até o topo (≈1,4 s). Sem suporte no aparelho, troca na hora. */
export const DURATION_MS = 1400;

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
      const amp = 7, steps = 40, frames: Keyframe[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const base = (1 + 2 * amp / 100) * (1 - eased) * 100 - amp;   // % da altura: começa abaixo da tela, termina acima
        const pts: string[] = [];
        for (let x = 0; x <= 100; x += 5) pts.push(`${x}% ${(base + amp * Math.sin((x / 100) * Math.PI * 4 + t * Math.PI * 6)).toFixed(2)}%`);
        frames.push({ clipPath: `polygon(${pts.join(',')},100% 101%,0% 101%)` });
      }
      document.documentElement.animate(frames, { duration: DURATION_MS, easing: 'linear', fill: 'forwards', pseudoElement: '::view-transition-new(root)' } as any);
    }).catch(() => { /* sem animação: o tema já foi trocado */ });
  } catch { apply(next); }
};
