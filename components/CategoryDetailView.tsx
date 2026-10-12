
import React, { useMemo } from 'react';
import { Receipt, DashboardConfig } from '../types';
import { ChevronLeft, Gem, LayoutGrid, ArrowRight, PieChart as PieIcon, Palette, Store, Clock, Calendar, ChevronRight, History } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import InteractiveDonut from './InteractiveDonut';
import ReceiptRow from './ReceiptRow';
import PercentRing from './PercentRing';
import { getCategoryColor, getCategoryIcon } from './Dashboard';
import { titleCase } from '../services/textFormat';

interface CategoryDetailViewProps {
  categoryName: string;
  receipts: Receipt[];
  onBack: () => void;
  onSelectSubCategory: (subCat: string) => void; 
  config: DashboardConfig;
  onEditIcon?: (category: string) => void;
  onSelectReceipt?: (receipt: Receipt) => void;
}

const CHART_COLORS = ['#D4AF37', '#27A46D', '#3B82F6', '#EC4899', '#F59E0B', '#8B5CF6', '#10B981', '#EF4444', '#06B6D4', '#6366F1'];

const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="bg-zinc-950 border border-white/10 p-4 rounded-2xl shadow-2xl backdrop-blur-md">
                <p className="text-luxury-gold text-[11px] font-bold uppercase tracking-[0.08em] mb-2 border-b border-white/5 pb-2">{data.name || data.label}</p>
                <p className="text-white font-serif text-lg">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(data.value)}</p>
                {data.percentage && <p className="text-zinc-400 text-xs mt-1">{data.percentage.toFixed(1).replace('.', ',')}% do depto.</p>}
            </div>
        );
    }
    return null;
};

const CategoryDetailView: React.FC<CategoryDetailViewProps> = ({ categoryName, receipts, onBack, onSelectSubCategory, config, onEditIcon, onSelectReceipt }) => {
  const filteredReceipts = useMemo(() => {
    return receipts.filter(r => {
        const rDate = new Date(r.date + 'T12:00:00');
        
        if (config.quickFilter === 'custom') {
            if (config.customStartDate && r.date < config.customStartDate) return false;
            if (config.customEndDate && r.date > config.customEndDate) return false;
        } else if (config.quickFilter === '7d' || config.quickFilter === '30d') {
            const days = config.quickFilter === '7d' ? 7 : 30;
            const limit = new Date();
            limit.setDate(limit.getDate() - days);
            if (rDate < limit) return false;
        } else {
            if (rDate.getFullYear() !== config.year) return false;
            if (config.month !== null && rDate.getMonth() !== config.month) return false;
        }
        return r.items.some(item => (item.category || '').startsWith(categoryName));
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [receipts, categoryName, config]);

  const subCategoriesData = useMemo(() => {
      const agg: Record<string, number> = {};
      let total = 0;
      filteredReceipts.forEach(r => {
          r.items.forEach(item => {
              if (item.category.startsWith(categoryName)) {
                  agg[item.category] = (agg[item.category] || 0) + item.totalPrice;
                  total += item.totalPrice;
              }
          });
      });
      return Object.entries(agg)
        .map(([name, value]) => ({ 
            name: name.split(' - ').slice(1).join(' - ') || name, 
            fullName: name,
            value, 
            color: getCategoryColor(name),
            percentage: total > 0 ? (value / total) * 100 : 0 
        }))
        .sort((a, b) => b.value - a.value);
  }, [filteredReceipts, categoryName]);

  const establishmentData = useMemo(() => {
      const agg: Record<string, number> = {};
      filteredReceipts.forEach(r => {
          r.items.forEach(item => {
              if (item.category.startsWith(categoryName)) {
                  agg[r.establishmentName] = (agg[r.establishmentName] || 0) + item.totalPrice;
              }
          });
      });
      return Object.entries(agg)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 15);
  }, [filteredReceipts, categoryName]);

  const stats = useMemo(() => {
      const total = subCategoriesData.reduce((acc, c) => acc + c.value, 0);
      return { total, count: subCategoriesData.length };
  }, [subCategoriesData]);

  return (
    <div className="animate-in fade-in slide-in-from-right-8 duration-1000 pb-20">
      <div className="flex items-center gap-6 mb-12">
        <button onClick={onBack} className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-luxury-gold transition-all shadow-xl">
            <ChevronLeft className="w-7 h-7" />
        </button>
        <div>
            <span className="text-[11px] text-zinc-500 uppercase tracking-[0.1em] font-bold block mb-1">NÍVEL 2 • DIVISÕES DE DEPARTAMENTO</span>
            <h2 className="text-4xl font-serif text-white tracking-tighter uppercase">{categoryName}</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 mb-12">
          <div className="lg:col-span-7 bg-zinc-950 border border-white/5 rounded-[2rem] md:rounded-[2.5rem] p-5 md:p-10 min-h-[340px] md:min-h-[500px] shadow-2xl relative overflow-hidden flex flex-col items-center justify-center">
               <div className="absolute top-5 left-5 md:top-10 md:left-10 flex flex-col">
                   <h3 className="text-[11px] text-zinc-400 uppercase tracking-[0.1em] font-bold mb-1">Concentração Divisória</h3>
                   <span className="text-[11px] text-zinc-500 border border-white/10 px-4 py-1.5 rounded-full uppercase tracking-[0.08em] font-bold w-fit">Análise de Subgrupo</span>
               </div>
               
               <div className="h-[280px] md:h-[400px] w-[calc(100%+1.5rem)] md:w-full relative mt-8 md:mt-0">
                   <InteractiveDonut
                       data={subCategoriesData}
                       centerLabel="Total Categoria"
                       centerValue={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(stats.total)}
                       onSliceClick={(entry) => entry?.fullName && onSelectSubCategory(entry.fullName)}
                   />
               </div>
          </div>
          
          <div className="lg:col-span-5 flex flex-col gap-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              <h3 className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold px-4 mb-2">Ramificações</h3>
              {subCategoriesData.map((cat, idx) => {
                  const SubIcon = getCategoryIcon(cat.fullName);
                  return (
                    <div key={idx} className="flex items-center justify-between p-3 md:p-6 bg-black/60 border border-white/10 rounded-2xl md:rounded-3xl hover:bg-white/[0.04] hover:border-luxury-gold/20 transition-all group relative overflow-hidden">
                        <div className="flex items-center gap-4 min-w-0">
                            <PercentRing percent={cat.percentage} color={cat.color} size={44}>
                                <div
                                  onClick={(e) => { e.stopPropagation(); onEditIcon && onEditIcon(cat.fullName); }}
                                  className="w-7 h-7 rounded-lg bg-black border border-white/10 flex items-center justify-center text-zinc-500 hover:border-luxury-gold cursor-pointer transition-all"
                                  style={{ color: cat.color }}
                                >
                                    <SubIcon className="w-3.5 h-3.5" />
                                </div>
                            </PercentRing>
                            <div className="flex flex-col cursor-pointer min-w-0" onClick={() => onSelectSubCategory(cat.fullName)}>
                                <span className="block text-sm font-semibold text-zinc-100 truncate">{titleCase(cat.name)}</span>
                                <span className="text-xs text-zinc-400 font-medium tabular-nums mt-0.5">{cat.percentage.toFixed(1).replace('.', ',')}% do depto.</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-6">
                            <span className="text-lg font-serif font-bold text-white tracking-tight">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(cat.value)}</span>
                            <button onClick={() => onEditIcon && onEditIcon(cat.fullName)} className="p-2 text-zinc-700 hover:text-luxury-gold opacity-0 group-hover:opacity-100 transition-all">
                                <Palette className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                  );
              })}
          </div>
      </div>

      <div className="bg-black border border-white/10 rounded-[2.5rem] p-6 sm:p-10 shadow-2xl relative overflow-hidden group mb-12">
          <div className="absolute top-0 left-0 w-80 h-80 bg-luxury-gold/5 blur-[100px] rounded-full pointer-events-none group-hover:bg-luxury-gold/10 transition-all duration-1000" />
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 relative z-10">
              <div className="flex flex-col">
                <h3 className="text-[11px] text-zinc-500 uppercase tracking-[0.1em] font-bold mb-1 flex items-center gap-2">
                    <Store className="w-3 h-3 text-luxury-gold" /> Establishment Matrix: {categoryName}
                </h3>
                <span className="text-2xl font-serif text-white tracking-tighter">Investimento por Unidade</span>
              </div>
          </div>
          
          <div className="h-[350px] w-full relative z-10">
              <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={establishmentData} margin={{ top: 0, right: 10, left: -20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                      <XAxis dataKey="name" hide={true} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 10 }} tickFormatter={(val) => `R$${val}`} />
                      <Tooltip content={<CustomTooltip />} cursor={{fill: 'rgba(255,255,255,0.02)'}} />
                      <Bar dataKey="value" radius={[8, 8, 0, 0]} animationDuration={2000}>
                          {establishmentData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                      </Bar>
                  </BarChart>
              </ResponsiveContainer>
          </div>
      </div>

      {/* RELAÇÃO DE AQUISIÇÕES POR CATEGORIA */}
      <div className="animate-in slide-in-from-bottom-8 duration-700">
          <div className="flex items-center gap-3 mb-8 px-1">
              <History className="w-5 h-5 text-luxury-gold" />
              <h3 className="text-zinc-300 text-xs uppercase tracking-[0.08em] font-bold">Timeline de Aquisições: {categoryName}</h3>
          </div>
          <div className="space-y-2">
              {filteredReceipts.slice(0, 15).map((receipt) => {
                  const catTotal = receipt.items
                    .filter(i => i.category.startsWith(categoryName))
                    .reduce((sum, i) => sum + i.totalPrice, 0);

                  return (
                    <ReceiptRow key={receipt.id} receipt={receipt} onClick={onSelectReceipt} amountOverride={catTotal} amountSubLabel="nesta categoria" />
                  );
              })}
          </div>
      </div>
    </div>
  );
};

export default CategoryDetailView;
