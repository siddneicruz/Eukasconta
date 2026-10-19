import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Filter, X, ArrowLeftRight, Check, Minus, Search, ChevronRight, Square } from 'lucide-react';
import {
  DeptFilter, DeptOption, NO_DEPT_FILTER, SelState, deptFullFor, includedLeaves, indexOptions, invertDeptFilter, invertManySel,
  isDeptFilterActive, onlySel, optionState, setManySel, toggleNodeSel,
} from '../services/deptFilter';
import { fold } from '../services/itemSearch';
import { brlAxis } from '../services/chartFormat';
import { openAlignSheet } from '../services/categoryAlign';

/* Folha para escolher o que entra na análise. Marcado = entra. Cada toque vale na hora (e fica gravado);
   "Pronto" só fecha. Dá para marcar um departamento inteiro ou descer por ele (seta à direita): categoria, grupo e item
   (4 níveis). A busca acha qualquer nível, inclusive um item da 4ª camada (ex.: "picanha").
   Três atalhos valem para tudo ou, com uma busca aberta, só para os resultados: marcar, desmarcar e inverter.
   "Desmarcar" deixa tudo vazio para a pessoa marcar só o que quer; ao marcar a primeira coisa, o filtro passa a valer. */

interface Props {
  options: DeptOption[];
  filter: DeptFilter;
  onChange: (f: DeptFilter) => void;
  onClose: () => void;
  title?: string;
  hint?: string;
  testId?: string;
  z?: string;           // classe de z-index (a folha pode abrir por cima de outra folha)
}

const MAX_RESULTS = 80;

const Box: React.FC<{ state: SelState }> = ({ state }) => (
  <span className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center ${state === 'none' ? 'border-zinc-600' : 'bg-luxury-gold border-luxury-gold'}`}>
    {state === 'all' && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3} />}
    {state === 'some' && <Minus className="w-3.5 h-3.5 text-black" strokeWidth={3} />}
  </span>
);

const EMPTY = new Set<string>();

const DeptFilterSheet: React.FC<Props> = ({
  options, filter, onChange, onClose,
  title = 'Categorias no painel',
  hint = 'Desmarque para tirar dos gráficos e dos totais. Fica salvo neste aparelho.',
  testId = 'dept-sheet', z = 'z-[260]',
}) => {
  const idx = useMemo(() => indexOptions(options), [options]);
  const outsideCount = useMemo(() => options.filter(o => o.outside && (o.kind === 'dept' || o.kind === 'cat')).length, [options]);
  // "Desmarcar todas" só esvazia a folha; o filtro de verdade muda quando a pessoa marca a primeira coisa
  const [cleared, setCleared] = useState(false);
  const incReal = useMemo(() => includedLeaves(filter, idx), [filter, idx]);
  const inc = cleared ? EMPTY : incReal;
  const active = isDeptFilterActive(filter);
  const names = filter.keys.map(k => deptFullFor(options, k));
  const [query, setQuery] = useState('');
  // abre já com os ramos que estão pela metade, para ver o que está marcado
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    options.forEach(o => { if ((idx.kidsOf.get(o.key) || []).length > 0 && optionState(idx, incReal, o) === 'some') s.add(o.key); });
    return s;
  });
  const panelRef = useRef<HTMLDivElement>(null);
  const q = fold(query);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const status = cleared
    ? 'Nada marcado. Marque o que quer analisar.'
    : !active
      ? 'Analisando todas as categorias'
      : filter.mode === 'exclude'
        ? `Analisando tudo, menos: ${names.join(', ')}`
        : `Analisando só: ${names.join(', ')}`;

  const results = useMemo(() => {
    if (!q) return [];
    const tokens = q.split(' ').filter(Boolean);
    const rank: Record<string, number> = { dept: 0, cat: 1, grp: 2, rest: 2, item: 3 };
    return options
      .filter(o => { const f = fold(o.full); return tokens.every(t => f.includes(t)); })
      .sort((a, b) => {
        const sa = fold(a.label).startsWith(tokens[0]) ? 0 : 1;
        const sb = fold(b.label).startsWith(tokens[0]) ? 0 : 1;
        return sa - sb || (rank[a.kind] - rank[b.kind]) || b.total - a.total;
      })
      .slice(0, MAX_RESULTS);
  }, [q, options]);

  // "Açougue › Carne Bovina › Cortes Nobres": o caminho até a opção, sem ela mesma
  const crumbOf = (o: DeptOption): string => {
    const names: string[] = [];
    let p: string | null | undefined = o.kind === 'cat' ? o.dept : o.parent;
    let guard = 0;
    while (p && guard++ < 6) {
      const po = idx.byKey.get(p);
      if (!po) break;
      names.unshift(po.label);
      p = po.kind === 'cat' ? po.dept : po.kind === 'dept' ? null : po.parent;
    }
    return names.join(' › ');
  };

  const toggle = (o: DeptOption) => {
    if (cleared) { onChange(onlySel(idx, [o])); setCleared(false); return; }
    onChange(toggleNodeSel(filter, idx, o.key));
  };
  const only = (o: DeptOption) => { setCleared(false); onChange(onlySel(idx, [o])); };
  const toggleExpand = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const deptsIn = idx.depts.filter(d => optionState(idx, inc, d) !== 'none').length;
  const resultStates = results.map(o => optionState(idx, inc, o));
  const allResultsIn = results.length > 0 && resultStates.every(s => s === 'all');
  const anyResultIn = resultStates.some(s => s !== 'none');
  const everythingIn = !cleared && !active;

  // marcar / desmarcar / inverter: tudo, ou só os resultados da busca
  const markAll = () => {
    setCleared(false);
    if (q) onChange(cleared ? onlySel(idx, results) : setManySel(filter, idx, results, true));
    else onChange(NO_DEPT_FILTER);
  };
  const unmarkAll = () => {
    if (q) {
      if (cleared) return;
      const next = setManySel(filter, idx, results, false);
      // se os resultados eram tudo o que estava marcado, esvazia a folha
      if (next === filter && anyResultIn) setCleared(true); else onChange(next);
      return;
    }
    setCleared(true);
  };
  const invertAll = () => {
    if (q) {
      if (cleared) { setCleared(false); onChange(onlySel(idx, results)); return; }
      const next = invertManySel(filter, idx, results);
      if (next === filter && results.length > 0) setCleared(true); else onChange(next);
      return;
    }
    if (cleared) { setCleared(false); onChange(NO_DEPT_FILTER); return; }
    if (!active) { setCleared(true); return; }
    onChange(invertDeptFilter(filter));
  };

  const renderRow = (o: DeptOption, opts: { depth: number; caption?: string; chevron?: boolean }) => {
    const state = optionState(idx, inc, o);
    const isDept = o.kind === 'dept';
    const open = expanded.has(o.key);
    const size = isDept ? 'text-[14px]' : o.kind === 'item' ? 'text-[12.5px]' : 'text-[13px]';
    const weight = isDept ? 'text-zinc-100 font-semibold' : o.kind === 'item' ? 'text-zinc-300 font-normal' : 'text-zinc-200 font-medium';
    return (
      <li key={`${o.kind}:${o.key}`}
        style={opts.depth ? { marginLeft: opts.depth * 14 } : undefined}
        className="flex items-stretch rounded-xl hover:bg-white/5"
        data-testid={isDept ? 'dept-row' : 'dept-sub-row'} data-key={o.key} data-kind={o.kind} data-level={o.level ?? (isDept ? 1 : 2)}
        data-on={state === 'all' ? 'true' : state === 'some' ? 'partial' : 'false'}>
        <button type="button" role="checkbox" aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
          onClick={() => toggle(o)} data-testid={isDept ? 'dept-check' : 'dept-sub-check'}
          className="min-w-0 flex-1 flex items-center gap-3 pl-3 pr-2 min-h-[48px] text-left">
          <Box state={state} />
          <span className="min-w-0 flex-1">
            <span className={`block truncate ${size} ${state === 'none' ? 'text-zinc-500 line-through decoration-zinc-700' : weight}`}>{o.label}</span>
            {opts.caption && <span className="block truncate text-[11px] text-zinc-500 leading-snug">{opts.caption}</span>}
            {o.outside && (o.kind === 'dept' || o.kind === 'cat') && <span className="block truncate text-[10.5px] text-zinc-500 leading-snug" data-testid="dept-outside-tag">fora da Estrutura</span>}
          </span>
          <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums">{o.total > 0 ? brlAxis(o.total) : ''}</span>
        </button>
        {opts.chevron && (
          <button type="button" onClick={() => toggleExpand(o.key)} aria-expanded={open} data-testid="dept-expand"
            aria-label={open ? `Esconder o que há dentro de ${o.label}` : `Ver o que há dentro de ${o.label}`}
            className="shrink-0 w-10 flex items-center justify-center text-zinc-500 hover:text-luxury-gold">
            <ChevronRight className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        )}
        <button type="button" onClick={() => only(o)} aria-label={`Ver só ${o.full}`} data-testid={isDept ? 'dept-only' : 'dept-sub-only'}
          className="shrink-0 w-11 text-[11px] font-semibold text-zinc-500 hover:text-luxury-gold">
          só
        </button>
      </li>
    );
  };

  const renderTree = (o: DeptOption, depth: number): React.ReactNode[] => {
    const kids = idx.kidsOf.get(o.key) || [];
    const rows: React.ReactNode[] = [renderRow(o, { depth, chevron: kids.length > 0 })];
    if (expanded.has(o.key)) kids.forEach(k => rows.push(...renderTree(k, depth + 1)));
    return rows;
  };

  const scope = q ? 'resultados' : 'todas';
  const btnBase = 'h-10 px-1.5 rounded-xl text-[11.5px] font-semibold border flex items-center justify-center gap-1 whitespace-nowrap disabled:opacity-40';

  return createPortal(
    <div className={`fixed inset-0 ${z} flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-150`} onClick={onClose} data-testid={testId}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[88dvh] flex flex-col bg-[#0c0c0e] border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] shadow-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="shrink-0 w-9 h-9 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold flex items-center justify-center"><Filter className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-serif text-white tracking-tight leading-tight">{title}</h3>
            <p className="text-xs text-zinc-400 mt-0.5 leading-snug">{hint}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input type="text" value={query} onChange={e => setQuery(e.target.value)} data-testid="dept-search"
              placeholder="Buscar categoria ou item" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"
              className="w-full bg-white/5 border border-white/5 rounded-xl py-2.5 pl-10 pr-10 text-[13px] text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-luxury-gold/40 transition-colors" />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Limpar a busca" data-testid="dept-search-clear"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg text-zinc-500 hover:text-luxury-gold"><X className="w-4 h-4" /></button>
            )}
          </div>
        </div>

        <div className="px-5 pb-2 grid grid-cols-3 gap-2" role="group" aria-label={q ? 'Atalhos para os resultados da busca' : 'Atalhos para todas as categorias'}>
          <button type="button" onClick={markAll} disabled={q ? allResultsIn || results.length === 0 : everythingIn} data-testid={q ? 'dept-results-all' : 'dept-all'}
            className={`${btnBase} border-luxury-gold/30 bg-luxury-gold/10 text-luxury-gold disabled:bg-transparent disabled:border-white/10 disabled:text-zinc-400`}>
            <Check className="w-3.5 h-3.5 shrink-0 hidden min-[390px]:block" /> {q ? 'Marcar todos' : 'Marcar todas'}
          </button>
          <button type="button" onClick={unmarkAll} disabled={q ? !anyResultIn : cleared} data-testid={q ? 'dept-results-none' : 'dept-none'}
            className={`${btnBase} border-white/10 bg-white/5 text-zinc-300 hover:border-luxury-gold/40`}>
            <Square className="w-3.5 h-3.5 shrink-0 hidden min-[390px]:block" /> {q ? 'Tirar todos' : 'Desmarcar todas'}
          </button>
          <button type="button" onClick={invertAll} disabled={q && results.length === 0} data-testid={q ? 'dept-results-invert' : 'dept-invert-sheet'}
            className={`${btnBase} border-white/10 bg-white/5 text-zinc-300 hover:border-luxury-gold/40`}>
            <ArrowLeftRight className="w-3.5 h-3.5 shrink-0 hidden min-[390px]:block" /> Inverter
          </button>
        </div>
        <p className="px-5 pb-2 text-[11px] text-zinc-500 leading-snug" data-testid="dept-status">{status}</p>
        {outsideCount > 0 && (
          <div className="mx-5 mb-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2" data-testid="dept-outside">
            <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-zinc-400">{outsideCount} {outsideCount === 1 ? 'categoria está' : 'categorias estão'} fora da Estrutura de Taxonomia (no fim da lista).</p>
            <button type="button" onClick={openAlignSheet} data-testid="dept-align" className="shrink-0 h-8 px-3 rounded-lg border border-luxury-gold/50 text-[11.5px] font-bold text-zinc-100">Alinhar</button>
          </div>
        )}

        {q && (
          <div className="px-5 pb-1.5 flex items-center justify-between gap-2" data-testid="dept-results-bar" data-scope={scope}>
            <span className="text-[11px] text-zinc-500 tabular-nums">{results.length} {results.length === 1 ? 'resultado' : 'resultados'}</span>
            <span className="text-[11px] text-zinc-600">Os atalhos valem só para estes</span>
          </div>
        )}

        <ul className="flex-1 overflow-y-auto px-2.5 pb-1" data-testid="dept-list">
          {options.length === 0 && <li className="px-3 py-8 text-center text-sm text-zinc-500">Ainda não há compras com categoria.</li>}
          {q
            ? (results.length === 0
              ? <li className="px-3 py-8 text-center text-sm text-zinc-500" data-testid="dept-search-empty">Nenhuma categoria ou item com “{query.trim()}”.</li>
              : results.map(o => renderRow(o, { depth: 0, caption: o.kind === 'dept' ? 'Departamento inteiro' : crumbOf(o) })))
            : idx.depts.flatMap(d => renderTree(d, 0))}
        </ul>

        <div className="px-5 pt-3 flex items-center justify-between gap-3 border-t border-white/5">
          <span className="text-xs text-zinc-500 tabular-nums" data-testid="dept-count">{deptsIn} de {idx.depts.length} {idx.depts.length === 1 ? 'categoria' : 'categorias'}</span>
          <button type="button" onClick={onClose} data-testid="dept-done"
            className="h-11 px-6 rounded-xl bg-luxury-gold text-black text-sm font-bold hover:bg-white transition-colors">Pronto</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default DeptFilterSheet;
