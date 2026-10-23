
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
import EggCountPicker from './EggCountPicker';
import { isEggItem } from '../services/eggs';
import { normalizeReceiptNumbers } from '../services/receiptNumbers';
import ItemCategoryPicker from './ItemCategoryPicker';
import ReceiptItemsEditor from './ReceiptItemsEditor';
import ReceiptStructuredView from './ReceiptStructuredView';

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
  // Ovos: quantas outras compras do mesmo item (mesma loja) ainda estão sem a quantidade, e o atalho que copia a escolha para elas
  eggSameCount?: (receipt: Receipt, index: number) => number;
  onApplyEggSame?: (receipt: Receipt, index: number) => number;
}

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

const ReceiptDetail: React.FC<ReceiptDetailProps> = ({ receipt, onClose, onUpdateReceipt, onDelete, onNext, onPrev, hasNext, hasPrev, categories, knownEstablishments = [], knownProducts = [], eggSameCount, onApplyEggSame }) => {
  const { aliasOf } = useStoreNames();
  const [viewMode, setViewMode] = useState<'cards' | 'thermal'>('thermal'); // abre no cupom em TXT; o Estruturado fica na aba da direita
  const [isEditing, setIsEditing] = useState(false);
  const [editedReceipt, setEditedReceipt] = useState<Receipt>(receipt);

  useEffect(() => {
    setEditedReceipt(receipt);
    setIsEditing(false);
  }, [receipt]);

  const handleEditItemCategory = (index: number, newCategory: string) => {
    const updatedItems = [...receipt.items];
    updatedItems[index] = { ...updatedItems[index], category: newCategory };
    onUpdateReceipt({ ...receipt, items: updatedItems });
  };

  // Ovos: guarda (ou tira) a quantidade de ovos da bandeja deste item
  const handleEggCount = (index: number, count: number | undefined) => {
    const updatedItems = [...receipt.items];
    const { eggCount: _drop, ...rest } = updatedItems[index];
    updatedItems[index] = count && count > 0 ? { ...rest, eggCount: count } : rest;
    onUpdateReceipt({ ...receipt, items: updatedItems });
  };

  const handleSaveEdit = () => {
    onUpdateReceipt(normalizeReceiptNumbers(editedReceipt));
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
    <div className={`fixed inset-0 z-[100] flex items-center justify-center ${isEditing ? 'p-2 md:p-4' : 'p-4'} bg-black/80 backdrop-blur-sm animate-in fade-in duration-300`}>
      <div className={`w-full max-w-3xl bg-black border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden ${isEditing ? 'max-h-full md:max-h-[95vh]' : 'max-h-[95vh]'} animate-in zoom-in-95 duration-300 relative`} data-testid="receipt-modal">
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

        {isEditing ? (
          <div className="px-3 py-2 md:px-5 md:py-3 border-b border-white/10 bg-surface/30 flex justify-between items-center gap-2 shrink-0" data-testid="edit-topbar">
            <span className="text-[11px] text-luxury-gold bg-luxury-gold/10 border border-luxury-gold/20 px-2 py-0.5 rounded uppercase tracking-[0.08em] font-bold flex items-center gap-1"><Edit2 className="w-3 h-3" /> Modo Edição</span>
            <div className="flex gap-2">
              <button onClick={() => setIsEditing(false)} aria-label="Cancelar edição" className="p-2 rounded-full hover:bg-red-900/30 text-zinc-500 hover:text-red-500 transition-colors bg-black/20"><X className="w-5 h-5" /></button>
              <button onClick={handleSaveEdit} aria-label="Salvar edição" className="p-2 rounded-full bg-luxury-gold hover:bg-[#B5952F] text-black shadow-lg shadow-luxury-gold/20 transition-colors"><Save className="w-5 h-5" /></button>
            </div>
          </div>
        ) : (
          <div className="p-5 border-b border-white/10 bg-surface/30 shrink-0">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                   {!isEditing && (
                       <>
                          <button onClick={onPrev} disabled={!hasPrev} className="md:hidden p-1 bg-white/5 rounded text-zinc-400 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                          <span className="text-[11px] text-zinc-500 uppercase tracking-[0.08em] border border-white/10 px-2 py-0.5 rounded">Detalhes</span>
                          <button onClick={onNext} disabled={!hasNext} className="md:hidden p-1 bg-white/5 rounded text-zinc-400 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
                       </>
                   )}
               </div>
              <div className="flex gap-2">
                  <>
                      <button onClick={() => setIsEditing(true)} aria-label="Editar lançamento" className="p-2 rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-luxury-gold transition-colors bg-black/20"><Edit2 className="w-5 h-5" /></button>
                      {onDelete && <button onClick={onDelete} aria-label="Excluir lançamento" data-testid="delete-receipt" className="p-2 rounded-full hover:bg-red-900/30 text-zinc-500 hover:text-red-400 transition-colors bg-black/20"><Trash2 className="w-5 h-5" /></button>}
                      <button onClick={onClose} className="p-2 rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors bg-black/20"><X className="w-5 h-5" /></button>
                  </>
            </div>
            </div>
            <div className="min-w-0">

             
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
            </div>
          </div>
        )}

        {!isEditing && (
            <div className="flex border-b border-white/5 bg-black/40 shrink-0">
                <button onClick={() => setViewMode('thermal')} className={`flex-1 py-3 text-xs uppercase tracking-[0.08em] font-bold flex items-center justify-center gap-2 transition-all ${viewMode === 'thermal' ? 'text-luxury-gold border-b-2 border-luxury-gold bg-luxury-gold/5' : 'text-zinc-500 hover:text-zinc-300'}`}><Scroll className="w-3.5 h-3.5" /> Cupom TXT</button>
                <button onClick={() => setViewMode('cards')} className={`flex-1 py-3 text-xs uppercase tracking-[0.08em] font-bold flex items-center justify-center gap-2 transition-all ${viewMode === 'cards' ? 'text-luxury-gold border-b-2 border-luxury-gold bg-luxury-gold/5' : 'text-zinc-500 hover:text-zinc-300'}`}><PieChart className="w-3.5 h-3.5" /> Estruturado</button>
            </div>
        )}

        <div className={`flex-1 overflow-y-auto ${isEditing ? 'p-3 md:p-6' : 'p-4 md:p-6'} bg-[#09090b] custom-scrollbar`}>
          {isEditing ? (
              <div className="space-y-3">
                  {/* dados do cupom em grade de 12 colunas: 3 linhas no celular, na largura toda; rolam junto com os itens */}
                  <div className="grid grid-cols-12 gap-x-2 gap-y-2 p-3 rounded-lg bg-zinc-900/40 border border-white/5" data-testid="edit-header-fields">
                      <div className="col-span-12">
                          <label className="text-[10px] uppercase text-zinc-500 font-bold block mb-0.5">Estabelecimento</label>
                          <input type="text" list="est-list-edit" value={editedReceipt.establishmentName} onChange={(e) => updateHeader('establishmentName', e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-base font-serif text-white focus:border-luxury-gold outline-none" />
                      </div>
                      <div className="col-span-6">
                          <label className="text-[10px] uppercase text-zinc-500 font-bold block mb-0.5">CNPJ</label>
                          <input type="text" value={editedReceipt.cnpj} onChange={(e) => updateHeader('cnpj', e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-zinc-300 focus:border-luxury-gold outline-none" />
                      </div>
                      <div className="col-span-6">
                          <label className="text-[10px] uppercase text-zinc-500 font-bold block mb-0.5">Data</label>
                          <input type="date" value={editedReceipt.date} onChange={(e) => updateHeader('date', e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-zinc-200 focus:border-luxury-gold outline-none" />
                      </div>
                      <div className="col-span-5">
                          <label className="text-[10px] uppercase text-zinc-500 font-bold block mb-0.5">Hora</label>
                          <input type="time" step="1" value={editedReceipt.time} onChange={(e) => updateHeader('time', e.target.value)} className="w-full bg-black border border-white/10 rounded px-1.5 py-1.5 text-[13px] text-zinc-200 focus:border-luxury-gold outline-none" />
                      </div>
                      <div className="col-span-5">
                          <label className="text-[10px] uppercase text-zinc-500 font-bold block mb-0.5">Cidade</label>
                          <input type="text" value={editedReceipt.city} onChange={(e) => updateHeader('city', e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-zinc-200 focus:border-luxury-gold outline-none" />
                      </div>
                      <div className="col-span-2">
                          <label className="text-[10px] uppercase text-zinc-500 font-bold block mb-0.5">UF</label>
                          <input type="text" maxLength={2} value={editedReceipt.state} onChange={(e) => updateHeader('state', e.target.value.toUpperCase())} className="w-full bg-black border border-white/10 rounded px-1 py-1.5 text-sm text-center text-zinc-200 uppercase focus:border-luxury-gold outline-none" />
                      </div>
                  </div>
                  <ReceiptItemsEditor items={editedReceipt.items} categories={categories}
                      onChange={updateEditedItem} onRemove={removeEditedItem} onAdd={addEmptyItem} />
              </div>
          ) : (
            viewMode === 'thermal' ? (<ThermalReceiptView receipt={receipt} />) : (
                <ReceiptStructuredView items={receipt.items} totalAmount={receipt.totalAmount} categories={categories} onEditItem={handleEditItemCategory}
                  onEggCount={handleEggCount}
                  eggSame={eggSameCount ? (i) => eggSameCount(receipt, i) : undefined}
                  onEggApplySame={onApplyEggSame ? (i) => { onApplyEggSame(receipt, i); } : undefined} />
            )
          )}
        </div>

        <div className={`${isEditing ? 'px-4 py-3 md:p-6' : 'p-6'} bg-surface/20 border-t border-white/10 flex justify-between items-center relative z-20 shrink-0`}>
            <div className="flex flex-col">
                <span className="text-zinc-500 font-sans text-xs uppercase tracking-wider mb-1">Total da Transação</span>
                {receipt.cnpj && <span className="text-xs text-zinc-500 font-mono">CNPJ: {formatCNPJ(receipt.cnpj)}</span>}
            </div>
            <span className={`${isEditing ? 'text-2xl md:text-3xl text-white' : 'text-3xl text-luxury-gold'} font-serif font-medium`}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(isEditing ? editedReceipt.totalAmount : receipt.totalAmount)}
            </span>
        </div>
      </div>
    </div>
  );
};

export default ReceiptDetail;
