import React, { useEffect, useMemo, useState } from 'react';
import { Receipt, DashboardConfig } from '../types';
import { ChevronLeft, TrendingUp, TrendingDown, DollarSign, BarChart3, MapPin, LayoutList, ArrowUpRight, ArrowDownRight, ChevronDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import * as Recharts from 'recharts';

const {
  Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} = Recharts;

import { getCategoryColor, getCategoryIcon } from './Dashboard';
import ProductPriceChart from './ProductPriceChart';
import ItemPeriodBar, { ItemPeriod, periodFromConfig } from './ItemPeriodBar';
import { useStoreNames } from './StoreNamesContext';
import NearbyPricesCard, { NearbySample } from './NearbyPricesCard';
import { priceBasis, eggNeedsCount } from '../services/eggs';
import type { CloudApi } from '../services/useCloud';
import type { AlertDraft } from './AlertsView';
import {
  itemBelongsToProduct, collectPriceObservations, computePriceStats,
  isDateInPeriod, periodLabel, buildPriceSeries, computeDeltas, weightedAverage, monthNamePt, normalizeUnit, HistoryItem,
} from '../services/productPriceStats';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const qtyFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
const weekday = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');

interface ProductVariantDetailViewProps {
  genericName: string;
  subCategoryName: string;
  receipts: Receipt[];
  onBack: () => void;
  onSelectReceipt: (receipt: Receipt) => void;
  config: DashboardConfig;
  onEditIcon?: (category: string) => void;
  // Nuvem (opcional): preços de outras pessoas perto de você
  cloud?: CloudApi;
  onCreateAlert?: (draft: AlertDraft) => void;
  onGoToAccount?: () => void;
}

interface HistRow extends HistoryItem {
  description: string;
  receipt: Receipt;
  // Ovo levado para a dúzia: o que o cupom trazia (para a consulta de preços por perto) e quantos ovos tem a bandeja
  rawUnitPrice: number;
  rawUnitType?: string;
  eggs: number | null;
  eggPending: boolean;      // ovo sem a quantidade da bandeja: falta informar no cupom
}

const CHART_COLORS = ['#D4AF37', '#27A46D', '#3B82F6', '#EC4899', '#F59E0B', '#8B5CF6', '#10B981', '#EF4444', '#06B6D4', '#6366F1'];
const INITIAL_ROWS = 12;

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="bg-zinc-950/95 border border-white/10 p-4 rounded-2xl shadow-2xl backdrop-blur-md z-[100]">
                <p className="text-luxury-gold text-[11px] font-bold uppercase tracking-[0.08em] mb-2 border-b border-white/5 pb-2">
                    {data.name || label}
                </p>
                <div className="flex flex-col gap-1">
                    <span className="text-white font-serif text-lg">
                        {brl.format(data.value)}
                    </span>
                    {data.percentage && (
                        <span className="text-zinc-500 text-[11px] uppercase tracking-[0.08em]">
                            {data.percentage.toFixed(1)}% do Ativo
                        </span>
                    )}
                </div>
            </div>
        );
    }
    return null;
};

const ProductVariantDetailView: React.FC<ProductVariantDetailViewProps> = ({ genericName, subCategoryName, receipts, onBack, onSelectReceipt, config, onEditIcon, cloud, onCreateAlert, onGoToAccount }) => {
  const { nameOf } = useStoreNames();
  const [unit, setUnit] = useState<string | undefined>(undefined);
  // Meses recolhidos na lista de compras (chave AAAA-MM). null = automático: os meses mais recentes
  // abrem e os mais antigos começam fechados; depois que a pessoa mexe, vale o que ela escolheu.
  const [manualCollapsed, setManualCollapsed] = useState<Set<string> | null>(null);

  // Período do histórico deste item: começa no filtro do Início (normalmente o mês atual) e pode ser trocado
  // aqui mesmo (7 dias, 30 dias, mês, ano, tudo ou um período do calendário) sem mexer no filtro do Início.
  const inherited = useMemo(
      () => periodFromConfig(config),
      [config.year, config.month, config.quickFilter, config.customStartDate, config.customEndDate]
  );
  const [period, setPeriod] = useState<ItemPeriod>(inherited);
  const periodCfg = period.cfg;

  const productIcon = useMemo(() => getCategoryIcon(genericName), [genericName]);
  const productColor = useMemo(() => getCategoryColor(genericName), [genericName]);

  // Todas as compras do produto, de qualquer período (base do menor/teto e da variação entre compras).
  const allHistory = useMemo(() => {
      const rows: HistRow[] = [];
      receipts.forEach(r => {
          (r.items || []).forEach((item, idx) => {
              if (!itemBelongsToProduct(item, genericName, subCategoryName)) return;
              const basis = priceBasis(item);
              rows.push({
                  key: `${r.id}#${idx}`,
                  description: item.description,
                  unitPrice: basis.unitPrice,
                  quantity: basis.eggs ? basis.quantity : Number(item.quantity) || 0,
                  totalPrice: Number(item.totalPrice) || 0,
                  unitType: basis.unitType,
                  rawUnitPrice: Number(item.unitPrice) || 0,
                  rawUnitType: item.unitType,
                  eggs: basis.eggs,
                  eggPending: eggNeedsCount(item),
                  date: r.date,
                  establishment: nameOf(r.establishmentName, r.cnpj),
                  receipt: r,
              });
          });
      });
      return rows;
  }, [receipts, genericName, subCategoryName, nameOf]);

  // Compras dentro do período escolhido, da mais recente para a mais antiga.
  const periodRows = useMemo(
      () => allHistory.filter(i => period.all || isDateInPeriod(i.date, periodCfg)).sort((a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key)),
      [allHistory, period.all, periodCfg]
  );

  const establishmentData = useMemo(() => {
      const agg: Record<string, number> = {};
      periodRows.forEach(i => {
          agg[i.establishment] = (agg[i.establishment] || 0) + i.totalPrice;
      });

      return Object.entries(agg).map(([name, value]) => ({
          name,
          value
      })).sort((a, b) => b.value - a.value).slice(0, 15);
  }, [periodRows]);

  // Menor preço, teto e médio olham todo o histórico do produto, não só o período da tela.
  const priceStats = useMemo(
      () => computePriceStats(collectPriceObservations(receipts, genericName, subCategoryName)),
      [receipts, genericName, subCategoryName]
  );

  const series = useMemo(() => buildPriceSeries(periodRows, unit), [periodRows, unit]);
  // Preço médio pago em todo o histórico (ponderado pela quantidade, na unidade mais usada)
  const historyAvg = useMemo(() => buildPriceSeries(allHistory), [allHistory]);
  const deltas = useMemo(() => computeDeltas(allHistory), [allHistory]);

  // Compra mais recente (com CNPJ válido): é com ela que o produto é reconhecido no cadastro comum.
  const nearbySample = useMemo<NearbySample | null>(() => {
      const last = [...allHistory]
          .filter(r => (r.receipt.cnpj || '').replace(/\D/g, '').length === 14 && r.rawUnitPrice > 0)
          .sort((a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key))[0];
      return last ? { description: last.description, cnpj: last.receipt.cnpj, unitType: last.rawUnitType, unitPrice: last.rawUnitPrice } : null;
  }, [allHistory]);

  const stores = useMemo(() => Array.from(new Set(periodRows.map(i => i.establishment))), [periodRows]);
  const singleStore = stores.length === 1;
  const hasRange = priceStats.count > 1 && priceStats.min !== priceStats.max;

  // Agrupa por mês (do mais recente para o mais antigo); cada mês sabe sua contagem e média.
  const groups = useMemo(() => {
      const map = new Map<string, HistRow[]>();
      periodRows.forEach(r => {
          const k = r.date.slice(0, 7);
          if (!map.has(k)) map.set(k, []);
          map.get(k)!.push(r);
      });
      return Array.from(map.entries()).map(([ym, rows]) => {
          const units = new Set(rows.map(r => normalizeUnit(r.unitType)));
          return { ym, rows, avg: units.size === 1 ? weightedAverage(rows) : 0 };
      });
  }, [periodRows]);

  // Automático: abre os meses até juntar INITIAL_ROWS compras; o resto começa recolhido (o título do mês continua à vista).
  const autoCollapsed = useMemo(() => {
      const set = new Set<string>();
      let shown = 0;
      groups.forEach(g => {
          if (shown >= INITIAL_ROWS) set.add(g.ym); else shown += g.rows.length;
      });
      return set;
  }, [groups]);
  const collapsed = manualCollapsed ?? autoCollapsed;

  // trocar de produto ou de período volta ao automático
  useEffect(() => { setManualCollapsed(null); },
      [genericName, subCategoryName, period.all, periodCfg.year, periodCfg.month, periodCfg.quickFilter, periodCfg.customStartDate, periodCfg.customEndDate]);

  const toggleMonth = (ym: string) => {
      const next = new Set(collapsed);
      if (next.has(ym)) next.delete(ym); else next.add(ym);
      setManualCollapsed(next);
  };
  const allCollapsed = groups.length > 0 && groups.every(g => collapsed.has(g.ym));
  const toggleAllMonths = () => setManualCollapsed(allCollapsed ? new Set() : new Set(groups.map(g => g.ym)));

  const fmtDelta = (d: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: Math.abs(d) >= 10 ? 0 : 1 }).format(Math.abs(d))}%`;

  return (
    <div className="animate-in fade-in slide-in-from-right-8 duration-1000 pb-20">
      <div className="flex items-center gap-6 mb-8">
        <button onClick={onBack} className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-luxury-gold transition-all shadow-xl">
            <ChevronLeft className="w-7 h-7" />
        </button>
        <div className="flex items-center gap-6">
            <div
                onClick={() => onEditIcon && onEditIcon(genericName)}
                className="w-14 h-14 rounded-2xl bg-black border border-white/10 flex items-center justify-center cursor-pointer hover:border-luxury-gold transition-all group/headericon"
                style={{ color: productColor }}
            >
                {React.createElement(productIcon, { className: "w-7 h-7 group-hover/headericon:scale-110 transition-transform" })}
            </div>
            <div>
                <span className="text-[11px] text-zinc-500 uppercase tracking-[0.1em] font-bold block mb-1">
                    NÍVEL 4 • PERFORMANCE DE ATIVO
                </span>
                <h2 className="text-4xl font-serif text-white tracking-tighter uppercase">
                    {genericName}
                </h2>
            </div>
        </div>
      </div>

      {/* Faixa de preços de todo o histórico: menor · médio · teto */}
      <div className="mb-6">
          <div className="bg-black/60 border border-white/10 rounded-2xl grid grid-cols-3 divide-x divide-white/5 shadow-lg" data-testid="price-strip">
              <StripCell icon={TrendingDown} color="text-emerald-500" label="Menor"
                  value={brl.format(priceStats.min)} sub={priceStats.minObs ? shortDate(priceStats.minObs.date) : ''}
                  title={priceStats.minObs ? `${priceStats.minObs.establishment} · ${priceStats.minObs.unitType}` : ''} />
              <StripCell icon={DollarSign} color="text-luxury-gold" label="Médio"
                  value={brl.format(historyAvg.avg)} sub={priceStats.count > 0 ? `${priceStats.count} ${priceStats.count === 1 ? 'compra' : 'compras'}` : ''} />
              <StripCell icon={TrendingUp} color="text-red-500" label="Teto"
                  value={brl.format(priceStats.max)} sub={priceStats.maxObs ? shortDate(priceStats.maxObs.date) : ''}
                  title={priceStats.maxObs ? `${priceStats.maxObs.establishment} · ${priceStats.maxObs.unitType}` : ''} />
          </div>
          <p className="text-[11px] text-zinc-500 text-center tracking-[0.08em] uppercase mt-2">Menor, médio e teto de todo o histórico</p>
      </div>

      {/* Seleção rápida do período do histórico deste item */}
      <div className="mb-4">
          <ItemPeriodBar value={period} onChange={setPeriod} fallback={inherited} />
      </div>

      {/* Evolução do preço pago, com a média do período */}
      <div className="mb-6">
          <ProductPriceChart series={series} periodTitle={period.all ? 'Todo o histórico' : periodLabel(periodCfg)} onUnitChange={setUnit} />
      </div>

      {cloud && onCreateAlert && onGoToAccount && (
          <NearbyPricesCard cloud={cloud} sample={nearbySample} onCreateAlert={onCreateAlert} onGoToAccount={onGoToAccount} />
      )}

      {/* Só faz sentido comparar lojas quando há mais de uma */}
      {establishmentData.length > 1 && (
      <div className="bg-black border border-white/10 rounded-[2rem] p-5 md:p-10 shadow-2xl mb-6 overflow-hidden relative group">
          <div className="absolute top-0 right-0 w-80 h-80 bg-luxury-gold/5 blur-[100px] rounded-full pointer-events-none group-hover:bg-luxury-gold/10 transition-all duration-1000" />
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 relative z-10">
              <div className="flex flex-col">
                <h3 className="text-[11px] text-zinc-500 uppercase tracking-[0.1em] font-bold mb-1 flex items-center gap-2">
                    <BarChart3 className="w-3 h-3 text-luxury-gold" /> Unit Flow Intelligence
                </h3>
                <span className="text-2xl font-serif text-white tracking-tighter">Comparativo de Unidades</span>
              </div>
          </div>

          <div className="h-[240px] md:h-[350px] w-full relative z-10">
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
      )}

      {/* Histórico compacto: o nome do item e a loja (quando é uma só) aparecem uma vez só */}
      <div className="animate-in slide-in-from-bottom-8 duration-700" data-testid="purchase-list">
           <div className="flex items-center justify-between gap-3 mb-3 px-1">
              <div className="flex items-center gap-2.5 min-w-0">
                  <LayoutList className="w-4 h-4 text-luxury-gold shrink-0" />
                  <h3 className="text-zinc-300 text-xs uppercase tracking-[0.08em] font-bold">Compras no período</h3>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-zinc-500 font-bold tracking-[0.08em] uppercase">{periodRows.length} {periodRows.length === 1 ? 'compra' : 'compras'}</span>
                  {groups.length > 1 && (
                      <button onClick={toggleAllMonths} data-testid="toggle-months"
                          aria-label={allCollapsed ? 'Expandir todos os meses' : 'Recolher todos os meses'}
                          title={allCollapsed ? 'Expandir todos os meses' : 'Recolher todos os meses'}
                          className="w-9 h-9 -my-1 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-zinc-400 hover:text-luxury-gold hover:border-luxury-gold/30 transition-colors">
                          {allCollapsed ? <ChevronsUpDown className="w-4 h-4" /> : <ChevronsDownUp className="w-4 h-4" />}
                      </button>
                  )}
              </div>
          </div>
          {singleStore && (
              <p className="flex items-center gap-1.5 px-1 mb-3 text-[11px] text-zinc-500 uppercase tracking-wider">
                  <MapPin className="w-3 h-3 text-zinc-600 shrink-0" /> <span className="truncate">Todas em {stores[0]}</span>
              </p>
          )}

          {periodRows.length === 0 ? (
              <p className="text-xs text-zinc-500 px-1 py-6 text-center">Nenhuma compra deste item no período selecionado.</p>
          ) : (
              <div className="bg-black/60 border border-white/10 rounded-2xl overflow-hidden">
                  {groups.map(({ ym, rows, avg }) => {
                      const info = { count: rows.length, avg };
                      const isCollapsed = collapsed.has(ym);
                      return (
                          <div key={ym} data-month={ym}>
                              <button type="button" onClick={() => toggleMonth(ym)} aria-expanded={!isCollapsed}
                                  className="w-full flex items-center justify-between gap-3 px-4 py-2.5 bg-white/[0.03] border-b border-white/5 text-left hover:bg-white/[0.06] transition-colors">
                                  <span className="flex items-center gap-2 min-w-0">
                                      <ChevronDown className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                                      <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-[0.1em]">{monthNamePt(Number(ym.slice(5, 7)) - 1)} {ym.slice(0, 4)}</span>
                                  </span>
                                  <span className="text-xs text-zinc-500 tabular-nums text-right">
                                      {info.count} {info.count === 1 ? 'compra' : 'compras'}{info.avg > 0 ? ` · média ${brl.format(info.avg)}` : ''}
                                  </span>
                              </button>
                              {!isCollapsed && rows.map(r => {
                                  const u = normalizeUnit(r.unitType);
                                  const d = deltas.get(r.key);
                                  const isMin = hasRange && r.unitPrice === priceStats.min;
                                  const isMax = hasRange && r.unitPrice === priceStats.max;
                                  return (
                                      <button key={r.key} onClick={() => onSelectReceipt(r.receipt)} data-row={r.key}
                                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-white/5 last:border-b-0 hover:bg-white/[0.04] transition-colors">
                                          <div className="w-9 shrink-0 text-center leading-none">
                                              <span className="block text-sm font-mono font-bold text-zinc-200">{r.date.slice(8, 10)}</span>
                                              <span className="block mt-1 text-[11px] uppercase tracking-[0.08em] text-zinc-500">{weekday(r.date)}</span>
                                          </div>
                                          <div className="flex-1 min-w-0">
                                              <p className="text-xs text-zinc-300 font-mono tabular-nums truncate">
                                                  {qtyFmt.format(r.quantity)} {u} <span className="text-zinc-600">·</span> {brl.format(r.totalPrice)}
                                              </p>
                                              {r.eggs && <p className="text-xs text-zinc-500 truncate mt-0.5" data-testid="egg-row-note">bandeja de {r.eggs} ovos · preço da dúzia</p>}
                                              {r.eggPending && <p className="text-xs text-luxury-gold truncate mt-0.5" data-testid="egg-row-pending">quantos ovos? toque para informar</p>}
                                              {!singleStore && <p className="text-xs text-zinc-500 truncate mt-0.5">{r.establishment}</p>}
                                          </div>
                                          {(isMin || isMax) && (
                                              <span className={`shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-full border ${isMin ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10' : 'text-red-500 border-red-500/30 bg-red-500/10'}`}>
                                                  {isMin ? 'menor' : 'teto'}
                                              </span>
                                          )}
                                          <div className="text-right shrink-0 min-w-[74px]">
                                              <span className={`block text-sm font-mono font-bold tabular-nums ${isMin ? 'text-emerald-500' : isMax ? 'text-red-500' : 'text-white'}`}>{brl.format(r.unitPrice)}</span>
                                              {d === null || d === undefined ? (
                                                  <span className="block text-xs text-zinc-700 mt-0.5">—</span>
                                              ) : Math.abs(d) < 0.5 ? (
                                                  <span className="block text-xs text-zinc-500 mt-0.5">= igual</span>
                                              ) : (
                                                  <span className={`inline-flex items-center justify-end gap-0.5 text-xs font-bold mt-0.5 ${d > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                                      {d > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}{fmtDelta(d)}
                                                  </span>
                                              )}
                                          </div>
                                      </button>
                                  );
                              })}
                          </div>
                      );
                  })}
              </div>
          )}
      </div>
    </div>
  );
};

const StripCell = ({ icon: Icon, label, value, sub, color, title }: any) => (
    <div className="px-2 py-4 text-center min-w-0" title={title || undefined}>
        <div className="flex items-center justify-center gap-1.5 mb-1.5">
            <Icon className={`w-3.5 h-3.5 ${color}`} />
            <span className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold">{label}</span>
        </div>
        <h3 className="text-lg md:text-2xl font-serif text-white leading-none">{value}</h3>
        {sub ? <span className="text-xs text-zinc-500 tracking-wide block mt-1.5 truncate">{sub}</span> : null}
    </div>
);

export default ProductVariantDetailView;
