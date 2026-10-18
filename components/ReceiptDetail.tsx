
import React, { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { Receipt, ReceiptItem } from '../types';
import { X, Calendar, MapPin, Hash, ChevronDown, ChevronUp, PieChart, Edit2, Check, ChevronLeft, ChevronRight, Fuel, Utensils, ShoppingCart, Home, AlertCircle, Heart, Droplets, Smile, Shirt, Zap, Briefcase, PawPrint, FileText, Scroll, MessageSquare, Send, Croissant, Download, Folder, FileType, Save, Trash2, Plus, Clock, Globe } from 'lucide-react';
import { getCategoryIcon } from './Dashboard';
import { formatCNPJ } from '../services/productNormalization';
import JSZip from 'jszip';
import { downloadFile } from '../services/nativeFiles';
import { titleCase } from '../services/textFormat';
import { useStoreNames } from './StoreNamesContext';
import { generateReceiptText } from '../services/receiptText';

interface ReceiptDetailProps {
  receipt: Receipt;
  onClose: () => void;
  onUpdateReceipt: (updatedReceipt: Receipt) => void;
  onDelete?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
  categories: string[];
  knownEstablishments?: string[];
  knownProducts?: string[];
}

interface CategoryGroupProps {
  category: string;
  items: ReceiptItem[];
  total: number;
  onEditItem: (itemIndex: number, newCategory: string) => void;
  allItems: ReceiptItem[];
  availableCategories: string[];
}

const CategoryGroup: React.FC<CategoryGroupProps> = ({ category, items, total, onEditItem, allItems, availableCategories }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [editingItemIdx, setEditingItemIdx] = useState<number | null>(null);

  const getCategoryStyle = (cat: string) => {
    const norm = cat.toLowerCase();
    if (norm.includes('transporte')) return { textColor: 'text-amber-500', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30', glow: 'shadow-[0_0_15px_rgba(245,158,11,0.1)]' };
    if (norm.includes('padaria')) return { textColor: 'text-amber-600', bgColor: 'bg-amber-600/10', borderColor: 'border-amber-600/30', glow: 'shadow-[0_0_15px_rgba(217,119,6,0.1)]' };
    if (norm.includes('hortifruti')) return { textColor: 'text-emerald-500', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30', glow: 'shadow-[0_0_15px_rgba(16,185,129,0.1)]' };
    if (norm.includes('refrigerados')) return { textColor: 'text-blue-500', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30', glow: 'shadow-[0_0_15px_rgba(59,130,246,0.1)]' };
    if (norm.includes('despensa') || norm.includes('mercearia')) return { textColor: 'text-orange-500', bgColor: 'bg-orange-500/10', borderColor: 'border-orange-500/30', glow: 'shadow-[0_0_15px_rgba(249,115,22,0.1)]' };
    if (norm.includes('bebida')) return { textColor: 'text-cyan-400', bgColor: 'bg-cyan-400/10', borderColor: 'border-cyan-400/30', glow: 'shadow-[0_0_15px_rgba(34,211,238,0.1)]' };
    if (norm.includes('higiene') || norm.includes('beleza')) return { textColor: 'text-pink-500', bgColor: 'bg-pink-500/10', borderColor: 'border-pink-500/30', glow: 'shadow-[0_0_15px_rgba(236,72,153,0.1)]' };
    if (norm.includes('saude')) return { textColor: 'text-red-500', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30', glow: 'shadow-[0_0_15px_rgba(239,68,68,0.1)]' };
    if (norm.includes('casa') || norm.includes('limpeza')) return { textColor: 'text-violet-500', bgColor: 'bg-violet-500/10', borderColor: 'border-violet-500/30', glow: 'shadow-[0_0_15px_rgba(139,92,246,0.1)]' };
    if (norm.includes('vestuario')) return { textColor: 'text-rose-500', bgColor: 'bg-rose-500/10', borderColor: 'border-rose-500/30', glow: 'shadow-[0_0_15px_rgba(225,29,72,0.1)]' };
    return { textColor: 'text-zinc-400', bgColor: 'bg-zinc-800', borderColor: 'border-white/10', glow: '' };
  };

  const style = getCategoryStyle(category);
  const Icon = getCategoryIcon(category);

  return (
    <div className={`mb-3 rounded-xl border transition-all duration-300 overflow-hidden ${isOpen ? `${style.borderColor} bg-black ${style.glow}` : 'border-white/5 bg-surface/20'}`}>
      <button onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center justify-between gap-2 p-3 hover:bg-white/5 transition-colors group">
        <div className="flex items-center gap-3 min-w-0">
             <div className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${style.bgColor} ${style.textColor} ring-1 ring-inset ring-white/5`}>
                <Icon className="w-4 h-4" />
             </div>
             <div className="text-left flex flex-col min-w-0">
                <span className={`block font-sans text-[13px] font-semibold leading-snug line-clamp-2 break-words ${isOpen ? 'text-zinc-100' : 'text-zinc-300'}`}>
                    {category}
                </span>
                {!isOpen && <span className="text-xs text-zinc-500">{items.length} {items.length === 1 ? 'item' : 'itens'}</span>}
             </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
             <div className="flex flex-col items-end">
                <span className={`font-sans font-bold text-sm ${style.textColor}`}>
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total)}
                </span>
             </div>
             <div className={`p-1.5 rounded-full transition-all duration-300 ${isOpen ? 'rotate-180 bg-white/10 text-zinc-200' : 'text-zinc-600'}`}>
                <ChevronDown className="w-3 h-3" />
             </div>
        </div>
      </button>
      
      {isOpen && (
        <div className="px-3 pb-2 bg-black/40 border-t border-white/5">
            {items.map((item, idx) => {
                const originalIndex = allItems.indexOf(item);
                const isEditing = editingItemIdx === originalIndex;
                return (
                    <div key={idx} className="flex flex-col py-3 border-b border-white/5 last:border-0 group/item hover:bg-white/[0.02] -mx-3 px-3 transition-colors">
                         <div className="flex justify-between items-start">
                            <div className="flex-1 pr-4">
                                <p className="text-zinc-100 text-sm font-medium font-sans leading-snug break-words">{titleCase(item.description)}</p>
                                {item.code && <p className="text-xs text-zinc-500 tabular-nums mt-0.5" data-testid="item-code">Código {item.code}</p>}
                                {item.readDescription && <p className="text-xs text-zinc-500 mt-0.5 break-words" data-testid="item-read-description">Na foto: {item.readDescription}</p>}
                            </div>
                            <div className="flex flex-col items-end gap-0.5 min-w-[100px]">
                                <span className="text-zinc-200 text-sm font-bold font-sans tabular-nums">
                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.totalPrice)}
                                </span>
                                <p className="text-xs text-zinc-500 font-sans tabular-nums flex items-center justify-end gap-1.5">
                                    <span>{item.quantity} {(item.unitType || 'UN').toLowerCase()}</span> 
                                    <span className="text-zinc-600">×</span>
                                    <span>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.unitPrice)}</span>
                                </p>
                                {!isEditing && (
                                    <button onClick={() => setEditingItemIdx(originalIndex)} className="opacity-0 group-hover/item:opacity-100 text-xs text-luxury-gold hover:underline transition-all mt-1">
                                        Mover
                                    </button>
                                )}
                            </div>
                        </div>
                        {isEditing && (
                            <div className="mt-2 animate-in fade-in slide-in-from-top-1 bg-zinc-900/80 p-2 rounded-lg border border-luxury-gold/20">
                                <label className="text-[11px] uppercase text-zinc-500 font-bold mb-1 block">Mover para Categoria:</label>
                                <select 
                                    className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-luxury-gold/50"
                                    defaultValue={category}
                                    onChange={(e) => {
                                        onEditItem(originalIndex, e.target.value);
                                        setEditingItemIdx(null);
                                    }}
                                    autoFocus
                                    onBlur={() => setEditingItemIdx(null)}
                                >
                                    {availableCategories.map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
      )}
    </div>
  );
};

// Texto do cupom (monoespaçado): ajusta a letra para a linha mais larga caber inteira na tela,
// sem quebrar (antes o "TOTAL" e os traços desciam para a linha de baixo no celular).
const FitPre: React.FC<{ text: string; maxPx?: number; minPx?: number }> = ({ text, maxPx = 12, minPx = 7 }) => {
    const boxRef = useRef<HTMLDivElement>(null);
    const preRef = useRef<HTMLPreElement>(null);
    const [size, setSize] = useState(9);
    useLayoutEffect(() => {
        const box = boxRef.current;
        if (!box) return;
        const fit = () => {
            const pre = preRef.current;
            const width = box.clientWidth;
            if (!pre || !width) return;
            // Mede o texto de verdade (a fonte do aparelho, com a linha mais larga) num tamanho de referência
            // e escala: assim a linha mais larga ocupa a largura toda, sem sobra de um lado só.
            const keep = pre.style.fontSize;
            pre.style.fontSize = '100px';
            const natural = pre.getBoundingClientRect().width;
            pre.style.fontSize = keep;
            if (!natural) return;
            const px = Math.floor(((width / natural) * 100 * 0.995) * 10) / 10; // 0,5% de folga
            setSize(Math.max(minPx, Math.min(maxPx, px)));
        };
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(box);
        // a fonte do cupom pode terminar de carregar depois: mede de novo quando isso acontecer
        const fonts = (document as any).fonts;
        if (fonts && fonts.ready) fonts.ready.then(fit).catch(() => {});
        return () => ro.disconnect();
    }, [text, maxPx, minPx]);
    return (
        <div ref={boxRef} className="w-full flex justify-center" data-testid="coupon-fit">
            <pre ref={preRef} className="whitespace-pre select-text relative z-0" style={{ fontSize: `${size}px`, lineHeight: 1.5, width: 'max-content' }} data-testid="coupon-pre">{text}</pre>
        </div>
    );
};

const ThermalReceiptView: React.FC<{ receipt: Receipt }> = ({ receipt }) => {
    const [isGenerating, setIsGenerating] = useState(false);
    const txtContent = useMemo(() => generateReceiptText(receipt), [receipt]);
    const establishmentSlug = useMemo(() => {
        return receipt.establishmentName.split(' ')[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
    }, [receipt.establishmentName]);
    const fileName = useMemo(() => {
        return `${establishmentSlug}_${receipt.date}.txt`;
    }, [establishmentSlug, receipt.date]);

    const handleExportTxt = () => {
        const blob = new Blob([txtContent], {type: "text/plain;charset=utf-8"});
        downloadFile(blob, fileName).catch(() => alert("Não foi possível salvar o arquivo."));
    };

    const handleExportZip = async () => {
        setIsGenerating(true);
        try {
            const ZipClass = (JSZip as any).default || JSZip;
            const zip = new ZipClass();
            const folder = zip.folder(establishmentSlug);
            if (folder) {
                folder.file(fileName, txtContent);
                folder.file("data.json", JSON.stringify(receipt, null, 2));
            }
            const content = await zip.generateAsync({ type: "blob" });
            await downloadFile(content, `${establishmentSlug}_Export.zip`);
        } catch (error) {
            alert("Erro ao gerar o arquivo ZIP.");
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 mb-4 bg-black/40 p-2 rounded-lg border border-white/5 font-mono text-xs text-zinc-500 overflow-x-auto whitespace-nowrap">
                <Folder className="w-3 h-3 text-luxury-gold" />
                <span>SYSTEM</span>
                <ChevronRight className="w-3 h-3" />
                <span>ESTABELECIMENTOS</span>
                <ChevronRight className="w-3 h-3" />
                <span className="text-zinc-300">{establishmentSlug}</span>
                <ChevronRight className="w-3 h-3" />
                <span className="text-luxury-gold flex items-center gap-1">
                    <FileType className="w-3 h-3" /> {fileName}
                </span>
            </div>
            <div className="thermal-box flex-1 bg-zinc-900 rounded-md p-3 md:p-6 mb-4 border border-zinc-800 shadow-2xl relative overflow-hidden font-mono text-zinc-400 overflow-y-auto overflow-x-auto custom-scrollbar" data-testid="coupon-box">
                {/* efeitos de tela de cupom (só no escuro): no claro o cupom é texto limpo sobre fundo claro */}
                <div className="thermal-fx absolute inset-0 pointer-events-none opacity-5 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%] z-20"></div>
                <div className="thermal-fx absolute inset-0 bg-gradient-to-b from-black/20 to-transparent pointer-events-none z-10"></div>
                <FitPre text={txtContent} />
            </div>
            <div className="flex justify-between items-center bg-black border border-white/10 rounded-xl p-4 animate-in slide-in-from-bottom-2 gap-4">
                <div className="flex flex-col flex-1">
                     <h3 className="text-xs uppercase tracking-[0.08em] text-zinc-200 font-bold mb-1">Exportar Dados</h3>
                     <p className="text-xs text-zinc-500 line-clamp-1">Baixe o arquivo original.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={handleExportTxt} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-[0.08em] transition-all">
                        <FileText className="w-4 h-4" /> .TXT
                    </button>
                    <button onClick={handleExportZip} disabled={isGenerating} className="flex items-center gap-2 bg-luxury-gold hover:bg-[#B5952F] text-black px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-[0.08em] transition-all">
                        {isGenerating ? '...' : <><Download className="w-4 h-4" /> .ZIP</>}
                    </button>
                </div>
            </div>
        </div>
    );
};

const ReceiptDetail: React.FC<ReceiptDetailProps> = ({ receipt, onClose, onUpdateReceipt, onDelete, onNext, onPrev, hasNext, hasPrev, categories, knownEstablishments = [], knownProducts = [] }) => {
  const { aliasOf } = useStoreNames();
  const [viewMode, setViewMode] = useState<'cards' | 'thermal'>('thermal'); // abre no cupom em TXT; o Estruturado fica na aba da direita
  const [isEditing, setIsEditing] = useState(false);
  const [editedReceipt, setEditedReceipt] = useState<Receipt>(receipt);

  useEffect(() => {
    setEditedReceipt(receipt);
    setIsEditing(false);
  }, [receipt]);

  const groupedItems = useMemo(() => {
    const groups: Record<string, { items: ReceiptItem[], total: number }> = {};
    receipt.items.forEach(item => {
        const cat = item.category && item.category.trim() !== '' ? item.category : 'Outros - Não Classificado';
        if (!groups[cat]) { groups[cat] = { items: [], total: 0 }; }
        groups[cat].items.push(item);
        groups[cat].total += item.totalPrice;
    });
    return Object.entries(groups).sort((a, b) => b[1].total - a[1].total);
  }, [receipt.items]);

  const handleEditItemCategory = (index: number, newCategory: string) => {
    const updatedItems = [...receipt.items];
    updatedItems[index] = { ...updatedItems[index], category: newCategory };
    onUpdateReceipt({ ...receipt, items: updatedItems });
  };

  const handleSaveEdit = () => {
    onUpdateReceipt(editedReceipt);
    setIsEditing(false);
  };

  const updateHeader = (field: keyof Receipt, value: any) => {
      setEditedReceipt(prev => ({ ...prev, [field]: value }));
  };

  const updateEditedItem = (index: number, field: keyof ReceiptItem, value: any) => {
    const newItems = [...editedReceipt.items];
    const item = { ...newItems[index], [field]: value };
    if (field === 'quantity' || field === 'unitPrice') {
        const qty = field === 'quantity' ? Number(value) : item.quantity;
        const unit = field === 'unitPrice' ? Number(value) : item.unitPrice;
        item.totalPrice = Number((qty * unit).toFixed(2));
    }
    newItems[index] = item;
    const newTotal = newItems.reduce((sum, i) => sum + (Number(i.totalPrice)||0), 0);
    setEditedReceipt(prev => ({ ...prev, items: newItems, totalAmount: newTotal }));
  };

  const addEmptyItem = () => {
      setEditedReceipt(prev => ({
          ...prev,
          items: [...prev.items, { description: '', quantity: 1, unitType: 'UN', unitPrice: 0, totalPrice: 0, category: 'Outros' }]
      }));
  };

  const removeEditedItem = (index: number) => {
      const newItems = editedReceipt.items.filter((_, i) => i !== index);
      const newTotal = newItems.reduce((sum, i) => sum + (Number(i.totalPrice)||0), 0);
      setEditedReceipt(prev => ({ ...prev, items: newItems, totalAmount: newTotal }));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="w-full max-w-3xl bg-black border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[95vh] animate-in zoom-in-95 duration-300 relative">
        {!isEditing && (
            <>
                <div className="absolute top-1/2 -translate-y-1/2 -left-12 hidden md:flex flex-col gap-4">
                    <button onClick={onPrev} disabled={!hasPrev} className="p-3 rounded-full bg-zinc-900 border border-white/10 text-zinc-400 hover:text-luxury-gold hover:border-luxury-gold/50 disabled:opacity-30 transition-all"><ChevronLeft className="w-6 h-6" /></button>
                </div>
                <div className="absolute top-1/2 -translate-y-1/2 -right-12 hidden md:flex flex-col gap-4">
                    <button onClick={onNext} disabled={!hasNext} className="p-3 rounded-full bg-zinc-900 border border-white/10 text-zinc-400 hover:text-luxury-gold hover:border-luxury-gold/50 disabled:opacity-30 transition-all"><ChevronRight className="w-6 h-6" /></button>
                </div>
            </>
        )}

        <div className="p-5 border-b border-white/10 bg-surface/30 flex justify-between items-start shrink-0">
          <div className="pr-8 flex-1 min-w-0">
             <div className="flex items-center gap-2 mb-2">
                 {!isEditing && (
                     <>
                        <button onClick={onPrev} disabled={!hasPrev} className="md:hidden p-1 bg-white/5 rounded text-zinc-400 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                        <span className="text-[11px] text-zinc-500 uppercase tracking-[0.08em] border border-white/10 px-2 py-0.5 rounded">Detalhes</span>
                        <button onClick={onNext} disabled={!hasNext} className="md:hidden p-1 bg-white/5 rounded text-zinc-400 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
                     </>
                 )}
                 {isEditing && (
                     <span className="text-[11px] text-luxury-gold bg-luxury-gold/10 border border-luxury-gold/20 px-2 py-0.5 rounded uppercase tracking-[0.08em] font-bold flex items-center gap-1"><Edit2 className="w-3 h-3" /> Modo Edição</span>
                 )}
             </div>
             
             {isEditing ? (
                 <div className="space-y-4 mt-2">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="text-[11px] uppercase text-zinc-500 font-bold block mb-1">CNPJ</label>
                            <input type="text" value={editedReceipt.cnpj} onChange={(e) => updateHeader('cnpj', e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-zinc-300 focus:border-luxury-gold outline-none" />
                        </div>
                        <div>
                            <label className="text-[11px] uppercase text-zinc-500 font-bold block mb-1">Estabelecimento</label>
                            <input type="text" list="est-list-edit" value={editedReceipt.establishmentName} onChange={(e) => updateHeader('establishmentName', e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-lg font-serif text-white focus:border-luxury-gold outline-none" />
                        </div>
                     </div>
                     <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                         <div>
                             <label className="text-[11px] uppercase text-zinc-500 font-bold block mb-1">Data</label>
                             <input type="date" value={editedReceipt.date} onChange={(e) => updateHeader('date', e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-zinc-200" />
                         </div>
                         <div>
                             <label className="text-[11px] uppercase text-zinc-500 font-bold block mb-1">Hora</label>
                             <input type="time" step="1" value={editedReceipt.time} onChange={(e) => updateHeader('time', e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-zinc-200" />
                         </div>
                         <div>
                             <label className="text-[11px] uppercase text-zinc-500 font-bold block mb-1">Cidade</label>
                             <input type="text" value={editedReceipt.city} onChange={(e) => updateHeader('city', e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-zinc-200" />
                         </div>
                         <div>
                             <label className="text-[11px] uppercase text-zinc-500 font-bold block mb-1">UF</label>
                             <input type="text" maxLength={2} value={editedReceipt.state} onChange={(e) => updateHeader('state', e.target.value.toUpperCase())} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-zinc-200 uppercase" />
                         </div>
                     </div>
                 </div>
             ) : (
                <>
                    {aliasOf(receipt.establishmentName, receipt.cnpj) ? (
                        <>
                            <h2 className="text-xl md:text-2xl font-serif text-zinc-100 font-medium line-clamp-3 break-words leading-snug" data-testid="receipt-store-alias">{aliasOf(receipt.establishmentName, receipt.cnpj)}</h2>
                            <p className="text-xs text-zinc-500 mt-1 break-words" title="Nome como veio no cupom">{titleCase(receipt.establishmentName)}</p>
                        </>
                    ) : (
                        <h2 className="text-xl md:text-2xl font-serif text-zinc-100 font-medium line-clamp-3 break-words leading-snug">{receipt.establishmentName}</h2>
                    )}
                    <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3 text-xs text-zinc-500 uppercase tracking-wide">
                        <div className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{receipt.date.split('-').reverse().join('/')}<span className="text-zinc-700 mx-1">|</span>{receipt.time || '--:--'}</div>
                        <div className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{receipt.city}{receipt.state ? ` - ${receipt.state}` : ''}</div>
                    </div>
                </>
             )}
          </div>
          <div className="flex gap-2">
              {!isEditing ? (
                <>
                    <button onClick={() => setIsEditing(true)} aria-label="Editar lançamento" className="p-2 rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-luxury-gold transition-colors bg-black/20"><Edit2 className="w-5 h-5" /></button>
                    {onDelete && <button onClick={onDelete} aria-label="Excluir lançamento" data-testid="delete-receipt" className="p-2 rounded-full hover:bg-red-900/30 text-zinc-500 hover:text-red-400 transition-colors bg-black/20"><Trash2 className="w-5 h-5" /></button>}
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors bg-black/20"><X className="w-5 h-5" /></button>
                </>
              ) : (
                <>
                    <button onClick={() => setIsEditing(false)} className="p-2 rounded-full hover:bg-red-900/30 text-zinc-500 hover:text-red-500 transition-colors bg-black/20"><X className="w-5 h-5" /></button>
                    <button onClick={handleSaveEdit} className="p-2 rounded-full bg-luxury-gold hover:bg-[#B5952F] text-black shadow-lg shadow-luxury-gold/20 transition-colors"><Save className="w-5 h-5" /></button>
                </>
              )}
          </div>
        </div>

        {!isEditing && (
            <div className="flex border-b border-white/5 bg-black/40 shrink-0">
                <button onClick={() => setViewMode('thermal')} className={`flex-1 py-3 text-xs uppercase tracking-[0.08em] font-bold flex items-center justify-center gap-2 transition-all ${viewMode === 'thermal' ? 'text-luxury-gold border-b-2 border-luxury-gold bg-luxury-gold/5' : 'text-zinc-500 hover:text-zinc-300'}`}><Scroll className="w-3.5 h-3.5" /> Cupom TXT</button>
                <button onClick={() => setViewMode('cards')} className={`flex-1 py-3 text-xs uppercase tracking-[0.08em] font-bold flex items-center justify-center gap-2 transition-all ${viewMode === 'cards' ? 'text-luxury-gold border-b-2 border-luxury-gold bg-luxury-gold/5' : 'text-zinc-500 hover:text-zinc-300'}`}><PieChart className="w-3.5 h-3.5" /> Estruturado</button>
            </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#09090b] custom-scrollbar">
          {isEditing ? (
              <div className="space-y-4">
                  <div className="flex justify-between items-center mb-2 px-1">
                      <h3 className="text-xs uppercase tracking-[0.08em] text-zinc-400 font-bold">Itens da Compra</h3>
                      <button type="button" onClick={addEmptyItem} className="flex items-center gap-1 text-[11px] uppercase font-bold text-luxury-gold hover:underline"><Plus className="w-3 h-3"/> Novo Item</button>
                  </div>
                  <div className="space-y-2">
                      {editedReceipt.items.map((item, idx) => (
                          <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 p-3 bg-zinc-900/50 border border-white/5 rounded-lg hover:bg-white/5 transition-colors items-start">
                              <div className="col-span-4"><label className="md:hidden text-xs text-zinc-500 block mb-0.5">Descrição</label><input type="text" value={item.description} onChange={(e) => updateEditedItem(idx, 'description', e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1 text-xs text-zinc-200"/></div>
                              <div className="col-span-3"><label className="md:hidden text-xs text-zinc-500 block mb-1">Categoria</label><select value={item.category} onChange={(e) => updateEditedItem(idx, 'category', e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1 text-xs text-zinc-300">{categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}</select></div>
                              <div className="col-span-1"><label className="md:hidden text-xs text-zinc-500 block mb-1">Qtd</label><input type="number" value={item.quantity} onChange={(e) => updateEditedItem(idx, 'quantity', e.target.value)} className="w-full bg-black border border-white/10 rounded px-1 py-1 text-xs text-center text-zinc-200"/></div>
                              <div className="col-span-1"><label className="md:hidden text-xs text-zinc-500 block mb-1">Un</label><input type="text" value={item.unitType || 'UN'} onChange={(e) => updateEditedItem(idx, 'unitType', e.target.value)} className="w-full bg-black border border-white/10 rounded px-1 py-1 text-xs text-center text-zinc-200 uppercase"/></div>
                              <div className="col-span-1"><label className="md:hidden text-xs text-zinc-500 block mb-1">Vl. Un</label><input type="number" step="0.01" value={item.unitPrice} onChange={(e) => updateEditedItem(idx, 'unitPrice', e.target.value)} className="w-full bg-black border border-white/10 rounded px-1 py-1 text-xs text-right text-zinc-200"/></div>
                              <div className="col-span-1"><label className="md:hidden text-xs text-zinc-500 block mb-1">Total</label><input type="number" step="0.01" value={item.totalPrice} onChange={(e) => updateEditedItem(idx, 'totalPrice', Number(e.target.value))} className="w-full bg-black border border-white/10 rounded px-1 py-1 text-xs text-right font-bold text-luxury-gold"/></div>
                              <div className="col-span-1 flex justify-center pt-1"><button onClick={() => removeEditedItem(idx)} className="text-zinc-600 hover:text-red-500"><Trash2 className="w-4 h-4" /></button></div>
                          </div>
                      ))}
                  </div>
              </div>
          ) : (
            viewMode === 'thermal' ? (<ThermalReceiptView receipt={receipt} />) : (
                <>
                {groupedItems.length > 0 && (
                    <div className="mb-8">
                        <div className="flex items-center gap-2 mb-4 px-1"><PieChart className="w-3.5 h-3.5 text-luxury-gold" /><h3 className="text-xs uppercase tracking-[0.08em] text-zinc-400 font-bold">Resumo Financeiro</h3></div>
                        <div className="grid grid-cols-2 gap-3">
                            {groupedItems.slice(0, 4).map(([category, data]) => {
                                const percentage = receipt.totalAmount > 0 ? (data.total / receipt.totalAmount) * 100 : 0;
                                return (
                                    <div key={category} className="bg-surface/30 border border-white/5 p-3 rounded-xl hover:bg-white/5 transition-all group">
                                        <div className="text-xs text-zinc-400 font-medium leading-snug line-clamp-2 mb-1 group-hover:text-luxury-gold/80 transition-colors">{category}</div>
                                        <div className="text-sm font-sans font-medium text-zinc-200 mb-2">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(data.total)}</div>
                                        <div className="w-full bg-zinc-800 h-5 rounded-lg overflow-hidden relative">
                                            <div className="bg-luxury-gold h-full rounded-lg opacity-80 transition-all duration-500" style={{ width: `${percentage}%` }} />
                                            <div className="absolute inset-0 flex items-center justify-end pr-1">
                                                <span className="text-xs font-bold text-white bg-black/30 px-1.5 py-px rounded">{percentage.toFixed(0)}%</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
                <div className="flex items-center justify-between mb-4 border-t border-white/5 pt-6">
                    <div className="flex flex-col"><h3 className="text-xs uppercase tracking-[0.08em] text-luxury-gold font-bold">Itens da Nota</h3><span className="text-xs text-zinc-500">Categorizados automaticamente</span></div>
                    <span className="text-xs text-zinc-500 bg-surface px-2 py-1 rounded border border-white/10">{receipt.items.length} itens</span>
                </div>
                <div className="space-y-1 pb-10">
                    {groupedItems.map(([category, data]) => (
                        <CategoryGroup key={category} category={category} items={data.items} total={data.total} onEditItem={handleEditItemCategory} allItems={receipt.items} availableCategories={categories}/>
                    ))}
                </div>
                </>
            )
          )}
        </div>

        <div className="p-6 bg-surface/20 border-t border-white/10 flex justify-between items-center relative z-20 shrink-0">
            <div className="flex flex-col">
                <span className="text-zinc-500 font-sans text-xs uppercase tracking-wider mb-1">Total da Transação</span>
                {receipt.cnpj && <span className="text-xs text-zinc-500 font-mono">CNPJ: {formatCNPJ(receipt.cnpj)}</span>}
            </div>
            <span className={`text-3xl font-serif font-medium ${isEditing ? 'text-white' : 'text-luxury-gold'}`}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(isEditing ? editedReceipt.totalAmount : receipt.totalAmount)}
            </span>
        </div>
      </div>
    </div>
  );
};

export default ReceiptDetail;
