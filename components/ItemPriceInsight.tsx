import React, { useEffect, useMemo, useState } from 'react';
import { TrendingDown, TrendingUp, DollarSign } from 'lucide-react';
import ProductPriceChart from './ProductPriceChart';
import DateRangeSlider from './DateRangeSlider';
import { HistoryItem, buildPriceSeries, normalizeUnit } from '../services/productPriceStats';
import { titleCase } from '../services/textFormat';

/* Preço de um item no período: menor / médio / teto das compras e a linha do preço pago ao longo do tempo,
   com a média do período tracejada. Usado no Início (item escolhido) e no Histórico (busca por item). */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

interface Props {
  items: HistoryItem[];
  title: string;        // nome do item ou da busca
  periodTitle: string;  // "Outubro de 2026"
  testId?: string;
  // quem usa pode acompanhar o recorte escolhido na barrinha (null = período inteiro), p.ex. para filtrar a lista
  onRangeChange?: (r: { from: string; to: string } | null) => void;
}

const Cell = ({ icon: Icon, color, label, value, sub, title }: any) => (
  <div className="px-2 py-3.5 text-center min-w-0" title={title || undefined}>
    <div className="flex items-center justify-center gap-1.5 mb-1.5">
      <Icon className={`w-3.5 h-3.5 ${color}`} />
      <span className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold">{label}</span>
    </div>
    <h3 className="text-lg md:text-2xl font-serif text-white leading-none">{value}</h3>
    {sub ? <span className="text-xs text-zinc-500 tracking-wide block mt-1.5 truncate">{sub}</span> : null}
  </div>
);

const longDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const ItemPriceInsight: React.FC<Props> = ({ items: allItems, title, periodTitle, testId = 'item-price', onRangeChange }) => {
  const [unit, setUnit] = useState('');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => { setUnit(''); setRange(null); }, [title]);
  useEffect(() => { onRangeChange?.(range); }, [range]);   // eslint-disable-line react-hooks/exhaustive-deps

  // limites do período inteiro e recorte escolhido na barrinha
  const bounds = useMemo(() => {
    if (!allItems.length) return null;
    let mn = allItems[0].date, mx = allItems[0].date;
    allItems.forEach(i => { if (i.date < mn) mn = i.date; if (i.date > mx) mx = i.date; });
    return { min: mn, max: mx };
  }, [allItems]);
  const clipped = !!range && !!bounds && (range.from > bounds.min || range.to < bounds.max);
  const items = useMemo(
    () => (clipped && range ? allItems.filter(i => i.date >= range.from && i.date <= range.to) : allItems),
    [allItems, clipped, range]
  );
  const series = useMemo(() => buildPriceSeries(items, unit), [items, unit]);

  // menor e teto olhando cada compra (não a média do dia), na unidade que está no gráfico
  const rng = useMemo(() => {
    const sel = items.filter(i => i.unitPrice > 0 && normalizeUnit(i.unitType) === series.unit);
    if (!sel.length) return null;
    let lo = sel[0], hi = sel[0];
    sel.forEach(i => {
      if (i.unitPrice < lo.unitPrice || (i.unitPrice === lo.unitPrice && i.date > lo.date)) lo = i;
      if (i.unitPrice > hi.unitPrice || (i.unitPrice === hi.unitPrice && i.date > hi.date)) hi = i;
    });
    return { lo, hi, n: sel.length };
  }, [items, series.unit]);

  return (
    <div className="space-y-3" data-testid={testId}>
      {rng && (
        <div className="bg-black/60 border border-white/10 rounded-2xl grid grid-cols-3 divide-x divide-white/5 shadow-lg" data-testid={`${testId}-strip`}>
          <Cell icon={TrendingDown} color="text-emerald-500" label="Menor" value={brl.format(rng.lo.unitPrice)}
            sub={shortDate(rng.lo.date)} title={`${titleCase(rng.lo.establishment)} · ${series.unit}`} />
          <Cell icon={DollarSign} color="text-luxury-gold" label="Médio" value={brl.format(series.avg)}
            sub={`${rng.n} ${rng.n === 1 ? 'compra' : 'compras'}`} />
          <Cell icon={TrendingUp} color="text-red-500" label="Teto" value={brl.format(rng.hi.unitPrice)}
            sub={shortDate(rng.hi.date)} title={`${titleCase(rng.hi.establishment)} · ${series.unit}`} />
        </div>
      )}
      <ProductPriceChart series={series} onUnitChange={setUnit}
        periodTitle={`${title} · ${clipped && range ? `${longDate(range.from)} à ${longDate(range.to)}` : periodTitle}`}
        footer={bounds && bounds.min < bounds.max ? (
          <DateRangeSlider min={bounds.min} max={bounds.max}
            from={range ? range.from : bounds.min} to={range ? range.to : bounds.max}
            onChange={(f, t) => setRange(f <= bounds.min && t >= bounds.max ? null : { from: f, to: t })}
            testId={`${testId}-range`} />
        ) : undefined} />
    </div>
  );
};

export default ItemPriceInsight;
