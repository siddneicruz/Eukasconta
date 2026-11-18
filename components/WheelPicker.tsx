import React, { useEffect, useRef } from 'react';

/* Roleta de escolha: três linhas visíveis, a do meio fica em destaque dentro de uma cápsula dourada.
   O dedo rola e ela encaixa (scroll-snap) na opção mais perto; cada troca dá um toque leve de vibração.
   A escolha só é entregue ao pai quando a rolagem assenta, para não refazer o cartão de baixo a cada linha que passa. */

export interface WheelOption { key: string; label: string }

const ITEM_H = 30;
const PAD = 30;   // respiro de cima e de baixo: com ele a linha do meio fica no centro

const tick = () => { try { if (navigator.vibrate) navigator.vibrate(7); } catch { /* sem vibração neste aparelho */ } };

const WheelPicker: React.FC<{ options: WheelOption[]; value: string; onChange: (key: string) => void; ariaLabel: string; title: string; testId?: string }> = ({ options, value, onChange, ariaLabel, title, testId }) => {
  const root = useRef<HTMLDivElement | null>(null);
  const cap = useRef<HTMLDivElement | null>(null);
  const cur = useRef(-1);          // linha que está sob a cápsula agora
  const raf = useRef(0);
  const settle = useRef<any>(null);
  const sent = useRef(value);      // última escolha entregue ao pai
  const optsRef = useRef(options);
  optsRef.current = options;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const paint = (first = false) => {
    raf.current = 0;
    const el = root.current; if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 2;
    let best = 0, bd = 1e9;
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) {
      const it = kids[i] as HTMLElement;
      const d = (i * ITEM_H + ITEM_H / 2 + PAD - mid) / ITEM_H;   // PAD = respiro de cima
      const a = Math.abs(d);
      if (a < bd) { bd = a; best = i; }
      it.style.transform = `rotateX(${Math.max(-62, Math.min(62, -d * 26))}deg) scale(${1 - Math.min(a, 2.4) * 0.09})`;
      it.style.opacity = String(Math.max(0.16, 1 - a * 0.42));
    }
    for (let i = 0; i < kids.length; i++) { const on = i === best; const it = kids[i] as HTMLElement; it.setAttribute('aria-selected', on ? 'true' : 'false'); it.dataset.on = on ? '1' : '0'; }
    if (best !== cur.current) {
      const was = cur.current; cur.current = best;
      if (!first && was !== -1) {
        tick();
        const c = cap.current; if (c) { c.style.transform = 'scale(1.03)'; setTimeout(() => { if (cap.current) cap.current.style.transform = ''; }, 140); }
      }
    }
  };
  const goTo = (i: number, smooth: boolean) => {
    const el = root.current; if (!el) return;
    i = Math.max(0, Math.min(optsRef.current.length - 1, i));
    el.scrollTo({ top: i * ITEM_H, behavior: smooth ? 'smooth' : 'auto' });
  };
  const commit = () => {
    const o = optsRef.current[cur.current];
    if (o && o.key !== sent.current) { sent.current = o.key; onChangeRef.current(o.key); }
  };

  // posição inicial, e acompanhar mudanças vindas de fora (ex.: a barra de letras põe a lista em A–Z)
  useEffect(() => {
    const i = Math.max(0, options.findIndex(o => o.key === value));
    sent.current = value;
    if (i !== cur.current) goTo(i, cur.current !== -1);
    paint(cur.current === -1);
  }, [value, options.length]);

  useEffect(() => () => { clearTimeout(settle.current); cancelAnimationFrame(raf.current); }, []);

  return (
    <div className="min-w-0" data-testid={testId}>
      <p className="ml-1 mb-0.5 text-[10px] font-bold tracking-[0.14em] text-zinc-500">{title}</p>
      <div className="relative rounded-xl bg-white/[0.04] border border-white/10 overflow-hidden">
        <div ref={cap} className="absolute left-1 right-1 rounded-lg border border-luxury-gold/45 bg-luxury-gold/15 pointer-events-none transition-transform duration-150" style={{ top: PAD, height: ITEM_H }} />
        <div ref={root} role="listbox" aria-label={ariaLabel} tabIndex={0}
          onScroll={() => { if (!raf.current) raf.current = requestAnimationFrame(() => paint()); clearTimeout(settle.current); settle.current = setTimeout(commit, 130); }}
          onKeyDown={e => { const s = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0; if (s) { e.preventDefault(); goTo(cur.current + s, true); } }}
          className="no-scrollbar overflow-y-auto overscroll-contain"
          style={{ height: ITEM_H + PAD * 2, paddingBlock: PAD, perspective: 400, scrollSnapType: 'y mandatory', touchAction: 'pan-y',
            WebkitMaskImage: 'linear-gradient(transparent,#000 20%,#000 80%,transparent)', maskImage: 'linear-gradient(transparent,#000 20%,#000 80%,transparent)' }}>
          {options.map((o, i) => (
            <div key={o.key} role="option" aria-selected={o.key === value} onClick={() => goTo(i, true)}
              className="flex items-center justify-center px-2 text-center cursor-pointer select-none text-[13px] font-bold leading-none text-zinc-500 data-[on='1']:text-zinc-100"
              style={{ height: ITEM_H, scrollSnapAlign: 'center', willChange: 'transform,opacity' }}>
              <span className="truncate">{o.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default WheelPicker;
