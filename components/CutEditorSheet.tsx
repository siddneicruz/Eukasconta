import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Filter, ArrowLeftRight, ChevronRight } from 'lucide-react';
import { Receipt } from '../types';
import PeriodPicker from './PeriodPicker';
import DeptFilterSheet from './DeptFilterSheet';
import { useLayers, useTaxonomy } from './LayersContext';
import { Cut, cutReceipts, dayCount, newCutId } from '../services/cuts';
import {
  DeptFilter, NO_DEPT_FILTER, buildDeptOptions, buildStructuredDeptOptions, deptFilterLabel, deptLabelFor, invertDeptFilter, isDeptFilterActive,
} from '../services/deptFilter';

/* Criar ou editar um recorte: de que dia até que dia, quais categorias entram e um nome se quiser.
   Mostra na hora quanto o recorte pega, para a pessoa saber o que vai gravar. */

interface Props {
  receipts: Receipt[];
  initial: Cut | null;          // null = recorte novo
  onSave: (cut: Cut) => void;
  onClose: () => void;
}

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const CutEditorSheet: React.FC<Props> = ({ receipts, initial, onSave, onClose }) => {
  const [name, setName] = useState(initial?.name || '');
  const [from, setFrom] = useState(initial?.from || '');
  const [to, setTo] = useState(initial?.to || '');
  const [filter, setFilter] = useState<DeptFilter>(initial?.filter || NO_DEPT_FILTER);
  const [deptOpen, setDeptOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    // Esc fecha só a folha que está por cima (o calendário e a lista de categorias abrem sobre esta)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const open = document.querySelectorAll('[aria-modal="true"]');
      if (open[open.length - 1] !== panelRef.current) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, []);

  const layers = useLayers();
  const ready = Boolean(from && to);
  const inRange = useMemo(() => (ready ? receipts.filter(r => r.date >= from && r.date <= to) : receipts), [receipts, from, to, ready]);
  const taxonomy = useTaxonomy();
  const options = useMemo(() => buildStructuredDeptOptions(receipts, inRange, layers, taxonomy), [receipts, inRange, layers, taxonomy]);
  const active = isDeptFilterActive(filter);
  const filterText = deptFilterLabel(filter, k => deptLabelFor(options, k));

  const preview = useMemo(() => {
    if (!ready) return null;
    const list = cutReceipts(receipts, from, to, filter);
    return { count: list.length, total: list.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0) };
  }, [receipts, from, to, filter, ready, layers]);

  const save = () => {
    if (!ready) return;
    onSave({
      id: initial?.id || newCutId(),
      name: name.trim(),
      from, to, filter,
      createdAt: initial?.createdAt || new Date().toISOString(),
    });
  };

  const title = initial ? 'Editar recorte' : 'Novo recorte';

  return (<>
    {createPortal(
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-150" onClick={onClose} data-testid="cut-editor">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[92dvh] flex flex-col bg-[#0c0c0e] border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] shadow-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-serif text-white tracking-tight leading-tight">{title}</h3>
            <p className="text-xs text-zinc-400 mt-0.5 leading-snug">Um pedaço do tempo, com a análise só dele. Fica salvo como etiqueta.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 pb-2 space-y-4 overflow-y-auto">
          <div>
            <label htmlFor="cut-name" className="block text-[11px] font-semibold text-zinc-500 mb-1.5">Nome (opcional)</label>
            <input id="cut-name" data-testid="cut-name" type="text" value={name} maxLength={60}
              onChange={e => setName(e.target.value)}
              placeholder="Ex.: Viagem, Mudança, Natal"
              autoComplete="off" enterKeyHint="done"
              className="w-full bg-white/5 border border-white/5 rounded-xl py-3 px-3.5 text-[14px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-luxury-gold/40 transition-colors" />
          </div>

          <div data-testid="cut-period">
            <span className="block text-[11px] font-semibold text-zinc-500 mb-1.5">De que dia até que dia</span>
            <PeriodPicker start={from} end={to} onChange={(a, b) => { setFrom(a); setTo(b); }} placeholder="Escolher período" size="field" openOnMount={!initial && !from && !to} />
          </div>

          <div>
            <span className="block text-[11px] font-semibold text-zinc-500 mb-1.5">Categorias que entram</span>
            <div className="flex items-stretch gap-2">
              <button type="button" onClick={() => setDeptOpen(true)} data-testid="cut-dept-btn"
                className={`min-w-0 flex-1 flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-left text-[14px] border transition-colors ${active ? 'bg-luxury-gold/10 border-luxury-gold/30 text-luxury-gold dept-active font-semibold' : 'bg-white/5 border-white/5 text-zinc-300 hover:border-luxury-gold/30'}`}>
                <Filter className="w-4 h-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate" data-testid="cut-dept-label">{filterText}</span>
                <ChevronRight className="w-4 h-4 shrink-0 opacity-60" />
              </button>
              {active && (
                <button type="button" onClick={() => setFilter(invertDeptFilter(filter))} data-testid="cut-dept-invert" aria-label="Inverter categorias"
                  className="shrink-0 w-12 flex items-center justify-center rounded-xl border border-white/10 text-zinc-300 hover:text-luxury-gold hover:border-luxury-gold/40">
                  <ArrowLeftRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <p className="min-h-[18px] text-[12px] text-zinc-400 tabular-nums" data-testid="cut-preview" aria-live="polite">
            {preview
              ? preview.count === 0
                ? 'Nenhuma compra nesse recorte ainda.'
                : <>{dayCount(from, to)} {dayCount(from, to) === 1 ? 'dia' : 'dias'} · {preview.count} {preview.count === 1 ? 'compra' : 'compras'} · <span className="text-zinc-100 font-semibold">{brl(preview.total)}</span></>
              : 'Escolha o primeiro e o último dia.'}
          </p>
        </div>

        <div className="px-5 pt-3 flex items-center justify-end gap-2 border-t border-white/5">
          <button type="button" onClick={onClose} data-testid="cut-cancel"
            className="h-11 px-5 rounded-xl border border-white/10 text-sm font-semibold text-zinc-300 hover:text-white">Cancelar</button>
          <button type="button" onClick={save} disabled={!ready} data-testid="cut-save"
            className="h-11 px-6 rounded-xl bg-luxury-gold text-black text-sm font-bold hover:bg-white transition-colors disabled:opacity-40 disabled:hover:bg-luxury-gold">
            {initial ? 'Salvar alterações' : 'Salvar recorte'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
    )}
    {/* fora da folha acima: o toque no fundo da lista de categorias não pode fechar o editor */}
    {deptOpen && (
      <DeptFilterSheet
        options={options}
        filter={filter}
        onChange={setFilter}
        onClose={() => setDeptOpen(false)}
        title="Categorias do recorte"
        hint="Desmarque para tirar do recorte. Vale só para este recorte."
        testId="cut-dept-sheet"
        z="z-[320]"
      />
    )}
  </>);
};

export default CutEditorSheet;
