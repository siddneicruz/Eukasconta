import { flushSync } from 'react-dom';

/** Troca de tema no estilo do app do Claude: o tema novo sobe como um grande arco (0,7 s), vindo de um lado
 *  (para o claro vem da esquerda; para o escuro, da direita).
 *  A página antiga e a nova viram duas imagens separadas; a nova fica dentro de um círculo enorme que só se DESLOCA
 *  (transform), e a imagem dentro dele se desloca ao contrário para ficar parada na tela. Só transform = animação
 *  feita pela placa de vídeo, fora da thread do app — não trava mesmo com a página ocupada redesenhando o tema. */
export const DURATION_MS = 700;
const EASE = 'cubic-bezier(0.3, 0, 0.15, 1)';
const STYLE_ID = 'ek-theme-wave-style';

const weak = (): boolean => {
  try {
    const n = (navigator as any);
    return (n.hardwareConcurrency && n.hardwareConcurrency <= 4) || (n.deviceMemory && n.deviceMemory <= 3);
  } catch { return false; }
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
