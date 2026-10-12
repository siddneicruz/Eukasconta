
import React, { useMemo, useState } from 'react';
import { Receipt } from '../types';
import { ChevronLeft, Calendar, Clock, MapPin, ArrowUpRight, Hash, TrendingUp, DollarSign, PieChart, Filter, X, ShoppingBag } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, CartesianGrid, ReferenceDot, Label } from 'recharts';
import { getCategoryColor } from './Dashboard';

interface EstablishmentDetailViewProps {
  establishmentName: string; // 'TODOS' ou Nome Específico
  receipts: Receipt[];
  onBack: () => void;
  onSelectReceipt: (receipt: Receipt) => void;
}

const EstablishmentDetailView: React.FC<EstablishmentDetailViewProps> = ({ establishmentName, receipts, onBack, onSelectReceipt }) => {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const isGlobalView = establishmentName === 'TODOS';

  const relevantReceipts = useMemo(() => {
    return receipts
        .filter(r => isGlobalView ? true : r.establishmentName === establishmentName)
        .sort((a, b) => new Date(b.date + 'T' + (b.time || '00:00')).getTime() - new Date(a.date + 'T' + (a.time || '00:00')).getTime());
  }, [receipts, establishmentName, isGlobalView]);

  const stats = useMemo(() => {
    const total = relevantReceipts.reduce((acc, r) => acc + r.totalAmount, 0);
    const count = relevantReceipts.length;
    const average = count > 0 ? total / count : 0;
    return { total, count, average };
  }, [relevantReceipts]);

  const categoryChartData = useMemo(() => {
      const agg: Record<string, number> = {};
      relevantReceipts.forEach(r => {
          r.items.forEach(item => {
              const rootCat = item.category ? item.category.split(' - ')[0] : 'Outros';
              agg[rootCat] = (agg[rootCat] || 0) + item.totalPrice;
          });
      });
      return Object.entries(agg)
        .map(([name, value]) => ({ name, value, color: getCategoryColor(name) }))
        .sort((a, b) => b.value - a.value);
  }, [relevantReceipts]);

  const filteredReceipts = useMemo(() => {
      if (!selectedCategory) return relevantReceipts;
      return relevantReceipts.filter(r => r.items.some(item => (item.category || '').startsWith(selectedCategory)));
  }, [relevantReceipts, selectedCategory]);

  const highestUnitPriceItem = useMemo(() => {
      let maxItem = { price: 0, description: '', date: '', unitType: '' };
      relevantReceipts.forEach(r => {
          r.items.forEach(item => {
              let effectivePrice = item.unitPrice || (item.quantity > 0 ? item.totalPrice / item.quantity : 0);
              if (effectivePrice > maxItem.price) {
                  maxItem = { price: effectivePrice, description: item.description, date: r.date, unitType: item.unitType || 'UN' };
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

  const timelineGroups = useMemo(() => {
      const groups: Record<string, Record<string, Receipt[]>> = {};
      filteredReceipts.forEach(r => {
          const d = new Date(r.date + 'T12:00:00');
          const year = isNaN(d.getTime()) ? 'INDETERMINADO' : d.getFullYear().toString();
          const monthKey = isNaN(d.getTime()) ? 'SEM DATA' : d.toLocaleString('pt-BR', { month: 'long' });
          if (!groups[year]) groups[year] = {};
          if (!groups[year][monthKey]) groups[year][monthKey] = [];
          groups[year][monthKey].push(r);
      });
      return groups;
  }, [filteredReceipts]);

  return (
    <div className="animate-in fade-in slide-in-from-right-8 duration-500 pb-20">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 border border-white/5 transition-colors"><ChevronLeft className="w-5 h-5" /></button>
        <div>
            <span className="text-[11px] text-zinc-500 uppercase tracking-[0.08em] block mb-1">
                {isGlobalView ? 'Fluxo Financeiro Unificado' : 'Histórico da Loja'}
            </span>
            <h2 className="text-2xl font-serif text-white tracking-wide uppercase">{establishmentName}</h2>
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
        </div>

        <div className="relative pl-4 border-l border-white/10 ml-2 space-y-8">
            {Object.entries(timelineGroups).sort((a, b) => b[0].localeCompare(a[0])).map(([year, months]) => (
                <div key={year} className="relative">
                    <div className="absolute -left-[35px] bg-black text-zinc-500 text-xs font-bold py-1 px-2 border border-white/10 rounded rotate-[-90deg] origin-center translate-y-4">
                        {year}
                    </div>
                    {Object.entries(months).sort((a,b) => b[0].localeCompare(a[0])).map(([month, monthReceipts]) => (
                        <div key={month} className="mb-8 pl-4">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-2 h-2 bg-luxury-gold rounded-full -ml-[21px] ring-4 ring-black" />
                                <span className="text-luxury-gold font-serif text-lg capitalize">{month}</span>
                            </div>
                            <div className="space-y-3">
                                {monthReceipts.map((receipt) => (
                                    <div key={receipt.id} onClick={() => onSelectReceipt(receipt)} className="group flex gap-4 cursor-pointer hover:bg-white/5 p-3 rounded-2xl transition-all -ml-2 border border-transparent hover:border-white/5">
                                        <div className="flex flex-col items-center justify-center w-12 border-r border-white/10 pr-4">
                                            <span className="text-xl font-bold text-white">{new Date(receipt.date + 'T12:00:00').getDate() || '?'}</span>
                                            <span className="text-[11px] text-zinc-500 uppercase">{new Date(receipt.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.','') || '??'}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-center">
                                                <span className="text-zinc-200 font-bold text-sm group-hover:text-luxury-gold transition-colors truncate">
                                                    {isGlobalView ? receipt.establishmentName : `${receipt.items.length} itens`}
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
                        </div>
                    ))}
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
