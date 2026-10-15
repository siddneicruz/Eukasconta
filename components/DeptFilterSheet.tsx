import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Filter, X, ArrowLeftRight, Check } from 'lucide-react';
import {
  DeptFilter, DeptOption, NO_DEPT_FILTER, deptIncluded, deptLabelFor, invertDeptFilter,
  isDeptFilterActive, onlyDept, toggleDept,
} from '../services/deptFilter';
import { brlAxis } from '../services/chartFormat';

/* Folha para escolher quais categorias entram na análise. Marcado = entra. Cada toque vale na hora
   (e fica gravado); "Pronto" só fecha. "Inverter" troca o lado: o que estava de fora vira o único analisado. */

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

const DeptFilterSheet: React.FC<Props> = ({
  options, filter, onChange, onClose,
  title = 'Categorias no painel',
  hint = 'Desmarque para tirar dos gráficos e dos totais. Fica salvo neste aparelho.',
  testId = 'dept-sheet', z = 'z-[260]',
}) => {
  const allKeys = options.map(o => o.key);
  const active = isDeptFilterActive(filter);
  const names = filter.keys.map(k => deptLabelFor(options, k));
  const insideCount = options.filter(o => deptIncluded(filter, o.key)).length;

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

  return createPortal(
    <div className={`fixed inset-0 ${z} flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-150`} onClick={onClose} data-testid={testId}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[88dvh] flex flex-col bg-[#0c0c0e] border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] shadow-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="shrink-0 w-9 h-9 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold flex items-center justify-center"><Filter className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-serif text-white tracking-tight leading-tight">{title}</h3>
            <p className="text-xs text-zinc-400 mt-0.5 leading-snug">{hint}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 pb-2 flex items-center gap-2">
          <button type="button" onClick={() => onChange(NO_DEPT_FILTER)} disabled={!active} data-testid="dept-all"
            className="h-9 px-3.5 rounded-full text-xs font-semibold border border-white/10 text-zinc-300 hover:border-luxury-gold/40 disabled:opacity-40 disabled:hover:border-white/10">
            Todas
          </button>
          <button type="button" onClick={() => onChange(invertDeptFilter(filter))} disabled={!active} data-testid="dept-invert-sheet"
            className="h-9 px-3.5 rounded-full text-xs font-semibold border border-luxury-gold/30 bg-luxury-gold/10 text-luxury-gold flex items-center gap-1.5 disabled:opacity-40 disabled:bg-transparent disabled:border-white/10 disabled:text-zinc-400">
            <ArrowLeftRight className="w-3.5 h-3.5" /> Inverter
          </button>
        </div>
        <p className="px-5 pb-2 text-[11px] text-zinc-500 leading-snug" data-testid="dept-status">{status}</p>

        <ul className="flex-1 overflow-y-auto px-2.5 pb-1" data-testid="dept-list">
          {options.length === 0 && <li className="px-3 py-8 text-center text-sm text-zinc-500">Ainda não há compras com categoria.</li>}
          {options.map(o => {
            const on = deptIncluded(filter, o.key);
            return (
              <li key={o.key} className="flex items-stretch rounded-xl hover:bg-white/5" data-testid="dept-row" data-key={o.key} data-on={on ? 'true' : 'false'}>
                <button type="button" role="checkbox" aria-checked={on}
                  onClick={() => onChange(toggleDept(filter, o.key, allKeys))}
                  className="min-w-0 flex-1 flex items-center gap-3 pl-3 pr-2 min-h-[48px] text-left">
                  <span className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center ${on ? 'bg-luxury-gold border-luxury-gold' : 'border-zinc-600'}`}>
                    {on && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3} />}
                  </span>
                  <span className={`min-w-0 flex-1 truncate text-[14px] ${on ? 'text-zinc-100 font-semibold' : 'text-zinc-500 line-through decoration-zinc-700'}`}>{o.label}</span>
                  <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums">{o.total > 0 ? brlAxis(o.total) : ''}</span>
                </button>
                <button type="button" onClick={() => onChange(onlyDept(o.key))} aria-label={`Ver só ${o.label}`} data-testid="dept-only"
                  className="shrink-0 w-12 text-[11px] font-semibold text-zinc-500 hover:text-luxury-gold">
                  só
                </button>
              </li>
            );
          })}
        </ul>

        <div className="px-5 pt-3 flex items-center justify-between gap-3 border-t border-white/5">
          <span className="text-xs text-zinc-500 tabular-nums">{insideCount} de {options.length} {options.length === 1 ? 'categoria' : 'categorias'}</span>
          <button type="button" onClick={onClose} data-testid="dept-done"
            className="h-11 px-6 rounded-xl bg-luxury-gold text-black text-sm font-bold hover:bg-white transition-colors">Pronto</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default DeptFilterSheet;
