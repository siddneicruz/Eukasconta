import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Filter, X, ArrowLeftRight, Check, Minus, Search, ChevronRight } from 'lucide-react';
import {
  DeptFilter, DeptOption, NO_DEPT_FILTER, SelState, deptFullFor, includedLeaves, indexOptions, invertDeptFilter,
  isDeptFilterActive, onlySel, optionState, setManySel, toggleDeptSel, toggleLeafSel,
} from '../services/deptFilter';
import { fold } from '../services/itemSearch';
import { brlAxis } from '../services/chartFormat';

/* Folha para escolher o que entra na análise. Marcado = entra. Cada toque vale na hora (e fica gravado);
   "Pronto" só fecha. Dá para marcar um departamento inteiro ou só algumas categorias dele (seta à direita),
   buscar por nome e marcar ou tirar todos os resultados de uma vez.
   "Inverter" troca o lado: o que estava de fora vira o único analisado. */

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

const MAX_RESULTS = 60;

const Box: React.FC<{ state: SelState }> = ({ state }) => (
  <span className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center ${state === 'none' ? 'border-zinc-600' : 'bg-luxury-gold border-luxury-gold'}`}>
    {state === 'all' && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3} />}
    {state === 'some' && <Minus className="w-3.5 h-3.5 text-black" strokeWidth={3} />}
  </span>
);

const DeptFilterSheet: React.FC<Props> = ({
  options, filter, onChange, onClose,
  title = 'Categorias no painel',
  hint = 'Desmarque para tirar dos gráficos e dos totais. Fica salvo neste aparelho.',
  testId = 'dept-sheet', z = 'z-[260]',
}) => {
  const idx = useMemo(() => indexOptions(options), [options]);
  const inc = useMemo(() => includedLeaves(filter, idx), [filter, idx]);
  const active = isDeptFilterActive(filter);
  const names = filter.keys.map(k => deptFullFor(options, k));
  const [query, setQuery] = useState('');
  // abre já com os departamentos que estão pela metade, para ver o que está marcado
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    idx.depts.forEach(d => { if (optionState(idx, inc, d) === 'some') s.add(d.key); });
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

  const status = !active
    ? 'Analisando todas as categorias'
    : filter.mode === 'exclude'
      ? `Analisando tudo, menos: ${names.join(', ')}`
      : `Analisando só: ${names.join(', ')}`;

  const results = useMemo(() => {
    if (!q) return [];
    const tokens = q.split(' ').filter(Boolean);
    return options
      .filter(o => { const f = fold(o.full); return tokens.every(t => f.includes(t)); })
      .sort((a, b) => {
        const sa = fold(a.label).startsWith(tokens[0]) ? 0 : 1;
        const sb = fold(b.label).startsWith(tokens[0]) ? 0 : 1;
        return sa - sb || (a.kind === b.kind ? 0 : a.kind === 'dept' ? -1 : 1) || b.total - a.total;
      })
      .slice(0, MAX_RESULTS);
  }, [q, options]);

  const toggle = (o: DeptOption) => onChange(o.kind === 'dept' ? toggleDeptSel(filter, idx, o.key) : toggleLeafSel(filter, idx, o.key));
  const only = (o: DeptOption) => onChange(onlySel(idx, [o]));
  const toggleExpand = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const deptsIn = idx.depts.filter(d => optionState(idx, inc, d) !== 'none').length;
  const resultStates = results.map(o => optionState(idx, inc, o));
  const allResultsIn = results.length > 0 && resultStates.every(s => s === 'all');
  const anyResultIn = resultStates.some(s => s !== 'none');

  const renderRow = (o: DeptOption, opts: { sub: boolean; caption?: string; chevron?: boolean }) => {
    const state = optionState(idx, inc, o);
    const isDept = o.kind === 'dept';
    const open = expanded.has(o.key);
    return (
      <li key={`${o.kind}:${o.key}`}
        className={`flex items-stretch rounded-xl hover:bg-white/5 ${opts.sub ? 'ml-6' : ''}`}
        data-testid={isDept ? 'dept-row' : 'dept-sub-row'} data-key={o.key} data-on={state === 'all' ? 'true' : state === 'some' ? 'partial' : 'false'}>
        <button type="button" role="checkbox" aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
          onClick={() => toggle(o)} data-testid={isDept ? 'dept-check' : 'dept-sub-check'}
          className="min-w-0 flex-1 flex items-center gap-3 pl-3 pr-2 min-h-[48px] text-left">
          <Box state={state} />
          <span className="min-w-0 flex-1">
            <span className={`block truncate ${opts.sub ? 'text-[13px]' : 'text-[14px]'} ${state === 'none' ? 'text-zinc-500 line-through decoration-zinc-700' : isDept ? 'text-zinc-100 font-semibold' : 'text-zinc-200 font-medium'}`}>{o.label}</span>
            {opts.caption && <span className="block truncate text-[11px] text-zinc-500 leading-snug">{opts.caption}</span>}
          </span>
          <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums">{o.total > 0 ? brlAxis(o.total) : ''}</span>
        </button>
        {opts.chevron && (
          <button type="button" onClick={() => toggleExpand(o.key)} aria-expanded={open} data-testid="dept-expand"
            aria-label={open ? `Esconder categorias de ${o.label}` : `Ver categorias de ${o.label}`}
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
              placeholder="Buscar categoria" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"
              className="w-full bg-white/5 border border-white/5 rounded-xl py-2.5 pl-10 pr-10 text-[13px] text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-luxury-gold/40 transition-colors" />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Limpar a busca" data-testid="dept-search-clear"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg text-zinc-500 hover:text-luxury-gold"><X className="w-4 h-4" /></button>
            )}
          </div>
        </div>

        <div className="px-5 pb-2 flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => onChange(NO_DEPT_FILTER)} disabled={!active} data-testid="dept-all"
            className="h-9 px-3.5 rounded-full text-xs font-semibold border border-luxury-gold/30 bg-luxury-gold/10 text-luxury-gold flex items-center gap-1.5 disabled:opacity-40 disabled:bg-transparent disabled:border-white/10 disabled:text-zinc-400">
            <Check className="w-3.5 h-3.5" /> Marcar todas
          </button>
          <button type="button" onClick={() => onChange(invertDeptFilter(filter))} disabled={!active} data-testid="dept-invert-sheet"
            className="h-9 px-3.5 rounded-full text-xs font-semibold border border-white/10 text-zinc-300 flex items-center gap-1.5 hover:border-luxury-gold/40 disabled:opacity-40 disabled:hover:border-white/10">
            <ArrowLeftRight className="w-3.5 h-3.5" /> Inverter
          </button>
        </div>
        <p className="px-5 pb-2 text-[11px] text-zinc-500 leading-snug" data-testid="dept-status">{status}</p>

        {q && (
          <div className="px-5 pb-1.5 flex items-center justify-between gap-2" data-testid="dept-results-bar">
            <span className="text-[11px] text-zinc-500 tabular-nums">{results.length} {results.length === 1 ? 'resultado' : 'resultados'}</span>
            {results.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => onChange(setManySel(filter, idx, results, true))} disabled={allResultsIn} data-testid="dept-results-all"
                  className="h-8 px-3 rounded-full text-[11px] font-semibold border border-luxury-gold/30 bg-luxury-gold/10 text-luxury-gold disabled:opacity-40">Marcar todos</button>
                <button type="button" onClick={() => onChange(setManySel(filter, idx, results, false))} disabled={!anyResultIn} data-testid="dept-results-none"
                  className="h-8 px-3 rounded-full text-[11px] font-semibold border border-white/10 text-zinc-300 disabled:opacity-40">Tirar todos</button>
              </div>
            )}
          </div>
        )}

        <ul className="flex-1 overflow-y-auto px-2.5 pb-1" data-testid="dept-list">
          {options.length === 0 && <li className="px-3 py-8 text-center text-sm text-zinc-500">Ainda não há compras com categoria.</li>}
          {q
            ? (results.length === 0
              ? <li className="px-3 py-8 text-center text-sm text-zinc-500" data-testid="dept-search-empty">Nenhuma categoria com “{query.trim()}”.</li>
              : results.map(o => renderRow(o, { sub: false, caption: o.kind === 'cat' ? idx.byKey.get(o.dept)?.label : 'Departamento inteiro' })))
            : idx.depts.flatMap(d => {
              const cats = idx.catsOf.get(d.key) || [];
              const rows = [renderRow(d, { sub: false, chevron: cats.length > 0 })];
              if (expanded.has(d.key)) cats.forEach(c => rows.push(renderRow(c, { sub: true })));
              return rows;
            })}
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
