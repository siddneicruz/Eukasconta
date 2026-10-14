import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { CompareOption, bySpend, deptId } from '../services/categoryCompare';
import { fold } from '../services/itemSearch';
import { brlAxis } from '../services/chartFormat';

/* Campo para escolher o que comparar: digita e as sugestões aparecem (autocompletar), ou abre a lista
   de departamentos e toca na seta de um deles para ver as categorias. Escolher de novo tira da comparação. */

interface Props {
  options: CompareOption[];
  selected: string[];
  max: number;
  onToggle: (id: string) => void;
  testId?: string;
  placeholder?: string;
}

interface Row { opt: CompareOption; indent: boolean; kids: number; expanded: boolean; flat: boolean }

const MAX_RESULTS = 40;

const CategoryCompareBox: React.FC<Props> = ({ options, selected, max, onToggle, testId = 'compare-search', placeholder = 'Buscar categoria' }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const full = selected.length >= max;
  const q = fold(query);

  const depts = useMemo(() => options.filter(o => o.kind === 'dept').sort(bySpend), [options]);
  const catsByDept = useMemo(() => {
    const m = new Map<string, CompareOption[]>();
    options.filter(o => o.kind === 'cat').sort(bySpend).forEach(o => {
      const k = deptId(o.dept);
      const arr = m.get(k);
      if (arr) arr.push(o); else m.set(k, [o]);
    });
    return m;
  }, [options]);

  const rows: Row[] = useMemo(() => {
    if (!q) {
      const out: Row[] = [];
      depts.forEach(d => {
        const kids = catsByDept.get(d.id) || [];
        const isOpen = expanded.has(d.id);
        out.push({ opt: d, indent: false, kids: kids.length, expanded: isOpen, flat: false });
        if (isOpen) kids.forEach(c => out.push({ opt: c, indent: true, kids: 0, expanded: false, flat: false }));
      });
      return out;
    }
    const tokens = q.split(' ').filter(Boolean);
    return options
      .filter(o => { const f = fold(o.full); return tokens.every(t => f.includes(t)); })
      .sort((a, b) => {
        const sa = fold(a.label).startsWith(tokens[0]) ? 0 : 1;
        const sb = fold(b.label).startsWith(tokens[0]) ? 0 : 1;
        return sa - sb || (a.kind === b.kind ? 0 : a.kind === 'dept' ? -1 : 1) || bySpend(a, b);
      })
      .slice(0, MAX_RESULTS)
      .map(o => ({ opt: o, indent: false, kids: 0, expanded: false, flat: true }));
  }, [q, depts, catsByDept, expanded, options]);

  useEffect(() => { setActive(q && rows.length ? 0 : -1); }, [q, rows.length]);

  // fecha ao tocar fora do campo e da lista
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // a linha ativa (teclado) fica sempre à vista
  useEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const isSel = (id: string) => selected.includes(id);
  const blocked = (id: string) => full && !isSel(id);

  const pick = (i: number) => {
    const r = rows[i];
    if (!r || blocked(r.opt.id)) return;
    onToggle(r.opt.id);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const toggleExpand = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rows.length) return;
      e.preventDefault();
      setOpen(true);
      setActive(a => (e.key === 'ArrowDown' ? (a + 1) % rows.length : (a <= 0 ? rows.length - 1 : a - 1)));
    } else if (e.key === 'ArrowRight' && !q && active >= 0 && rows[active]?.kids) {
      e.preventDefault();
      if (!rows[active].expanded) toggleExpand(rows[active].opt.id);
    } else if (e.key === 'ArrowLeft' && !q && active >= 0 && rows[active]) {
      const r = rows[active];
      if (r.expanded) { e.preventDefault(); toggleExpand(r.opt.id); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0) pick(active); else { setOpen(false); inputRef.current?.blur(); }
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
    }
  };

  const showList = open;

  return (
    <div ref={boxRef} className="relative" data-testid={testId}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
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
        enterKeyHint="done"
        data-testid={`${testId}-input`}
        placeholder={placeholder}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full bg-white/5 border border-white/5 rounded-xl py-2.5 pl-10 pr-11 text-[13px] text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-luxury-gold/40 transition-colors"
      />
      {query ? (
        <button type="button" aria-label="Limpar a busca" data-testid={`${testId}-clear`}
          onMouseDown={e => e.preventDefault()}
          onClick={() => { setQuery(''); inputRef.current?.focus(); }}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg text-zinc-500 hover:text-luxury-gold transition-colors">
          <X className="w-4 h-4" />
        </button>
      ) : (
        <button type="button" aria-label={showList ? 'Fechar a lista' : 'Ver departamentos'} data-testid={`${testId}-toggle`}
          onMouseDown={e => e.preventDefault()}
          onClick={() => setOpen(o => !o)}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg text-zinc-500 hover:text-luxury-gold transition-colors">
          <ChevronDown className={`w-4 h-4 transition-transform ${showList ? 'rotate-180' : ''}`} />
        </button>
      )}

      {showList && (
        <div
          id={listId}
          ref={listRef}
          role="listbox"
          aria-multiselectable="true"
          data-testid={`${testId}-list`}
          onMouseDown={e => e.preventDefault()}
          className="absolute left-0 right-0 top-full mt-2 z-50 max-h-[50vh] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl p-1.5"
        >
          {full && (
            <p className="px-3 py-2 text-[11px] text-zinc-500" data-testid={`${testId}-max`}>
              Máximo de {max} na comparação. Toque em uma marcada para tirar.
            </p>
          )}
          {rows.length === 0 ? (
            <p className="px-3 py-4 text-sm text-zinc-500 text-center" data-testid={`${testId}-empty`}>
              {q ? <>Nenhuma categoria com “{query.trim()}” nas suas compras.</> : 'Ainda não há compras com categoria.'}
            </p>
          ) : rows.map((r, i) => {
            const sel = isSel(r.opt.id);
            const dis = blocked(r.opt.id);
            return (
              <div key={r.opt.id} className={`flex items-stretch rounded-xl transition-colors ${i === active ? 'bg-luxury-gold/10' : 'hover:bg-white/5'} ${r.indent ? 'ml-5' : ''}`}>
                <button
                  type="button"
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={sel}
                  aria-disabled={dis || undefined}
                  data-row={i}
                  data-testid="compare-suggestion"
                  data-kind={r.opt.kind}
                  data-selected={sel ? 'true' : 'false'}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  className={`min-w-0 flex-1 flex items-center gap-2.5 pl-3 ${r.kids ? 'pr-1' : 'pr-3'} py-2 min-h-[46px] text-left ${dis ? 'opacity-40' : ''}`}
                >
                  <span className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${sel ? 'bg-luxury-gold border-luxury-gold' : 'border-zinc-600'}`}>
                    {sel && <Check className="w-3 h-3 text-black" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${r.opt.kind === 'dept' ? 'text-[14px] font-semibold text-zinc-100' : 'text-[13px] font-medium text-zinc-200'}`}>{r.opt.label}</span>
                    {r.flat && <span className="block text-[11px] text-zinc-500 leading-snug truncate">{r.opt.kind === 'dept' ? 'Departamento inteiro' : r.opt.dept}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums">{r.opt.total > 0 ? brlAxis(r.opt.total) : ''}</span>
                </button>
                {r.kids > 0 && (
                  <button
                    type="button"
                    aria-label={r.expanded ? `Esconder categorias de ${r.opt.label}` : `Ver categorias de ${r.opt.label}`}
                    aria-expanded={r.expanded}
                    data-testid="compare-expand"
                    onClick={() => toggleExpand(r.opt.id)}
                    className="shrink-0 w-11 flex items-center justify-center text-zinc-500 hover:text-luxury-gold"
                  >
                    <ChevronRight className={`w-4 h-4 transition-transform ${r.expanded ? 'rotate-90' : ''}`} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CategoryCompareBox;
