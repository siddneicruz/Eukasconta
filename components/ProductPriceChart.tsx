import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  useXAxisScale, useYAxisScale, useChartWidth, usePlotArea,
} from 'recharts';
import { Pin, X } from 'lucide-react';
import { PriceSeries, SeriesPoint } from '../services/productPriceStats';

/* Gráfico de área do preço pago por dia, com a média do período em linha tracejada.
   Passar o dedo/mouse mostra a legenda; clicar num ponto TRAVA o rótulo nele (clicar de novo solta),
   e "Limpar rótulos" solta todos. */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const shortDate = (iso: string) => iso.split('-').reverse().join('/');
const dayMonth = (t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const monthYear = (t: number) => new Date(t).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('. de ', '/').replace(' de ', '/').replace('.', '');

const useIsLight = () => {
  const read = () => typeof document !== 'undefined' && document.documentElement.classList.contains('light-theme');
  const [light, setLight] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setLight(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return light;
};

const pctVsAvg = (price: number, avg: number) => (avg > 0 ? ((price - avg) / avg) * 100 : 0);
const fmtPct = (p: number) => `${p > 0 ? '+' : ''}${Math.round(p)}%`;
// Mais caro que a média é ruim (vermelho); mais barato é bom (verde).
const pctColor = (p: number, light: boolean) => (Math.abs(p) < 1 ? '#a1a1aa' : p > 0 ? (light ? '#dc2626' : '#f87171') : (light ? '#15803d' : '#34d399'));

interface PinnedProps {
  points: SeriesPoint[];
  pins: number[];
  avg: number;
  light: boolean;
}

// Desenha, dentro do gráfico, o ponto destacado e a caixinha de cada rótulo travado.
const PinnedLabels: React.FC<PinnedProps> = ({ points, pins, avg, light }) => {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const width = useChartWidth();
  const plot = usePlotArea();
  if (!xScale || !yScale || !plot || !pins.length) return null;

  const boxW = 104, boxH = 50;
  const bg = light ? '#ffffff' : '#09090b';
  const stroke = light ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.16)';
  const txt = light ? '#09090b' : '#fafafa';
  const sub = light ? '#71717a' : '#a1a1aa';

  return (
    <g style={{ pointerEvents: 'none' }}>
      {points.filter(p => pins.includes(p.t)).map(p => {
        const cx = xScale(p.t) as number;
        const cy = yScale(p.price) as number;
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
        const above = cy - boxH - 14 >= plot.y - 6;
        const by = above ? cy - boxH - 14 : cy + 14;
        const bx = Math.min(Math.max(cx - boxW / 2, 4), width - boxW - 4);
        const d = pctVsAvg(p.price, avg);
        return (
          <g key={p.t} data-pin={p.date}>
            <line x1={cx} x2={cx} y1={above ? cy - 6 : cy + 6} y2={above ? by + boxH : by} stroke="#D4AF37" strokeOpacity={0.6} strokeWidth={1} />
            <circle cx={cx} cy={cy} r={6} fill={bg} stroke="#D4AF37" strokeWidth={2.25} />
            <rect x={bx} y={by} width={boxW} height={boxH} rx={10} fill={bg} stroke={stroke} />
            <text x={bx + 10} y={by + 15} fontSize={10} fontWeight={700} letterSpacing="0.04em" fill={sub}>{shortDate(p.date)}</text>
            <text x={bx + 10} y={by + 32} fontSize={14} fontWeight={700} fill="#D4AF37" fontFamily="ui-serif, Georgia, serif">{brl.format(p.price)}</text>
            <text x={bx + 10} y={by + 44} fontSize={10} fontWeight={700} fill={pctColor(d, light)}>{fmtPct(d)} vs média</text>
          </g>
        );
      })}
    </g>
  );
};

interface ClickLayerProps { points: SeriesPoint[]; onPick: (t: number) => void; }

// Retângulo transparente sobre a área do gráfico: o clique/toque escolhe o ponto mais próximo no eixo do tempo.
const ClickLayer: React.FC<ClickLayerProps> = ({ points, onPick }) => {
  const xScale = useXAxisScale();
  const plot = usePlotArea();
  if (!xScale || !plot || !points.length) return null;
  const handle = (e: React.MouseEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const x = e.clientX - svg.getBoundingClientRect().left;
    let best = points[0], bestDist = Infinity;
    points.forEach(p => {
      const px = xScale(p.t) as number;
      const d = Math.abs(px - x);
      if (Number.isFinite(d) && d < bestDist) { best = p; bestDist = d; }
    });
    onPick(best.t);
  };
  return <rect className="click-layer" data-testid="click-layer" x={plot.x} y={plot.y} width={plot.width} height={plot.height} fill="transparent" style={{ cursor: 'pointer' }} onClick={handle} />;
};

const HoverTip = ({ active, payload, pins, avg, unit }: any) => {
  if (!active || !payload || !payload.length) return null;
  const p: SeriesPoint = payload[0].payload;
  if (pins.includes(p.t)) return null; // já tem rótulo fixo aqui
  const d = pctVsAvg(p.price, avg);
  return (
    <div className="bg-zinc-950 border border-white/10 px-3 py-2 rounded-xl shadow-2xl backdrop-blur-md min-w-[120px] pointer-events-none">
      <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-[0.1em] mb-1">{shortDate(p.date)}</p>
      <p className="text-luxury-gold font-sans text-base leading-none">{brl.format(p.price)}<span className="text-xs text-zinc-500 font-sans ml-1">/{unit}</span></p>
      <p className="text-xs mt-1 font-bold" style={{ color: pctColor(d, false) }}>{fmtPct(d)} vs média</p>
      <p className="text-xs text-zinc-500 mt-1">{num.format(p.qty)} {unit}{p.count > 1 ? ` · ${p.count} compras` : ''}</p>
    </div>
  );
};

// 4 a 5 marcações no eixo do tempo, sempre nas pontas e no meio.
const pickTicks = (points: SeriesPoint[], lo: number, hi: number): number[] => {
  if (points.length <= 5) return points.map(p => p.t);
  const out: number[] = [];
  for (let i = 0; i < 5; i++) out.push(Math.round(lo + ((hi - lo) * i) / 4));
  return out;
};

// Escala "redonda" para o eixo de preço: passos como 0,5 / 1 / 2 / 5 / 10...
const niceScale = (lo: number, hi: number) => {
  const span = Math.max(hi - lo, 0.01);
  const pow0 = Math.pow(10, Math.floor(Math.log10(span / 8)));
  let step = span / 4;
  outer: for (let k = 0; k < 4; k++) {
    for (const m of [1, 2, 2.5, 5]) {
      const cand = m * pow0 * Math.pow(10, k);
      if (Math.ceil(hi / cand) - Math.floor(lo / cand) <= 5) { step = cand; break outer; }
    }
  }
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo: start, hi: end, ticks };
};

interface Props {
  series: PriceSeries;
  periodTitle: string;
  onUnitChange?: (unit: string) => void;
}

const ProductPriceChart: React.FC<Props> = ({ series, periodTitle, onUnitChange }) => {
  const light = useIsLight();
  const { points, avg, unit, units } = series;
  const [pins, setPins] = useState<number[]>([]);

  // trocar de unidade ou de período limpa os rótulos travados
  useEffect(() => { setPins([]); }, [points]);

  const reduced = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const view = useMemo(() => {
    if (!points.length) return null;
    const first = points[0].t, last = points[points.length - 1].t;
    const day = 86400000;
    const pad = first === last ? 2 * day : Math.max(day, (last - first) * 0.04);
    const xLo = first - pad, xHi = last + pad;
    const pMin = Math.min(...points.map(p => p.price), avg || Infinity);
    const pMax = Math.max(...points.map(p => p.price), avg || 0);
    const span = pMax - pMin || pMax * 0.4 || 1;
    const rawLo = Math.max(0, pMin - span * 0.18);
    const rawHi = pMax + span * 0.32; // folga em cima para o rótulo caber
    const { lo: yLo, hi: yHi, ticks: yTicks } = niceScale(rawLo, rawHi);
    const ticks = pickTicks(points, first, last);
    // "ago/26 · ago/26" não ajuda: se dois rótulos de mês saíssem iguais, o eixo mostra dia/mês
    const monthLabels = ticks.map(monthYear);
    const longSpan = (last - first) / day > 45 && new Set(monthLabels).size === monthLabels.length;
    return { xLo, xHi, yLo, yHi, yTicks, ticks, fmtX: (t: number) => (longSpan ? monthYear(t) : dayMonth(t)) };
  }, [points, avg]);

  const toggle = (t: number) => setPins(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]));

  const gridColor = light ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)';
  const dotFill = light ? '#ffffff' : '#121214';
  const last = points[points.length - 1];
  const lastDelta = last ? pctVsAvg(last.price, avg) : 0;

  return (
    <div className="bg-black border border-white/10 rounded-[2rem] p-5 md:p-8 shadow-2xl relative overflow-hidden group" data-testid="price-chart">
      <div className="absolute top-0 left-0 w-72 h-72 bg-luxury-gold/5 blur-[90px] rounded-full pointer-events-none group-hover:bg-luxury-gold/10 transition-all duration-1000" />
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h3 className="text-[11px] text-zinc-500 uppercase tracking-[0.1em] font-bold mb-1">Preço pago no período</h3>
            <p className="text-xs text-zinc-500 truncate">{periodTitle}</p>
          </div>
          {units.length > 1 && (
            <div className="shrink-0 inline-flex p-0.5 rounded-full bg-white/5 border border-white/10">
              {units.map(u => (
                <button key={u} onClick={() => onUnitChange && onUnitChange(u)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-[0.08em] transition-colors ${u === unit ? 'bg-luxury-gold text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>
                  {u}
                </button>
              ))}
            </div>
          )}
        </div>

        {!view ? (
          <p className="text-xs text-zinc-500 py-10 text-center">Nenhuma compra deste item no período selecionado.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-x-3 gap-y-1 mb-4">
              <span className="text-3xl md:text-4xl font-serif font-bold tracking-tighter text-white leading-none">{brl.format(avg)}</span>
              <span className="text-[11px] text-zinc-500 uppercase tracking-[0.08em] pb-0.5">média paga / {unit}</span>
              {points.length > 1 && last && (
                <span className="text-xs font-bold pb-0.5" style={{ color: pctColor(lastDelta, light) }}>
                  última compra {fmtPct(lastDelta)} vs média
                </span>
              )}
            </div>

            <div className="h-[210px] md:h-[300px] -mx-2 select-none [&_.recharts-wrapper]:!outline-none [&_.recharts-surface]:!outline-none [&_svg]:!outline-none [&_.recharts-surface_*:not(.click-layer)]:!pointer-events-none" style={{ cursor: 'pointer' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 6, right: 14, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ppGold" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#D4AF37" stopOpacity={0.42} />
                      <stop offset="100%" stopColor="#D4AF37" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                  <XAxis dataKey="t" type="number" scale="time" domain={[view.xLo, view.xHi]} ticks={view.ticks}
                    tickFormatter={view.fmtX} axisLine={false} tickLine={false}
                    tick={{ fill: '#a1a1aa', fontSize: 11, fontWeight: 600 }} dy={8} />
                  <YAxis domain={[view.yLo, view.yHi]} ticks={view.yTicks} axisLine={false} tickLine={false} width={46}
                    tick={{ fill: '#8b8b95', fontSize: 11 }}
                    tickFormatter={(v: number) => (v >= 100 ? String(Math.round(v)) : Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ','))} />
                  <Tooltip cursor={{ stroke: '#D4AF37', strokeOpacity: 0.35, strokeDasharray: '3 3' }} wrapperStyle={{ pointerEvents: 'none', zIndex: 20 }}
                    content={(p: any) => <HoverTip {...p} pins={pins} avg={avg} unit={unit} />} />
                  {avg > 0 && (
                    <ReferenceLine y={avg} stroke={light ? '#15803d' : '#34d399'} strokeOpacity={0.85} strokeDasharray="5 5"
                      label={{ value: `média ${brl.format(avg)}`, position: 'insideBottomRight', fill: light ? '#15803d' : '#34d399', fontSize: 10, fontWeight: 700 }} />
                  )}
                  <Area type="monotone" dataKey="price" stroke="#D4AF37" strokeWidth={2.5} fill="url(#ppGold)"
                    dot={points.length <= 60 ? { r: 3, fill: '#D4AF37', stroke: dotFill, strokeWidth: 1.5 } : false}
                    activeDot={{ r: 5.5, stroke: '#D4AF37', strokeWidth: 2, fill: dotFill }}
                    isAnimationActive={!reduced} animationDuration={1200} animationEasing="ease-out" />
                  <PinnedLabels points={points} pins={pins} avg={avg} light={light} />
                  <ClickLayer points={points} onPick={toggle} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center justify-between gap-3 mt-3 text-xs text-zinc-500">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-2"><span className="w-4 h-[2px] bg-luxury-gold rounded-full" /> Preço pago</span>
                <span className="inline-flex items-center gap-2"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: light ? '#15803d' : '#34d399' }} /> Média do período</span>
              </div>
              {pins.length > 0 ? (
                <button onClick={() => setPins([])} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-zinc-300 font-bold uppercase tracking-[0.08em] text-[11px] hover:border-luxury-gold/40 hover:text-luxury-gold transition-colors">
                  <X className="w-3 h-3" /> Limpar rótulos ({pins.length})
                </button>
              ) : (
                <span className="shrink-0 inline-flex items-center gap-1 text-zinc-600"><Pin className="w-3 h-3" /> toque num ponto para fixar</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ProductPriceChart;
