import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Establishment, Receipt } from '../types';
import { collectStoreRows, suggestNicknames, StoreRow, NicknameResult } from '../services/nicknameAI';
import { formatCNPJ } from '../services/productNormalization';
import { titleCase } from '../services/textFormat';

/* Folha com os apelidos sugeridos pela IA. Cada linha pode ser editada ou desmarcada;
   só o que estiver marcado vira apelido quando a pessoa toca em "Aplicar". */

interface Props {
  establishments: Establishment[];
  receipts: Receipt[];
  onApply: (list: { cnpj: string; originalName: string; aliasName: string }[]) => void;
  onClose: () => void;
}

interface Line { row: StoreRow; text: string; on: boolean; }

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const NicknameSuggestSheet: React.FC<Props> = ({ establishments, receipts, onApply, onClose }) => {
  // A lista de lojas é fixada ao abrir a folha: se os dados mudarem por trás (sincronização), não se refaz a consulta à IA.
  const [rows] = useState(() => collectStoreRows(establishments, receipts));
  const job = useRef<{ run: number; p: Promise<NicknameResult> } | null>(null);
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading');
  const [progress, setProgress] = useState<[number, number]>([0, 1]);
  const [error, setError] = useState('');
  const [partial, setPartial] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [unchanged, setUnchanged] = useState(0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase('loading'); setError(''); setPartial('');
    if (rows.length === 0) { setPhase('ready'); setLines([]); setUnchanged(0); return; }
    // uma consulta por tentativa, mesmo que o React rode este efeito duas vezes
    if (!job.current || job.current.run !== run) job.current = { run, p: suggestNicknames(rows, (done, total) => setProgress([done, total])) };
    job.current.p
      .then(({ suggestions, failed }) => {
        if (!alive) return;
        const out: Line[] = [];
        let keep = 0;
        rows.forEach(row => {
          const s = suggestions.get(row.id);
          if (!s) return;
          if (row.current && same(row.current, s)) { keep += 1; return; }
          // quem já tem apelido escolhido pela pessoa só muda se ela marcar; sem apelido (ou só uma sigla), já vem marcado
          const weak = !row.current || row.current.trim().length <= 3;
          out.push({ row, text: s, on: weak });
        });
        setLines(out); setUnchanged(keep); setPartial(failed || ''); setPhase('ready');
      })
      .catch((e: any) => { if (alive) { setError(String(e?.message || e)); setPhase('error'); } });
    return () => { alive = false; };
  }, [run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chosen = lines.filter(l => l.on && l.text.trim().length > 0);
  const setLine = (i: number, patch: Partial<Line>) => setLines(prev => prev.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const allOn = lines.length > 0 && lines.every(l => l.on);

  const apply = () => {
    onApply(chosen.map(l => ({ cnpj: l.row.est.cnpj, originalName: l.row.est.originalName, aliasName: l.text.trim() })));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[250] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md animate-in fade-in duration-150" onClick={onClose} data-testid="nick-sheet">
      <div role="dialog" aria-modal="true" aria-labelledby="nick-title" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-xl max-h-[92dvh] flex flex-col bg-[#0c0c0e] border border-luxury-gold/30 rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl">
        <div className="flex items-start gap-3 p-5 sm:p-6 border-b border-white/5">
          <div className="shrink-0 w-10 h-10 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold flex items-center justify-center"><Sparkles className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <h3 id="nick-title" className="text-lg font-serif text-white tracking-tight">Apelidos sugeridos pela IA</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Revise, edite o que quiser e aplique. Nada muda antes de você aplicar.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {phase === 'loading' && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center" data-testid="nick-loading">
            <Loader2 className="w-8 h-8 text-luxury-gold animate-spin" />
            <p className="text-sm text-zinc-300">Analisando {rows.length} {rows.length === 1 ? 'loja' : 'lojas'}…</p>
            {progress[1] > 1 && <p className="text-xs text-zinc-500">Parte {Math.min(progress[0] + 1, progress[1])} de {progress[1]}</p>}
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col items-center gap-4 py-12 px-6 text-center" data-testid="nick-error">
            <div className="w-12 h-12 rounded-full bg-red-950/40 border border-red-900/40 text-red-400 flex items-center justify-center"><AlertTriangle className="w-5 h-5" /></div>
            <p className="text-sm text-zinc-300 break-words max-w-sm">{error}</p>
            <button type="button" onClick={() => setRun(n => n + 1)} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/5 border border-white/10 text-zinc-200 text-sm font-semibold hover:border-luxury-gold/40">
              <RefreshCw className="w-4 h-4" /> Tentar de novo
            </button>
          </div>
        )}

        {phase === 'ready' && (
          <>
            <div className="px-5 sm:px-6 pt-4 pb-2 flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-400" data-testid="nick-summary">
                {lines.length === 0
                  ? (rows.length === 0 ? 'Nenhuma loja com cupom ainda.' : 'Os apelidos de hoje já estão bons.')
                  : `${lines.length} ${lines.length === 1 ? 'sugestão' : 'sugestões'}${unchanged ? ` · ${unchanged} já ${unchanged === 1 ? 'estava bom' : 'estavam bons'}` : ''}`}
              </p>
              {lines.length > 0 && (
                <button type="button" onClick={() => setLines(prev => prev.map(l => ({ ...l, on: !allOn })))} className="shrink-0 text-xs font-bold text-luxury-gold">
                  {allOn ? 'Desmarcar todas' : 'Marcar todas'}
                </button>
              )}
            </div>
            {partial && <p className="mx-5 sm:mx-6 mb-2 text-xs text-amber-400" data-testid="nick-partial">Só parte das lojas foi analisada: {partial}</p>}

            <ul className="flex-1 overflow-y-auto px-3 sm:px-4 pb-3 space-y-2" data-testid="nick-list">
              {lines.map((l, i) => (
                <li key={`${l.row.cnpj}|${l.row.name}`} className={`rounded-2xl border p-3.5 transition-colors ${l.on ? 'border-luxury-gold/30 bg-luxury-gold/[0.04]' : 'border-white/5 bg-white/[0.02]'}`} data-testid="nick-row">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={l.on} onChange={e => setLine(i, { on: e.target.checked })} aria-label={`Aplicar apelido em ${titleCase(l.row.name)}`}
                      className="mt-1 w-5 h-5 shrink-0 accent-[#D4AF37]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-200 font-semibold leading-snug break-words">{titleCase(l.row.name)}</p>
                      <p className="text-xs text-zinc-500 mt-0.5 break-words">
                        {l.row.cnpj ? <span className="tabular-nums">{formatCNPJ(l.row.cnpj)}</span> : 'Sem CNPJ'}
                        {(l.row.city || l.row.state) && <> · {[l.row.city, l.row.state].filter(Boolean).join(' - ')}</>}
                        {` · ${l.row.receipts} ${l.row.receipts === 1 ? 'cupom' : 'cupons'}`}
                      </p>
                      {l.row.topItems.length > 0 && <p className="text-xs text-zinc-600 mt-0.5 truncate">Compras: {l.row.topItems.join(', ')}</p>}
                      <input type="text" value={l.text} onChange={e => setLine(i, { text: e.target.value, on: true })} aria-label="Apelido sugerido" data-testid="nick-input"
                        className="mt-2.5 w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-luxury-gold font-semibold focus:border-luxury-gold/50 outline-none" />
                      {l.row.current && <p className="text-xs text-zinc-500 mt-1.5">Hoje: <span className="text-zinc-400">{titleCase(l.row.current)}</span></p>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="p-4 sm:p-5 border-t border-white/5 flex flex-col sm:flex-row gap-3">
              <button type="button" onClick={apply} disabled={chosen.length === 0} data-testid="nick-apply"
                className="flex-1 py-4 rounded-xl font-bold text-[11px] uppercase tracking-[0.08em] bg-luxury-gold text-black hover:bg-white transition-colors disabled:opacity-40 disabled:hover:bg-luxury-gold">
                {chosen.length === 0 ? 'Aplicar apelidos' : chosen.length === 1 ? 'Aplicar 1 apelido' : `Aplicar ${chosen.length} apelidos`}
              </button>
              <button type="button" onClick={onClose} className="sm:w-36 py-4 rounded-xl bg-white/5 border border-white/10 text-zinc-300 font-bold text-[11px] uppercase tracking-[0.08em] hover:bg-white/10 transition-colors">
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default NicknameSuggestSheet;
