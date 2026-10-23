import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, Loader2, Sparkles, X } from 'lucide-react';
import { Receipt } from '../types';
import { useLayers } from './LayersContext';
import { askAiForJson } from '../services/geminiService';
import { errorText } from '../services/shoppingListAI';
import { saveLayerPins } from '../services/layerPins';
import { titleCase } from '../services/textFormat';
import { pinKey } from '../services/categoryLayers';
import {
  LayerSuggestion, RefineProgress, collectUnplaced, patternSuggestions, refineWithAI,
} from '../services/layerLearning';

/* "Melhorar camadas": itens que ficaram sem grupo/item (3ª e 4ª camadas). Primeiro o app aplica o que aprendeu com as suas
   fixações (sem IA); depois, se quiser, pergunta à IA escolhida em Config sobre o resto. Nada muda antes de você aplicar. */

interface Props { receipts: Receipt[]; onClose: () => void; onApplied?: (n: number) => void }

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const keyOf = (s: { category: string; description: string }) => pinKey(s.category, s.description);

const LayerRefineSheet: React.FC<Props> = ({ receipts, onClose, onApplied }) => {
  const idx = useLayers();
  const unplaced = useMemo(() => collectUnplaced(receipts, idx), [receipts, idx]);
  const byPattern = useMemo(() => patternSuggestions(unplaced, idx), [unplaced, idx]);
  const [aiRows, setAiRows] = useState<LayerSuggestion[]>([]);
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<RefineProgress | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const cancel = useRef({ cancelled: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); cancel.current.cancelled = true; };
  }, [onClose]);

  // o que o padrão já resolve não vai para a IA; o que a IA já respondeu também não
  const patternKeys = useMemo(() => new Set(byPattern.map(keyOf)), [byPattern]);
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const list: LayerSuggestion[] = [];
    [...byPattern, ...aiRows].forEach(r => { const k = keyOf(r); if (!seen.has(k)) { seen.add(k); list.push(r); } });
    return list;
  }, [byPattern, aiRows]);
  const rowKeys = useMemo(() => new Set(rows.map(keyOf)), [rows]);
  const toAsk = useMemo(() => unplaced.filter(u => !rowKeys.has(keyOf(u))), [unplaced, rowKeys]);

  const chosen = rows.filter(r => !off[keyOf(r)]);
  const buys = chosen.reduce((n, r) => n + r.count, 0);

  const ask = async () => {
    setError(''); setNote('');
    cancel.current = { cancelled: false };
    setBusy({ done: 0, total: 1, category: '' });
    try {
      const res = await refineWithAI(toAsk, idx, { ask: askAiForJson, signal: cancel.current, onProgress: setBusy });
      setAiRows(prev => [...prev, ...res.suggestions]);
      if (res.failed > 0 && res.suggestions.length === 0) setError(errorText({ message: res.lastError }) || 'A IA não respondeu. Tente de novo.');
      else if (res.suggestions.length === 0) setNote('A IA não achou grupo ou item para esses itens.');
      else if (res.remaining > 0) setNote(`Perguntei sobre as categorias com mais compras. Ainda restam ${plural(res.remaining, 'item', 'itens')}: toque de novo para continuar.`);
    } catch (e: any) {
      setError(errorText(e) || 'A IA não respondeu. Tente de novo.');
    } finally {
      setBusy(null);
    }
  };

  const apply = () => {
    const n = saveLayerPins(chosen.map(r => ({ category: r.category, description: r.description, nodeKey: r.nodeKey })));
    onApplied?.(n);
    setAiRows(prev => prev.filter(r => off[keyOf(r)]));
    if (unplaced.length - chosen.length === 0 || rows.length === chosen.length) onClose();
  };

  return (
    <div className="fixed inset-0 z-[250] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md animate-in fade-in duration-150" onClick={onClose} data-testid="refine-sheet">
      <div role="dialog" aria-modal="true" aria-labelledby="refine-title" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-xl max-h-[92dvh] flex flex-col bg-[#0c0c0e] border border-luxury-gold/30 rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl">
        <div className="flex items-start gap-3 p-5 sm:p-6 border-b border-white/5">
          <div className="shrink-0 w-10 h-10 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold flex items-center justify-center"><BrainCircuit className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <h3 id="refine-title" className="text-lg font-serif text-white tracking-tight">Melhorar grupos e itens</h3>
            <p className="text-xs text-zinc-400 mt-0.5 leading-snug">O app aprende com o que você já fixou (ex.: Cebola em Bulbos) e sugere o mesmo para os itens que ficaram sem grupo ou item.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-zinc-500"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
          <p className="text-xs text-zinc-400 px-1" data-testid="refine-count">
            {unplaced.length === 0 ? 'Todos os itens já estão num grupo ou item.' : `${plural(unplaced.length, 'descrição sem grupo ou item', 'descrições sem grupo ou item')}${rows.length ? ` · ${plural(rows.length, 'sugestão', 'sugestões')}` : ''}`}
          </p>

          {rows.length > 0 && (
            <ul className="space-y-2" data-testid="refine-rows">
              {rows.map(r => {
                const on = !off[keyOf(r)];
                return (
                  <li key={keyOf(r)}>
                    <label className={`flex items-start gap-3 rounded-2xl border p-3 cursor-pointer transition-colors ${on ? 'border-luxury-gold/30 bg-luxury-gold/[0.04]' : 'border-white/5 bg-white/[0.02] opacity-70'}`} data-testid="refine-row">
                      <input type="checkbox" checked={on} onChange={e => setOff(prev => ({ ...prev, [keyOf(r)]: !e.target.checked }))}
                        aria-label={`Fixar ${titleCase(r.description)}`} className="mt-0.5 w-5 h-5 shrink-0 accent-[#D4AF37]" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-zinc-100 leading-snug break-words">{titleCase(r.description)}</span>
                        <span className="block text-[12.5px] text-luxury-gold leading-snug mt-0.5 break-words" data-testid="refine-path">{r.path}</span>
                        <span className="block text-[11px] text-zinc-500 mt-0.5">
                          {plural(r.count, 'compra', 'compras')} · {brl.format(r.total)} · {r.source === 'ia' ? 'Sugestão da IA' : r.reason}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {toAsk.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3.5" data-testid="refine-ai-box">
              <p className="text-[12.5px] text-zinc-300 leading-snug">
                {plural(toAsk.length, 'descrição', 'descrições')} {toAsk.length === 1 ? 'ainda não tem' : 'ainda não têm'} sugestão pelo seu padrão. A IA escolhida em Config pode tentar, usando a sua estrutura e as suas fixações como exemplo.
              </p>
              <button type="button" onClick={ask} disabled={!!busy} data-testid="refine-ask"
                className="mt-3 w-full h-11 rounded-xl border border-luxury-gold/50 text-[13px] font-bold text-zinc-100 flex items-center justify-center gap-2 disabled:opacity-60 active:opacity-80">
                {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> {busy.category ? `Perguntando: ${busy.category.split(' - ').pop()}` : 'Perguntando à IA'} ({Math.min(busy.done + 1, busy.total)}/{busy.total})</> : <><Sparkles className="w-4 h-4 text-luxury-gold" /> Perguntar à IA</>}
              </button>
              {error && <p className="mt-2 text-xs text-red-400 leading-snug" data-testid="refine-error">{error}</p>}
              {note && <p className="mt-2 text-xs text-zinc-400 leading-snug" data-testid="refine-note">{note}</p>}
            </div>
          )}
        </div>

        <div className="p-4 sm:p-5 border-t border-white/5 space-y-3">
          <p className="text-xs text-zinc-400 text-center" data-testid="refine-summary">
            {chosen.length === 0 ? 'Nenhuma sugestão marcada.' : `${plural(chosen.length, 'descrição', 'descrições')} · ${plural(buys, 'compra', 'compras')} ganham grupo ou item`}
          </p>
          <div className="flex gap-3">
            <button type="button" disabled={chosen.length === 0} onClick={apply} data-testid="refine-apply"
              className="flex-1 py-4 rounded-xl font-bold text-[11px] uppercase tracking-[0.08em] bg-luxury-gold text-black disabled:opacity-40 active:opacity-80">
              {chosen.length === 0 ? 'Fixar' : `Fixar ${plural(chosen.length, 'descrição', 'descrições')}`}
            </button>
            <button type="button" onClick={onClose} className="w-28 sm:w-36 py-4 rounded-xl bg-white/5 border border-white/10 text-zinc-300 font-bold text-[11px] uppercase tracking-[0.08em] active:opacity-80">Fechar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LayerRefineSheet;
