import React, { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

/* Seta fina para subir: aparece quando a tela já desceu bastante.
   Cada toque sobe até o começo do cartão anterior (lista → cabeçalho da lista → "onde você gasta" → …) e, no último, volta ao topo.
   Os "cartões" são achados na própria tela: elementos marcados com data-scroll-anchor, ou blocos largos de cantos bem arredondados. */
const SELECTOR = '[data-scroll-anchor], section, [class*="rounded-[2"], [class*="rounded-3xl"]';

/** Cartões da tela atual: marcados com data-scroll-anchor ou blocos largos de cantos bem arredondados (os de fora, não os aninhados). */
function findCards(main: HTMLElement): HTMLElement[] {
  const mw = main.clientWidth;
  const out: HTMLElement[] = [];
  main.querySelectorAll<HTMLElement>(SELECTOR).forEach(el => {
    if (el.offsetWidth < mw * 0.55 || el.offsetHeight < 90) return;
    const parent = el.parentElement?.closest(SELECTOR);
    if (parent && parent !== main && !el.hasAttribute('data-scroll-anchor') && main.contains(parent)) return;
    out.push(el);
  });
  return out;
}

export default function ScrollUpButton({ resetKey }: { resetKey?: string }) {
  const [show, setShow] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const main = document.querySelector('.app-main') as HTMLElement | null;
    mainRef.current = main;
    if (!main) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { setShow(main.scrollTop > 120 && main.scrollHeight > main.clientHeight + 400); setAtEnd(main.scrollTop + main.clientHeight >= main.scrollHeight - 24); });
    };
    main.addEventListener('scroll', on, { passive: true });
    on();
    return () => { main.removeEventListener('scroll', on); cancelAnimationFrame(raf); };
  }, [resetKey]);

  /* Efeito "gaveta": ao terminar de passar por um card, a ponta final dele afunda (encolhe um pouco e esmaece) sob a barra de filtros,
     como se fosse guardado numa pasta; o próximo card vem em seguida. Só em aparelho normal e sem "reduzir movimento". */
  useEffect(() => {
    const main = document.querySelector('.app-main') as HTMLElement | null;
    if (!main || document.documentElement.classList.contains('ek-lite')) return;
    let cards: HTMLElement[] = [];
    let raf = 0;
    let lastScan = 0;
    const ZONE = 240;
    const apply = () => {
      raf = 0;
      const now = Date.now();
      if (now - lastScan > 1200) { cards.forEach(c => { c.style.transform = ''; c.style.opacity = ''; }); cards = findCards(main); lastScan = now; }
      const mTop = main.getBoundingClientRect().top;
      let top = mTop + 8;
      main.querySelectorAll<HTMLElement>('.sticky').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > main.clientWidth * 0.6 && r.top - mTop < 4 && r.height < 160) top = Math.max(top, r.bottom);
      });
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        const p = Math.max(0, Math.min(1, (top + ZONE - r.bottom) / ZONE));   // 0 = longe do topo, 1 = já entrou na "gaveta"
        if (p <= 0 || r.top > top) { if (c.style.transform) { c.style.transform = ''; c.style.opacity = ''; } continue; }
        const e = p * p * (3 - 2 * p);   // suaviza o começo e o fim
        c.style.transformOrigin = '50% 100%';
        c.style.transform = `scale(${(1 - 0.07 * e).toFixed(3)}) translateY(${(-6 * e).toFixed(1)}px)`;
        c.style.opacity = String((1 - 0.55 * e).toFixed(3));
      }
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(apply); };
    main.addEventListener('scroll', on, { passive: true });
    apply();
    return () => { main.removeEventListener('scroll', on); cancelAnimationFrame(raf); cards.forEach(c => { c.style.transform = ''; c.style.opacity = ''; }); };
  }, [resetKey]);

  const go = (dir: 1 | -1) => {
    const main = mainRef.current;
    if (!main) return;
    // tira o efeito de gaveta antes de medir (ele desloca o topo dos cards)
    findCards(main).forEach(c => { c.style.transform = ''; c.style.opacity = ''; });
    const mTop = main.getBoundingClientRect().top;
    // barra de filtros fixa no topo (se houver) cobre o começo do cartão: deixa folga para ela
    let pad = 12;
    main.querySelectorAll<HTMLElement>('.sticky').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > main.clientWidth * 0.6 && r.top - mTop < 4 && r.height < 160) pad = Math.max(pad, r.height + 12);
    });
    const tops = findCards(main).map(el => Math.round(main.scrollTop + el.getBoundingClientRect().top - mTop - pad));
    const cur = main.scrollTop;
    const max = main.scrollHeight - main.clientHeight;
    if (dir < 0) {
      const prev = tops.filter(t => t < cur - 40).sort((a, b) => b - a)[0];
      main.scrollTo({ top: prev == null || prev < Math.max(320, main.clientHeight * 0.5) ? 0 : prev, behavior: 'smooth' });
    } else {
      const next = tops.filter(t => t > cur + 40).sort((a, b) => a - b)[0];
      main.scrollTo({ top: next == null || next > max - 40 ? max : next, behavior: 'smooth' });
    }
  };

  if (!show) return null;
  const cls = 'w-11 h-11 rounded-full flex items-center justify-center text-zinc-200 border border-white/10 active:scale-95 transition-transform';
  return (
    <div data-testid="scroll-nav" className="fixed z-[45] flex flex-col gap-2" style={{ right: 26, bottom: 'calc(var(--safe-bottom) + 84px)' }}>
      <button type="button" onClick={() => go(-1)} aria-label="Subir" data-testid="scroll-up" className={cls} style={{ background: 'rgba(16,16,19,.5)' }}>
        <ChevronUp className="w-6 h-6" strokeWidth={1.5} />
      </button>
      {!atEnd && (
        <button type="button" onClick={() => go(1)} aria-label="Descer" data-testid="scroll-down" className={cls} style={{ background: 'rgba(16,16,19,.5)' }}>
          <ChevronDown className="w-6 h-6" strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}
