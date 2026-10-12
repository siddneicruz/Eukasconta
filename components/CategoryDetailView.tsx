
import React, { useMemo, useState } from 'react';
import { Receipt, DashboardConfig } from '../types';
import { ChevronLeft, Palette, Store, ChevronDown, History } from 'lucide-react';
import InteractiveDonut from './InteractiveDonut';
import ReceiptRow from './ReceiptRow';
import PercentRing from './PercentRing';
import { getCategoryColor, getCategoryIcon } from './Dashboard';
import { properCase, sameDept, catKey } from '../services/textFormat';
import { projectReceipts, itemFilterTitle } from '../services/itemSearch';

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

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const CategoryDetailView: React.FC<CategoryDetailViewProps> = ({ categoryName, receipts, onBack, onSelectSubCategory, config, onEditIcon, onSelectReceipt }) => {
  // Com um item escolhido na busca do Início, só as linhas dele entram aqui também
  const baseReceipts = useMemo(() => projectReceipts(receipts, config.item), [receipts, config.item]);
  const filteredReceipts = useMemo(() => {
    return baseReceipts.filter(r => {
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
        return r.items.some(item => sameDept(item.category, categoryName));
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [baseReceipts, categoryName, config]);

  // Subgrupos: "HORTIFRUTI - FRUTAS" e "Hortifruti - Frutas" são o mesmo; vale o nome que mais gastou.
  const subCategoriesData = useMemo(() => {
      const groups = new Map<string, { total: number; variants: Map<string, number> }>();
      let total = 0;
      filteredReceipts.forEach(r => {
          r.items.forEach(item => {
              if (!sameDept(item.category, categoryName)) return;
              const key = catKey(item.category);
              let g = groups.get(key);
              if (!g) { g = { total: 0, variants: new Map() }; groups.set(key, g); }
              g.total += item.totalPrice;
              g.variants.set(item.category, (g.variants.get(item.category) || 0) + item.totalPrice);
              total += item.totalPrice;
          });
      });
      return Array.from(groups.values())
        .map(g => {
            const fullName = Array.from(g.variants.entries()).sort((a, b) => b[1] - a[1])[0][0];
            const sub = fullName.split(' - ').slice(1).join(' - ') || fullName;
            return {
                name: sub,
                label: properCase(sub),
                fullName,
                value: g.total,
                color: getCategoryColor(fullName),
                percentage: total > 0 ? (g.total / total) * 100 : 0
            };
        })
        .sort((a, b) => b.value - a.value);
  }, [filteredReceipts, categoryName]);

  const establishmentData = useMemo(() => {
      const agg: Record<string, number> = {};
      filteredReceipts.forEach(r => {
          r.items.forEach(item => {
              if (sameDept(item.category, categoryName)) {
                  agg[r.establishmentName] = (agg[r.establishmentName] || 0) + item.totalPrice;
              }
          });
      });
      return Object.entries(agg)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);
  }, [filteredReceipts, categoryName]);

  const [showAllStores, setShowAllStores] = useState(false);
  const storesTotal = useMemo(() => establishmentData.reduce((a, e) => a + e.value, 0), [establishmentData]);
  const STORES_COLLAPSED = 5;
  const visibleStores = showAllStores ? establishmentData : establishmentData.slice(0, STORES_COLLAPSED);

  const stats = useMemo(() => {
      const total = subCategoriesData.reduce((acc, c) => acc + c.value, 0);
      return { total, count: subCategoriesData.length };
  }, [subCategoriesData]);

  return (
    <div className="animate-in fade-in slide-in-from-right-8 duration-1000 pb-20">
      <div className="flex items-center gap-4 sm:gap-6 mb-6 sm:mb-10">
        <button onClick={onBack} className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-luxury-gold transition-all shadow-xl">
            <ChevronLeft className="w-7 h-7" />
        </button>
        <div className="min-w-0 flex-1">
            <span className="text-[11px] text-zinc-500 uppercase tracking-[0.1em] font-bold block mb-1">NÍVEL 2 • DIVISÕES DE DEPARTAMENTO</span>
            <h2 className="text-3xl sm:text-4xl font-serif text-white tracking-tighter uppercase break-words">{categoryName}</h2>
            {config.item && (
                <span className="mt-2 inline-flex max-w-full items-center rounded-full border border-luxury-gold/30 bg-luxury-gold/10 px-3 py-1 text-xs text-zinc-300" data-testid="cat-item-note">
                    <span className="truncate">Só <b className="font-semibold text-luxury-gold">{itemFilterTitle(config.item)}</b></span>
                </span>
            )}
        </div>
        {onEditIcon && (
            <button onClick={() => onEditIcon(categoryName)} aria-label="Mudar ícone e cor do departamento" title="Mudar ícone e cor" data-testid="dept-edit-icon"
                className="shrink-0 w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-luxury-gold hover:border-luxury-gold/30 transition-all">
                <Palette className="w-5 h-5" />
            </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-10 mb-8">
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
                                <span className="block text-sm font-semibold text-zinc-100 truncate">{cat.label}</span>
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

      <div className="bg-black border border-white/10 rounded-3xl p-4 sm:p-6 shadow-2xl mb-8" data-testid="store-ranking">
          <div className="flex items-baseline justify-between gap-3 mb-3">
              <h3 className="text-[11px] text-zinc-500 uppercase tracking-[0.1em] font-bold flex items-center gap-2 min-w-0">
                  <Store className="w-3 h-3 text-luxury-gold shrink-0" />
                  <span className="truncate">Investimento por unidade</span>
              </h3>
              <span className="text-xs text-zinc-500 tabular-nums shrink-0">{establishmentData.length} {establishmentData.length === 1 ? 'loja' : 'lojas'}</span>
          </div>
          {establishmentData.length === 0 ? (
              <p className="text-sm text-zinc-500 py-4">Sem compras neste departamento no período.</p>
          ) : (
              <ul className="divide-y divide-white/5">
                  {visibleStores.map((e, i) => {
                      const color = CHART_COLORS[i % CHART_COLORS.length];
                      const pct = storesTotal > 0 ? (e.value / storesTotal) * 100 : 0;
                      const max = establishmentData[0].value || 1;
                      return (
                          <li key={e.name} className="py-2.5" data-testid="store-row">
                              <div className="flex items-baseline justify-between gap-3">
                                  <span className="flex items-center gap-2 min-w-0">
                                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                                      <span className="text-sm text-zinc-100 truncate" title={e.name}>{properCase(e.name)}</span>
                                  </span>
                                  <span className="shrink-0 tabular-nums">
                                      <span className="text-sm font-serif font-bold text-white">{brl(e.value)}</span>
                                      <span className="text-[11px] text-zinc-500 ml-2">{pct.toFixed(0)}%</span>
                                  </span>
                              </div>
                              <div className="mt-1.5 h-1 rounded-full bg-white/5 overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${Math.max(2, (e.value / max) * 100)}%`, background: color }} />
                              </div>
                          </li>
                      );
                  })}
              </ul>
          )}
          {establishmentData.length > STORES_COLLAPSED && (
              <button type="button" onClick={() => setShowAllStores(v => !v)} data-testid="store-ranking-toggle"
                  className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-luxury-gold hover:bg-white/5 transition-colors">
                  {showAllStores ? 'Mostrar menos' : `Ver as ${establishmentData.length} lojas`}
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAllStores ? 'rotate-180' : ''}`} />
              </button>
          )}
      </div>

      {/* RELAÇÃO DE AQUISIÇÕES POR CATEGORIA */}
      <div className="animate-in slide-in-from-bottom-8 duration-700">
          <div className="flex items-center gap-3 mb-4 px-1">
              <History className="w-5 h-5 text-luxury-gold" />
              <h3 className="text-zinc-300 text-xs uppercase tracking-[0.08em] font-bold">Timeline de Aquisições: {categoryName}</h3>
          </div>
          <div className="space-y-2">
              {filteredReceipts.slice(0, 15).map((receipt) => {
                  const catTotal = receipt.items
                    .filter(i => sameDept(i.category, categoryName))
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
