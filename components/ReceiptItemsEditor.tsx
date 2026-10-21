import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ReceiptItem } from '../types';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Plus, Search, Trash2, X } from 'lucide-react';
import ItemCategoryPicker from './ItemCategoryPicker';
import EggCountPicker from './EggCountPicker';
import { isEggItem } from '../services/eggs';
import { getCategoryColor, getCategoryIcon } from './Dashboard';

/* Itens do cupom na edição: linhas compactas que abrem uma a uma, com busca para chegar direto no item,
   "expandir/recolher tudo" e ordem por cupom, categoria ou nome. A ordem é só de exibição: os índices continuam
   os do cupom, então editar, remover e fixar categoria funcionam igual. */

type Order = 'cupom' | 'categoria' | 'nome';
const fold = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const field = 'w-full bg-black border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-zinc-200';

interface Props {
  items: ReceiptItem[];
  categories: string[];
  onChange: (index: number, field: keyof ReceiptItem, value: any) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}

const ReceiptItemsEditor: React.FC<Props> = ({ items, categories, onChange, onRemove, onAdd }) => {
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<Order>('cupom');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const rows = useRef<Map<number, HTMLDivElement | null>>(new Map());

  const shown = useMemo(() => {
    const q = fold(query).trim();
    let list = items.map((item, idx) => ({ item, idx }));
    if (q) list = list.filter(({ item }) => fold(`${item.description} ${item.category}`).includes(q));
    if (order === 'nome') list.sort((a, b) => fold(a.item.description).localeCompare(fold(b.item.description)) || a.idx - b.idx);
    if (order === 'categoria') list.sort((a, b) => fold(a.item.category || '').localeCompare(fold(b.item.category || '')) || fold(a.item.description).localeCompare(fold(b.item.description)) || a.idx - b.idx);
    return list;
  }, [items, query, order]);

  // um só resultado na busca: já abre para editar
  useEffect(() => {
    if (query.trim() && shown.length === 1) setOpen(prev => (prev.has(shown[0].idx) ? prev : new Set(prev).add(shown[0].idx)));
  }, [query, shown]);

  const toggle = (idx: number) => setOpen(prev => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; });
  const goTo = (idx: number) => {
    setOpen(prev => new Set(prev).add(idx));
    setTimeout(() => rows.current.get(idx)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 60);
  };
  const add = () => {
    const idx = items.length;
    setQuery('');
    onAdd();
    goTo(idx);
  };
  const remove = (idx: number) => {
    onRemove(idx);
    setOpen(prev => { const n = new Set<number>(); prev.forEach(i => { if (i < idx) n.add(i); else if (i > idx) n.add(i - 1); }); return n; });
  };

  const allOpen = shown.length > 0 && shown.every(s => open.has(s.idx));
  const sum = shown.reduce((s, x) => s + (Number(x.item.totalPrice) || 0), 0);

  const renderRow = ({ item, idx }: { item: ReceiptItem; idx: number }) => {
    const isOpen = open.has(idx);
    const color = getCategoryColor(item.category || '');
    const Icon = getCategoryIcon(item.category || '');
    const catShort = (item.category || 'Sem categoria').split(' - ').slice(1).join(' › ') || item.category || 'Sem categoria';
    return (
      <div key={idx} ref={el => { rows.current.set(idx, el); }} data-testid={`item-row-${idx}`}
        className={`rounded-2xl border transition-colors ${isOpen ? 'bg-zinc-900/60 border-luxury-gold/30' : 'bg-zinc-900/40 border-white/5 hover:bg-white/5'}`}>
        <button type="button" onClick={() => toggle(idx)} aria-expanded={isOpen} data-testid={`item-toggle-${idx}`}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
          <span className="w-8 h-8 shrink-0 rounded-full bg-black/60 border border-white/10 flex items-center justify-center" style={{ color }}>
            {React.createElement(Icon, { className: 'w-4 h-4' })}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-zinc-100 truncate">{item.description || <span className="text-zinc-500 italic">Novo item</span>}</span>
            <span className="block text-[11px] text-zinc-500 truncate">
              {Number(item.quantity) || 0} {item.unitType || 'UN'} × {brl.format(Number(item.unitPrice) || 0)} · {catShort}
            </span>
          </span>
          <span className="text-sm font-bold text-luxury-gold tabular-nums shrink-0">{brl.format(Number(item.totalPrice) || 0)}</span>
          <ChevronDown className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && (
          <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-white/5">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Descrição</label>
              <input type="text" data-testid={`item-desc-${idx}`} value={item.description} onChange={e => onChange(idx, 'description', e.target.value)} className={field} />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Categoria</label>
              <ItemCategoryPicker category={item.category} description={item.description} categories={categories} testId={`item-cat-${idx}`} onPick={c => onChange(idx, 'category', c)} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-xs text-zinc-500 block mb-1">Qtd</label><input type="number" value={item.quantity} onChange={e => onChange(idx, 'quantity', e.target.value)} className={`${field} text-center`} /></div>
              <div><label className="text-xs text-zinc-500 block mb-1">Un</label><input type="text" value={item.unitType || 'UN'} onChange={e => onChange(idx, 'unitType', e.target.value)} className={`${field} text-center uppercase`} /></div>
              <div><label className="text-xs text-zinc-500 block mb-1">Vl. Un</label><input type="number" step="0.01" value={item.unitPrice} onChange={e => onChange(idx, 'unitPrice', e.target.value)} className={`${field} text-right`} /></div>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1"><label className="text-xs text-zinc-500 block mb-1">Total</label><input type="number" step="0.01" value={item.totalPrice} onChange={e => onChange(idx, 'totalPrice', Number(e.target.value))} className={`${field} text-right font-bold text-luxury-gold`} /></div>
              <button type="button" onClick={() => remove(idx)} aria-label="Remover item" className="h-9 px-3 rounded-full border border-white/10 text-zinc-500 hover:text-red-500 hover:border-red-500/40 flex items-center gap-1.5 text-xs"><Trash2 className="w-4 h-4" /> Remover</button>
            </div>
            {isEggItem(item) && <EggCountPicker item={item} testId={`egg-picker-edit-${idx}`} onChange={n => onChange(idx, 'eggCount', n)} />}
          </div>
        )}
      </div>
    );
  };

  // cabeçalhos por categoria quando a ordem é por categoria
  const body: React.ReactNode[] = [];
  let lastCat: string | null = null;
  shown.forEach(s => {
    if (order === 'categoria' && (s.item.category || '') !== lastCat) {
      lastCat = s.item.category || '';
      const group = shown.filter(x => (x.item.category || '') === lastCat);
      body.push(
        <div key={`h-${lastCat}`} className="flex items-center justify-between px-2 pt-3 pb-0.5 text-[11px] font-bold text-zinc-400">
          <span className="truncate">{(lastCat || 'Sem categoria').split(' - ').join(' › ')} <span className="text-zinc-600 font-medium">· {group.length}</span></span>
          <span className="tabular-nums text-zinc-500 shrink-0 ml-2">{brl.format(group.reduce((t, x) => t + (Number(x.item.totalPrice) || 0), 0))}</span>
        </div>
      );
    }
    body.push(renderRow(s));
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center px-1">
        <h3 className="text-xs uppercase tracking-[0.08em] text-zinc-400 font-bold">Itens da Compra <span className="text-zinc-600 normal-case tracking-normal">({items.length})</span></h3>
        <button type="button" onClick={add} data-testid="item-add" className="flex items-center gap-1 text-[11px] uppercase font-bold text-luxury-gold hover:underline"><Plus className="w-3 h-3" /> Novo Item</button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input type="search" data-testid="item-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar item ou categoria"
          onKeyDown={e => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); goTo(shown[0].idx); (e.target as HTMLInputElement).blur(); } }}
          className="w-full bg-black border border-white/10 rounded-full pl-10 pr-9 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600" />
        {query && <button type="button" aria-label="Limpar busca" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-zinc-500"><X className="w-3.5 h-3.5" /></button>}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-full bg-white/5 border border-white/10 p-0.5" role="group" aria-label="Ordenar itens">
          {([['cupom', 'Cupom'], ['categoria', 'Categoria'], ['nome', 'Nome']] as [Order, string][]).map(([k, label]) => (
            <button key={k} type="button" data-testid={`item-order-${k}`} onClick={() => setOrder(k)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${order === k ? 'bg-luxury-gold text-black' : 'text-zinc-400'}`}>{label}</button>
          ))}
        </div>
        <button type="button" data-testid="item-toggle-all" onClick={() => setOpen(allOpen ? new Set() : new Set(shown.map(s => s.idx)))}
          className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/10 text-xs font-semibold text-zinc-300">
          {allOpen ? <><ChevronsDownUp className="w-3.5 h-3.5" /> Recolher tudo</> : <><ChevronsUpDown className="w-3.5 h-3.5" /> Expandir tudo</>}
        </button>
      </div>

      {query.trim() && <p className="text-[11px] text-zinc-500 px-1" data-testid="item-search-count">{shown.length} de {items.length} {items.length === 1 ? 'item' : 'itens'} · {brl.format(sum)}</p>}

      <div className="space-y-1.5">
        {body}
        {shown.length === 0 && <p className="text-center text-sm text-zinc-500 py-6">{items.length === 0 ? 'Nenhum item. Toque em “Novo Item”.' : 'Nenhum item encontrado.'}</p>}
      </div>
    </div>
  );
};

export default ReceiptItemsEditor;
