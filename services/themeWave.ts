import { flushSync } from 'react-dom';

/** Troca de tema no estilo do app do Claude: o tema novo entra como uma grande forma redonda (0,7 s).
 *  São 2 jeitos que se alternam a cada troca (a ordem fica guardada no aparelho):
 *    arco-esq — arco bem redondo que sobe vindo de baixo, pelo lado esquerdo
 *    arco-dir — o mesmo, pelo lado direito
 *  A página antiga e a nova viram duas imagens separadas; a nova fica dentro de um círculo
 *  que só se DESLOCA (transform), e a imagem dentro dele se desloca ao contrário para ficar parada na tela.
 *  Só transform = animação feita pela placa de vídeo, fora da thread do app — não trava mesmo com a página
 *  ocupada redesenhando o tema. Nenhuma borda reta e nenhum efeito de mistura de cores (eram pesados). */
export const DURATION_MS = 700;
const EASE = 'cubic-bezier(0.3, 0, 0.15, 1)';
const STYLE_ID = 'ek-theme-wave-style';

export type WaveMode = 'arco-esq' | 'arco-dir';
export const WAVE_MODES: WaveMode[] = ['arco-esq', 'arco-dir'];
const IDX_KEY = 'ek_theme_wave_i3';

const nextMode = (): WaveMode => {
  let i = 0;
  try { i = parseInt(localStorage.getItem(IDX_KEY) || '0', 10) || 0; } catch { /* sem armazenamento: começa do primeiro */ }
  const n = WAVE_MODES.length;
  const m = WAVE_MODES[((i % n) + n) % n];
  try { localStorage.setItem(IDX_KEY, String(i + 1)); } catch { /* ok */ }
  return m;
};

const weak = (): boolean => {
  try {
    const n = (navigator as any);
    return (n.hardwareConcurrency && n.hardwareConcurrency <= 4) || (n.deviceMemory && n.deviceMemory <= 3);
  } catch { return false; }
};

type Shape = { gw: number; gh: number; from: [number, number]; to: [number, number]; css: string };

/** Círculo enorme: começa fora da tela, encostando no ponto de origem, e termina centrado cobrindo a tela. */
const circleShape = (w: number, h: number, cx0: number, cy0: number, R: number): Shape => ({
  gw: 2 * R, gh: 2 * R,
  from: [Math.round(cx0 - R), Math.round(cy0 - R)],
  to: [Math.round(w / 2 - R), Math.round(h / 2 - R)],
  css: 'border-radius:50%;overflow:hidden',
});

const buildShape = (mode: WaveMode, w: number, h: number): Shape => {
  // raio perto do mínimo que cobre a tela (meia diagonal): a frente do arco fica bem redonda, com as pontas curvando
  // para dentro da tela em vez de uma linha quase reta
  const R = Math.ceil(Math.hypot(w / 2, h / 2) * 1.06);
  return circleShape(w, h, mode === 'arco-esq' ? w * 0.15 : w * 0.85, h + 8 + R, R);
};

let running = false;

export const switchThemeWave = (next: 'dark' | 'light', apply: (t: 'dark' | 'light') => void) => {
  const doc = document as any;
  const root = document.documentElement;
  let reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* segue sem a preferência */ }
  if (typeof doc.startViewTransition !== 'function' || reduce) { apply(next); return; }
  if (running) return; // toque repetido durante a troca: ignora
  running = true;
  const isWeak = weak();
  let style: HTMLStyleElement | null = null;
  const cleanup = () => {
    running = false;
    try { style?.remove(); } catch { /* já saiu */ }
    root.style.removeProperty('view-transition-name');
    root.classList.remove('theme-switching');
  };
  try {
    if (!isWeak) {
      const w = window.innerWidth, h = window.innerHeight;
      const mode = nextMode();
      const s = buildShape(mode, w, h);
      const [a, b] = s.from, [c, d] = s.to;
      style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
::view-transition-group(ek-old){animation:none!important;z-index:1}
::view-transition-old(ek-old){animation:none!important;opacity:1!important;mix-blend-mode:normal}
::view-transition-group(ek-new){left:0!important;top:0!important;width:${s.gw}px!important;height:${s.gh}px!important;${s.css};z-index:2;will-change:transform;animation:ek-wave-g ${DURATION_MS}ms ${EASE} both!important}
::view-transition-new(ek-new){left:0!important;top:0!important;width:${w}px!important;height:${h}px!important;max-width:none;opacity:1!important;mix-blend-mode:normal;will-change:transform;animation:ek-wave-n ${DURATION_MS}ms ${EASE} both!important}
@keyframes ek-wave-g{from{transform:translate(${a}px,${b}px)}to{transform:translate(${c}px,${d}px)}}
@keyframes ek-wave-n{from{transform:translate(${-a}px,${-b}px)}to{transform:translate(${-c}px,${-d}px)}}`;
      document.head.appendChild(style);
      root.style.setProperty('view-transition-name', 'ek-old');
    }
    const vt = doc.startViewTransition(() => {
      // sem transições/animações de CSS durante a troca: elas competiam com a revelação
      root.classList.add('theme-switching');
      flushSync(() => apply(next));
      root.classList.toggle('light-theme', next === 'light');
      if (!isWeak) root.style.setProperty('view-transition-name', 'ek-new');
    });
    let anim: Animation | null = null;
    const done = () => { try { anim?.cancel(); } catch { /* já terminou */ } cleanup(); };
    vt.finished.then(done, done);
    vt.ready.then(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
      if (isWeak) anim = root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: 'ease-out', pseudoElement: '::view-transition-new(root)' } as any);
    }).catch(() => { /* sem animação: o tema já foi trocado */ });
  } catch { cleanup(); apply(next); }
};
