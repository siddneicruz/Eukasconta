import { flushSync } from 'react-dom';

/** Troca de tema no estilo do app do Claude: o tema novo entra como uma grande forma curva (0,7 s).
 *  São 5 jeitos que se alternam a cada troca (a ordem fica guardada no aparelho):
 *    arco-esq  — arco que sobe vindo de baixo, pelo lado esquerdo
 *    arco-dir  — o mesmo, pelo lado direito
 *    canto-sup — arcos em forma de tigela, nascendo no canto superior esquerdo
 *    canto-inf — arcos em forma de cúpula, nascendo no canto inferior esquerdo
 *    ondas     — frente ondulada em S, vinda da direita
 *  A página antiga e a nova viram duas imagens separadas; a nova fica dentro de uma forma (círculo enorme ou onda)
 *  que só se DESLOCA (transform), e a imagem dentro dela se desloca ao contrário para ficar parada na tela.
 *  Só transform = animação feita pela placa de vídeo, fora da thread do app — não trava mesmo com a página
 *  ocupada redesenhando o tema. Nenhuma borda reta e nenhum efeito de mistura de cores (eram pesados). */
export const DURATION_MS = 700;
const EASE = 'cubic-bezier(0.3, 0, 0.15, 1)';
const STYLE_ID = 'ek-theme-wave-style';

export type WaveMode = 'arco-esq' | 'arco-dir' | 'canto-sup' | 'canto-inf' | 'ondas';
export const WAVE_MODES: WaveMode[] = ['arco-esq', 'arco-dir', 'canto-sup', 'canto-inf', 'ondas'];
const IDX_KEY = 'ek_theme_wave_i2';

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

/** Faixa com a frente ondulada em S (duas ondas somadas), entrando pela direita e avançando para a esquerda. */
const waveShape = (w: number, h: number): Shape => {
  const A = Math.round(Math.min(w * 0.16, 90));           // amplitude da onda
  const gw = w + 2 * A + 8, gh = h;
  const pts: string[] = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const y = (gh * i) / N, t = (i / N) * Math.PI * 2;
    // S fluido: uma onda principal + um harmônico menor, sempre dentro de [0, 2A]
    const e = A + A * (0.78 * Math.sin(t + 0.6) + 0.22 * Math.sin(t * 2 + 1.4));
    pts.push(`${e.toFixed(1)} ${y.toFixed(1)}`);
  }
  const d = `M ${pts[0]} L ${pts.slice(1).join(' L ')} L ${gw} ${gh} L ${gw} 0 Z`;
  return { gw, gh, from: [w, 0], to: [-2 * A - 2, 0], css: `clip-path:path('${d}')` };
};

const buildShape = (mode: WaveMode, w: number, h: number): Shape => {
  const hd = Math.hypot(w / 2, h / 2);
  if (mode === 'arco-esq' || mode === 'arco-dir') {
    // raio grande = arco aberto; sobra 12% para a borda sair da tela antes do fim
    const R = Math.ceil(Math.max(1.5 * w, hd * 1.12));
    return circleShape(w, h, mode === 'arco-esq' ? w * 0.15 : w * 0.85, h + 8 + R, R);
  }
  if (mode === 'ondas') return waveShape(w, h);
  // cantos: o círculo encosta no canto e vem na diagonal; o raio dá a curvatura de tigela/cúpula
  const R = Math.ceil(Math.max(1.35 * hd, 0.9 * w));
  const corner: [number, number] = mode === 'canto-sup' ? [0, 0] : [0, h];
  const ux = corner[0] - w / 2, uy = corner[1] - h / 2, len = Math.hypot(ux, uy) || 1;
  return circleShape(w, h, corner[0] + (ux / len) * (R + 8), corner[1] + (uy / len) * (R + 8), R);
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
      const s = buildShape(nextMode(), w, h);
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
