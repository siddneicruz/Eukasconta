import React, { useEffect, useMemo, useState } from 'react';
import { TrendingDown, TrendingUp, DollarSign } from 'lucide-react';
import ProductPriceChart from './ProductPriceChart';
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

const ItemPriceInsight: React.FC<Props> = ({ items, title, periodTitle, testId = 'item-price' }) => {
  const [unit, setUnit] = useState('');
  useEffect(() => { setUnit(''); }, [title]);
  const series = useMemo(() => buildPriceSeries(items, unit), [items, unit]);

  // menor e teto olhando cada compra (não a média do dia), na unidade que está no gráfico
  const range = useMemo(() => {
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
      {range && (
        <div className="bg-black/60 border border-white/10 rounded-2xl grid grid-cols-3 divide-x divide-white/5 shadow-lg" data-testid={`${testId}-strip`}>
          <Cell icon={TrendingDown} color="text-emerald-500" label="Menor" value={brl.format(range.lo.unitPrice)}
            sub={shortDate(range.lo.date)} title={`${titleCase(range.lo.establishment)} · ${series.unit}`} />
          <Cell icon={DollarSign} color="text-luxury-gold" label="Médio" value={brl.format(series.avg)}
            sub={`${range.n} ${range.n === 1 ? 'compra' : 'compras'}`} />
          <Cell icon={TrendingUp} color="text-red-500" label="Teto" value={brl.format(range.hi.unitPrice)}
            sub={shortDate(range.hi.date)} title={`${titleCase(range.hi.establishment)} · ${series.unit}`} />
        </div>
      )}
      <ProductPriceChart series={series} periodTitle={`${title} · ${periodTitle}`} onUnitChange={setUnit} />
    </div>
  );
};

export default ItemPriceInsight;
