import React, { useEffect, useMemo, useState } from 'react';
import * as Recharts from 'recharts';
import { ChevronLeft, ChevronRight, Goal, Plus, Save, Trash2, TrendingUp, Undo2, X, Check } from 'lucide-react';
import { Receipt } from '../types';
import CategoryCompareBox from './CategoryCompareBox';
import { useLayers, useTaxonomy } from './LayersContext';
import { CompareOption, buildCompareOptions, chipLabel, matcherFor } from '../services/categoryCompare';
import { fold } from '../services/itemSearch';
import { AXIS_Y_WIDTH, TL_MARGIN_RIGHT, renderTimelineTick, renderTimelineYTick } from '../services/chartFormat';

const { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart, Area, Line, ReferenceLine } = Recharts;

/* Aba "Metas": cada meta é uma etiqueta (como os recortes). A meta vale por mês: o gráfico mostra o mês escolhido
   contra o teto, no acumulado (com a linha do ritmo ideal, a tendência e o mês anterior) ou dia a dia.
   A cor da linha é escolhida pela pessoa e fica gravada junto com a meta. */

export const GOALS_KEY = 'eukasconta_category_goals';
export const GOAL_COLORS_KEY = 'eukasconta_goal_colors';
const PALETTE = ['#D4AF37', '#10B981', '#3B82F6', '#A855F7', '#EC4899', '#F97316', '#06B6D4', '#EF4444'];
const UNDO_MS = 7000;
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const round2 = (n: number) => Math.round(n * 100) / 100;
const pctText = (p: number) => `${Math.round(p)}%`;

const readJson = (k: string): Record<string, any> => {
  try { const v = JSON.parse(localStorage.getItem(k) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
};
const writeJson = (k: string, v: Record<string, any>) => {
  try { localStorage.setItem(k, JSON.stringify(v)); window.dispatchEvent(new Event('storage')); } catch { /* sem armazenamento */ }
};

interface Row { day: number; label: string; full: string; cur?: number; curCum?: number; proj?: number; ideal: number; prevCum?: number }

/** Série do mês: gasto por dia e acumulado até hoje, projeção de fechamento, ritmo ideal da meta e o mês anterior. */
export const buildGoalMonth = (receipts: Receipt[], match: (category: string, description?: string) => boolean, y: number, m: number, goal: number, today = new Date()) => {
  const days = new Date(y, m + 1, 0).getDate();
  const ym = (yy: number, mm: number) => `${yy}-${String(mm + 1).padStart(2, '0')}`;
  const sumByDay = (yy: number, mm: number) => {
    const out = new Map<number, number>();
    const pre = ym(yy, mm);
    receipts.forEach(r => {
      if (!r.date || !r.date.startsWith(pre)) return;
      const d = Number(r.date.slice(8, 10));
      (r.items || []).forEach(i => { if (match(String(i.category || ''), i.description)) out.set(d, (out.get(d) || 0) + (Number(i.totalPrice) || 0)); });
    });
    return out;
  };
  const cur = sumByDay(y, m);
  const py = m === 0 ? y - 1 : y, pm = m === 0 ? 11 : m - 1;
  const prev = sumByDay(py, pm);
  const prevDays = new Date(py, pm + 1, 0).getDate();
  const isCurrent = today.getFullYear() === y && today.getMonth() === m;
  const isPast = y < today.getFullYear() || (y === today.getFullYear() && m < today.getMonth());
  const elapsed = isCurrent ? today.getDate() : isPast ? days : 0;

  const rows: Row[] = [];
  let acc = 0, pacc = 0;
  for (let d = 1; d <= days; d++) {
    const row: Row = { day: d, label: String(d), full: `${String(d).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}`, ideal: goal > 0 ? round2((goal * d) / days) : 0 };
    if (d <= elapsed) { const v = round2(cur.get(d) || 0); acc += v; row.cur = v; row.curCum = round2(acc); }
    if (d <= prevDays) { pacc += prev.get(d) || 0; row.prevCum = round2(pacc); }
    rows.push(row);
  }
  const total = round2(acc);
  let projection: number | null = null;
  if (isCurrent && total > 0 && elapsed >= 3 && elapsed < days) {
    const pace = total / elapsed;
    for (let d = elapsed; d <= days; d++) rows[d - 1].proj = round2(total + pace * (d - elapsed));
    projection = round2(pace * days);
  }
  return { rows, days, elapsed, total, projection, isCurrent, prevTotalToDate: round2(rows[Math.min(elapsed, prevDays) - 1]?.prevCum ?? 0) };
};

const GoalTooltip = ({ active, payload, mode, color }: any) => {
  if (!active || !payload || !payload.length) return null;
  const row: Row = payload[0].payload;
  const acum = mode === 'acum';
  const line = (label: string, value: number | undefined, c: string, dashed = false) => value === undefined ? null : (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="w-3 shrink-0 border-t-2" style={{ borderColor: c, borderStyle: dashed ? 'dashed' : 'solid' }} />
        <span className="text-[11px] text-zinc-300 truncate">{label}</span>
      </span>
      <span className="text-[12px] font-semibold text-white tabular-nums shrink-0">{brl(value)}</span>
    </div>
  );
  return (
    <div className="bg-zinc-950 border border-white/10 px-3 py-2 rounded-xl shadow-xl backdrop-blur-md max-w-[240px]" data-testid="goal-tooltip">
      <p className="text-luxury-gold text-[11px] font-semibold leading-none">{row.full}</p>
      <div className="mt-1.5 space-y-1">
        {acum ? (<>
          {line('Acumulado', row.curCum, color)}
          {row.curCum === undefined && line('Tendência', row.proj, color, true)}
          {line('Ritmo da meta', row.ideal || undefined, '#a1a1aa', true)}
          {line('Mês anterior', row.prevCum, '#71717a', true)}
        </>) : line('No dia', row.cur, color)}
      </div>
    </div>
  );
};

interface Props { receipts: Receipt[] }

const GoalsPanel: React.FC<Props> = ({ receipts }) => {
  const layers = useLayers();
  const taxonomy = useTaxonomy();
  const now = new Date();
  const [goals, setGoals] = useState<Record<string, number>>(() => readJson(GOALS_KEY) as Record<string, number>);
  const [colors, setColors] = useState<Record<string, string>>(() => readJson(GOAL_COLORS_KEY) as Record<string, string>);
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState('');
  const [draft, setDraft] = useState('');
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [mode, setMode] = useState<'acum' | 'dia'>('acum');
  const [saved, setSaved] = useState(false);
  const [undo, setUndo] = useState<{ key: string; value: number; color?: string } | null>(null);

  useEffect(() => {
    const on = () => { setGoals(readJson(GOALS_KEY) as Record<string, number>); setColors(readJson(GOAL_COLORS_KEY) as Record<string, string>); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), UNDO_MS); return () => clearTimeout(t); }, [undo]);
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(false), 1600); return () => clearTimeout(t); }, [saved]);

  const monthReceipts = useMemo(() => {
    const pre = `${month.y}-${String(month.m + 1).padStart(2, '0')}`;
    return receipts.filter(r => r.date && r.date.startsWith(pre));
  }, [receipts, month]);
  const options = useMemo(() => buildCompareOptions(receipts, monthReceipts, { layers, taxonomy, includeUnused: true }), [receipts, monthReceipts, layers, taxonomy]);
  const optByFull = useMemo(() => new Map(options.map(o => [fold(o.full), o] as [string, CompareOption])), [options]);

  // etiquetas: uma por meta que ainda aponta para algo que existe
  const tags = useMemo(() => Object.keys(goals)
    .map(key => ({ key, value: Number(goals[key]) || 0, opt: optByFull.get(fold(key)) }))
    .filter((t): t is { key: string; value: number; opt: CompareOption } => !!t.opt && t.value > 0), [goals, optByFull]);
  const colorOf = (key: string): string => {
    const hit = Object.keys(colors).find(k => fold(k) === fold(key));
    return (hit && colors[hit]) || PALETTE[0];
  };

  const current = tags.find(t => t.key === sel) || (adding ? null : tags[0] || null);
  const showNew = adding || tags.length === 0;

  useEffect(() => { if (current && sel !== current.key) setSel(current.key); }, [current?.key]);
  useEffect(() => { if (current) setDraft(String(current.value)); }, [current?.key, current?.value]);

  const commitGoals = (next: Record<string, number>) => { setGoals(next); writeJson(GOALS_KEY, next); };
  const commitColors = (next: Record<string, string>) => { setColors(next); writeJson(GOAL_COLORS_KEY, next); };

  const saveCurrent = () => {
    const v = parseFloat(draft.replace(',', '.'));
    if (!current || isNaN(v) || v <= 0) return;
    commitGoals({ ...goals, [current.key]: v });
    setSaved(true);
  };
  const createGoal = () => {
    const v = parseFloat(draft.replace(',', '.'));
    const opt = options.find(o => o.id === newId);
    if (!opt || isNaN(v) || v <= 0) return;
    const existing = Object.keys(goals).find(k => fold(k) === fold(opt.full)) ?? opt.full;
    commitGoals({ ...goals, [existing]: v });
    setAdding(false); setNewId(''); setSel(existing); setSaved(true);
  };
  const removeGoal = (key: string) => {
    const color = Object.keys(colors).find(k => fold(k) === fold(key));
    setUndo({ key, value: goals[key], color: color ? colors[color] : undefined });
    const next = { ...goals }; delete next[key]; commitGoals(next);
    if (sel === key) setSel(null);
  };
  const restoreGoal = () => {
    if (!undo) return;
    commitGoals({ ...goals, [undo.key]: undo.value });
    if (undo.color) commitColors({ ...colors, [undo.key]: undo.color });
    setSel(undo.key); setUndo(null);
  };
  const pickColor = (key: string, c: string) => {
    const next = { ...colors };
    Object.keys(next).forEach(k => { if (fold(k) === fold(key)) delete next[k]; });
    next[key] = c;
    commitColors(next);
  };

  const a = useMemo(() => {
    if (!current) return null;
    return buildGoalMonth(receipts, matcherFor(current.opt.id, layers), month.y, month.m, current.value);
  }, [current?.opt.id, current?.value, receipts, month, layers]);

  const monthLabel = `${MONTHS[month.m]}/${String(month.y).slice(2)}`;
  const isNow = month.y === now.getFullYear() && month.m === now.getMonth();
  const shift = (d: number) => setMonth(({ y, m }) => { const t = new Date(y, m + d, 1); return { y: t.getFullYear(), m: t.getMonth() }; });
  const tagOpts = tags.map(t => t.opt);

  const saveBtn = 'shrink-0 h-12 px-4 rounded-xl bg-luxury-gold text-black text-sm font-bold inline-flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-40';
  const inputCls = 'w-full h-12 bg-black/60 border border-white/10 rounded-2xl px-4 text-sm text-luxury-gold font-bold outline-none focus:border-luxury-gold/40';

  const color = current ? colorOf(current.key) : PALETTE[0];
  const pct = current && a ? (a.total / current.value) * 100 : 0;
  const over = current && a ? a.total > current.value : false;
  const projOver = current && a && a.projection !== null ? a.projection > current.value : false;
  const left = current && a ? current.value - a.total : 0;
  const daysLeft = a ? a.days - a.elapsed : 0;
  const perDay = current && a && !over && daysLeft > 0 ? left / daysLeft : 0;
  const chartMax = current && a ? Math.max(current.value, a.total, a.projection ?? 0, ...a.rows.map(r => r.prevCum ?? 0)) * 1.05 : 0;
  const ticks = a ? [1, 5, 10, 15, 20, 25, a.days].filter((d, i, arr) => d <= a.days && arr.indexOf(d) === i && !(d === 25 && a.days - 25 < 3)) : [];

  return (
    <div className="space-y-3 md:space-y-4" data-testid="goals-card">
      <div className="flex flex-wrap items-center gap-2" data-testid="goal-tags">
        <button type="button" onClick={() => { setAdding(true); setSel(null); setNewId(''); setDraft(''); }} data-testid="goal-new"
          className="h-10 pl-3 pr-3.5 rounded-full border border-dashed border-luxury-gold/50 text-luxury-gold dept-active text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-luxury-gold/10 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Nova meta
        </button>
        {tags.map(t => {
          const on = !adding && current?.key === t.key;
          return (
            <span key={t.key} data-testid="goal-tag" data-selected={on ? 'true' : 'false'}
              className={`inline-flex items-center h-10 max-w-full rounded-full border text-xs font-semibold transition-colors ${on ? 'bg-luxury-gold text-black border-luxury-gold' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
              <button type="button" onClick={() => { setAdding(false); setSel(t.key); }} aria-pressed={on} data-testid="goal-tag-select"
                className="h-full min-w-0 pl-3 pr-1.5 flex items-center gap-1.5 rounded-l-full">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/20" style={{ backgroundColor: colorOf(t.key) }} />
                <span className="truncate">{chipLabel(t.opt, tagOpts)}</span>
                <span className={`shrink-0 text-[10px] font-medium tabular-nums ${on ? 'text-black/60' : 'text-zinc-500'}`}>{brl(t.value)}</span>
              </button>
              <button type="button" onClick={() => removeGoal(t.key)} data-testid="goal-tag-remove" aria-label={`Apagar meta ${chipLabel(t.opt, tagOpts)}`}
                className={`shrink-0 w-9 h-full flex items-center justify-center rounded-r-full transition-colors ${on ? 'text-black/60 hover:text-black' : 'text-zinc-500 hover:text-red-400'}`}>
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          );
        })}
      </div>

      {showNew && (
        <div className="bg-[#121214] border border-white/5 rounded-2xl md:rounded-[1.75rem] p-3 md:p-6 shadow-xl" data-testid="goal-new-card">
          <h3 className="text-[12px] font-semibold text-zinc-300 flex items-center gap-1.5 mb-1"><Goal className="w-3.5 h-3.5 text-blue-400" /> Nova meta do mês</h3>
          <p className="text-[12px] text-zinc-500 mb-3 leading-snug">Escolha o departamento, a categoria, o grupo ou o item e o teto de gasto por mês. Ela fica aqui como etiqueta.</p>
          <div className="space-y-2.5">
            <CategoryCompareBox options={options} selected={newId ? [newId] : []} max={1} single onToggle={id => setNewId(prev => (prev === id ? '' : id))}
              testId="goal-search" placeholder="Escolha o que vai ter meta" valueLabel={options.find(o => o.id === newId)?.full} />
            <div className="flex gap-2">
              <input type="number" inputMode="decimal" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Teto do mês, em R$" className={inputCls} data-testid="goal-value" />
              <button type="button" onClick={createGoal} disabled={!newId || !(parseFloat(draft) > 0)} className={saveBtn} data-testid="goal-save-new"><Save className="w-4 h-4" /> Salvar</button>
            </div>
            {tags.length > 0 && <button type="button" onClick={() => setAdding(false)} className="text-[12px] text-zinc-500 underline underline-offset-2">Cancelar</button>}
          </div>
        </div>
      )}

      {!showNew && current && a && (
        <div className="bg-[#121214] border border-white/5 rounded-2xl md:rounded-[1.75rem] p-3 md:p-6 shadow-xl" data-testid="goal-analysis">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[15px] md:text-lg font-semibold text-zinc-100 truncate" data-testid="goal-title">{current.opt.full.split(' - ').join(' › ')}</h3>
              <p className="text-[11px] text-zinc-500 mt-0.5 tabular-nums">Meta de {brl(current.value)} por mês</p>
            </div>
            <div className="shrink-0 flex items-center gap-0.5 -mr-1.5 -mt-1" role="group" aria-label="Mês da meta">
              <button type="button" onClick={() => shift(-1)} aria-label="Mês anterior" data-testid="goal-prev" className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 active:bg-white/5"><ChevronLeft className="w-4 h-4" /></button>
              <span className="min-w-[52px] text-center text-[12px] font-semibold text-zinc-200 tabular-nums" data-testid="goal-month">{monthLabel}</span>
              <button type="button" onClick={() => shift(1)} aria-label="Próximo mês" data-testid="goal-next" disabled={isNow || month.y > now.getFullYear() || (month.y === now.getFullYear() && month.m >= now.getMonth())}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 active:bg-white/5 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="mt-3 flex items-end justify-between gap-3">
            <p className="text-2xl font-serif font-bold text-white tabular-nums leading-none" data-testid="goal-spent">{brl(a.total)}</p>
            <span className={`shrink-0 inline-flex items-center h-7 px-2.5 rounded-full text-[11px] font-semibold border ${over ? 'text-rose-400 border-rose-400/40 bg-rose-400/10' : projOver ? 'text-amber-500 border-amber-500/40 bg-amber-500/10' : 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10'}`} data-testid="goal-status">
              {over ? 'Meta estourada' : projOver ? 'Vai passar da meta' : 'Dentro da meta'}
            </span>
          </div>
          <div className="mt-2.5 h-2 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: over ? '#f43f5e' : color }} />
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-500 tabular-nums" data-testid="goal-left">
            {pctText(pct)} da meta · {over ? `passou ${brl(-left)}` : `faltam ${brl(left)}`}
            {a.isCurrent && !over && daysLeft > 0 ? ` · pode gastar ${brl(perDay)} por dia até o fim do mês` : ''}
          </p>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex rounded-full bg-white/5 border border-white/10 p-0.5" role="group" aria-label="Tipo de gráfico">
              {([['acum', 'Acumulado'], ['dia', 'Dia a dia']] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setMode(k)} aria-pressed={mode === k} data-testid={`goal-mode-${k}`}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${mode === k ? 'bg-luxury-gold text-black' : 'text-zinc-400'}`}>{label}</button>
              ))}
            </div>
          </div>

          <div className="tl-chart w-full mt-2.5 h-[200px] md:h-[300px]" data-testid="goal-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={a.rows} margin={{ top: 8, right: TL_MARGIN_RIGHT, left: 0, bottom: 2 }}>
                <defs>
                  <linearGradient id="goalFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.38} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 6" vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} ticks={ticks} interval={0} tick={renderTimelineTick} height={24} />
                <YAxis axisLine={false} tickLine={false} width={AXIS_Y_WIDTH - 12} tick={renderTimelineYTick} tickCount={4} domain={[0, mode === 'acum' ? chartMax : 'auto']} />
                <Tooltip content={(p: any) => <GoalTooltip {...p} mode={mode} color={color} />} cursor={{ stroke: 'rgba(212,175,55,0.3)', strokeWidth: 1, strokeDasharray: '3 4' }} />
                {mode === 'acum' && <ReferenceLine y={current.value} stroke={color} strokeDasharray="8 6" strokeWidth={1.5} ifOverflow="extendDomain" />}
                {mode === 'dia' && <ReferenceLine y={current.value / a.days} stroke={color} strokeDasharray="8 6" strokeWidth={1.25} strokeOpacity={0.7} ifOverflow="extendDomain" />}
                {mode === 'acum' && <Line type="linear" dataKey="prevCum" stroke="#71717a" strokeWidth={1.5} strokeDasharray="4 5" dot={false} activeDot={false} isAnimationActive={false} />}
                {mode === 'acum' && <Line type="linear" dataKey="ideal" stroke="#a1a1aa" strokeOpacity={0.8} strokeWidth={1.25} strokeDasharray="2 4" dot={false} activeDot={false} isAnimationActive={false} />}
                {mode === 'acum' && a.projection !== null && <Line type="linear" dataKey="proj" stroke={color} strokeOpacity={0.75} strokeWidth={2} strokeDasharray="2 6" strokeLinecap="round" dot={false} activeDot={false} isAnimationActive={false} />}
                <Area type="monotone" dataKey={mode === 'acum' ? 'curCum' : 'cur'} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="url(#goalFill)" fillOpacity={1}
                  dot={false} activeDot={{ r: 3.5, stroke: color, strokeWidth: 1.5 }} animationDuration={700} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-[11px] text-zinc-500" data-testid="goal-legend">
            <span className="inline-flex items-center gap-1.5"><span className="w-4 h-[2px] rounded-full" style={{ backgroundColor: color }} /> {mode === 'acum' ? 'Acumulado' : 'No dia'}</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: color }} /> {mode === 'acum' ? 'Meta' : 'Meta por dia'}</span>
            {mode === 'acum' && <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dotted border-zinc-400" /> Ritmo da meta</span>}
            {mode === 'acum' && a.projection !== null && <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dotted" style={{ borderColor: color }} /> Tendência</span>}
            {mode === 'acum' && <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-zinc-500" /> Mês anterior</span>}
          </div>

          {a.projection !== null && mode === 'acum' && (
            <div className="mt-3 flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/10" data-testid="goal-projection">
              <span className="p-2 rounded-xl shrink-0" style={{ backgroundColor: `${color}22`, color }}><TrendingUp className="w-4 h-4" /></span>
              <p className="text-[13px] text-zinc-400 leading-snug">
                No ritmo atual o mês fecha em <strong className="text-white font-semibold">{brl(a.projection)}</strong>
                {a.projection > current.value ? <>, <strong className="text-rose-400 font-semibold">{brl(a.projection - current.value)} acima</strong> da meta.</> : <>, dentro da meta ({brl(current.value - a.projection)} de folga).</>}
              </p>
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-white/5 space-y-3">
            <div>
              <p className="text-[11px] text-zinc-500 mb-1.5">Cor da linha no gráfico</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor da linha" data-testid="goal-colors">
                {PALETTE.map(c => (
                  <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Cor ${c}`} onClick={() => pickColor(current.key, c)} data-testid="goal-color"
                    className="w-9 h-9 rounded-full flex items-center justify-center ring-offset-2 ring-offset-[#121214] transition-shadow" style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px #121214, 0 0 0 4px ${c}` : undefined }}>
                    {color === c && <Check className="w-4 h-4 text-white drop-shadow" />}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-zinc-500 mb-1.5">Teto do mês</p>
              <div className="flex gap-2">
                <input type="number" inputMode="decimal" value={draft} onChange={e => setDraft(e.target.value)} className={inputCls} data-testid="goal-value" aria-label="Teto do mês" />
                <button type="button" onClick={saveCurrent} disabled={!(parseFloat(draft) > 0) || parseFloat(draft) === current.value} className={saveBtn} data-testid="goal-save">
                  {saved ? <><Check className="w-4 h-4" /> Salvo</> : <><Save className="w-4 h-4" /> Salvar</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {undo && (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-900 border border-white/10 pl-4 pr-1.5 py-1.5 shadow-xl" role="status" data-testid="goal-undo-bar">
          <span className="min-w-0 truncate text-[13px] text-zinc-300 flex items-center gap-2"><Trash2 className="w-3.5 h-3.5 shrink-0 text-zinc-500" /> Meta apagada</span>
          <button type="button" onClick={restoreGoal} data-testid="goal-undo" className="shrink-0 h-10 px-3.5 rounded-xl text-[13px] font-bold text-luxury-gold dept-active inline-flex items-center gap-1.5 active:bg-white/5">
            <Undo2 className="w-4 h-4" /> Desfazer
          </button>
        </div>
      )}
    </div>
  );
};

export default GoalsPanel;
