import React from 'react';
import { TrendingDown, MapPin, X, BellPlus } from 'lucide-react';
import type { SuggestionGroup } from '../services/useCloud';
import type { AlertDraft } from './AlertsView';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
const cleanName = (s: string) => s.replace(/^\d{3,14}\s+/, '');
const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

interface Props {
  groups: SuggestionGroup[];
  onClose: () => void;
  onCreateAlert: (draft: AlertDraft) => void;
}

// Aparece depois de escanear: itens que apareceram mais baratos em lojas perto da que você acabou de usar.
const ScanSuggestionsSheet: React.FC<Props> = ({ groups, onClose, onCreateAlert }) => {
  const rows = groups.flatMap(g => g.items.map(it => ({ ...it, store: g.store })))
    .sort((a, b) => b.savings_pct - a.savings_pct)
    .slice(0, 6);
  if (rows.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-end md:items-center justify-center p-0 md:p-6 bg-black/70 backdrop-blur-sm animate-in fade-in" onClick={onClose} data-testid="scan-suggestions">
      <div onClick={e => e.stopPropagation()} className="w-full max-w-lg max-h-[85dvh] overflow-y-auto custom-scrollbar bg-[#09090b] border border-white/10 rounded-t-[2rem] md:rounded-[2rem] shadow-2xl animate-in slide-in-from-bottom-8 duration-300"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 p-5 pb-4 bg-[#09090b] border-b border-white/5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0"><TrendingDown className="w-5 h-5" /></div>
            <div>
              <h3 className="text-base font-bold text-white leading-tight">Dá para pagar menos aqui perto</h3>
              <p className="text-xs text-zinc-500 mt-1">Preços de outras lojas, vistos nos últimos 45 dias.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 text-zinc-500 hover:text-white shrink-0" aria-label="Fechar"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-3">
          {rows.map((r, i) => (
            <div key={`${r.master_product_id}-${r.establishment_id}-${i}`} data-suggestion className="p-4 rounded-2xl bg-white/[0.03] border border-white/5">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-bold text-white leading-snug min-w-0">{titleCase(cleanName(r.description))}</div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-bold shrink-0">-{r.savings_pct}%</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-500 font-bold">Você pagou</div>
                  <div className="text-zinc-300 mt-1 line-through decoration-zinc-600">{brl.format(r.paid_price)}<span className="text-zinc-600">/{r.unit_type}</span></div>
                  <div className="text-zinc-500 text-xs mt-0.5 truncate">{titleCase(r.store)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-emerald-500 font-bold">Achei por</div>
                  <div className="text-emerald-400 font-bold mt-1">{brl.format(r.cheaper_price)}<span className="text-emerald-700 font-normal">/{r.unit_type}</span></div>
                  <div className="text-zinc-500 text-xs mt-0.5 truncate">{titleCase(r.establishment_name)} · {dayMonth(r.observed_on)}</div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-white/5">
                <span className="text-xs text-zinc-500 flex items-center gap-1.5 min-w-0"><MapPin className="w-3 h-3 shrink-0" /><span className="truncate">{String(r.distance_km).replace('.', ',')} km{r.address ? ` · ${r.address}` : ''}</span></span>
                <button onClick={() => onCreateAlert({ master_product_id: r.master_product_id, label: cleanName(r.description), unit_type: r.unit_type, max_price: r.cheaper_price })}
                  className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] font-bold text-luxury-gold hover:text-white transition-colors shrink-0">
                  <BellPlus className="w-3.5 h-3.5" /> Avisar
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 pb-5">
          <button onClick={onClose} className="w-full py-4 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-[11px] font-bold uppercase tracking-[0.08em] hover:border-luxury-gold/40 transition-all">Entendi</button>
        </div>
      </div>
    </div>
  );
};

export default ScanSuggestionsSheet;
