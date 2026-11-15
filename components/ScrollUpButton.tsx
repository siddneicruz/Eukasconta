import React, { useEffect, useRef, useState } from 'react';
import { ChevronUp } from 'lucide-react';

/* Seta fina para voltar ao topo: aparece no canto direito, logo abaixo da barra de filtros, enquanto a tela está sendo rolada
   (depois de descer um pouco) e some sozinha um instante depois que a rolagem para. Um toque leva direto ao topo, sem paradas. */
const CARD_SELECTOR = '[data-scroll-anchor], section, [class*="rounded-[2"], [class*="rounded-3xl"]';

/** Cartões da tela atual: blocos largos de cantos bem arredondados (só os de fora, não os aninhados). */
function findCards(main: HTMLElement): HTMLElement[] {
  const mw = main.clientWidth;
  const out: HTMLElement[] = [];
  main.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach(el => {
    if (el.offsetWidth < mw * 0.55 || el.offsetHeight < 140) return;
    const parent = el.parentElement?.closest(CARD_SELECTOR);
    if (parent && parent !== main && main.contains(parent)) return;
    if (el.closest('[role="dialog"], .fixed')) return;
    out.push(el);
  });
  return out;
}

/** Ao entrar num card novo na tela (ele chega à faixa de leitura, perto do topo): vibração curta e um brilho dourado na borda dele.
    Só dispara com o dedo rolando, nunca na abertura da tela. Fica desligado em aparelho fraco e com "reduzir movimento". */
function useCardGlow(resetKey?: string) {
  useEffect(() => {
    const main = document.querySelector('.app-main') as HTMLElement | null;
    if (!main || document.documentElement.classList.contains('ek-lite')) return;
    let cards: HTMLElement[] = [];
    let lastScan = 0;
    let current: HTMLElement | null = null;
    let armed = false;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const now = Date.now();
        if (now - lastScan > 1200) { cards = findCards(main); lastScan = now; }
        const mTop = main.getBoundingClientRect().top;
        const line = mTop + main.clientHeight * 0.3;   // faixa de leitura: ~30% abaixo do topo
        const hit = cards.find(c => { const r = c.getBoundingClientRect(); return r.top <= line && r.bottom > line; }) || null;
        if (hit && hit !== current) {
          if (armed && current) {
            try { navigator.vibrate?.(14); } catch { /* sem vibração */ }
            hit.classList.remove('ek-card-glow'); void hit.offsetWidth; hit.classList.add('ek-card-glow');
            setTimeout(() => hit.classList.remove('ek-card-glow'), 1000);
          }
          current = hit;
        } else if (!hit) current = null;
        armed = true;
      });
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => { main.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); cards.forEach(c => c.classList.remove('ek-card-glow')); };
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
