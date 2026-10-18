
import React, { useMemo, useState } from 'react';
import { Receipt } from '../types';
import { ChevronLeft, Calendar, Clock, MapPin, ArrowUpRight, Hash, TrendingUp, DollarSign, PieChart, Filter, X, ShoppingBag, ChevronDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, CartesianGrid, ReferenceDot, Label } from 'recharts';
import { getCategoryColor } from './Dashboard';
import { deptKey, sameDept, masterOf, properCase } from '../services/textFormat';
import { priceBasis } from '../services/eggs';
import { useStoreNames } from './StoreNamesContext';

interface EstablishmentDetailViewProps {
  establishmentName: string; // 'TODOS' ou Nome Específico
  receipts: Receipt[];
  onBack: () => void;
  onSelectReceipt: (receipt: Receipt) => void;
}

const EstablishmentDetailView: React.FC<EstablishmentDetailViewProps> = ({ establishmentName, receipts, onBack, onSelectReceipt }) => {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const { nameOf, keyOf } = useStoreNames();
  const isGlobalView = establishmentName === 'TODOS';
  // a loja é reconhecida pelo apelido: filiais e nomes lidos de formas diferentes entram juntos
  const targetKey = useMemo(
      () => keyOf(establishmentName, receipts.find(r => r.establishmentName === establishmentName)?.cnpj),
      [establishmentName, receipts, keyOf]);

  const relevantReceipts = useMemo(() => {
    return receipts
        .filter(r => isGlobalView ? true : keyOf(r.establishmentName, r.cnpj) === targetKey)
        .sort((a, b) => new Date(b.date + 'T' + (b.time || '00:00')).getTime() - new Date(a.date + 'T' + (a.time || '00:00')).getTime());
  }, [receipts, targetKey, isGlobalView, keyOf]);

  const stats = useMemo(() => {
    const total = relevantReceipts.reduce((acc, r) => acc + r.totalAmount, 0);
    const count = relevantReceipts.length;
    const average = count > 0 ? total / count : 0;
    return { total, count, average };
  }, [relevantReceipts]);

  const categoryChartData = useMemo(() => {
      // "HORTIFRUTI" e "Hortifruti" contam como o mesmo departamento
      const groups = new Map<string, { total: number; variants: Map<string, number> }>();
      relevantReceipts.forEach(r => {
          r.items.forEach(item => {
              const rootCat = masterOf(item.category) || 'Outros';
              const key = deptKey(rootCat);
              let g = groups.get(key);
              if (!g) { g = { total: 0, variants: new Map() }; groups.set(key, g); }
              g.total += item.totalPrice;
              g.variants.set(rootCat, (g.variants.get(rootCat) || 0) + item.totalPrice);
          });
      });
      return Array.from(groups.values())
        .map(g => {
            const name = Array.from(g.variants.entries()).sort((a, b) => b[1] - a[1])[0][0];
            return { name, label: properCase(name), value: g.total, color: getCategoryColor(name) };
        })
        .sort((a, b) => b.value - a.value);
  }, [relevantReceipts]);

  const filteredReceipts = useMemo(() => {
      if (!selectedCategory) return relevantReceipts;
      return relevantReceipts.filter(r => r.items.some(item => sameDept(item.category, selectedCategory)));
  }, [relevantReceipts, selectedCategory]);

  const highestUnitPriceItem = useMemo(() => {
      let maxItem = { price: 0, description: '', date: '', unitType: '' };
      relevantReceipts.forEach(r => {
          r.items.forEach(item => {
              // ovo com a quantidade conhecida entra pelo preço da dúzia
              const basis = priceBasis(item);
              let effectivePrice = basis.unitPrice || (item.quantity > 0 ? item.totalPrice / item.quantity : 0);
              if (effectivePrice > maxItem.price) {
                  maxItem = { price: effectivePrice, description: item.description, date: r.date, unitType: basis.unitType || 'UN' };
              }
          });
      });
      return maxItem.price > 0 ? maxItem : null;
  }, [relevantReceipts]);

  const { chartData: evolutionChartData, activePoint } = useMemo(() => {
    if (relevantReceipts.length === 0) return { chartData: [], activePoint: null };
    const sorted = [...relevantReceipts].sort((a, b) => a.date.localeCompare(b.date));
    
    const aggregated: Record<string, number> = {};
    sorted.forEach(r => {
        const d = new Date(r.date + 'T12:00:00');
        const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        aggregated[key] = (aggregated[key] || 0) + r.totalAmount;
    });

    const finalData = Object.entries(aggregated)
        .map(([key, value]) => {
            const [y, m] = key.split('-');
            const date = new Date(parseInt(y), parseInt(m) - 1, 1);
            return { label: date.toLocaleDateString('pt-BR', { month: 'short' }).toUpperCase().replace('.', ''), value, rawKey: key };
        });

    let point = null;
    if (highestUnitPriceItem) {
        const itemMonthKey = highestUnitPriceItem.date.substring(0, 7);
        point = finalData.find(d => d.rawKey === itemMonthKey);
    }

    return { chartData: finalData, activePoint: point };
  }, [relevantReceipts, highestUnitPriceItem]);

  // Linha do tempo: anos e meses em ordem cronológica (do mais novo ao mais antigo), cada mês com seu total.
  const timelineYears = useMemo(() => {
      const years = new Map<string, Map<string, { key: string; name: string; order: number; receipts: Receipt[]; total: number }>>();
      filteredReceipts.forEach(r => {
          const d = new Date(r.date + 'T12:00:00');
          const valid = !isNaN(d.getTime());
          const year = valid ? String(d.getFullYear()) : 'INDETERMINADO';
          const mIdx = valid ? d.getMonth() : -1;
          const name = valid ? d.toLocaleString('pt-BR', { month: 'long' }) : 'Sem data';
          const key = `${year}|${mIdx}`;
          let ym = years.get(year);
          if (!ym) { ym = new Map(); years.set(year, ym); }
          let g = ym.get(key);
          if (!g) { g = { key, name, order: mIdx, receipts: [], total: 0 }; ym.set(key, g); }
          g.receipts.push(r);
          g.total += Number(r.totalAmount) || 0;
      });
      return Array.from(years.entries())
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([year, ym]) => ({ year, months: Array.from(ym.values()).sort((a, b) => b.order - a.order) }));
  }, [filteredReceipts]);
  const allMonths = useMemo(() => timelineYears.flatMap(y => y.months), [timelineYears]);

  // Recolher/expandir: com muitos cupons, só os meses mais recentes começam abertos; a pessoa muda quando quiser.
  const [manualCollapsed, setManualCollapsed] = useState<Set<string> | null>(null);
  React.useEffect(() => { setManualCollapsed(null); }, [selectedCategory, establishmentName]);
  const autoCollapsed = useMemo(() => {
      const closed = new Set<string>();
      let shown = 0;
      allMonths.forEach((g, i) => {
          if (i > 0 && shown >= 15) closed.add(g.key);
          else shown += g.receipts.length;
      });
      return closed;
  }, [allMonths]);
  const collapsed = manualCollapsed ?? autoCollapsed;
  const allCollapsed = allMonths.length > 0 && allMonths.every(g => collapsed.has(g.key));
  const toggleMonth = (key: string) => {
      const next = new Set(collapsed);
      if (next.has(key)) next.delete(key); else next.add(key);
      setManualCollapsed(next);
  };
  const toggleAll = () => setManualCollapsed(allCollapsed ? new Set() : new Set(allMonths.map(g => g.key)));

  return (
    <div className="animate-in fade-in slide-in-from-right-8 duration-500 pb-20">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 border border-white/5 transition-colors"><ChevronLeft className="w-5 h-5" /></button>
        <div>
            <span className="text-[11px] text-zinc-500 uppercase tracking-[0.08em] block mb-1">
                {isGlobalView ? 'Fluxo Financeiro Unificado' : 'Histórico da Loja'}
            </span>
            <h2 className="text-2xl font-serif text-white tracking-wide uppercase">{isGlobalView ? establishmentName : nameOf(establishmentName, receipts.find(r => r.establishmentName === establishmentName)?.cnpj)}</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <KPIBlock icon={<DollarSign className="w-6 h-6 text-luxury-gold" />} label="TOTAL" value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(stats.total)} />
        <KPIBlock icon={<Hash className="w-6 h-6 text-zinc-400" />} label="VISITAS" value={stats.count.toString()} />
        <KPIBlock icon={<TrendingUp className="w-6 h-6 text-emerald-500" />} label="MÉDIO" value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(stats.average)} />
      </div>

      <div className="mb-10 bg-black border border-white/10 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
             <div className="absolute top-0 right-0 w-64 h-64 bg-luxury-gold/5 blur-[80px] rounded-full pointer-events-none" />
             <div className="flex justify-between items-center mb-6 px-2">
                 <h3 className="text-xs text-zinc-500 uppercase tracking-[0.08em] font-bold">Evolução Mensal de Gastos</h3>
                 <span className="text-[11px] border border-luxury-gold/20 text-luxury-gold px-2 py-0.5 rounded bg-luxury-gold/5 uppercase font-bold">Análise Temporal</span>
             </div>
             <div className="h-[250px] w-full">
                 <ResponsiveContainer width="100%" height="100%">
                     <AreaChart data={evolutionChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.3}/><stop offset="95%" stopColor="#D4AF37" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#71717a', fontSize: 10 }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 10 }} tickFormatter={(val) => `R$${val}`} />
                        <Tooltip contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '12px' }} itemStyle={{ color: '#D4AF37' }} />
                        <Area type="monotone" dataKey="value" stroke="#D4AF37" strokeWidth={2} fillOpacity={1} fill="url(#colorVal)" />
                     </AreaChart>
                 </ResponsiveContainer>
             </div>
      </div>

      <div className="mb-12">
        <div className="flex items-center justify-between mb-6 px-1">
             <div className="flex items-center gap-2">
                 <Clock className="w-4 h-4 text-zinc-500" />
                 <h3 className="text-zinc-400 text-xs uppercase tracking-[0.08em] font-bold">Linha do Tempo de Compras</h3>
             </div>
             {allMonths.length > 1 && (
                 <button type="button" onClick={toggleAll} data-testid="timeline-toggle-all"
                     aria-label={allCollapsed ? 'Expandir todos os meses' : 'Recolher todos os meses'}
                     title={allCollapsed ? 'Expandir todos os meses' : 'Recolher todos os meses'}
                     className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-zinc-400 hover:text-luxury-gold hover:border-luxury-gold/30 transition-colors">
                     {allCollapsed ? <ChevronsUpDown className="w-4 h-4" /> : <ChevronsDownUp className="w-4 h-4" />}
                 </button>
             )}
        </div>

        <div className="relative pl-4 border-l border-white/10 ml-2 space-y-8" data-testid="timeline">
            {timelineYears.map(({ year, months }) => (
                <div key={year} className="relative">
                    <div className="absolute -left-[35px] bg-black text-zinc-500 text-xs font-bold py-1 px-2 border border-white/10 rounded rotate-[-90deg] origin-center translate-y-4">
                        {year}
                    </div>
                    {months.map((g) => {
                        const isCollapsed = collapsed.has(g.key);
                        return (
                        <div key={g.key} data-month={g.key} className="mb-8 pl-4">
                            <button type="button" onClick={() => toggleMonth(g.key)} aria-expanded={!isCollapsed} data-testid="timeline-month"
                                className={`w-full flex items-center justify-between gap-3 text-left -ml-1 pl-1 pr-2 py-1.5 rounded-xl hover:bg-white/[0.03] transition-colors ${isCollapsed ? '' : 'mb-3'}`}>
                                <span className="flex items-center gap-2 min-w-0">
                                    <span className="w-2 h-2 bg-luxury-gold rounded-full -ml-[21px] mr-[13px] ring-4 ring-black shrink-0" />
                                    <ChevronDown className={`w-4 h-4 text-luxury-gold shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                                    <span className="text-luxury-gold font-serif text-lg capitalize truncate">{g.name}</span>
                                </span>
                                <span className="text-[11px] text-zinc-500 font-medium tabular-nums shrink-0 text-right">
                                    {g.receipts.length} {g.receipts.length === 1 ? 'cupom' : 'cupons'} · {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(g.total)}
                                </span>
                            </button>
                            {!isCollapsed && (
                            <div className="space-y-3">
                                {g.receipts.map((receipt) => (
                                    <div key={receipt.id} onClick={() => onSelectReceipt(receipt)} className="group flex gap-4 cursor-pointer hover:bg-white/5 p-3 rounded-2xl transition-all -ml-2 border border-transparent hover:border-white/5">
                                        <div className="flex flex-col items-center justify-center w-12 border-r border-white/10 pr-4">
                                            <span className="text-xl font-bold text-white">{new Date(receipt.date + 'T12:00:00').getDate() || '?'}</span>
                                            <span className="text-[11px] text-zinc-500 uppercase">{new Date(receipt.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.','') || '??'}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-center">
                                                <span className="text-zinc-200 font-bold text-sm group-hover:text-luxury-gold transition-colors truncate">
                                                    {isGlobalView ? nameOf(receipt.establishmentName, receipt.cnpj) : `${receipt.items.length} itens`}
                                                </span>
                                                <span className="text-white font-bold text-sm shrink-0 ml-2">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(receipt.totalAmount)}
                                                </span>
                                            </div>
                                            <div className="mt-1 text-xs text-zinc-500 flex items-center gap-2">
                                                <Clock className="w-3 h-3" /> {receipt.time || '--:--'}
                                                <span>•</span>
                                                <span className="truncate">{receipt.items.slice(0, 3).map(i => i.description).join(', ')}...</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            )}
                        </div>
                        );
                    })}
                </div>
            ))}
        </div>
      </div>
    </div>
  );
};

const KPIBlock = ({ icon, label, value }: any) => (
  <div className="bg-[#121214] border border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center text-center group hover:border-white/20 transition-all shadow-lg">
      <div className="mb-2 group-hover:scale-110 transition-transform">{icon}</div>
      <span className="text-[11px] text-zinc-500 uppercase tracking-[0.08em] font-bold mb-1">{label}</span>
      <span className="text-xl md:text-2xl font-serif font-bold text-white tracking-tight">{value}</span>
  </div>
);

export default EstablishmentDetailView;
