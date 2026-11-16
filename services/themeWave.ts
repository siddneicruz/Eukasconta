import { flushSync } from 'react-dom';

/** Troca de tema no estilo do app do Claude: o tema novo sobe como um grande arco (0,7 s), vindo de um lado
 *  (para o claro vem da esquerda; para o escuro, da direita).
 *  A página antiga e a nova viram duas imagens separadas; a nova fica dentro de um círculo enorme que só se DESLOCA
 *  (transform), e a imagem dentro dele se desloca ao contrário para ficar parada na tela. Só transform = animação
 *  feita pela placa de vídeo, fora da thread do app — não trava mesmo com a página ocupada redesenhando o tema. */
export const DURATION_MS = 700;
/** 5 jeitos de varrer a tela; a cada troca de tema passa para o próximo (a ordem fica guardada no aparelho). */
export type WaveMode = 'arco' | 'gota' | 'cortina' | 'diagonal' | 'cima';
export const WAVE_MODES: WaveMode[] = ['arco', 'gota', 'cortina', 'diagonal', 'cima'];
const IDX_KEY = 'ek_theme_wave_i';
const nextMode = (): WaveMode => {
  let i = 0;
  try { i = parseInt(localStorage.getItem(IDX_KEY) || '0', 10) || 0; } catch { /* sem armazenamento: começa do arco */ }
  const m = WAVE_MODES[((i % WAVE_MODES.length) + WAVE_MODES.length) % WAVE_MODES.length];
  try { localStorage.setItem(IDX_KEY, String(i + 1)); } catch { /* ok */ }
  return m;
};
const EASE = 'cubic-bezier(0.3, 0, 0.15, 1)';
const STYLE_ID = 'ek-theme-wave-style';

const weak = (): boolean => {
  try {
    const n = (navigator as any);
    return (n.hardwareConcurrency && n.hardwareConcurrency <= 4) || (n.deviceMemory && n.deviceMemory <= 3);
  } catch { return false; }
};

let running = false;

type Origin = Element | { x: number; y: number } | null | undefined;
const originXY = (o: Origin): { x: number; y: number } => {
  try {
    if (o && 'getBoundingClientRect' in o) { const r = (o as Element).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    if (o && typeof (o as any).x === 'number') return o as { x: number; y: number };
  } catch { /* usa o centro */ }
  return { x: window.innerWidth / 2, y: window.innerHeight * 0.9 };
};

/** Gota na água: anéis brancos; a camada deles usa mistura 'difference' — sobre o escuro viram claros e sobre o claro viram escuros
 *  (efeito preto-e-branco). O painel entra no estado NOVO da página com nome de transição próprio, para aparecer
 *  por cima das duas imagens da troca. */
const buildRipple = (x: number, y: number): HTMLElement => {
  const w = window.innerWidth, h = window.innerHeight;
  const R = Math.ceil(Math.max(Math.hypot(x, y), Math.hypot(w - x, y), Math.hypot(x, h - y), Math.hypot(w - x, h - y)));
  const box = document.createElement('div');
  box.setAttribute('data-ek-ripple', '1');
  box.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;view-transition-name:ek-ripple;z-index:2147483000';
  const ring = 'radial-gradient(circle closest-side,transparent 0,transparent 84%,#fff 90%,#fff 95%,transparent 100%)';
  [0, 130, 260].forEach((delay, i) => {
    const el = document.createElement('div');
    const size = 2 * R * (1 - i * 0.12);
    el.style.cssText = `position:absolute;left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;border-radius:50%;background:${ring};opacity:0;will-change:transform,opacity`;
    box.appendChild(el);
    try {
      el.animate([
        { transform: 'scale(0.02)', opacity: 0.95 },
        { transform: 'scale(1)', opacity: 0 },
      ], { duration: DURATION_MS + 250, delay, easing: 'cubic-bezier(0.2,0.6,0.3,1)', fill: 'both' });
    } catch { /* sem animação de anel */ }
  });
  return box;
};

const clipKeyframes = (mode: WaveMode, next: 'dark' | 'light', x: number, y: number, R: number): string => {
  const fromLeft = next === 'light';
  if (mode === 'cortina') return `from{clip-path:inset(0 ${fromLeft ? '100% 0 0' : '0 0 100%'})}to{clip-path:inset(0 0 0 0)}`;
  if (mode === 'cima') return `from{clip-path:inset(${fromLeft ? '0 0 100% 0' : '100% 0 0 0'})}to{clip-path:inset(0 0 0 0)}`;
  if (mode === 'diagonal') return fromLeft
    ? 'from{clip-path:polygon(0 0,0 0,0 0)}to{clip-path:polygon(0 0,230% 0,0 230%)}'
    : 'from{clip-path:polygon(100% 0,100% 0,100% 0)}to{clip-path:polygon(100% 0,-130% 0,100% 230%)}';
  return `from{clip-path:circle(0px at ${x}px ${y}px)}to{clip-path:circle(${R}px at ${x}px ${y}px)}`; // gota
};

export const switchThemeWave = (next: 'dark' | 'light', apply: (t: 'dark' | 'light') => void, origin?: Origin) => {
  const doc = document as any;
  const root = document.documentElement;
  let reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* segue sem a preferência */ }
  if (typeof doc.startViewTransition !== 'function' || reduce) { apply(next); return; }
  if (running) return; // toque repetido durante a troca: ignora
  running = true;
  const isWeak = weak();
  const mode = nextMode();
  const arco = mode === 'arco';
  let ripple: HTMLElement | null = null;
  let style: HTMLStyleElement | null = null;
  const cleanup = () => {
    running = false;
    try { style?.remove(); } catch { /* já saiu */ }
    root.style.removeProperty('view-transition-name');
    root.classList.remove('theme-switching');
    try { ripple?.remove(); } catch { /* já saiu */ }
  };
  try {
    if (!isWeak && !arco) {
      const w = window.innerWidth, h = window.innerHeight;
      const o = originXY(origin);
      const x = Math.round(o.x), y = Math.round(o.y);
      const R = Math.ceil(Math.max(Math.hypot(x, y), Math.hypot(w - x, y), Math.hypot(x, h - y), Math.hypot(w - x, h - y)));
      const dur = mode === 'gota' ? DURATION_MS + 100 : DURATION_MS;
      style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
::view-transition-old(root){animation:none!important;opacity:1!important;mix-blend-mode:normal}
::view-transition-new(root){opacity:1!important;mix-blend-mode:normal;animation:ek-clip ${dur}ms ${EASE} both!important}
::view-transition-group(ek-ripple){animation:none!important;z-index:3}
::view-transition-old(ek-ripple){display:none}
::view-transition-new(ek-ripple){animation:none!important;opacity:1!important;mix-blend-mode:difference}
@keyframes ek-clip{${clipKeyframes(mode, next, x, y, R)}}`;
      document.head.appendChild(style);
      if (mode === 'gota') ripple = buildRipple(x, y);
    }
    if (!isWeak && arco) {
      const w = window.innerWidth, h = window.innerHeight;
      // raio grande = arco aberto, como no app do Claude; sobra 12% para a borda sair da tela antes do fim
      const R = Math.ceil(Math.max(1.5 * w, Math.hypot(w / 2, h / 2) * 1.12));
      const x0 = next === 'light' ? w * 0.15 : w * 0.85;
      const a = Math.round(x0 - R), b = h + 8;                       // início: círculo todo abaixo da tela, deslocado para um lado
      const c = Math.round(w / 2 - R), d = Math.round(h / 2 - R);    // fim: círculo centrado, cobrindo a tela
      style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
::view-transition-group(ek-old){animation:none!important;z-index:1}
::view-transition-old(ek-old){animation:none!important;opacity:1!important;mix-blend-mode:normal}
::view-transition-group(ek-new){left:0!important;top:0!important;width:${2 * R}px!important;height:${2 * R}px!important;border-radius:50%;overflow:hidden;z-index:2;will-change:transform;animation:ek-wave-g ${DURATION_MS}ms ${EASE} both!important}
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
      if (!isWeak && arco) root.style.setProperty('view-transition-name', 'ek-new');
      if (ripple) document.body.appendChild(ripple);
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
