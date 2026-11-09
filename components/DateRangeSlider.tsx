import { ChevronLeft, ChevronRight } from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/* Barrinha de período com um puxador em cada ponta. Arrastar (dedo ou mouse) ou usar as setas do teclado
   (1 dia; Shift = 7 dias). Mostra a data sob cada puxador e, abaixo, a legenda "15/11/2025 à 09/11/2026".
   As datas vão e voltam como AAAA-MM-DD; o filtro em si é de quem usa. */

const DAY = 86400000;
const toIdx = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY);
const toIso = (idx: number) => new Date(idx * DAY).toISOString().slice(0, 10);
const long = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const short = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

const ym = (iso: string) => iso.slice(0, 7);
const monthOf = (y: number, m0: number) => ({ first: toIso(Math.round(Date.UTC(y, m0, 1) / DAY)), last: toIso(Math.round(Date.UTC(y, m0 + 1, 0) / DAY)) });

const THUMB = 22;      // diâmetro visível do puxador
const LABEL_W = 58;    // largura reservada para a data sob o puxador

interface Props {
  min: string;                       // primeira data possível (AAAA-MM-DD)
  max: string;                       // última data possível
  from: string;                      // início escolhido
  to: string;                        // fim escolhido
  onChange: (from: string, to: string) => void;
  testId?: string;
}

const DateRangeSlider: React.FC<Props> = ({ min, max, from, to, onChange, testId = 'range-slider' }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [drag, setDrag] = useState<'from' | 'to' | null>(null);

  const lo = toIdx(min), hi = toIdx(max);
  const span = Math.max(hi - lo, 1);
  const a = Math.min(Math.max(toIdx(from), lo), hi);
  const b = Math.min(Math.max(toIdx(to), a), hi);
  const full = a === lo && b === hi;

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const read = () => setW(el.clientWidth);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // posição em px do centro de cada puxador (o trilho tem folga de meio puxador nas pontas)
  const usable = Math.max(w - THUMB, 1);
  const xOf = (idx: number) => THUMB / 2 + ((idx - lo) / span) * usable;
  const xa = xOf(a), xb = xOf(b);

  const idxAt = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return lo;
    const r = el.getBoundingClientRect();
    const f = (clientX - r.left - THUMB / 2) / Math.max(r.width - THUMB, 1);
    return Math.round(lo + Math.min(Math.max(f, 0), 1) * span);
  }, [lo, span]);

  const set = (which: 'from' | 'to', idx: number) => {
    if (which === 'from') onChange(toIso(Math.min(Math.max(idx, lo), b)), toIso(b));
    else onChange(toIso(a), toIso(Math.max(Math.min(idx, hi), a)));
  };

  const onPointerDown = (which: 'from' | 'to') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag(which);
  };
  const onPointerMove = (which: 'from' | 'to') => (e: React.PointerEvent) => {
    if (drag !== which) return;
    set(which, idxAt(e.clientX));
  };
  const endDrag = () => setDrag(null);

  // toque no trilho: leva o puxador mais perto até ali
  const onTrackDown = (e: React.PointerEvent) => {
    const idx = idxAt(e.clientX);
    const which = Math.abs(idx - a) <= Math.abs(idx - b) ? 'from' : 'to';
    set(which, idx);
  };

  const onKey = (which: 'from' | 'to') => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 7 : 1;
    const cur = which === 'from' ? a : b;
    let next: number | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + step;
    else if (e.key === 'Home') next = lo;
    else if (e.key === 'End') next = hi;
    if (next === null) return;
    e.preventDefault();
    set(which, next);
  };

  useEffect(() => {
    if (!drag) return;
    const up = () => setDrag(null);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [drag]);

  // datas sob os puxadores: centradas, sem sair do trilho e sem se atropelar
  const clampL = (x: number) => Math.min(Math.max(x - LABEL_W / 2, 0), Math.max(w - LABEL_W, 0));
  let la = clampL(xa), lb = clampL(xb);
  if (lb - la < LABEL_W + 4) {
    const mid = (xa + xb) / 2;
    la = Math.min(Math.max(mid - LABEL_W - 2, 0), Math.max(w - 2 * LABEL_W - 4, 0));
    lb = la + LABEL_W + 4;
  }

  // setas: pulam de mês em mês (recortando nas pontas do período). Se o recorte ainda não é um mês só,
  // a primeira setinha escolhe o mês do fim do recorte e as seguintes andam daí.
  const single = ym(toIso(a)) === ym(toIso(b));
  const anchor = toIso(b);
  const curY = +anchor.slice(0, 4), curM = +anchor.slice(5, 7) - 1;
  const minYm = ym(min), maxYm = ym(max);
  const goMonth = (y: number, m0: number) => {
    const { first, last } = monthOf(y, m0);
    onChange(first < min ? min : first, last > max ? max : last);
  };
  const step = (dir: -1 | 1) => {
    if (!single) { goMonth(curY, curM); return; }
    const d = new Date(Date.UTC(curY, curM + dir, 1));
    goMonth(d.getUTCFullYear(), d.getUTCMonth());
  };
  const prevYm = ym(new Date(Date.UTC(curY, curM - 1, 1)).toISOString());
  const nextYm = ym(new Date(Date.UTC(curY, curM + 1, 1)).toISOString());
  const canPrev = single ? prevYm >= minYm : true;
  const canNext = single ? nextYm <= maxYm : false;

  const arrow = (dir: -1 | 1, enabled: boolean) => (
    <button type="button" disabled={!enabled} onClick={() => step(dir)}
      aria-label={dir < 0 ? 'Mês anterior' : 'Próximo mês'} data-testid={`${testId}-${dir < 0 ? 'prev' : 'next'}`}
      className="shrink-0 w-9 h-9 -mt-3 flex items-center justify-center rounded-full text-zinc-500 hover:text-luxury-gold active:bg-white/5 disabled:opacity-25 disabled:hover:text-zinc-500 transition-colors">
      {dir < 0 ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
    </button>
  );

  const thumb = (which: 'from' | 'to', x: number, val: string) => {
    const active = drag === which;
    return (
      <div role="slider" tabIndex={0} aria-label={which === 'from' ? 'Início do período' : 'Fim do período'}
        aria-valuemin={lo} aria-valuemax={hi} aria-valuenow={which === 'from' ? a : b} aria-valuetext={long(val)}
        data-testid={`${testId}-${which}`}
        onPointerDown={onPointerDown(which)} onPointerMove={onPointerMove(which)} onPointerUp={endDrag} onPointerCancel={endDrag}
        onKeyDown={onKey(which)}
        className="absolute top-1/2 w-11 h-11 -mt-[22px] -ml-[22px] flex items-center justify-center cursor-grab active:cursor-grabbing outline-none group/thumb"
        style={{ left: x, touchAction: 'none', zIndex: active ? 3 : 2 }}>
        <span className="block rounded-full transition-[transform,box-shadow] duration-150 ease-out group-focus-visible/thumb:ring-2 group-focus-visible/thumb:ring-luxury-gold/60"
          style={{
            width: THUMB, height: THUMB,
            background: 'radial-gradient(circle at 35% 30%, #F3DE8E, #DDB94B 55%, #A67C0A)',
            border: '2.5px solid var(--ek-bg, #0A0A0C)',
            boxShadow: active ? '0 0 0 5px rgba(221,185,75,0.22), 0 4px 12px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.45)',
            transform: active ? 'scale(1.12)' : 'scale(1)',
          }} />
      </div>
    );
  };

  return (
    <div className="select-none" data-testid={testId}>
      <div className="flex items-center gap-1">
      {arrow(-1, canPrev)}
      <div className="flex-1 min-w-0">
      <div ref={trackRef} className="relative h-11 cursor-pointer" style={{ touchAction: 'none' }} onPointerDown={onTrackDown}>
        {/* trilho */}
        <div className="absolute left-[11px] right-[11px] top-1/2 -mt-[2px] h-1 rounded-full bg-white/10" />
        {/* trecho escolhido */}
        <div className="absolute top-1/2 -mt-[2px] h-1 rounded-full"
          style={{ left: xa, width: Math.max(xb - xa, 0), background: 'linear-gradient(90deg, #A67C0A, #DDB94B, #F3DE8E)', transition: drag ? 'none' : 'left 120ms ease-out, width 120ms ease-out' }} />
        {thumb('from', xa, toIso(a))}
        {thumb('to', xb, toIso(b))}
      </div>

      {/* data sob cada puxador */}
      <div className="relative h-4 -mt-1 text-[11px] font-bold tabular-nums text-luxury-gold" aria-hidden="true">
        <span className="absolute whitespace-nowrap text-center" style={{ left: la, width: LABEL_W }}>{short(toIso(a))}</span>
        <span className="absolute whitespace-nowrap text-center" style={{ left: lb, width: LABEL_W }}>{short(toIso(b))}</span>
      </div>
      </div>
      {arrow(1, canNext)}
      </div>

      {/* legenda do período */}
      <div className="flex items-center justify-center gap-3 mt-2 text-xs text-zinc-500 tabular-nums">
        <span data-testid={`${testId}-legend`}>{long(toIso(a))} <span className="text-zinc-600">à</span> {long(toIso(b))}</span>
        {!full && (
          <button type="button" onClick={() => onChange(min, max)} data-testid={`${testId}-reset`}
            className="text-[11px] font-bold uppercase tracking-[0.08em] text-luxury-gold/80 hover:text-luxury-gold transition-colors">
            tudo
          </button>
        )}
      </div>
    </div>
  );
};

export default DateRangeSlider;
