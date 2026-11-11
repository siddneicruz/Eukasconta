import { ChevronDown, ChevronUp } from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/* Régua de meses com um puxador: arraste (dedo ou mouse), toque no trilho ou use as setas do teclado.
   Mesmo desenho e mesma regra de setas da régua de período: seta de CIMA volta um mês, seta de BAIXO avança. */

export interface YM { y: number; m: number }   // m: 0 = janeiro
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const idx = (v: YM) => v.y * 12 + v.m;
const ym = (i: number): YM => ({ y: Math.floor(i / 12), m: ((i % 12) + 12) % 12 });
const label = (v: YM) => `${MONTHS[v.m]}/${String(v.y).slice(2)}`;
const THUMB = 22;
const LABEL_W = 58;

interface Props { min: YM; max: YM; value: YM; onChange: (v: YM) => void; testId?: string }

const MonthSlider: React.FC<Props> = ({ min, max, value, onChange, testId = 'month-slider' }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [drag, setDrag] = useState(false);
  const lo = idx(min), hi = Math.max(idx(max), lo);
  const span = Math.max(hi - lo, 1);
  const cur = Math.min(Math.max(idx(value), lo), hi);

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

  const usable = Math.max(w - THUMB, 1);
  const x = THUMB / 2 + ((cur - lo) / span) * usable;
  const idxAt = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return lo;
    const r = el.getBoundingClientRect();
    const f = (clientX - r.left - THUMB / 2) / Math.max(r.width - THUMB, 1);
    return Math.round(lo + Math.min(Math.max(f, 0), 1) * span);
  }, [lo, span]);
  const set = (i: number) => { const t = Math.min(Math.max(i, lo), hi); if (t !== cur) onChange(ym(t)); };

  useEffect(() => {
    if (!drag) return;
    const up = () => setDrag(false);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [drag]);

  const clampL = Math.min(Math.max(x - LABEL_W / 2, 0), Math.max(w - LABEL_W, 0));
  const back = cur > lo ? cur - 1 : null;
  const fwd = cur < hi ? cur + 1 : null;
  const arrow = (id: string, text: string, up: boolean, target: number | null) => (
    <button type="button" disabled={target === null} onClick={() => target !== null && set(target)} aria-label={text} data-testid={`${testId}-${id}`}
      className="w-7 h-[22px] flex items-center justify-center text-zinc-500 hover:text-luxury-gold active:text-luxury-gold active:bg-white/5 disabled:opacity-25 disabled:hover:text-zinc-500 transition-colors">
      {up ? <ChevronUp className="w-4 h-4" strokeWidth={2.25} /> : <ChevronDown className="w-4 h-4" strokeWidth={2.25} />}
    </button>
  );

  return (
    <div className="select-none" data-testid={testId}>
      <div className="flex items-center gap-1">
        <div className="shrink-0 -mt-3 flex flex-col overflow-hidden rounded-full bg-white/5 border border-white/10 divide-y divide-white/5">
          {arrow('back', 'Voltar um mês', true, back)}
          {arrow('fwd', 'Avançar um mês', false, fwd)}
        </div>
        <div className="flex-1 min-w-0">
          <div ref={trackRef} className="relative h-11 cursor-pointer" style={{ touchAction: 'none' }}
            onPointerDown={e => set(idxAt(e.clientX))}>
            <div className="absolute left-[11px] right-[11px] top-1/2 -mt-[2px] h-1 rounded-full bg-white/10" />
            <div className="absolute top-1/2 -mt-[2px] h-1 rounded-full"
              style={{ left: THUMB / 2, width: Math.max(x - THUMB / 2, 0), background: 'linear-gradient(90deg, #A67C0A, #DDB94B, #F3DE8E)', transition: drag ? 'none' : 'width 120ms ease-out' }} />
            <div role="slider" tabIndex={0} aria-label="Mês da meta" aria-valuemin={lo} aria-valuemax={hi} aria-valuenow={cur} aria-valuetext={label(ym(cur))}
              data-testid={`${testId}-thumb`}
              onPointerDown={e => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); setDrag(true); }}
              onPointerMove={e => { if (drag) set(idxAt(e.clientX)); }}
              onPointerUp={() => setDrag(false)} onPointerCancel={() => setDrag(false)}
              onKeyDown={e => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); set(cur - 1); }
                else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); set(cur + 1); }
                else if (e.key === 'Home') { e.preventDefault(); set(lo); }
                else if (e.key === 'End') { e.preventDefault(); set(hi); }
              }}
              className="absolute top-1/2 w-11 h-11 -mt-[22px] -ml-[22px] flex items-center justify-center cursor-grab active:cursor-grabbing outline-none group/thumb"
              style={{ left: x, touchAction: 'none', zIndex: 2 }}>
              <span className="block rounded-full transition-[transform,box-shadow] duration-150 ease-out group-focus-visible/thumb:ring-2 group-focus-visible/thumb:ring-luxury-gold/60"
                style={{ width: THUMB, height: THUMB, background: 'radial-gradient(circle at 35% 30%, #F3DE8E, #DDB94B 55%, #A67C0A)', border: '2.5px solid var(--ek-bg, #0A0A0C)',
                  boxShadow: drag ? '0 0 0 5px rgba(221,185,75,0.22), 0 4px 12px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.45)', transform: drag ? 'scale(1.12)' : 'scale(1)' }} />
            </div>
          </div>
          <div className="relative h-4 -mt-1 text-[11px] font-bold tabular-nums text-luxury-gold" aria-hidden="true">
            <span className="absolute whitespace-nowrap text-center" style={{ left: clampL, width: LABEL_W }}>{label(ym(cur))}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2 text-xs text-zinc-500 tabular-nums">
        <span>{label(ym(lo))}</span><span>{label(ym(hi))}</span>
      </div>
    </div>
  );
};

export default MonthSlider;
