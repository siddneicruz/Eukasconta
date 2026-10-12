import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X, Package } from 'lucide-react';
import { Receipt, MasterProduct, ItemFilter } from '../types';
import { buildItemIndex, searchItems, itemFilterTitle, fold, MIN_QUERY } from '../services/itemSearch';

/* Campo de busca de item com autocompletar. Ao escolher uma sugestão, `onSelect` recebe o filtro
   (um produto, ou "tudo com <palavra>"). O texto pode ser controlado de fora (Histórico, onde o
   que se digita também filtra a lista) ou ficar só aqui dentro (Início). */

interface Props {
  receipts: Receipt[];
  masters: MasterProduct[];
  selected: ItemFilter | null;
  onSelect: (f: ItemFilter | null) => void;
  query?: string;
  onQueryChange?: (q: string) => void;
  placeholder?: string;
  textRow?: boolean;          // oferece "Tudo com “cebola”" quando há mais de um produto parecido
  enterPicksFirst?: boolean;  // Enter escolhe a primeira sugestão
  showClear?: boolean;        // ✕ no campo quando há texto digitado
  emptyHint?: boolean;        // avisa quando nada foi encontrado
  className?: string;
  testId?: string;
}

const ItemSearchBox: React.FC<Props> = ({
  receipts, masters, selected, onSelect, query, onQueryChange, placeholder = 'Buscar item',
  textRow = true, enterPicksFirst = true, showClear = true, emptyHint = true, className = '', testId = 'item-search',
}) => {
  const [inner, setInner] = useState('');
  const controlled = query !== undefined;
  const q = controlled ? query! : inner;
  const setQ = (v: string) => { if (controlled) onQueryChange?.(v); else setInner(v); };

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();

  const index = useMemo(() => buildItemIndex(receipts, masters), [receipts, masters]);
  const suggestions = useMemo(() => (open ? searchItems(index, q, { textRow }) : []), [open, index, q, textRow]);
  const searching = fold(q).length >= MIN_QUERY;

  useEffect(() => { setActive(enterPicksFirst && suggestions.length ? 0 : -1); }, [suggestions, enterPicksFirst]);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const pick = (i: number) => {
    const s = suggestions[i];
    if (!s) return;
    onSelect(s.filter);
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!suggestions.length) return;
      e.preventDefault();
      setOpen(true);
      setActive(a => (e.key === 'ArrowDown' ? (a + 1) % suggestions.length : (a <= 0 ? suggestions.length - 1 : a - 1)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && suggestions[active]) pick(active);
      else { setOpen(false); inputRef.current?.blur(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const hasSelected = !!selected && !q;
  const showList = open && searching;

  return (
    <div className={`relative ${className}`} data-testid={testId}>
      <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        data-testid={`${testId}-input`}
        placeholder={hasSelected ? itemFilterTitle(selected!) : placeholder}
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); }}
        onBlur={() => { closeTimer.current = setTimeout(() => setOpen(false), 150); }}
        onKeyDown={onKeyDown}
        className={`w-full bg-white/5 border rounded-xl py-3.5 pl-12 ${showClear && q ? 'pr-11' : 'pr-5'} text-sm text-zinc-300 focus:outline-none focus:border-luxury-gold/40 transition-colors ${hasSelected ? 'border-luxury-gold/40 placeholder:text-luxury-gold placeholder:font-semibold' : 'border-white/5 placeholder:text-zinc-500'}`}
      />
      {showClear && q && (
        <button type="button" aria-label="Limpar a busca" data-testid={`${testId}-clear`}
          onMouseDown={e => e.preventDefault()}
          onClick={() => { setQ(''); inputRef.current?.focus(); }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg text-zinc-500 hover:text-luxury-gold transition-colors">
          <X className="w-4 h-4" />
        </button>
      )}

      {showList && (suggestions.length > 0 || emptyHint) && (
        <div
          id={listId}
          role="listbox"
          data-testid={`${testId}-list`}
          onMouseDown={e => e.preventDefault()}
          className="absolute left-0 right-0 top-full mt-2 z-50 max-h-[55vh] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl p-1.5"
        >
          {suggestions.length === 0 ? (
            <p className="px-3 py-4 text-sm text-zinc-500 text-center" data-testid={`${testId}-empty`}>
              Nenhum item com “{q.trim()}” nas suas compras.
            </p>
          ) : suggestions.map((s, i) => (
            <button
              key={s.id}
              id={`${listId}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              data-testid="item-suggestion"
              data-kind={s.kind}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 min-h-[52px] rounded-xl text-left transition-colors ${i === active ? 'bg-luxury-gold/10' : 'hover:bg-white/5'}`}
            >
              <span className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border ${s.kind === 'text' ? 'bg-luxury-gold/15 border-luxury-gold/40 text-luxury-gold' : 'bg-white/5 border-white/10 text-zinc-500'}`}>
                {s.kind === 'text' ? <Search className="w-3.5 h-3.5" /> : <Package className="w-3.5 h-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-zinc-100 truncate">{s.label}</span>
                <span className="block text-xs text-zinc-500 leading-snug">{s.sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ItemSearchBox;
