import { flushSync } from 'react-dom';

/** Troca de tema no estilo do app do Claude: o tema novo entra como uma grande forma curva (0,7 s).
 *  São 5 jeitos que se alternam a cada troca (a ordem fica guardada no aparelho):
 *    arco-esq  — arco que sobe vindo de baixo, pelo lado esquerdo
 *    arco-dir  — o mesmo, pelo lado direito
 *    canto-sup — arcos em forma de tigela, nascendo no canto superior esquerdo
 *    canto-inf — arcos em forma de cúpula, nascendo no canto inferior esquerdo
 *    chuva     — gotas de óleo (no claro) ou leite (no escuro) pingando por 3 s, de borda nítida, até cobrir a tela
 *  A página antiga e a nova viram duas imagens separadas; a nova fica dentro de uma forma (círculo enorme ou onda)
 *  que só se DESLOCA (transform), e a imagem dentro dela se desloca ao contrário para ficar parada na tela.
 *  Só transform = animação feita pela placa de vídeo, fora da thread do app — não trava mesmo com a página
 *  ocupada redesenhando o tema. Nenhuma borda reta e nenhum efeito de mistura de cores (eram pesados). */
export const DURATION_MS = 700;
const EASE = 'cubic-bezier(0.3, 0, 0.15, 1)';
const STYLE_ID = 'ek-theme-wave-style';

export type WaveMode = 'arco-esq' | 'arco-dir' | 'canto-sup' | 'canto-inf' | 'chuva';
export const WAVE_MODES: WaveMode[] = ['arco-esq', 'arco-dir', 'canto-sup', 'canto-inf', 'chuva'];
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

const buildShape = (mode: WaveMode, w: number, h: number): Shape => {
  const hd = Math.hypot(w / 2, h / 2);
  if (mode === 'arco-esq' || mode === 'arco-dir') {
    // raio grande = arco aberto; sobra 12% para a borda sair da tela antes do fim
    const R = Math.ceil(Math.max(1.5 * w, hd * 1.12));
    return circleShape(w, h, mode === 'arco-esq' ? w * 0.15 : w * 0.85, h + 8 + R, R);
  }
  // cantos: o círculo encosta no canto e vem na diagonal; o raio dá a curvatura de tigela/cúpula
  const R = Math.ceil(Math.max(1.35 * hd, 0.9 * w));
  const corner: [number, number] = mode === 'canto-sup' ? [0, 0] : [0, h];
  const ux = corner[0] - w / 2, uy = corner[1] - h / 2, len = Math.hypot(ux, uy) || 1;
  return circleShape(w, h, corner[0] + (ux / len) * (R + 8), corner[1] + (uy / len) * (R + 8), R);
};

/** Gota de óleo/leite: mancha de borda NÍTIDA (sem esfumaçado nem degradê), redonda e levemente irregular, com
 *  gotículas ao redor. Desenhada UMA vez num canvas e guardada como imagem: serve de máscara do tema novo e só é
 *  esticada, nunca redesenhada. */
let blotUrls: string[] | null = null;
const makeBlots = (): string[] => {
  if (blotUrls) return blotUrls;
  const out: string[] = [];
  try {
    for (let v = 0; v < 3; v++) {
      const N = 768, c = document.createElement('canvas');
      c.width = N; c.height = N;
      const g = c.getContext('2d');
      if (!g) throw new Error('sem canvas');
      const cx = N / 2, cy = N / 2;
      const ph = Array.from({ length: 5 }, () => Math.random() * Math.PI * 2);
      const am = [0.07, 0.055, 0.045, 0.03, 0.02];
      const radius = (t: number) => {
        let r = 0.5;                                       // gota principal ocupa ~metade da imagem
        for (let k = 0; k < 5; k++) r += am[k] * Math.sin(t * (k + 2) + ph[k]);
        return r * (N / 2) * 0.62;
      };
      g.fillStyle = '#000';
      g.beginPath();
      for (let i = 0; i <= 360; i++) {
        const t = (i / 360) * Math.PI * 2, r = radius(t);
        const x = cx + Math.cos(t) * r, y = cy + Math.sin(t) * r;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.fill();
      const U = (N / 2) * 0.62;
      // respingo 🫟: jatos finos que saem da borda da gota (largos na base, em ponta no fim), cada um com uma
      // gotícula solta logo depois da ponta — tudo de borda nítida
      const ns = 11 + Math.floor(Math.random() * 5);
      for (let k = 0; k < ns; k++) {
        const t = (k / ns) * Math.PI * 2 + (Math.random() - 0.5) * 0.35, r0 = radius(t);
        const len = (0.12 + Math.random() * 0.42) * U, wd = (0.05 + Math.random() * 0.07) * U;
        const bx = cx + Math.cos(t) * (r0 - 4), by = cy + Math.sin(t) * (r0 - 4);
        const tx = cx + Math.cos(t) * (r0 + len), ty = cy + Math.sin(t) * (r0 + len);
        const nx = -Math.sin(t) * wd, ny = Math.cos(t) * wd;
        g.beginPath(); g.moveTo(bx + nx, by + ny); g.lineTo(tx, ty); g.lineTo(bx - nx, by - ny); g.closePath(); g.fill();
        const dd = r0 + len + (0.04 + Math.random() * 0.12) * U, rr = 2.5 + Math.random() * 7;
        g.beginPath(); g.arc(cx + Math.cos(t) * dd, cy + Math.sin(t) * dd, rr, 0, Math.PI * 2); g.fill();
      }
      // gotículas soltas por perto (algumas quase encostadas, outras mais afastadas)
      const n = 10 + Math.floor(Math.random() * 6);
      for (let k = 0; k < n; k++) {
        const t = Math.random() * Math.PI * 2, r0 = radius(t);
        const d = r0 + (0.1 + Math.random() * 0.55) * U + 6;
        const rr = 2.5 + Math.random() * Math.random() * 13;
        g.beginPath(); g.arc(cx + Math.cos(t) * d, cy + Math.sin(t) * d, rr, 0, Math.PI * 2); g.fill();
      }
      out.push(c.toDataURL('image/png'));
    }
  } catch { /* sem canvas: o modo chuva se desliga */ }
  blotUrls = out;
  return out;
};

const easeOut = (x: number) => 1 - Math.pow(1 - x, 2.4);
export const RAIN_MS = 3000;
/** Gotas pingando uma a uma (grade com sorteio, ordem aleatória), cada uma crescendo até se juntar às outras. */
const rainCss = (w: number, h: number, dur: number): string | null => {
  const urls = makeBlots();
  if (!urls.length) return null;
  const COLS = 2, ROWS = 4, L = COLS * ROWS;
  const S = Math.ceil(Math.max(w, h) * 2.6);                       // tamanho final de cada gota (a imagem tem folga)
  const cellW = w / COLS, cellH = h / ROWS;
  const pts: [number, number][] = [];
  for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++)
    pts.push([Math.round(cellW * (q + 0.2 + Math.random() * 0.6)), Math.round(cellH * (r + 0.2 + Math.random() * 0.6))]);
  const order = pts.map((_, i) => i).sort(() => Math.random() - 0.5);   // quem cai primeiro
  const start = order.map((_, k) => 0.02 + (k / (L - 1)) * 0.5 + (Math.random() - 0.5) * 0.03);
  const span = 0.46;                                               // cada gota cresce durante 46% do tempo
  const steps = 75;
  let kf = '';
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const sz: string[] = [], ps: string[] = [];
    for (let i = 0; i < L; i++) {
      const p = easeOut(Math.min(1, Math.max(0, (t - start[order.indexOf(i)]) / span)));
      const size = Math.round(S * p), [x, y] = pts[i];
      sz.push(`${size}px ${size}px`); ps.push(`${Math.round(x - size / 2)}px ${Math.round(y - size / 2)}px`);
    }
    kf += `${(t * 100).toFixed(2)}%{-webkit-mask-size:${sz.join(',')};-webkit-mask-position:${ps.join(',')};mask-size:${sz.join(',')};mask-position:${ps.join(',')}}`;
  }
  const imgs = Array.from({ length: L }, (_, i) => `url(${urls[i % urls.length]})`).join(',');
  const rep = Array.from({ length: L }, () => 'no-repeat').join(',');
  return `
::view-transition-old(root){animation:none!important;opacity:1!important;mix-blend-mode:normal}
::view-transition-new(root){opacity:1!important;mix-blend-mode:normal;-webkit-mask-image:${imgs};mask-image:${imgs};-webkit-mask-repeat:${rep};mask-repeat:${rep};animation:ek-rain ${dur}ms linear both!important}
@keyframes ek-rain{${kf}}`;
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
  let stain = false;
  const cleanup = () => {
    running = false;
    try { style?.remove(); } catch { /* já saiu */ }
    root.style.removeProperty('view-transition-name');
    root.classList.remove('theme-switching');
  };
  try {
    if (!isWeak) {
      const w = window.innerWidth, h = window.innerHeight;
      let mode = nextMode();
      let rain: string | null = null;
      if (mode === 'chuva') { rain = rainCss(w, h, RAIN_MS); if (!rain) mode = 'arco-esq'; }
      const s = buildShape(mode, w, h);
      const [a, b] = s.from, [c, d] = s.to;
      style = document.createElement('style');
      style.id = STYLE_ID;
      if (rain) { stain = true; style.textContent = rain; } else style.textContent = `
::view-transition-group(ek-old){animation:none!important;z-index:1}
::view-transition-old(ek-old){animation:none!important;opacity:1!important;mix-blend-mode:normal}
::view-transition-group(ek-new){left:0!important;top:0!important;width:${s.gw}px!important;height:${s.gh}px!important;${s.css};z-index:2;will-change:transform;animation:ek-wave-g ${DURATION_MS}ms ${EASE} both!important}
::view-transition-new(ek-new){left:0!important;top:0!important;width:${w}px!important;height:${h}px!important;max-width:none;opacity:1!important;mix-blend-mode:normal;will-change:transform;animation:ek-wave-n ${DURATION_MS}ms ${EASE} both!important}
@keyframes ek-wave-g{from{transform:translate(${a}px,${b}px)}to{transform:translate(${c}px,${d}px)}}
@keyframes ek-wave-n{from{transform:translate(${-a}px,${-b}px)}to{transform:translate(${-c}px,${-d}px)}}`;
      document.head.appendChild(style);
      if (!stain) root.style.setProperty('view-transition-name', 'ek-old');
    }
    const vt = doc.startViewTransition(() => {
      // sem transições/animações de CSS durante a troca: elas competiam com a revelação
      root.classList.add('theme-switching');
      flushSync(() => apply(next));
      root.classList.toggle('light-theme', next === 'light');
      if (!isWeak && !stain) root.style.setProperty('view-transition-name', 'ek-new');
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
