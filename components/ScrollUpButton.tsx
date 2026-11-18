import React, { useEffect, useRef, useState } from 'react';
import { ChevronUp } from 'lucide-react';

/* Seta fina para voltar ao topo: aparece no canto direito, logo abaixo da barra de filtros, enquanto a tela está sendo rolada
   (depois de descer um pouco) e some sozinha um instante depois que a rolagem para. Um toque leva direto ao topo, sem paradas. */
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

/** Cada vez que o MEIO de um card passa pelo meio da área visível da tela: vibração curta e uma piscada dourada na borda dele.
    Vale para card grande ou pequeno, rolando para cima ou para baixo, e não depende da velocidade: compara de que lado do meio da tela
    o meio do card estava no quadro anterior e agora, então um card que passou "voando" também pisca.
    Só dispara com o dedo rolando, nunca na abertura da tela. Fica desligado em aparelho fraco e com "reduzir movimento". */
function useCardGlow(resetKey?: string) {
  useEffect(() => {
    const main = document.querySelector('.app-main') as HTMLElement | null;
    if (!main || document.documentElement.classList.contains('ek-lite')) return;
    let reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* sem matchMedia */ }
    if (reduce) return;
    let cards: HTMLElement[] = [];
    let lastScan = 0;
    const side = new Map<HTMLElement, number>();   // de que lado do meio da tela estava o meio do card: -1 acima, 1 abaixo
    const timers = new Map<HTMLElement, any>();
    let raf = 0;
    const flash = (c: HTMLElement) => {
      c.classList.remove('ek-card-glow'); void c.offsetWidth; c.classList.add('ek-card-glow');
      clearTimeout(timers.get(c));
      timers.set(c, setTimeout(() => c.classList.remove('ek-card-glow'), 1000));
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const now = Date.now();
        if (now - lastScan > 1200) { cards = findCards(main); lastScan = now; }
        const mr = main.getBoundingClientRect();
        const mid = mr.top + main.clientHeight / 2;
        let fired = false;
        cards.forEach(c => {
          const r = c.getBoundingClientRect();
          const sd = (r.top + r.bottom) / 2 < mid ? -1 : 1;
          const was = side.get(c);
          side.set(c, sd);
          if (was !== undefined && was !== sd) { flash(c); fired = true; }
        });
        if (fired) { try { navigator.vibrate?.(14); } catch { /* sem vibração */ } }
      });
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => { main.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); timers.forEach(t => clearTimeout(t)); cards.forEach(c => c.classList.remove('ek-card-glow')); };
  }, [resetKey]);
}

export default function ScrollUpButton({ resetKey }: { resetKey?: string }) {
  const [show, setShow] = useState(false);
  const [top, setTop] = useState(200);
  const mainRef = useRef<HTMLElement | null>(null);
  useCardGlow(resetKey);

  useEffect(() => {
    const main = document.querySelector('.app-main') as HTMLElement | null;
    mainRef.current = main;
    setShow(false);
    if (!main) return;
    let timer: any;
    let raf = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        clearTimeout(timer);
        if (main.scrollTop < 300) { setShow(false); return; }
        // fica logo abaixo da barra de filtros fixa (se houver) ou do cabeçalho
        const head = document.querySelector('.app-header') as HTMLElement | null;
        let t = Math.max(main.getBoundingClientRect().top, head ? head.getBoundingClientRect().bottom : 0);
        const base = t;
        main.querySelectorAll<HTMLElement>('.sticky').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width > main.clientWidth * 0.6 && r.height < 220 && r.top <= base + 24 && r.bottom > base) t = Math.max(t, r.bottom);
        });
        setTop(Math.round(t + 10));
        setShow(true);
        timer = setTimeout(() => setShow(false), 1600);
      });
    };
    main.addEventListener('scroll', on, { passive: true });
    return () => { main.removeEventListener('scroll', on); clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [resetKey]);

  const goTop = () => { setShow(false); mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <button
      type="button"
      onClick={goTop}
      aria-label="Voltar ao topo"
      data-testid="scroll-up"
      tabIndex={show ? 0 : -1}
      className="fixed z-[45] w-11 h-11 rounded-full flex items-center justify-center text-zinc-200 border border-white/10 active:scale-95"
      style={{ right: 14, top, background: 'rgba(16,16,19,.55)', opacity: show ? 1 : 0, transform: show ? 'none' : 'translateY(-6px)', pointerEvents: show ? 'auto' : 'none', transition: 'opacity .2s, transform .2s' }}
    >
      <ChevronUp className="w-6 h-6" strokeWidth={1.5} />
    </button>
  );
}
