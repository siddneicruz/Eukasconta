import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronRight } from 'lucide-react';
import { CutReceiptRef, rangeLabel } from '../services/cuts';

/* Lista curta de cupons (de uma loja ou de um dia) para a pessoa escolher qual abrir.
   Quando só existe um cupom, quem chama abre direto e esta folha nem aparece. */

interface Props {
  title: string;
  subtitle?: string;
  refs: CutReceiptRef[];
  onPick: (id: string) => void;
  onClose: () => void;
}

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const ReceiptPickSheet: React.FC<Props> = ({ title, subtitle, refs, onPick, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
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

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-150" onClick={onClose} data-testid="receipt-pick">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[80dvh] flex flex-col bg-[#0c0c0e] border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] shadow-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-serif text-white tracking-tight leading-tight break-words" data-testid="receipt-pick-title">{title}</h3>
            {subtitle && <p className="text-xs text-zinc-400 mt-0.5 leading-snug">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <ul className="px-3 pb-2 overflow-y-auto">
          {refs.map(r => (
            <li key={r.id}>
              <button type="button" onClick={() => onPick(r.id)} data-testid="receipt-pick-row" data-id={r.id}
                className="w-full text-left flex items-center gap-3 min-h-[56px] px-3 py-2 rounded-2xl hover:bg-white/5 active:bg-white/10 transition-colors">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-zinc-100 tabular-nums">{rangeLabel(r.date, r.date)}{r.time ? ` · ${r.time.slice(0, 5)}` : ''}</span>
                  <span className="block text-[11px] text-zinc-500">{r.items} {r.items === 1 ? 'item' : 'itens'}</span>
                </span>
                <span className="shrink-0 text-[14px] font-semibold text-white tabular-nums">{brl(r.value)}</span>
                <ChevronRight className="w-4 h-4 shrink-0 text-zinc-600" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
};

export default ReceiptPickSheet;
