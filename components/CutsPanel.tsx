import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Recharts from 'recharts';
import { Plus, X, Filter, Pencil, ArrowLeftRight, CalendarRange, PieChart as PieChartIcon, Store, Undo2 } from 'lucide-react';
import { Receipt } from '../types';
import CutEditorSheet from './CutEditorSheet';
import { getCategoryColor } from './Dashboard';
import {
  Cut, analyzeCut, cutTitle, loadCuts, rangeLabel, saveCuts,
} from '../services/cuts';
import { buildDeptOptions, deptFilterLabel, deptLabelFor, invertDeptFilter, isDeptFilterActive } from '../services/deptFilter';
import { TL_AXIS_Y_WIDTH, TL_MARGIN_RIGHT, renderTimelineTick, renderTimelineYTick, useElementWidth } from '../services/chartFormat';

const { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } = Recharts;

/* Aba "Recortes": etiquetas de períodos que a pessoa grava (do dia tal ao dia tal, com ou sem categorias).
   Tocar numa etiqueta mostra a análise só daquele recorte; o ✕ apaga (com "Desfazer"). */

interface Props {
  receipts: Receipt[];
  displayName: (name: string, cnpj: string) => string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const pctText = (p: number) => `${(p >= 10 ? Math.round(p) : Math.round(p * 10) / 10).toString().replace('.', ',')}%`;
const UNDO_MS = 7000;
const DEPTS_SHOWN = 6;
const STORES_SHOWN = 5;

const CutTooltip = ({ active, payload }: any) => {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload || {};
  return (
    <div className="bg-zinc-950 border border-white/10 px-3 py-2 rounded-xl shadow-xl backdrop-blur-md" data-testid="cut-tooltip">
      <p className="text-luxury-gold text-[11px] font-semibold leading-none">{p.label || p.name}</p>
      <p className="text-[13px] font-semibold text-white tabular-nums mt-1.5">{brl(Number(p.value) || 0)}</p>
    </div>
  );
};

interface ViewProps {
  cut: Cut;
  receipts: Receipt[];
  displayName: (name: string, cnpj: string) => string;
  onEdit: () => void;
  onChangeFilter: (cut: Cut) => void;
}

const CutAnalysisView: React.FC<ViewProps> = ({ cut, receipts, displayName, onEdit, onChangeFilter }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(chartRef);
  const plotWidth = Math.max(120, width - TL_AXIS_Y_WIDTH - TL_MARGIN_RIGHT);
  const [allDepts, setAllDepts] = useState(false);

  const a = useMemo(() => analyzeCut(receipts, cut, plotWidth), [receipts, cut, plotWidth]);
  const options = useMemo(
    () => buildDeptOptions(receipts, receipts.filter(r => r.date >= cut.from && r.date <= cut.to)),
    [receipts, cut.from, cut.to],
  );

  const active = isDeptFilterActive(cut.filter);
  const filterText = deptFilterLabel(cut.filter, k => deptLabelFor(options, k));
  const range = rangeLabel(cut.from, cut.to);
  const named = cut.name.trim().length > 0;
  const prevLabel = rangeLabel(a.prevFrom, a.prevTo);
  const running = a.elapsed < a.days;
  const empty = a.total === 0;

  const up = a.delta !== null && a.delta > 0;
  const down = a.delta !== null && a.delta < 0;
  const deltaTxt = a.delta === null ? '' : pctText(Math.abs(a.delta));

  const depts = allDepts ? a.byDept : a.byDept.slice(0, DEPTS_SHOWN);
  const stores = a.byStore.slice(0, STORES_SHOWN);
  const topStore = stores[0]?.value || 0;

  return (
    <div className="space-y-3 md:space-y-4" data-testid="cut-analysis" data-cut-id={cut.id}>
      <div className="bg-[#121214] border border-white/5 rounded-2xl md:rounded-[1.75rem] p-3 md:p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[15px] md:text-lg font-semibold text-zinc-100 truncate" data-testid="cut-title">{cutTitle(cut)}</h3>
            <p className="text-[11px] text-zinc-500 tabular-nums mt-0.5" data-testid="cut-sub">
              {named ? `${range} · ` : ''}{a.days} {a.days === 1 ? 'dia' : 'dias'}{running ? ` · ${a.elapsed} já passaram` : ''}
            </p>
          </div>
          <button type="button" onClick={onEdit} data-testid="cut-edit" aria-label="Editar recorte"
            className="shrink-0 w-10 h-10 -mr-1.5 -mt-1.5 flex items-center justify-center rounded-xl text-zinc-500 hover:text-luxury-gold">
            <Pencil className="w-4 h-4" />
          </button>
        </div>

        {active && (
          <div className="flex items-center gap-1.5 mt-2">
            <span className="min-w-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold dept-active text-[11px] font-semibold" data-testid="cut-filter-label">
              <Filter className="w-3 h-3 shrink-0" /><span className="truncate">{filterText}</span>
            </span>
            <button type="button" onClick={() => onChangeFilter({ ...cut, filter: invertDeptFilter(cut.filter) })} data-testid="cut-invert"
              className="shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-white/10 text-[11px] font-semibold text-zinc-300 hover:text-luxury-gold hover:border-luxury-gold/40">
              <ArrowLeftRight className="w-3 h-3" /> Inverter
            </button>
          </div>
        )}

        <p className="mt-3 text-2xl font-serif font-bold text-white tabular-nums leading-none" data-testid="cut-total">{brl(a.total)}</p>
        <p className="mt-1.5 text-[11px] leading-snug text-zinc-500 tabular-nums" data-testid="cut-delta">
          {a.delta === null ? (
            <>Sem gastos no período anterior ({prevLabel})</>
          ) : (
            <>
              <span className={`font-semibold ${up ? 'text-rose-400' : down ? 'text-emerald-400' : 'text-zinc-400'}`}>{up ? '▲' : down ? '▼' : '='} {deltaTxt}</span>
              {' '}em relação a {prevLabel} ({brl(a.prevTotal)})
            </>
          )}
        </p>

        {/* o contêiner fica sempre montado: é nele que se mede a largura para escolher os rótulos do eixo */}
        <div ref={chartRef} className="tl-chart w-full mt-2.5">
          {empty ? (
            <p className="py-10 text-center text-[13px] text-zinc-500" data-testid="cut-nospend">Nenhuma compra neste recorte.</p>
          ) : (
            <div className="h-[170px] md:h-[260px] w-full" data-testid="cut-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={a.series.points} margin={{ top: 8, right: TL_MARGIN_RIGHT, left: 0, bottom: 2 }}>
                  <CartesianGrid strokeDasharray="2 6" vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} ticks={a.series.ticks} interval={0} tick={renderTimelineTick} height={24} />
                  <YAxis axisLine={false} tickLine={false} width={TL_AXIS_Y_WIDTH} tick={renderTimelineYTick} tickCount={4} />
                  <Tooltip content={<CutTooltip />} cursor={{ stroke: 'rgba(212,175,55,0.3)', strokeWidth: 1, strokeDasharray: '3 4' }} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#D4AF37"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dot={a.series.showAllDots ? { r: 2.25, className: 'tl-dot', stroke: '#D4AF37', strokeWidth: 1.25 } : false}
                    activeDot={{ r: 3.5, className: 'tl-dot', stroke: '#D4AF37', strokeWidth: 1.5 }}
                    animationDuration={700}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {!empty && (
          <>
            <div className="grid grid-cols-3 divide-x divide-white/5 mt-2 pt-2 border-t border-white/5" data-testid="cut-kpis">
              <div className="pr-2 min-w-0">
                <p className="text-[10px] text-zinc-500">Média por dia</p>
                <p className="text-[14px] md:text-lg font-serif font-bold text-white tabular-nums leading-tight truncate" data-testid="cut-kpi-day">{brl(a.perDay)}</p>
              </div>
              <div className="px-3 min-w-0">
                <p className="text-[10px] text-zinc-500">Compras</p>
                <p className="text-[14px] md:text-lg font-serif font-bold text-white tabular-nums leading-tight truncate">
                  <span data-testid="cut-kpi-receipts">{a.receipts}</span>
                  <span className="ml-1.5 text-[10px] md:text-[11px] font-sans font-normal text-zinc-500" data-testid="cut-kpi-items">{a.items} {a.items === 1 ? 'item' : 'itens'}</span>
                </p>
              </div>
              <div className="pl-3 min-w-0">
                <p className="text-[10px] text-zinc-500">Média por compra</p>
                <p className="text-[14px] md:text-lg font-serif font-bold text-white tabular-nums leading-tight truncate" data-testid="cut-kpi-avg">{brl(a.perReceipt)}</p>
              </div>
            </div>
            {a.peak && (
              <p className="mt-2 text-[11px] text-zinc-500 tabular-nums" data-testid="cut-peak">
                Dia que mais gastou: <span className="text-zinc-300 font-semibold">{rangeLabel(a.peak.date, a.peak.date)}</span> · {brl(a.peak.value)}
              </p>
            )}
          </>
        )}
      </div>

      {!empty && a.byDept.length > 0 && (
        <div className="bg-[#121214] border border-white/5 rounded-2xl md:rounded-[1.75rem] p-3 md:p-6 shadow-xl" data-testid="cut-depts">
          <h3 className="text-[12px] font-semibold text-zinc-300 flex items-center gap-1.5 mb-2 px-0.5">
            <PieChartIcon className="w-3.5 h-3.5 text-luxury-gold" /> Por categoria
          </h3>
          <ul>
            {depts.map(d => {
              const color = getCategoryColor(d.name);
              return (
                <li key={d.key} className="py-1.5" data-testid="cut-dept-row" data-key={d.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="truncate text-[13px] text-zinc-200">{d.name}</span>
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold text-white tabular-nums">
                      {brl(d.value)} <span className="text-[11px] text-zinc-500 font-normal">{pctText(d.pct)}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-[3px] rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, d.pct)}%`, backgroundColor: color }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {a.byDept.length > DEPTS_SHOWN && (
            <button type="button" onClick={() => setAllDepts(v => !v)} data-testid="cut-depts-more"
              className="mt-1.5 h-9 w-full rounded-xl text-xs font-semibold text-zinc-400 hover:text-luxury-gold">
              {allDepts ? 'Mostrar menos' : `Ver todas (${a.byDept.length})`}
            </button>
          )}
        </div>
      )}

      {!empty && stores.length > 0 && (
        <div className="bg-[#121214] border border-white/5 rounded-2xl md:rounded-[1.75rem] p-3 md:p-6 shadow-xl" data-testid="cut-stores">
          <h3 className="text-[12px] font-semibold text-zinc-300 flex items-center gap-1.5 mb-2 px-0.5">
            <Store className="w-3.5 h-3.5 text-emerald-500" /> Onde comprou
          </h3>
          <ul>
            {stores.map(s => (
              <li key={s.key} className="py-1.5" data-testid="cut-store-row">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[13px] text-zinc-200">
                    {displayName(s.name, s.cnpj)} <span className="text-[11px] text-zinc-500">· {s.count} {s.count === 1 ? 'compra' : 'compras'}</span>
                  </span>
                  <span className="shrink-0 text-[13px] font-semibold text-white tabular-nums">{brl(s.value)}</span>
                </div>
                <div className="mt-1 h-[3px] rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500/80" style={{ width: `${topStore > 0 ? Math.max(1.5, (s.value / topStore) * 100) : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const CutsPanel: React.FC<Props> = ({ receipts, displayName, selectedId, onSelect }) => {
  const [cuts, setCuts] = useState<Cut[]>(() => loadCuts());
  const [editor, setEditor] = useState<{ cut: Cut | null } | null>(null);
  const [undo, setUndo] = useState<{ cut: Cut } | null>(null);
  const tagsRef = useRef<HTMLDivElement>(null);

  const commit = (next: Cut[]) => { setCuts(next); saveCuts(next); };

  // mais recente primeiro
  const sorted = useMemo(
    () => [...cuts].sort((x, y) => y.from.localeCompare(x.from) || y.to.localeCompare(x.to) || y.createdAt.localeCompare(x.createdAt)),
    [cuts],
  );
  const current = sorted.find(c => c.id === selectedId) || sorted[0] || null;

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);

  // a etiqueta escolhida fica sempre à vista
  useEffect(() => {
    if (!current) return;
    const el = tagsRef.current?.querySelector<HTMLElement>(`[data-cut-id="${current.id}"]`);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [current?.id]);

  const remove = (c: Cut) => {
    commit(cuts.filter(x => x.id !== c.id));
    setUndo({ cut: c });
  };

  const restore = () => {
    if (!undo) return;
    commit([...cuts.filter(x => x.id !== undo.cut.id), undo.cut]);
    onSelect(undo.cut.id);
    setUndo(null);
  };

  const save = (c: Cut) => {
    commit(cuts.some(x => x.id === c.id) ? cuts.map(x => (x.id === c.id ? c : x)) : [...cuts, c]);
    onSelect(c.id);
    setEditor(null);
  };

  const replace = (c: Cut) => commit(cuts.map(x => (x.id === c.id ? c : x)));

  return (
    <div className="space-y-3 md:space-y-4" data-testid="cuts-panel">
      {sorted.length === 0 ? (
        <div className="bg-[#121214] border border-white/5 rounded-2xl md:rounded-[1.75rem] px-5 py-8 text-center shadow-xl" data-testid="cut-empty">
          <div className="mx-auto w-11 h-11 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold flex items-center justify-center mb-3"><CalendarRange className="w-5 h-5" /></div>
          <p className="text-[15px] font-semibold text-zinc-100">Crie um recorte do tempo</p>
          <p className="text-[13px] text-zinc-500 mt-1.5 max-w-xs mx-auto leading-snug">
            Escolha de que dia até que dia (e, se quiser, só algumas categorias). Ele fica salvo aqui como etiqueta, com a análise só desse período.
          </p>
          <button type="button" onClick={() => setEditor({ cut: null })} data-testid="cut-new"
            className="mt-5 h-11 px-6 rounded-xl bg-luxury-gold text-black text-sm font-bold hover:bg-white transition-colors inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> Criar recorte
          </button>
        </div>
      ) : (
        <>
          <div ref={tagsRef} className="flex flex-wrap items-center gap-2" data-testid="cut-tags">
            <button type="button" onClick={() => setEditor({ cut: null })} data-testid="cut-new"
              className="h-10 pl-3 pr-3.5 rounded-full border border-dashed border-luxury-gold/50 text-luxury-gold dept-active text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-luxury-gold/10 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Novo
            </button>
            {sorted.map(c => {
              const on = current?.id === c.id;
              return (
                <span key={c.id} data-testid="cut-tag" data-cut-id={c.id} data-selected={on ? 'true' : 'false'}
                  className={`inline-flex items-center h-10 max-w-full rounded-full border text-xs font-semibold transition-colors ${on ? 'bg-luxury-gold text-black border-luxury-gold' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                  <button type="button" onClick={() => onSelect(c.id)} aria-pressed={on} data-testid="cut-tag-select"
                    className="h-full min-w-0 pl-3.5 pr-1.5 flex items-center gap-1.5 rounded-l-full">
                    {isDeptFilterActive(c.filter) && <Filter className="w-3 h-3 shrink-0" aria-label="Com filtro de categorias" />}
                    <span className="truncate tabular-nums">{cutTitle(c)}</span>
                    {c.name.trim() && (<>
                      {' '}<span className={`shrink-0 text-[10px] font-medium tabular-nums ${on ? 'text-black/60' : 'text-zinc-500'}`} data-testid="cut-tag-dates">{rangeLabel(c.from, c.to)}</span>
                    </>)}
                  </button>
                  <button type="button" onClick={() => remove(c)} data-testid="cut-tag-remove" aria-label={`Apagar recorte ${cutTitle(c)}`}
                    className={`shrink-0 w-9 h-full flex items-center justify-center rounded-r-full transition-colors ${on ? 'text-black/60 hover:text-black' : 'text-zinc-500 hover:text-red-400'}`}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              );
            })}
          </div>

          {current && (
            <CutAnalysisView
              key={current.id}
              cut={current}
              receipts={receipts}
              displayName={displayName}
              onEdit={() => setEditor({ cut: current })}
              onChangeFilter={replace}
            />
          )}
        </>
      )}

      {undo && (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-900 border border-white/10 pl-4 pr-1.5 py-1.5 shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200" role="status" data-testid="cut-undo-bar">
          <span className="min-w-0 truncate text-[13px] text-zinc-300">Recorte “{cutTitle(undo.cut)}” apagado</span>
          <button type="button" onClick={restore} data-testid="cut-undo"
            className="shrink-0 h-10 px-3.5 rounded-xl text-[13px] font-bold text-luxury-gold dept-active inline-flex items-center gap-1.5 hover:bg-white/5">
            <Undo2 className="w-4 h-4" /> Desfazer
          </button>
        </div>
      )}

      {editor && <CutEditorSheet receipts={receipts} initial={editor.cut} onSave={save} onClose={() => setEditor(null)} />}
    </div>
  );
};

export default CutsPanel;
