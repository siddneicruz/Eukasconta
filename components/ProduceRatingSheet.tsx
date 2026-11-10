import React, { useState } from 'react';
import { Leaf, X, Check } from 'lucide-react';

/* Depois de ler um cupom com hortifruti: "Como estava?". Um toque por item (Ruim / Ok / Ótimo), pode pular.
   A nota vai de 0 a 10 por trás (2, 6 ou 10); quem vê é só a média da loja, nunca a nota de uma pessoa. */

export interface ProduceRateItem { description: string; unitType?: string; }

const OPTIONS = [
  { score: 2, emoji: '😞', label: 'Ruim' },
  { score: 6, emoji: '😐', label: 'Ok' },
  { score: 10, emoji: '😍', label: 'Ótimo' },
];

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
const cleanName = (s: string) => s.replace(/^\d{3,14}\s+/, '');

interface Props {
  store: string;
  items: ProduceRateItem[];
  onSubmit: (rated: { description: string; unit_type?: string; score: number }[]) => Promise<void>;
  onClose: () => void;
}

const ProduceRatingSheet: React.FC<Props> = ({ store, items, onSubmit, onClose }) => {
  const [scores, setScores] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  // "todos" = uma nota para tudo; "um" = nota item a item. A escolha fica lembrada neste aparelho.
  const [mode, setMode] = useState<'todos' | 'um'>(() => { try { return localStorage.getItem('ek_rate_mode') === 'todos' ? 'todos' : 'um'; } catch { return 'um'; } });
  const [all, setAll] = useState<number | null>(null);
  const pickMode = (m: 'todos' | 'um') => { setMode(m); try { localStorage.setItem('ek_rate_mode', m); } catch { /* sem registro */ } };
  const count = mode === 'todos' ? (all === null ? 0 : items.length) : Object.keys(scores).length;

  const send = async () => {
    if (!count) return onClose();
    setBusy(true);
    try {
      await onSubmit(items.map((it, i) => { const sc = mode === 'todos' ? all : (scores[i] ?? null); return sc === null ? null : { description: it.description, unit_type: it.unitType, score: sc }; })
        .filter((x): x is { description: string; unit_type: string | undefined; score: number } => !!x));
    } finally { setBusy(false); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-end md:items-center justify-center p-0 md:p-6 bg-black/70 backdrop-blur-sm animate-in fade-in" onClick={onClose} data-testid="produce-rating">
      <div onClick={e => e.stopPropagation()} className="w-full max-w-lg max-h-[85dvh] overflow-y-auto custom-scrollbar bg-[#09090b] border border-white/10 rounded-t-[2rem] md:rounded-[2rem] shadow-2xl animate-in slide-in-from-bottom-8 duration-300"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex items-start justify-between gap-4 p-5 pb-4 border-b border-white/5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0"><Leaf className="w-5 h-5" /></div>
            <div>
              <h3 className="text-base font-bold text-white leading-tight">Como estava o hortifruti?</h3>
              <p className="text-xs text-zinc-500 mt-1">{store ? `Em ${titleCase(store)}. ` : ''}Ajude os outros a escolher onde comprar, não só pelo preço.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 text-zinc-500 hover:text-white shrink-0" aria-label="Pular"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 p-0.5 rounded-full bg-white/5 border border-white/10" role="tablist" data-testid="produce-mode">
            {([['todos', 'Todos de uma vez'], ['um', 'Um por um']] as const).map(([m, label]) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => pickMode(m)} data-testid={`produce-mode-${m}`}
                className={`h-9 rounded-full text-[11px] font-bold uppercase tracking-[0.06em] transition-colors ${mode === m ? 'bg-luxury-gold text-black' : 'text-zinc-500'}`}>{label}</button>
            ))}
          </div>

          {mode === 'todos' ? (
            <div className="rounded-xl border border-white/10 bg-black/40 p-3" data-testid="produce-all">
              <p className="text-sm text-zinc-200 mb-1">Todo o hortifruti deste cupom</p>
              <p className="text-xs text-zinc-500 mb-3 leading-relaxed">{items.map(it => titleCase(cleanName(it.description))).join(', ')}</p>
              <div className="grid grid-cols-3 gap-2">
                {OPTIONS.map(o => {
                  const on = all === o.score;
                  return (
                    <button key={o.score} type="button" aria-pressed={on} data-testid={`produce-all-${o.score}`} onClick={() => setAll(on ? null : o.score)}
                      className={`h-12 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-bold transition-colors ${on ? 'bg-luxury-gold/15 border-luxury-gold/60 text-luxury-gold' : 'bg-white/5 border-white/10 text-zinc-400 active:bg-white/10'}`}>
                      <span className="text-lg leading-none">{o.emoji}</span>{o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : items.map((it, i) => (
            <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-3" data-testid="produce-row">
              <p className="text-sm text-zinc-200 mb-2 truncate">{titleCase(cleanName(it.description))}</p>
              <div className="grid grid-cols-3 gap-2">
                {OPTIONS.map(o => {
                  const on = scores[i] === o.score;
                  return (
                    <button key={o.score} type="button" aria-pressed={on} data-testid={`produce-${i}-${o.score}`}
                      onClick={() => setScores(p => { const n = { ...p }; if (n[i] === o.score) delete n[i]; else n[i] = o.score; return n; })}
                      className={`h-12 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-bold transition-colors ${on ? 'bg-luxury-gold/15 border-luxury-gold/60 text-luxury-gold' : 'bg-white/5 border-white/10 text-zinc-400 active:bg-white/10'}`}>
                      <span className="text-lg leading-none">{o.emoji}</span>{o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <button type="button" onClick={send} disabled={busy} data-testid="produce-send"
            className="w-full h-12 rounded-xl bg-luxury-gold text-black text-[11px] font-bold uppercase tracking-[0.08em] flex items-center justify-center gap-2 disabled:opacity-60">
            <Check className="w-4 h-4" /> {count ? `Enviar ${count} ${count === 1 ? 'nota' : 'notas'}` : 'Pular'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProduceRatingSheet;
