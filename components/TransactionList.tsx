
import React, { useState, useMemo, useEffect } from 'react';
import { Receipt, DashboardConfig } from '../types';
import { Search, ChevronRight, Calendar, Receipt as ReceiptIcon, Trash2, FileText, XCircle, Clock, Download, ArrowUpDown, Plus } from 'lucide-react';
import { normalizeProductName } from '../services/productNormalization';

interface TransactionListProps {
  receipts: Receipt[];
  onSelectReceipt: (receipt: Receipt) => void;
  onDeleteReceipt: (id: string) => void;
  onSelectEstablishment?: (name: string) => void; 
  onSelectProduct?: (normalizedName: string) => void;
  onExportData?: (receipts: Receipt[]) => void;
  onAddManual?: () => void;
  initialCategory?: string;
  config?: DashboardConfig; 
}

const normalizeText = (text: string) => {
  if (!text) return "";
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
};

const TransactionList: React.FC<TransactionListProps> = ({ receipts, onSelectReceipt, onDeleteReceipt, onSelectEstablishment, onSelectProduct, onExportData, onAddManual, initialCategory, config }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [establishmentFilter, setEstablishmentFilter] = useState('');
  
  const [startDate, setStartDate] = useState(config?.customStartDate || '');
  const [endDate, setEndDate] = useState(config?.customEndDate || '');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [sortType, setSortType] = useState<'date' | 'amount'>('date');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  useEffect(() => {
    if (config?.customStartDate) setStartDate(config.customStartDate);
    if (config?.customEndDate) setEndDate(config.customEndDate);
  }, [config]);

  const filteredReceipts = useMemo(() => {
    const term = normalizeText(searchTerm);
    
    return receipts.filter(r => {
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
  }, [receipts, searchTerm, establishmentFilter, startDate, endDate, selectedCategories, sortType, sortOrder, config]);

  // Agrupamento para exibição por mês (Timeline)
  const groupedReceipts = useMemo(() => {
      const groups: Record<string, Receipt[]> = {};
      filteredReceipts.forEach(r => {
          const d = new Date(r.date + 'T12:00:00');
          const monthName = isNaN(d.getTime()) ? 'DATA INDETERMINADA' : d.toLocaleString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase();
          if (!groups[monthName]) groups[monthName] = [];
          groups[monthName].push(r);
      });
      return groups;
  }, [filteredReceipts]);

  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex flex-col md:flex-row ls:flex-row md:items-end ls:items-center justify-between gap-6 ls:gap-4">
          <div className="text-center md:text-left ls:text-left">
              <h2 className="text-3xl ls:text-2xl md:text-5xl font-serif text-white mb-2 ls:mb-0 tracking-tight">HISTÓRICO</h2>
              <p className="text-zinc-500 font-sans font-light tracking-wide uppercase text-[10px]">Lançamentos do Período Selecionado</p>
          </div>
          <div className="grid grid-cols-2 md:flex items-center gap-3">
              <button onClick={onAddManual} className="group flex items-center justify-center gap-3 bg-luxury-gold border border-luxury-gold px-6 py-3 rounded-xl hover:bg-white transition-all shadow-lg shadow-luxury-gold/10">
                  <Plus className="w-4 h-4 text-black" />
                  <span className="text-xs font-bold text-black uppercase tracking-widest">Adicionar</span>
              </button>
              {onExportData && (
                  <button onClick={() => onExportData(filteredReceipts)} className="group flex items-center justify-center gap-3 bg-zinc-900 border border-white/10 px-6 py-3 rounded-xl hover:border-luxury-gold/50 transition-all">
                      <Download className="w-4 h-4 text-luxury-gold" />
                      <span className="text-xs font-bold text-zinc-300 uppercase tracking-widest">Exportar</span>
                  </button>
              )}
          </div>
      </div>

      <div className="flex flex-col xl:flex-row ls:flex-row gap-4 ls:gap-2 items-start xl:items-center ls:items-center bg-black/40 p-1 rounded-2xl relative z-20">
        <div className="flex gap-2 w-full xl:flex-1">
        <div className="relative flex-1 min-w-0">
           <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
           <input type="text" placeholder="Buscar estabelecimento ou valor..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-white/5 border border-white/5 rounded-xl py-3.5 pl-12 pr-6 text-sm text-zinc-300 focus:outline-none focus:border-luxury-gold/30 transition-colors" />
        </div>
            <button 
                onClick={() => {
                    setSortType(sortType === 'date' ? 'amount' : 'date');
                    setSortOrder('desc');
                }}
                className="shrink-0 flex items-center gap-2 px-4 py-3.5 bg-white/5 border border-white/5 rounded-xl text-[10px] font-bold text-zinc-400 uppercase whitespace-nowrap"
            >
                <ArrowUpDown className="w-3.5 h-3.5" />
                {sortType === 'date' ? 'Data' : 'Valor'}
            </button>
        </div>

        <div className="flex items-center gap-2 w-full xl:w-auto">
            <div className="relative flex-1 min-w-0 xl:min-w-[140px]">
                <Calendar className="hidden sm:block absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full bg-white/5 border border-white/5 rounded-xl py-3 sm:py-3.5 pl-3 sm:pl-10 pr-2 sm:pr-3 text-[10px] text-zinc-400 focus:outline-none uppercase font-bold" />
            </div>
            <span className="text-zinc-700 hidden sm:inline">-</span>
            <div className="relative flex-1 min-w-0 xl:min-w-[140px]">
                <Calendar className="hidden sm:block absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full bg-white/5 border border-white/5 rounded-xl py-3 sm:py-3.5 pl-3 sm:pl-10 pr-2 sm:pr-3 text-[10px] text-zinc-400 focus:outline-none uppercase font-bold" />
            </div>
            
            {(searchTerm || startDate || endDate) && (
                <button onClick={() => { setSearchTerm(''); setStartDate(''); setEndDate(''); }} className="shrink-0 p-3.5 bg-white/5 hover:bg-red-950/20 text-zinc-500 hover:text-red-400 rounded-xl transition-colors border border-white/5">
                    <XCircle className="w-4 h-4" />
                </button>
            )}
            
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-10 pr-2 pb-20 custom-scrollbar relative z-10">
        {Object.keys(groupedReceipts).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 opacity-70">
            <FileText className="w-12 h-12 text-zinc-800 mb-4" />
            <h3 className="font-serif text-xl text-zinc-500 mb-2 uppercase">Vazio</h3>
            <p className="text-zinc-600 font-sans text-xs tracking-widest uppercase">Nenhum registro encontrado</p>
          </div>
        ) : (
          /* Explicitly type the entries to ensure 'items' is inferred as Receipt[] and avoid 'unknown' type errors */
          (Object.entries(groupedReceipts) as [string, Receipt[]][]).map(([month, items]) => (
            <div key={month} className="space-y-4">
                <div className="flex items-center gap-4 px-2">
                    <div className="h-px bg-white/10 flex-1" />
                    <span className="text-[10px] font-bold text-luxury-gold uppercase tracking-[0.4em] whitespace-nowrap">{month}</span>
                    <div className="h-px bg-white/10 flex-1" />
                </div>
                <div className="space-y-3">
                    {items.map((receipt) => {
                         const rDate = new Date(receipt.date + 'T12:00:00');
                         const dayNum = isNaN(rDate.getTime()) ? '?' : rDate.getDate();
                         const dayName = isNaN(rDate.getTime()) ? '??' : rDate.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();

                         return (
                            <div key={receipt.id} onClick={() => onSelectReceipt(receipt)} className="group bg-black border border-white/10 rounded-2xl p-3 md:p-4 cursor-pointer transition-all hover:border-luxury-gold/40 hover:bg-zinc-900 shadow-xl flex items-center justify-between gap-2">
                                <div className="flex items-center gap-3 md:gap-5 min-w-0">
                                    <div className="flex flex-col items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-xl bg-white/5 border border-white/5 shrink-0">
                                        <span className="text-sm md:text-xl font-serif font-bold text-white leading-none">{dayNum}</span>
                                        <span className="text-[7px] md:text-[8px] text-zinc-500 font-bold tracking-widest mt-0.5 md:mt-1">{dayName}</span>
                                    </div>
                                    <div className="min-w-0">
                                        <h4 className="text-zinc-200 font-serif text-sm md:text-lg truncate pr-2">{receipt.establishmentName}</h4>
                                        <div className="flex items-center gap-2 md:gap-4 text-[8px] md:text-[9px] text-zinc-500 mt-0.5 md:mt-1 uppercase font-bold tracking-widest">
                                            <span className="flex items-center gap-1 md:gap-1.5 shrink-0"><Clock className="w-2.5 h-2.5 md:w-3 md:h-3" />{receipt.time || '12:00'}</span>
                                            <span className="truncate max-w-[110px] sm:max-w-[200px]">{receipt.items.map(i => i.description).slice(0, 3).join(', ')}...</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 md:gap-6 shrink-0">
                                    <span className="font-sans font-bold text-white text-xs md:text-lg tracking-tight">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(receipt.totalAmount)}</span>
                                    <ChevronRight className="w-4 h-4 text-zinc-800 group-hover:text-luxury-gold group-hover:translate-x-1 transition-all hidden sm:block" />
                                </div>
                            </div>
                         );
                    })}
                </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default TransactionList;
