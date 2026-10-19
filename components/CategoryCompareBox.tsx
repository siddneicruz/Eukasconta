import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { CompareOption, bySpend, deptId } from '../services/categoryCompare';
import { fold } from '../services/itemSearch';
import { brlAxis } from '../services/chartFormat';
import { openAlignSheet } from '../services/categoryAlign';

/* Campo para escolher uma categoria: digita e as sugestões aparecem (autocompletar), ou abre a lista de departamentos e
   toca na seta de um deles para descer: categoria, grupo e item (4 níveis). Escolher de novo tira da escolha.
   Serve ao Comparativo (várias, até `max`) e à auditoria de metas (`single`: uma só, e a lista fecha ao escolher). */

interface Props {
  options: CompareOption[];
  selected: string[];
  max: number;
  onToggle: (id: string) => void;
  testId?: string;
  placeholder?: string;
  single?: boolean;
  valueLabel?: string;      // o que está escolhido (modo `single`), mostrado no próprio campo
  /** Quais linhas podem ser escolhidas. Uma que não pode, só abre e fecha o que há dentro dela (se tiver). */
  selectable?: (opt: CompareOption, kids: number) => boolean;
  /** Abre a lista já com o cursor no campo (para telas que existem só para escolher). */
  autoFocus?: boolean;
  /** Classes a mais na lista (por exemplo, mais larga em tela grande). */
  listClass?: string;
}

interface Row { opt: CompareOption; depth: number; kids: number; expanded: boolean; flat: boolean; crumb: string }

const MAX_RESULTS = 40;

const LEVEL_ORDER: Record<string, number> = { dept: 0, cat: 1, grp: 2, rest: 2, item: 3 };

const CategoryCompareBox: React.FC<Props> = ({ options, selected, max, onToggle, testId = 'compare-search', placeholder = 'Buscar categoria', single = false, valueLabel, selectable, autoFocus = false, listClass = '' }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const full = !single && selected.length >= max;
  const q = fold(query);

  const byId = useMemo(() => new Map(options.map(o => [o.id, o] as [string, CompareOption])), [options]);
  const parentOf = (o: CompareOption): string | null => {
    const p = o.parent ?? (o.kind === 'cat' ? deptId(o.dept) : null);
    return p && byId.has(p) ? p : null;
  };
  const { roots, kidsOf } = useMemo(() => {
    const kids = new Map<string, CompareOption[]>();
    const top: CompareOption[] = [];
    options.forEach(o => {
      const p = o.parent ?? (o.kind === 'cat' ? deptId(o.dept) : null);
      if (p && byId.has(p)) {
        const arr = kids.get(p);
        if (arr) arr.push(o); else kids.set(p, [o]);
      } else top.push(o);
    });
    kids.forEach(arr => arr.sort(bySpend));
    return { roots: top.sort(bySpend), kidsOf: kids };
  }, [options, byId]);

  // "Açougue › Carne Bovina › Cortes Nobres": o caminho até a opção, sem ela mesma
  const crumbOf = (o: CompareOption): string => {
    const names: string[] = [];
    let p = parentOf(o);
    let guard = 0;
    while (p && guard++ < 6) { const po = byId.get(p); if (!po) break; names.unshift(po.label); p = parentOf(po); }
    return names.join(' › ');
  };

  const rows: Row[] = useMemo(() => {
    if (!q) {
      const out: Row[] = [];
      const walk = (o: CompareOption, depth: number) => {
        const kids = kidsOf.get(o.id) || [];
        const isOpen = expanded.has(o.id);
        out.push({ opt: o, depth, kids: kids.length, expanded: isOpen, flat: false, crumb: '' });
        if (isOpen) kids.forEach(k => walk(k, depth + 1));
      };
      roots.forEach(r => walk(r, 0));
      return out;
    }
    const tokens = q.split(' ').filter(Boolean);
    return options
      .filter(o => { const f = fold(o.full); return tokens.every(t => f.includes(t)); })
      .sort((a, b) => {
        const sa = fold(a.label).startsWith(tokens[0]) ? 0 : 1;
        const sb = fold(b.label).startsWith(tokens[0]) ? 0 : 1;
        return sa - sb || (LEVEL_ORDER[a.kind] - LEVEL_ORDER[b.kind]) || bySpend(a, b);
      })
      .slice(0, MAX_RESULTS)
      .map(o => ({ opt: o, depth: 0, kids: 0, expanded: false, flat: true, crumb: crumbOf(o) }));
  }, [q, roots, kidsOf, expanded, options]);

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

  const kidCount = (id: string): number => (kidsOf.get(id) || []).length;
  // no resultado da busca a lista é plana (r.kids = 0): o que há dentro vem da árvore
  const locked = (r: Row): boolean => !!selectable && !selectable(r.opt, kidCount(r.opt.id));

  const pick = (i: number) => {
    const r = rows[i];
    if (!r || blocked(r.opt.id)) return;
    if (locked(r)) { if (r.kids) toggleExpand(r.opt.id); return; }
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
  const outsideCount = useMemo(() => options.filter(o => o.outside && (o.kind === 'dept' || o.kind === 'cat')).length, [options]);
  useEffect(() => { if (autoFocus) { inputRef.current?.focus(); setOpen(true); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        placeholder={valueLabel || placeholder}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={`w-full bg-white/5 border border-white/5 rounded-xl py-2.5 pl-10 pr-11 text-[13px] text-zinc-200 focus:outline-none focus:border-luxury-gold/40 transition-colors ${valueLabel ? 'placeholder:text-zinc-200 placeholder:font-semibold' : 'placeholder:text-zinc-500'}`}
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
          aria-multiselectable={single ? undefined : true}
          data-testid={`${testId}-list`}
          onMouseDown={e => e.preventDefault()}
          className={`absolute left-0 right-0 top-full mt-2 z-50 max-h-[50vh] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl p-1.5 ${listClass}`}
        >
          {outsideCount > 0 && (
            <div className="mx-1 mb-1 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2" data-testid={`${testId}-outside`}>
              <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-zinc-400">{outsideCount} {outsideCount === 1 ? 'categoria está' : 'categorias estão'} fora da Estrutura de Taxonomia (no fim da lista).</p>
              <button type="button" onClick={openAlignSheet} data-testid={`${testId}-align`} className="shrink-0 h-8 px-3 rounded-lg border border-luxury-gold/50 text-[11.5px] font-bold text-zinc-100">Alinhar</button>
            </div>
          )}
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
            const lockedFlat = r.flat && locked(r);
            const dis = blocked(r.opt.id) || lockedFlat;
            const k = r.opt.kind;
            const titleCls = k === 'dept' ? 'text-[14px] font-semibold text-zinc-100' : k === 'cat' ? 'text-[13px] font-medium text-zinc-200' : k === 'item' ? 'text-[12.5px] font-normal text-zinc-300' : 'text-[13px] font-medium text-zinc-300';
            const caption = lockedFlat ? 'Escolha uma categoria dentro dele' : k === 'dept' ? 'Departamento inteiro' : k === 'cat' ? r.opt.dept : r.crumb;
            return (
              <div key={r.opt.id} style={r.depth ? { marginLeft: r.depth * 16 } : undefined}
                className={`flex items-stretch rounded-xl transition-colors ${i === active ? 'bg-luxury-gold/10' : 'hover:bg-white/5'}`}>
                <button
                  type="button"
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={sel}
                  aria-disabled={dis || undefined}
                  data-row={i}
                  data-testid="compare-suggestion"
                  data-kind={k}
                  data-level={r.opt.level ?? (k === 'dept' ? 1 : 2)}
                  data-selected={sel ? 'true' : 'false'}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  className={`min-w-0 flex-1 flex items-center gap-2.5 pl-3 ${r.kids ? 'pr-1' : 'pr-3'} py-2 min-h-[46px] text-left ${dis ? 'opacity-40' : ''}`}
                >
                  <span className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${sel ? 'bg-luxury-gold border-luxury-gold' : 'border-zinc-600'}`}>
                    {sel && <Check className="w-3 h-3 text-black" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${titleCls}`}>{r.opt.label}</span>
                    {r.flat && <span className="block text-[11px] text-zinc-500 leading-snug truncate">{caption}</span>}
                    {r.opt.outside && (k === 'dept' || k === 'cat') && <span className="block text-[10.5px] text-zinc-500 leading-snug" data-testid="compare-outside-tag">fora da Estrutura</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums">{r.opt.total > 0 ? brlAxis(r.opt.total) : ''}</span>
                </button>
                {r.kids > 0 && (
                  <button
                    type="button"
                    aria-label={r.expanded ? `Esconder o que há dentro de ${r.opt.label}` : `Ver o que há dentro de ${r.opt.label}`}
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
