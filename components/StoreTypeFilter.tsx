import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Store, ChevronDown, Check, X } from 'lucide-react';
import { Receipt } from '../types';
import { useStoreNames } from './StoreNamesContext';
import { useMasterInfo } from './MasterContext';
import { DEFAULT_STORE_TYPES, NO_STORE_TYPE, storeTypeLabel, storeTypeTotals, useStoreTypeFilter } from '../services/storeTypes';

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

/* Filtro por tipo de estabelecimento (Mercado, Restaurante, Farmácia, Academia...). Fica gravado no aparelho e vale no início e nos relatórios.
   `receipts` são os cupons do período, só para mostrar quanto cada tipo gastou ao lado da opção. */
const StoreTypeFilter: React.FC<{ receipts: Receipt[]; className?: string }> = ({ receipts, className = '' }) => {
  const [sel, setSel] = useStoreTypeFilter();
  const [open, setOpen] = useState(false);
  const { typeOf } = useStoreNames();
  const types = useMasterInfo().master?.storeTypes;
  const totals = useMemo(() => storeTypeTotals(receipts, typeOf), [receipts, typeOf]);
  const list = useMemo(() => {
    const base = types && types.length ? types : DEFAULT_STORE_TYPES;
    const out = [...base];
    if (totals.has(NO_STORE_TYPE) || sel.includes(NO_STORE_TYPE)) out.push(NO_STORE_TYPE);
    sel.forEach(t => { if (!out.includes(t)) out.push(t); });
    // os que têm gasto no período vêm primeiro
    return out.map((t, i) => ({ t, i, v: totals.get(t) || 0 })).sort((a, b) => (b.v > 0 ? 1 : 0) - (a.v > 0 ? 1 : 0) || a.i - b.i);
  }, [types, totals, sel]);
  const active = sel.length > 0;
  const toggle = (t: string) => setSel(sel.includes(t) ? sel.filter(x => x !== t) : [...sel, t]);

  return (
    <>
      <div className={`flex items-center gap-1 ${className}`}>
        <button type="button" onClick={() => setOpen(true)} data-testid="store-type-btn" data-active={active ? 'true' : 'false'} aria-haspopup="dialog"
          aria-label={`Tipo de estabelecimento: ${storeTypeLabel(sel)}. Alterar`}
          className="min-w-0 h-8 px-2.5 rounded-xl flex items-center gap-2 text-left bg-white/[0.03] border border-white/5 hover:bg-white/5 transition-colors">
          <Store className="w-4 h-4 text-luxury-gold shrink-0" />
          <span className={`truncate text-xs font-bold uppercase tracking-[0.04em] ${active ? 'text-luxury-gold' : 'text-zinc-300'}`}>{storeTypeLabel(sel)}</span>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        </button>
        {active && (
          <button type="button" onClick={() => setSel([])} aria-label="Limpar o filtro de tipo" data-testid="store-type-clear"
            className="w-8 h-8 flex items-center justify-center rounded-xl border border-white/5 text-zinc-500 active:text-luxury-gold"><X className="w-3.5 h-3.5" /></button>
        )}
      </div>
      {open && createPortal(
        <div className="fixed inset-0 z-[260] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-150" onClick={() => setOpen(false)} data-testid="store-type-sheet">
          <div className="w-full sm:max-w-md max-h-[88dvh] flex flex-col bg-[#0c0c0e] border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] shadow-2xl" onClick={e => e.stopPropagation()} role="dialog" aria-label="Tipo de estabelecimento">
            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
              <h4 className="text-[17px] font-serif text-white tracking-tight">Tipo de estabelecimento</h4>
              <button type="button" onClick={() => setSel([])} disabled={!active} className="text-xs font-semibold text-luxury-gold disabled:text-zinc-600">Todos os tipos</button>
            </div>
            <ul className="overflow-y-auto px-3 pb-2">
              {list.map(({ t, v }) => {
                const on = sel.includes(t);
                return (
                  <li key={t}>
                    <button type="button" onClick={() => toggle(t)} aria-pressed={on} data-testid={`store-type-opt-${t}`}
                      className="w-full min-h-11 px-2 rounded-xl flex items-center gap-3 text-left active:bg-white/5">
                      <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${on ? 'bg-luxury-gold border-luxury-gold' : 'border-white/20'}`}>{on && <Check className="w-3.5 h-3.5 text-black" />}</span>
                      <span className={`flex-1 min-w-0 truncate text-sm ${v > 0 || on ? 'text-zinc-100' : 'text-zinc-500'}`}>{t}</span>
                      {v > 0 && <span className="text-xs text-zinc-400 tabular-nums shrink-0">{brl(v)}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="p-4 border-t border-white/5" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
              <button type="button" onClick={() => setOpen(false)} className="w-full h-11 rounded-xl bg-luxury-gold text-black text-sm font-bold">Pronto</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default StoreTypeFilter;
