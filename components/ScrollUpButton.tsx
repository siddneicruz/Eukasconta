import { useEffect } from 'react';
import { useMotionPref } from '../services/uiPrefs';

/* Comportamento da rolagem da tela (sem botões): brilho e vibração por card, e o empurrão com o dedo que para no próximo card. */
const CARD_SELECTOR = '[data-scroll-anchor], section, [class*="rounded-[2"], [class*="rounded-3xl"], [class*="rounded-2xl"]';

/** Cartões da tela atual: blocos largos de cantos bem arredondados (só os de fora, não os aninhados). */
function findCards(main: HTMLElement): HTMLElement[] {
  const mw = main.clientWidth;
  const out: HTMLElement[] = [];
  main.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach(el => {
    if (el.offsetWidth < mw * 0.55 || el.offsetHeight < 56) return;   // cartão pequeno também conta
    if (el.closest('.sticky')) return;                                  // barras fixas não são cartões
    const parent = el.parentElement?.closest(CARD_SELECTOR);
    if (parent && parent !== main && main.contains(parent)) return;
    if (el.closest('[role="dialog"], .fixed')) return;
    out.push(el);
  });
  return out;
}

const glowTimers = new Map<HTMLElement, any>();
function flashCard(c: HTMLElement) {
  c.classList.remove('ek-card-glow'); void c.offsetWidth; c.classList.add('ek-card-glow');
  clearTimeout(glowTimers.get(c));
  glowTimers.set(c, setTimeout(() => c.classList.remove('ek-card-glow'), 1000));
}

/** Linha logo abaixo do cabeçalho e das barras fixas: é onde o topo de um card "encosta" ao pular até ele. */
function topEdge(main: HTMLElement): number {
  const head = document.querySelector('.app-header') as HTMLElement | null;
  let t = Math.max(main.getBoundingClientRect().top, head ? head.getBoundingClientRect().bottom : 0);
  const base = t;
  main.querySelectorAll<HTMLElement>('.sticky').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > main.clientWidth * 0.6 && r.height < 220 && r.top <= base + 24 && r.bottom > base) t = Math.max(t, r.bottom);
  });
  return t;
}

/** Cada vez que o MEIO de um card passa pelo meio da área visível da tela: vibração curta e uma piscada dourada na borda dele.
    Vale para card grande ou pequeno, rolando para cima ou para baixo, e não depende da velocidade: compara de que lado do meio da tela
    o meio do card estava no quadro anterior e agora, então um card que passou "voando" também pisca.
    Só dispara com o dedo rolando, nunca na abertura da tela. Fica desligado em aparelho fraco e com "reduzir movimento". */
function useCardGlow(resetKey?: string, on = true) {
  useEffect(() => {
    if (!on) return;
    const main = document.querySelector('.app-main') as HTMLElement | null;
    if (!main || document.documentElement.classList.contains('ek-lite')) return;
    let reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* sem matchMedia */ }
    if (reduce) return;
    let cards: HTMLElement[] = [];
    let lastScan = 0;
    const side = new Map<HTMLElement, number>();   // de que lado do meio da tela estava o meio do card: -1 acima, 1 abaixo
    let raf = 0;
    const flash = flashCard;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const now = Date.now();
        if (now - lastScan > 1200) { cards = findCards(main); lastScan = now; }
        const mr = main.getBoundingClientRect();
        const mid = mr.top + main.clientHeight / 2;
        let fired = 0;
        cards.forEach(c => {
          const r = c.getBoundingClientRect();
          const sd = (r.top + r.bottom) / 2 < mid ? -1 : 1;
          const was = side.get(c);
          side.set(c, sd);
          if (was !== undefined && was !== sd) { flash(c); fired++; }
        });
        if (fired) { try { navigator.vibrate?.(fired === 1 ? 14 : Array.from({ length: Math.min(fired, 4) * 2 - 1 }, (_, i) => (i % 2 === 0 ? 12 : 35))); } catch { /* sem vibração */ } }   // um toque por card cruzado, mesmo voando
      });
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => { main.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); glowTimers.forEach(t => clearTimeout(t)); cards.forEach(c => c.classList.remove('ek-card-glow')); };
  }, [resetKey, on]);
}

/** Empurrão (fling) com o dedo na tela inteira:
    - devagar: rolagem normal do aparelho;
    - médio: para no topo do próximo card (para cima ou para baixo); se o card for grande, a rolagem acelera para chegar lá;
    - muito rápido: vai até o topo ou até o rodapé da tela.
    Não mexe em toques que começam em roleta, barra de letras, campo de texto ou faixa que rola de lado. */
function useFlingSnap(resetKey?: string, on = true) {
  useEffect(() => {
    if (!on) return;
    const main = document.querySelector('.app-main') as HTMLElement | null;
    if (!main) return;
    let reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* sem matchMedia */ }
    if (reduce) return;
    let samples: { x: number; y: number; t: number }[] = [];
    let ok = false;
    const stop = () => { /* a rolagem suave do navegador já para sozinha quando o dedo encosta */ };
    const blocked = (el: Element | null) => {
      if (!el) return true;
      if (el.closest('[role="listbox"], input, textarea, select, [data-rail], [data-no-fling], .recharts-wrapper, [role="dialog"], .fixed')) return true;
      for (let n: HTMLElement | null = el as HTMLElement; n && n !== main; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
      }
      return false;
    };
    // rolagem suave do próprio navegador: ele cancela o impulso que já estava correndo e não briga com ele (antes, escrever o scrollTop
    // a cada quadro competia com o impulso e dava trepidação)
    const glide = (to: number) => {
      const max = main.scrollHeight - main.clientHeight;
      main.scrollTo({ top: Math.max(0, Math.min(max, to)), behavior: 'smooth' });
    };
    const onStart = (e: TouchEvent) => {
      stop();
      const t = e.touches[0];
      ok = e.touches.length === 1 && !blocked(e.target as Element);
      samples = t ? [{ x: t.clientX, y: t.clientY, t: performance.now() }] : [];
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0]; if (!ok || !t) return;
      const now = performance.now();
      samples.push({ x: t.clientX, y: t.clientY, t: now });
      while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
    };
    const onEnd = () => {
      if (!ok || samples.length < 2) return;
      const a = samples[0], b = samples[samples.length - 1];
      if (performance.now() - b.t > 70 || b.t - a.t < 12) return;          // dedo parou antes de soltar: sem empurrão
      const vy = (a.y - b.y) / (b.t - a.t);                                  // px/ms; positivo = conteúdo sobe (rolando para baixo)
      const vx = Math.abs(a.x - b.x) / (b.t - a.t);
      const mag = Math.abs(vy);
      if (mag < 0.9 || vx > mag * 0.6) return;                               // devagar ou na diagonal: rolagem normal
      const dir = vy > 0 ? 1 : -1;
      const max = main.scrollHeight - main.clientHeight;
      if (mag >= 3.4) {                                                      // muito rápido: topo ou rodapé
        const to = dir === 1 ? max : 0;
        glide(to);
        return;
      }
      const edge = topEdge(main) + 8;
      const cards = findCards(main).map(c => ({ c, top: c.getBoundingClientRect().top, h: c.offsetHeight }));
      const hit = dir === 1 ? cards.find(x => x.top > edge + 8) : [...cards].reverse().find(x => x.top < edge - 8);
      const to = hit ? main.scrollTop + hit.top - edge : (dir === 1 ? max : 0);
      const dist = Math.abs(to - main.scrollTop);
      if (dist < 4) return;
      glide(to);
      if (hit) flashCard(hit.c);
    };
    main.addEventListener('touchstart', onStart, { passive: true });
    main.addEventListener('touchmove', onMove, { passive: true });
    main.addEventListener('touchend', onEnd, { passive: true });
    main.addEventListener('wheel', stop, { passive: true });
    return () => { stop(); main.removeEventListener('touchstart', onStart); main.removeEventListener('touchmove', onMove); main.removeEventListener('touchend', onEnd); main.removeEventListener('wheel', stop); };
  }, [resetKey, on]);
}

/** Sem botões de seta: o empurrão com o dedo faz o papel deles. Fica só o brilho e a vibração ao passar por cada card. */
export default function ScrollUpButton({ resetKey }: { resetKey?: string }) {
  const on = useMotionPref();
  useCardGlow(resetKey, on);
  useFlingSnap(resetKey, on);
  return null;
}
