import React, { useMemo, useRef } from 'react';
import * as Recharts from 'recharts';
import { LineChart as LineChartIcon, X } from 'lucide-react';
import { Receipt, DashboardConfig } from '../types';
import CategoryCompareBox from './CategoryCompareBox';
import CompareDonut from './CompareDonut';
import { useLayers } from './LayersContext';
import {
  CompareOption, buildCompareSeries, computeCompareStats, chipLabel,
} from '../services/categoryCompare';
import {
  TL_AXIS_Y_WIDTH, TL_MARGIN_RIGHT, renderTimelineTick, renderTimelineYTick, useElementWidth, brlAxis,
} from '../services/chartFormat';

const { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } = Recharts;

export interface ChosenCompare { id: string; color: string; opt: CompareOption }

interface Props {
  options: CompareOption[];
  chosen: ChosenCompare[];
  onToggle: (id: string) => void;
  max: number;
  receipts: Receipt[];          // já filtrados pelo período
  config: DashboardConfig;
}

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

interface LineDef { key: string; label: string; color: string }

// Balão pequeno: a data (ou mês) em cima e, embaixo, só quem gastou naquele ponto, do maior para o menor.
const CompareTooltip = ({ active, payload, lines }: any) => {
  if (!active || !payload || !payload.length) return null;
  const point = payload[0].payload || {};
  const rows = (lines as LineDef[])
    .map(l => ({ ...l, value: Number(point[l.key]) || 0 }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value);
  return (
    <div className="bg-zinc-950 border border-white/10 px-3 py-2 rounded-xl shadow-xl backdrop-blur-md max-w-[240px]" data-testid="compare-tooltip">
      <p className="text-luxury-gold text-[11px] font-semibold leading-none">{point.label || point.name}</p>
      {rows.length === 0 ? (
        <p className="text-zinc-500 text-[11px] mt-1.5">Sem gastos</p>
      ) : (
        <div className="mt-1.5 space-y-1">
          {rows.map(r => (
            <div key={r.key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                <span className="text-[11px] text-zinc-300 truncate">{r.label}</span>
              </span>
              <span className="text-[12px] font-semibold text-white tabular-nums shrink-0">{brl(r.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const CompareCard: React.FC<Props> = ({ options, chosen, onToggle, max, receipts, config }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const layers = useLayers();
  const width = useElementWidth(chartRef);
  const plotWidth = Math.max(120, width - TL_AXIS_Y_WIDTH - TL_MARGIN_RIGHT);

  const ids = useMemo(() => chosen.map(c => c.id), [chosen]);
  const idsKey = ids.join('|');
  const stats = useMemo(() => computeCompareStats(receipts, ids, layers), [receipts, idsKey, layers]);
  const cmp = useMemo(() => buildCompareSeries(receipts, ids, config, plotWidth, new Date(), layers), [receipts, idsKey, config, plotWidth, layers]);

  const perCat = useMemo(() => chosen.map(c => ({ id: c.id, color: c.color, total: computeCompareStats(receipts, [c.id], layers).total })), [receipts, idsKey, layers]);
  const opts = chosen.map(c => c.opt);
  const lines: LineDef[] = chosen.map((c, i) => ({ key: cmp.keys[i], label: chipLabel(c.opt, opts), color: c.color }));
  const share = stats.periodTotal > 0 ? (stats.total / stats.periodTotal) * 100 : 0;
  const empty = chosen.length === 0;
  const noSpend = !empty && stats.total === 0;

  return (
    <div className="bg-[#121214] border border-white/5 rounded-2xl md:rounded-[1.75rem] p-3 md:p-6 shadow-xl" data-testid="compare-card">
      <div className="flex items-center justify-between gap-3 mb-2.5 px-0.5">
        <h3 className="text-[12px] font-semibold text-zinc-300 flex items-center gap-1.5">
          <LineChartIcon className="w-3.5 h-3.5 text-luxury-gold" /> Comparar categorias
        </h3>
        <span className="text-[11px] text-zinc-500 truncate" data-testid="compare-caption">{cmp.caption}</span>
      </div>

      <CategoryCompareBox options={options} selected={ids} max={max} onToggle={onToggle} />

      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5" data-testid="compare-chips">
          {chosen.map((c, i) => (
            <span key={c.id} className="inline-flex items-center h-8 pl-2.5 pr-0.5 rounded-full bg-white/5 border border-white/10 text-xs max-w-full" data-testid="compare-chip">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
              <span className="ml-1.5 font-semibold text-zinc-200 truncate">{lines[i].label}</span>
              {c.opt.total > 0 && <span className="hidden md:inline ml-1.5 text-[11px] text-zinc-500 tabular-nums shrink-0">{brlAxis(c.opt.total)}</span>}
              <button type="button" aria-label={`Tirar ${lines[i].label} da comparação`} data-testid="compare-chip-remove"
                onClick={() => onToggle(c.id)}
                className="ml-0.5 w-7 h-7 shrink-0 flex items-center justify-center rounded-full text-zinc-500 hover:text-luxury-gold transition-colors">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* o contêiner fica sempre montado: é nele que se mede a largura para escolher os rótulos do eixo */}
      <div ref={chartRef} className="tl-chart w-full mt-2.5">
        {empty ? (
          <p className="py-10 text-center text-[13px] text-zinc-500" data-testid="compare-empty">
            Busque ou escolha categorias acima para comparar.
          </p>
        ) : noSpend ? (
          <p className="py-10 text-center text-[13px] text-zinc-500" data-testid="compare-nospend">
            Nenhum gasto dessas categorias neste período.
          </p>
        ) : (
          <div className="h-[184px] md:h-[280px] w-full" data-testid="compare-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cmp.points} margin={{ top: 8, right: TL_MARGIN_RIGHT, left: 0, bottom: 2 }}>
                <defs>
                  {chosen.map((c, i) => (
                    <linearGradient key={c.id} id={`cmpFill-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c.color} stopOpacity={0.38} />
                      <stop offset="100%" stopColor={c.color} stopOpacity={0.03} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="2 6" vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} ticks={cmp.ticks} interval={0} tick={renderTimelineTick} height={24} />
                <YAxis axisLine={false} tickLine={false} width={TL_AXIS_Y_WIDTH} tick={renderTimelineYTick} tickCount={4} domain={[0, 'auto']} />
                <Tooltip
                  content={(p: any) => <CompareTooltip {...p} lines={lines} />}
                  cursor={{ stroke: 'rgba(212,175,55,0.3)', strokeWidth: 1, strokeDasharray: '3 4' }}
                />
                {chosen.map((c, i) => (
                  <Area
                    key={c.id}
                    type="monotone"
                    dataKey={cmp.keys[i]}
                    name={lines[i].label}
                    stroke={c.color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill={`url(#cmpFill-${i})`}
                    fillOpacity={1}
                    dot={cmp.showAllDots ? { r: 2.25, className: 'tl-dot', stroke: c.color, strokeWidth: 1.25 } : false}
                    activeDot={{ r: 3.5, className: 'tl-dot', stroke: c.color, strokeWidth: 1.5 }}
                    animationDuration={700}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {!empty && (
        <div className="grid grid-cols-3 divide-x divide-white/5 mt-2 pt-2 border-t border-white/5" data-testid="compare-kpis">
          <div className="pr-2 min-w-0">
            <p className="text-[10px] text-zinc-500">Gasto <span className="tabular-nums">({share >= 10 ? Math.round(share) : share.toFixed(1).replace('.', ',')}%)</span></p>
            <p className="text-[14px] md:text-lg font-serif font-bold text-white tabular-nums leading-tight truncate" data-testid="kpi-total">{brl(stats.total)}</p>
          </div>
          <div className="px-3 min-w-0">
            <p className="text-[10px] text-zinc-500">Itens em {stats.receipts} {stats.receipts === 1 ? 'compra' : 'compras'}</p>
            <p className="text-[14px] md:text-lg font-serif font-bold text-white tabular-nums leading-tight" data-testid="kpi-items">{stats.items}</p>
          </div>
          <div className="pl-3 min-w-0">
            <p className="text-[10px] text-zinc-500">Média por compra</p>
            <p className="text-[14px] md:text-lg font-serif font-bold text-white tabular-nums leading-tight truncate" data-testid="kpi-avg">{brl(stats.avg)}</p>
          </div>
        </div>
      )}
      {!empty && !noSpend && chosen.length > 1 && (
        <CompareDonut items={chosen.map((c, i) => ({ id: c.id, color: c.color, label: lines[i].label, total: perCat[i]?.total ?? 0 }))} />
      )}
    </div>
  );
};

export default CompareCard;
