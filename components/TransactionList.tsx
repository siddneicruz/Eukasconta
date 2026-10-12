
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Receipt, DashboardConfig, MasterProduct, ItemFilter, ReceiptItem } from '../types';
import { ChevronRight, Calendar, Receipt as ReceiptIcon, Trash2, FileText, XCircle, Clock, Download, ArrowUpDown, Plus, ChevronDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { normalizeProductName } from '../services/productNormalization';
import { titleCase } from '../services/textFormat';
import PeriodPicker from './PeriodPicker';
import ConfirmDialog from './ConfirmDialog';
import ItemSearchBox from './ItemSearchBox';
import ItemPriceInsight from './ItemPriceInsight';
import { makeItemMatcher, textFilter, toHistoryItems, itemFilterTitle } from '../services/itemSearch';
import { periodLabel, normalizeUnit } from '../services/productPriceStats';

interface TransactionListProps {
  receipts: Receipt[];
  onSelectReceipt: (receipt: Receipt) => void;
  onDeleteReceipt: (id: string) => void;
  onSelectEstablishment?: (name: string) => void; 
  onSelectProduct?: (normalizedName: string) => void;
  onExportData?: (receipts: Receipt[]) => void;
  // Um .txt por cupom dentro de um .zip
  onExportTxtZip?: (receipts: Receipt[]) => void;
  onAddManual?: () => void;
  initialCategory?: string;
  config?: DashboardConfig; 
  // Busca por item (autocompletar usa o cadastro de produtos); o item escolhido fica na config, igual ao Início
  masterProducts?: MasterProduct[];
  onConfigChange?: (config: DashboardConfig) => void;
}

const normalizeText = (text: string) => {
  if (!text) return "";
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
};

const AUTO_OPEN_ROWS = 15;
const LONG_PRESS_MS = 450;   // segurar o cupom por esse tempo mostra a lixeira
const PRESS_SLOP_PX = 8;     // mexer o dedo mais que isso é rolagem, não um "segurar"
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const TransactionList: React.FC<TransactionListProps> = ({ receipts, onSelectReceipt, onDeleteReceipt, onSelectEstablishment, onSelectProduct, onExportData, onExportTxtZip, onAddManual, initialCategory, config, masterProducts = [], onConfigChange }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [establishmentFilter, setEstablishmentFilter] = useState('');
  // Item escolhido no autocompletar: vive na config (compartilhado com o Início); sem config, fica só aqui
  const [localItem, setLocalItem] = useState<ItemFilter | null>(null);
  const itemFilter: ItemFilter | null = config && onConfigChange ? (config.item || null) : localItem;
  const setItemFilter = (f: ItemFilter | null) => { if (config && onConfigChange) onConfigChange({ ...config, item: f }); else setLocalItem(f); };
  
  const [startDate, setStartDate] = useState(config?.customStartDate || '');
  const [endDate, setEndDate] = useState(config?.customEndDate || '');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [sortType, setSortType] = useState<'date' | 'amount'>('date');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  // Exportar os cupons em TXT (.zip): pergunta antes e deixa incluir os que os filtros escondem
  const [exportOpen, setExportOpen] = useState(false);
  const [exportAll, setExportAll] = useState(false);

  // Segurar um cupom: a linha "arma" e mostra uma lixeira; tocar na lixeira abre a confirmação de exclusão.
  const [armedId, setArmedId] = useState<string | null>(null);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> | null; fired: boolean } | null>(null);
  const swallowClick = useRef(false);
  const cancelPress = () => { if (press.current?.timer) clearTimeout(press.current.timer); press.current = null; };
  const startPress = (e: React.PointerEvent, id: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelPress();
    const p = { x: e.clientX, y: e.clientY, timer: null as ReturnType<typeof setTimeout> | null, fired: false };
    p.timer = setTimeout(() => {
      p.fired = true; swallowClick.current = true;
      setArmedId(id);
      try { navigator.vibrate?.(18); } catch { /* sem vibração: segue */ }
    }, LONG_PRESS_MS);
    press.current = p;
  };
  const movePress = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || p.fired) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > PRESS_SLOP_PX) cancelPress();
  };
  const endPress = () => {
    const fired = press.current?.fired;
    cancelPress();
    // o "click" que vem logo depois de soltar o dedo não pode abrir o cupom; se ele não vier, libera sozinho
    if (fired) setTimeout(() => { swallowClick.current = false; }, 400);
  };
  const rowClick = (receipt: Receipt) => {
    if (swallowClick.current) { swallowClick.current = false; return; }
    if (armedId) { setArmedId(null); return; }
    onSelectReceipt(receipt);
  };
  useEffect(() => {
    if (!armedId) return;
    const away = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-armed="true"]')) return;
      // o primeiro toque fora só tira a lixeira; se caiu em outro cupom, esse toque não o abre
      setArmedId(null);
      swallowClick.current = true;
      setTimeout(() => { swallowClick.current = false; }, 400);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setArmedId(null); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [armedId]);
  useEffect(() => () => cancelPress(), []);

  useEffect(() => {
    if (config?.customStartDate) setStartDate(config.customStartDate);
    if (config?.customEndDate) setEndDate(config.customEndDate);
  }, [config?.customStartDate, config?.customEndDate]);

  const filteredReceipts = useMemo(() => {
    const term = normalizeText(searchTerm);
    const itemMatch = itemFilter ? makeItemMatcher(itemFilter) : null;
    
    return receipts.filter(r => {
        if (itemMatch && !r.items.some(itemMatch)) return false;
        const matchesSearch = normalizeText(r.establishmentName).includes(term) || 
                              r.totalAmount.toString().includes(term) ||
                              r.items.some(item => normalizeText(item.description).includes(term));
        const matchesEstablishment = establishmentFilter ? normalizeText(r.establishmentName).includes(normalizeText(establishmentFilter)) : true;
        
        let matchesTime = true;
        if (startDate || endDate) {
            if (startDate && r.date < startDate) matchesTime = false;
            if (endDate && r.date > endDate) matchesTime = false;
        } else if (config) {
            // Robustez para datas inválidas no filtro
            const rDate = new Date(r.date + 'T12:00:00');
            if (!isNaN(rDate.getTime())) {
                if (rDate.getFullYear() !== config.year) matchesTime = false;
                if (config.month !== null && rDate.getMonth() !== config.month) matchesTime = false;
            } else {
                // Se a data for inválida, oculta se estiver filtrando por período específico
                if (config.month !== null) matchesTime = false;
            }
        }

        const matchesCategory = selectedCategories.length > 0 ? r.items.some(item => selectedCategories.includes(item.category)) : true;

        return matchesSearch && matchesEstablishment && matchesTime && matchesCategory;
    }).sort((a, b) => {
        if (sortType === 'date') {
            // Combine date and time for precise sorting
            const dateTimeA = `${a.date}T${a.time || '00:00:00'}`;
            const dateTimeB = `${b.date}T${b.time || '00:00:00'}`;
            return sortOrder === 'desc' ? dateTimeB.localeCompare(dateTimeA) : dateTimeA.localeCompare(dateTimeB);
        }
        return sortOrder === 'desc' ? b.totalAmount - a.totalAmount : a.totalAmount - b.totalAmount;
    });
  }, [receipts, searchTerm, establishmentFilter, startDate, endDate, selectedCategories, sortType, sortOrder, config, itemFilter]);

  // Agrupamento para exibição por mês (Timeline)
  const groupedReceipts = useMemo(() => {
      const groups: Record<string, Receipt[]> = {};
      filteredReceipts.forEach(r => {
          const d = new Date(r.date + 'T12:00:00');
          const monthName = isNaN(d.getTime()) ? 'Data indeterminada' : (m => m.charAt(0).toUpperCase() + m.slice(1))(d.toLocaleString('pt-BR', { month: 'long', year: 'numeric' }));
          if (!groups[monthName]) groups[monthName] = [];
          groups[monthName].push(r);
      });
      return groups;
  }, [filteredReceipts]);

  // Meses recolhíveis. Sem escolha da pessoa, abre os meses mais novos até somar ~15 cupons
  // (o mês mais recente sempre abre) e recolhe o resto; o título de cada mês fica sempre à vista.
  // Busca por item: o escolhido no autocompletar ou, se só digitou, a palavra digitada (3+ letras).
  // Mostra as linhas do item em cada cupom e o gráfico de preço antes da lista.
  const searchMatcher = useMemo(() => {
      if (itemFilter) return makeItemMatcher(itemFilter);
      const f = textFilter(searchTerm);
      return f ? makeItemMatcher(f) : null;
  }, [itemFilter, searchTerm]);
  const searchTitle = itemFilter ? itemFilterTitle(itemFilter) : searchTerm.trim();
  const rowInfo = useMemo(() => {
      const m = new Map<string, { lines: ReceiptItem[]; subtotal: number }>();
      if (!searchMatcher) return m;
      filteredReceipts.forEach(r => {
          const lines = r.items.filter(searchMatcher);
          if (lines.length) m.set(r.id, { lines, subtotal: lines.reduce((s, i) => s + (Number(i.totalPrice) || 0), 0) });
      });
      return m;
  }, [filteredReceipts, searchMatcher]);
  const priceItems = useMemo(() => (searchMatcher ? toHistoryItems(filteredReceipts, searchMatcher) : []), [filteredReceipts, searchMatcher]);
  const priceFor = (r: Receipt) => (itemFilter && rowInfo.get(r.id) ? rowInfo.get(r.id)!.subtotal : (Number(r.totalAmount) || 0));
  const itemPeriodTitle = useMemo(() => {
      if (startDate || endDate) return periodLabel({ year: config?.year ?? new Date().getFullYear(), month: null, quickFilter: 'custom', customStartDate: startDate, customEndDate: endDate });
      if (config) return periodLabel({ year: config.year, month: config.month, quickFilter: null, customStartDate: '', customEndDate: '' });
      return 'Todo o histórico';
  }, [startDate, endDate, config]);

  const monthGroups = useMemo(() => (Object.entries(groupedReceipts) as [string, Receipt[]][]).map(([month, items]) => ({
      month, items, total: items.reduce((s, r) => s + priceFor(r), 0),
  })), [groupedReceipts, rowInfo, itemFilter]);

  const [manualCollapsed, setManualCollapsed] = useState<Set<string> | null>(null);
  useEffect(() => { setManualCollapsed(null); },
      [searchTerm, establishmentFilter, startDate, endDate, selectedCategories, sortType, sortOrder, config?.year, config?.month, itemFilter]);

  const autoCollapsed = useMemo(() => {
      const closed = new Set<string>();
      let shown = 0;
      monthGroups.forEach((g, i) => {
          if (i > 0 && shown >= AUTO_OPEN_ROWS) closed.add(g.month);
          else shown += g.items.length;
      });
      return closed;
  }, [monthGroups]);
  const collapsed = manualCollapsed ?? autoCollapsed;
  const allCollapsed = monthGroups.length > 0 && monthGroups.every(g => collapsed.has(g.month));
  const toggleMonth = (month: string) => {
      const next = new Set(collapsed);
      if (next.has(month)) next.delete(month); else next.add(month);
      setManualCollapsed(next);
  };
  const toggleAllMonths = () => setManualCollapsed(allCollapsed ? new Set() : new Set(monthGroups.map(g => g.month)));

  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex flex-col md:flex-row ls:flex-row md:items-end ls:items-center justify-between gap-6 ls:gap-4">
          <div className="text-center md:text-left ls:text-left">
              <h2 className="text-3xl ls:text-2xl md:text-5xl font-serif text-white mb-2 ls:mb-0 tracking-tight">HISTÓRICO</h2>
              <p className="text-zinc-400 font-sans text-sm">Lançamentos do período selecionado</p>
          </div>
          <div className="grid grid-cols-2 md:flex items-center gap-3">
              <button onClick={onAddManual} className="group flex items-center justify-center gap-3 bg-luxury-gold border border-luxury-gold px-6 py-3 rounded-xl hover:bg-white transition-all shadow-lg shadow-luxury-gold/10">
                  <Plus className="w-4 h-4 text-black" />
                  <span className="text-sm font-bold text-black">Adicionar</span>
              </button>
              {onExportTxtZip && (
                  <button onClick={() => { setExportAll(false); setExportOpen(true); }} disabled={receipts.length === 0} data-testid="export-txt-open" className="group flex items-center justify-center gap-3 bg-zinc-900 border border-white/10 px-6 py-3 rounded-xl hover:border-luxury-gold/50 transition-all disabled:opacity-40">
                      <FileText className="w-4 h-4 text-luxury-gold" />
                      <span className="text-sm font-bold text-zinc-300">Exportar TXT</span>
                  </button>
              )}
              {onExportData && (
                  <button onClick={() => onExportData(filteredReceipts)} className="group flex items-center justify-center gap-3 bg-zinc-900 border border-white/10 px-6 py-3 rounded-xl hover:border-luxury-gold/50 transition-all">
                      <Download className="w-4 h-4 text-luxury-gold" />
                      <span className="text-sm font-bold text-zinc-300">Exportar</span>
                  </button>
              )}
          </div>
      </div>

      <div className="flex flex-col xl:flex-row ls:flex-row gap-4 ls:gap-2 items-start xl:items-center ls:items-center bg-black/40 p-1 rounded-2xl relative z-20">
        <div className="flex gap-2 w-full xl:flex-1">
        <ItemSearchBox
            className="flex-1 min-w-0"
            testId="hist-search"
            receipts={receipts}
            masters={masterProducts}
            selected={itemFilter}
            onSelect={(f) => { setItemFilter(f); setSearchTerm(''); }}
            query={searchTerm}
            onQueryChange={setSearchTerm}
            placeholder="Buscar loja, item ou valor"
            textRow={false}
            enterPicksFirst={false}
            showClear={false}
            emptyHint={false}
        />
            <button 
                onClick={() => {
                    setSortType(sortType === 'date' ? 'amount' : 'date');
                    setSortOrder('desc');
                }}
                className="shrink-0 flex items-center gap-2 px-4 py-3.5 bg-white/5 border border-white/5 rounded-xl text-[13px] font-semibold text-zinc-300 whitespace-nowrap"
            >
                <ArrowUpDown className="w-3.5 h-3.5" />
                {sortType === 'date' ? 'Data' : 'Valor'}
            </button>
        </div>

        <div className="flex items-center gap-2 w-full xl:w-auto">
            <PeriodPicker
                start={startDate}
                end={endDate}
                onChange={(from, to) => { setStartDate(from); setEndDate(to); }}
                placeholder="Escolher período"
                className="flex-1 min-w-0 xl:min-w-[220px]"
            />
            
            {(searchTerm || startDate || endDate) && (
                <button data-testid="hist-clear" onClick={() => { setSearchTerm(''); setStartDate(''); setEndDate(''); }} className="shrink-0 p-3.5 bg-white/5 hover:bg-red-950/20 text-zinc-500 hover:text-red-400 rounded-xl transition-colors border border-white/5">
                    <XCircle className="w-4 h-4" />
                </button>
            )}
            
        </div>
      </div>

      {itemFilter && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-luxury-gold/30 bg-luxury-gold/10 pl-4 pr-2 py-2 -mt-2" data-testid="hist-item-banner">
            <span className="text-[13px] text-zinc-200 min-w-0">
                <span className="block truncate">Mostrando só <b className="font-semibold text-luxury-gold">{itemFilterTitle(itemFilter)}</b></span>
                <span className="block text-xs text-zinc-400 tabular-nums">{priceItems.length} {priceItems.length === 1 ? 'compra' : 'compras'} no período</span>
            </span>
            <button onClick={() => setItemFilter(null)} data-testid="hist-item-clear"
                className="shrink-0 px-3.5 py-1.5 rounded-full border border-luxury-gold/40 text-xs font-bold text-luxury-gold hover:bg-luxury-gold/15 transition-all">
                Ver tudo
            </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-10 pr-2 pb-20 custom-scrollbar relative z-10">
        {priceItems.length > 0 && (
          <div data-testid="hist-price-section">
              <ItemPriceInsight items={priceItems} title={searchTitle} periodTitle={itemPeriodTitle} testId="hist-price" />
          </div>
        )}
        {monthGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 opacity-70">
            <FileText className="w-12 h-12 text-zinc-800 mb-4" />
            <h3 className="font-serif text-xl text-zinc-500 mb-2 uppercase">Vazio</h3>
            <p className="text-zinc-500 font-sans text-sm">Nenhum registro encontrado</p>
          </div>
        ) : (
          <>
          {monthGroups.length > 1 && (
            <div className="flex items-center justify-between px-2 -mb-5">
                <span className="text-[11px] text-zinc-500 font-bold tracking-[0.08em] uppercase">{filteredReceipts.length} {filteredReceipts.length === 1 ? 'lançamento' : 'lançamentos'}</span>
                <button type="button" onClick={toggleAllMonths} data-testid="toggle-months"
                    aria-label={allCollapsed ? 'Expandir todos os meses' : 'Recolher todos os meses'}
                    title={allCollapsed ? 'Expandir todos os meses' : 'Recolher todos os meses'}
                    className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-zinc-400 hover:text-luxury-gold hover:border-luxury-gold/30 transition-colors">
                    {allCollapsed ? <ChevronsUpDown className="w-4 h-4" /> : <ChevronsDownUp className="w-4 h-4" />}
                </button>
            </div>
          )}
          {monthGroups.map(({ month, items, total }) => {
            const isCollapsed = collapsed.has(month);
            return (
            <div key={month} data-month={month} className="space-y-4">
                <button type="button" onClick={() => toggleMonth(month)} aria-expanded={!isCollapsed}
                    className="w-full flex items-center gap-4 px-2 py-1 rounded-xl text-center hover:bg-white/[0.03] transition-colors">
                    <div className="h-px bg-white/10 flex-1" />
                    <span className="flex flex-col items-center min-w-0">
                        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-luxury-gold tracking-wide whitespace-nowrap">
                            <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                            {month}
                        </span>
                        <span className="text-[11px] text-zinc-500 font-medium tabular-nums mt-0.5">{items.length} {items.length === 1 ? 'cupom' : 'cupons'} · {brl.format(total)}</span>
                    </span>
                    <div className="h-px bg-white/10 flex-1" />
                </button>
                {!isCollapsed && (
                <div className="space-y-3">
                    {items.map((receipt) => {
                         const rDate = new Date(receipt.date + 'T12:00:00');
                         const dayNum = isNaN(rDate.getTime()) ? '?' : rDate.getDate();
                         const dayName = isNaN(rDate.getTime()) ? '??' : rDate.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').replace(/^./, c => c.toUpperCase());

                         const armed = armedId === receipt.id;
                         return (
                            <div key={receipt.id} data-receipt-row data-armed={armed ? 'true' : undefined}
                                onClick={() => rowClick(receipt)}
                                onPointerDown={(e) => startPress(e, receipt.id)}
                                onPointerMove={movePress}
                                onPointerUp={endPress}
                                onPointerCancel={endPress}
                                onPointerLeave={cancelPress}
                                onContextMenu={(e) => { e.preventDefault(); setArmedId(receipt.id); }}
                                style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' } as React.CSSProperties}
                                className={`group border rounded-2xl p-3 md:p-4 cursor-pointer transition-all shadow-xl flex items-center justify-between gap-2 ${armed ? 'bg-red-500/[0.07] border-red-500/50' : 'bg-black border-white/10 hover:border-luxury-gold/40 hover:bg-zinc-900'}`}>
                                <div className="flex items-center gap-3 md:gap-5 min-w-0">
                                    <div className="flex flex-col items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-xl bg-white/5 border border-white/5 shrink-0">
                                        <span className="text-base md:text-xl font-serif font-bold text-white leading-none">{dayNum}</span>
                                        <span className="text-[11px] text-zinc-400 font-semibold mt-0.5 md:mt-1">{dayName}</span>
                                    </div>
                                    <div className="min-w-0">
                                        <h4 className="text-zinc-100 font-sans font-semibold text-[15px] md:text-lg leading-snug line-clamp-2 break-words pr-1">{titleCase(receipt.establishmentName)}</h4>
                                        <div className="flex items-center gap-2 md:gap-3 text-xs text-zinc-500 mt-0.5 md:mt-1 min-w-0">
                                            <span className="flex items-center gap-1 shrink-0 tabular-nums"><Clock className="w-3 h-3" />{receipt.time || '12:00'}</span>
                                            {rowInfo.get(receipt.id) ? (
                                                <span className="truncate" data-testid="row-item-lines">
                                                    {rowInfo.get(receipt.id)!.lines.slice(0, 2).map(i => `${brl.format(Number(i.unitPrice) || 0)}/${normalizeUnit(i.unitType).toLowerCase()} · ${titleCase(i.description)}`).join('  |  ')}
                                                    {rowInfo.get(receipt.id)!.lines.length > 2 ? ` +${rowInfo.get(receipt.id)!.lines.length - 2}` : ''}
                                                </span>
                                            ) : (
                                                <span className="truncate">{receipt.items.slice(0, 3).map(i => titleCase(i.description)).join(', ')}{receipt.items.length > 3 ? '…' : ''}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 md:gap-6 shrink-0">
                                    {itemFilter && rowInfo.get(receipt.id) && rowInfo.get(receipt.id)!.lines.length < receipt.items.length ? (
                                        <span className="flex flex-col items-end leading-tight">
                                            <span className="font-sans font-bold text-white text-sm md:text-lg tabular-nums" data-testid="row-item-amount">{brl.format(priceFor(receipt))}</span>
                                            <span className="text-[11px] text-zinc-500 tabular-nums">cupom {brl.format(receipt.totalAmount)}</span>
                                        </span>
                                    ) : (
                                        <span className="font-sans font-bold text-white text-sm md:text-lg tabular-nums">{brl.format(priceFor(receipt))}</span>
                                    )}
                                    {armed ? (
                                        <button type="button" data-testid="row-delete" aria-label="Excluir lançamento" title="Excluir lançamento"
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onClick={(e) => { e.stopPropagation(); setArmedId(null); onDeleteReceipt(receipt.id); }}
                                            className="w-11 h-11 -mr-1 flex items-center justify-center rounded-xl bg-red-500/15 border border-red-500/50 text-red-400 hover:bg-red-500/25 active:scale-95 transition-all animate-in zoom-in-50 duration-150">
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    ) : (
                                        <ChevronRight className="w-4 h-4 text-zinc-800 group-hover:text-luxury-gold group-hover:translate-x-1 transition-all hidden sm:block" />
                                    )}
                                </div>
                            </div>
                         );
                    })}
                </div>
                )}
            </div>
            );
          })}
          </>
        )}
      </div>

      {exportOpen && onExportTxtZip && (() => {
          const hidden = receipts.length - filteredReceipts.length;
          const total = exportAll ? receipts.length : filteredReceipts.length;
          return (
              <ConfirmDialog
                  tone="gold"
                  icon={<FileText className="w-5 h-5" />}
                  title="Exportar cupons em TXT"
                  confirmLabel={total === 1 ? 'Gerar .zip com 1 cupom' : `Gerar .zip com ${total} cupons`}
                  message={
                      <div className="space-y-3 text-left">
                          <p className="text-center">Cria um arquivo .zip com um .txt separado para cada cupom, igual ao da aba "Cupom TXT".</p>
                          {hidden > 0 && (
                              <label className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/10 cursor-pointer">
                                  <input type="checkbox" checked={exportAll} onChange={e => setExportAll(e.target.checked)} data-testid="export-txt-all" className="mt-0.5 w-4 h-4 accent-[#D4AF37]" />
                                  <span className="text-sm text-zinc-300">Incluir também os {hidden} {hidden === 1 ? 'cupom' : 'cupons'} que os filtros e o período escondem ({receipts.length} no total)</span>
                              </label>
                          )}
                      </div>
                  }
                  onConfirm={() => { setExportOpen(false); onExportTxtZip(exportAll ? receipts : filteredReceipts); }}
                  onCancel={() => setExportOpen(false)}
              />
          );
      })()}
    </div>
  );
};

export default TransactionList;
