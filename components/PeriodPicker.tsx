import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';

// Escolha de período num calendário só: toca no primeiro dia, navega por mês/ano e toca no último dia.
// Não há dois campos de data. Valores sempre em "aaaa-mm-dd" (vazio = sem limite).

interface PeriodPickerProps {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  placeholder?: string;
  className?: string;
  // 'field' = campo alto (Histórico); 'compact' = campo baixo das barras de filtro
  size?: 'field' | 'compact';
  // abre o calendário assim que o campo aparece (ex.: logo depois de tocar em "Período")
  openOnMount?: boolean;
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const todayIso = () => { const t = new Date(); return toIso(t.getFullYear(), t.getMonth(), t.getDate()); };

const parse = (iso: string): { y: number; m: number; d: number } | null => {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!mt) return null;
  return { y: Number(mt[1]), m: Number(mt[2]) - 1, d: Number(mt[3]) };
};
const br = (iso: string) => { const p = parse(iso); return p ? `${pad(p.d)}/${pad(p.m + 1)}/${p.y}` : ''; };
const brShort = (iso: string) => { const p = parse(iso); return p ? `${pad(p.d)}/${pad(p.m + 1)}` : ''; };
const dayCount = (a: string, b: string) => {
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return 0;
  return Math.round((Date.UTC(pb.y, pb.m, pb.d) - Date.UTC(pa.y, pa.m, pa.d)) / 86400000) + 1;
};
const longDay = (iso: string) => { const p = parse(iso); return p ? `${p.d} de ${MONTHS[p.m]} de ${p.y}` : iso; };

// Texto do campo fechado.
export const periodLabel = (start: string, end: string): string => {
  if (start && end) {
    if (start === end) return br(start);
    const a = parse(start)!, b = parse(end)!;
    return a.y === b.y ? `${brShort(start)} – ${br(end)}` : `${br(start)} – ${br(end)}`;
  }
  if (start) return `A partir de ${br(start)}`;
  if (end) return `Até ${br(end)}`;
  return '';
};

type View = 'days' | 'months' | 'years';

const PeriodPicker: React.FC<PeriodPickerProps> = ({ start, end, onChange, placeholder = 'Período', className = '', size = 'field', openOnMount = false }) => {
  const [open, setOpen] = useState(openOnMount);
  const label = periodLabel(start, end);
  const has = Boolean(start || end);

  const triggerCls = size === 'compact'
    ? 'py-1.5 pl-2 pr-2 rounded-lg text-xs bg-white/5 border border-white/10 focus-visible:border-luxury-gold/40'
    : 'py-3 sm:py-3.5 pl-3 pr-3 rounded-xl text-[13px] bg-white/5 border border-white/5';

  return (
    <>
      <div className={`relative flex items-center min-w-0 ${className}`}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="period-trigger"
          aria-haspopup="dialog"
          aria-label={has ? `Período: ${label}. Alterar` : 'Escolher período'}
          className={`w-full min-w-0 flex items-center gap-2 text-left font-medium transition-colors hover:border-luxury-gold/30 focus:outline-none ${triggerCls} ${has ? 'text-zinc-100' : 'text-zinc-400'} ${has ? 'pr-9' : ''}`}
        >
          <Calendar className={`w-4 h-4 shrink-0 ${has ? 'text-luxury-gold' : 'text-zinc-500'}`} />
          <span className="truncate tabular-nums">{has ? label : placeholder}</span>
        </button>
        {has && (
          <button
            type="button"
            onClick={() => onChange('', '')}
            aria-label="Limpar período"
            data-testid="period-clear"
            className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-luxury-gold"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {open && <PeriodSheet start={start} end={end} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  );
};

interface SheetProps {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  onClose: () => void;
}

const PeriodSheet: React.FC<SheetProps> = ({ start, end, onChange, onClose }) => {
  const today = todayIso();
  const first = parse(start) || parse(end) || parse(today)!;
  const [cursor, setCursor] = useState({ y: first.y, m: first.m });
  const [view, setView] = useState<View>('days');
  // Rascunho: o período só vale quando o último dia é tocado. Abrir de novo com um período já escolhido
  // e tocar num dia começa um período novo.
  const [a, setA] = useState(start);
  const [b, setB] = useState(end);
  const [hover, setHover] = useState('');
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const selecting = Boolean(a && !b);   // falta escolher o último dia

  const pick = (iso: string) => {
    if (!a || (a && b)) { setA(iso); setB(''); setHover(''); return; }
    // segundo toque: fecha o período (na ordem certa, mesmo tocando um dia antes do primeiro)
    const lo = iso < a ? iso : a, hi = iso < a ? a : iso;
    setA(lo); setB(hi);
    onChange(lo, hi);
    closeTimer.current = setTimeout(() => closeRef.current(), 260);
  };

  const preset = (lo: string, hi: string) => {
    setA(lo); setB(hi);
    const p = parse(lo);
    if (p) setCursor({ y: p.y, m: p.m });
    onChange(lo, hi);
    closeTimer.current = setTimeout(() => closeRef.current(), 200);
  };

  const presets = useMemo(() => {
    const t = parse(today)!;
    const monthStart = toIso(t.y, t.m, 1);
    const prevM = t.m === 0 ? { y: t.y - 1, m: 11 } : { y: t.y, m: t.m - 1 };
    const d30 = new Date(t.y, t.m, t.d - 29);
    return [
      { id: 'mes', label: 'Este mês', lo: monthStart, hi: today },
      { id: 'passado', label: 'Mês passado', lo: toIso(prevM.y, prevM.m, 1), hi: toIso(prevM.y, prevM.m, daysIn(prevM.y, prevM.m)) },
      { id: '30', label: '30 dias', lo: toIso(d30.getFullYear(), d30.getMonth(), d30.getDate()), hi: today },
      { id: 'ano', label: 'Este ano', lo: toIso(t.y, 0, 1), hi: today },
    ];
  }, [today]);

  const shiftMonth = (delta: number) => setCursor(c => {
    const n = c.y * 12 + c.m + delta;
    return { y: Math.floor(n / 12), m: ((n % 12) + 12) % 12 };
  });

  // Células do mês: dias em branco antes do dia 1 (domingo = coluna 0) e depois os dias.
  const cells = useMemo(() => {
    const lead = new Date(cursor.y, cursor.m, 1).getDay();
    const total = daysIn(cursor.y, cursor.m);
    const out: (number | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= total; d++) out.push(d);
    while (out.length % 7) out.push(null);
    return out;
  }, [cursor]);

  // Faixa que aparece pintada: período fechado, ou do 1º dia até onde o ponteiro está (prévia).
  let bandLo = '', bandHi = '';
  if (a && b) { bandLo = a; bandHi = b; }
  else if (a) { const h = hover || a; bandLo = h < a ? h : a; bandHi = h < a ? a : h; }
  const years = useMemo(() => {
    const t = new Date().getFullYear();
    const from = Math.min(2018, cursor.y), to = Math.max(t + 1, cursor.y);
    const out: number[] = [];
    for (let y = from; y <= to; y++) out.push(y);
    return out;
  }, [cursor.y]);

  const summary = a && b
    ? `${parse(a)?.y === parse(b)?.y ? brShort(a) : br(a)} → ${br(b)} · ${dayCount(a, b)} ${dayCount(a, b) === 1 ? 'dia' : 'dias'}`
    : a ? `Início em ${br(a)}. Toque no último dia.` : 'Toque no primeiro dia do período.';

  return createPortal(
    <div className="fixed inset-0 z-[310] flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Escolher período"
        data-testid="period-sheet"
        onClick={e => e.stopPropagation()}
        className="w-full md:max-w-sm bg-zinc-950 border border-white/10 md:rounded-3xl rounded-t-3xl shadow-2xl outline-none px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom-6 md:zoom-in-95 duration-200"
      >
        {/* Atalhos */}
        <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
          {presets.map(p => (
            <button key={p.id} type="button" onClick={() => preset(p.lo, p.hi)} data-testid={`period-preset-${p.id}`}
              className="shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold border border-white/10 text-zinc-300 hover:border-luxury-gold/40 hover:text-luxury-gold transition-colors">
              {p.label}
            </button>
          ))}
        </div>

        {/* Cabeçalho: setas mudam o mês; tocar no mês ou no ano abre a grade para pular direto */}
        <div className="flex items-center justify-between mb-2">
          <button type="button" onClick={() => view === 'days' ? shiftMonth(-1) : setCursor(c => ({ ...c, y: c.y - 1 }))} aria-label={view === 'days' ? 'Mês anterior' : 'Ano anterior'}
            className="w-11 h-11 flex items-center justify-center rounded-xl text-zinc-300 hover:text-luxury-gold hover:bg-white/5"><ChevronLeft className="w-5 h-5" /></button>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setView(v => v === 'months' ? 'days' : 'months')} data-testid="period-month-btn" aria-expanded={view === 'months'}
              className={`px-3 py-2 rounded-xl text-[15px] font-semibold hover:bg-white/5 ${view === 'months' ? 'text-luxury-gold' : 'text-zinc-100'}`}>{cap(MONTHS[cursor.m])}</button>
            <button type="button" onClick={() => setView(v => v === 'years' ? 'days' : 'years')} data-testid="period-year-btn" aria-expanded={view === 'years'}
              className={`px-3 py-2 rounded-xl text-[15px] font-semibold tabular-nums hover:bg-white/5 ${view === 'years' ? 'text-luxury-gold' : 'text-zinc-100'}`}>{cursor.y}</button>
          </div>
          <button type="button" onClick={() => view === 'days' ? shiftMonth(1) : setCursor(c => ({ ...c, y: c.y + 1 }))} aria-label={view === 'days' ? 'Próximo mês' : 'Próximo ano'}
            className="w-11 h-11 flex items-center justify-center rounded-xl text-zinc-300 hover:text-luxury-gold hover:bg-white/5"><ChevronRight className="w-5 h-5" /></button>
        </div>

        <div className="min-h-[300px]">
          {view === 'days' && (
            <div onPointerLeave={() => setHover('')}>
              <div className="grid grid-cols-7 mb-1">
                {WEEKDAYS.map((w, i) => <div key={i} className="h-8 flex items-center justify-center text-[11px] font-semibold text-zinc-500">{w}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {cells.map((d, i) => {
                  if (d === null) return <div key={i} className="h-11" />;
                  const iso = toIso(cursor.y, cursor.m, d);
                  const col = i % 7;
                  const inBand = Boolean(bandLo && bandHi && iso >= bandLo && iso <= bandHi);
                  const edge = iso === bandLo || iso === bandHi;
                  const selected = iso === a || iso === b;
                  const isToday = iso === today;
                  return (
                    <div key={i} className="relative h-11" onPointerEnter={() => selecting && setHover(iso)}>
                      {inBand && (
                        <div className={`absolute inset-y-1 inset-x-0 bg-luxury-gold/15 ${iso === bandLo || col === 0 ? 'rounded-l-full' : ''} ${iso === bandHi || col === 6 ? 'rounded-r-full' : ''}`} />
                      )}
                      <button
                        type="button"
                        onClick={() => pick(iso)}
                        data-testid={`period-day-${iso}`}
                        aria-label={longDay(iso)}
                        aria-pressed={selected}
                        className={`absolute inset-0 m-auto w-10 h-10 rounded-full flex items-center justify-center text-sm tabular-nums transition-colors
                          ${selected || (edge && inBand) ? 'bg-luxury-gold text-black font-bold' : inBand ? 'text-luxury-gold font-semibold' : isToday ? 'text-zinc-100 font-semibold ring-1 ring-luxury-gold/50' : 'text-zinc-200 hover:bg-white/10'}`}
                      >
                        {d}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {view === 'months' && (
            <div className="grid grid-cols-3 gap-2 pt-2">
              {MONTHS_ABBR.map((m, i) => (
                <button key={m} type="button" data-testid={`period-pick-month-${i}`} onClick={() => { setCursor(c => ({ ...c, m: i })); setView('days'); }}
                  className={`h-14 rounded-2xl text-[15px] font-semibold border transition-colors ${i === cursor.m ? 'bg-luxury-gold text-black border-luxury-gold' : 'border-white/10 text-zinc-200 hover:border-luxury-gold/40'}`}>
                  {cap(m)}
                </button>
              ))}
            </div>
          )}

          {view === 'years' && (
            <div className="grid grid-cols-4 gap-2 pt-2 max-h-[300px] overflow-y-auto">
              {years.map(y => (
                <button key={y} type="button" data-testid={`period-pick-year-${y}`} onClick={() => { setCursor(c => ({ ...c, y })); setView('months'); }}
                  className={`h-12 rounded-2xl text-[15px] font-semibold tabular-nums border transition-colors ${y === cursor.y ? 'bg-luxury-gold text-black border-luxury-gold' : 'border-white/10 text-zinc-200 hover:border-luxury-gold/40'}`}>
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Resumo e saída */}
        <div className="flex items-center justify-between gap-3 pt-3 mt-2 border-t border-white/10">
          <p className={`text-[13px] min-w-0 ${selecting ? 'text-luxury-gold' : 'text-zinc-400'}`} data-testid="period-summary" aria-live="polite">{summary}</p>
          <div className="flex items-center gap-2 shrink-0">
            {(a || b) && (
              <button type="button" onClick={() => { onChange('', ''); onClose(); }} data-testid="period-reset"
                className="px-3.5 py-2 rounded-xl text-xs font-bold border border-white/10 text-zinc-300 hover:text-red-400 hover:border-red-500/40">Limpar</button>
            )}
            <button type="button" onClick={onClose} data-testid="period-close"
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-zinc-200 hover:border-luxury-gold/40">Fechar</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default PeriodPicker;
