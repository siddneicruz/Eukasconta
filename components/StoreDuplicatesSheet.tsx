import React, { useEffect, useMemo, useState } from 'react';
import { Copy, X, Sparkles, Loader2, AlertTriangle, RefreshCw, Check, Undo2 } from 'lucide-react';
import { Establishment, Receipt } from '../types';
import { formatCNPJ } from '../services/productNormalization';
import { titleCase } from '../services/textFormat';
import { MergePlan, StoreGroup, StoreMember, buildUnits, candidateBlocks, findStoreGroups, removableCount } from '../services/storeDedupe';
import { reviewWithAI } from '../services/storeDedupeAI';

/* Folha "Lojas repetidas". Abre já com o que as regras acharam (CNPJ, nome sem LTDA/F01, cidade e endereço) e,
   se a pessoa pedir, a IA confere as lojas parecidas que as regras deixaram de lado. Cada grupo mostra qual cadastro
   fica (dá para trocar) e pode ficar de fora. Só o que estiver marcado é juntado quando a pessoa toca em "Juntar". */

interface Props {
  establishments: Establishment[];
  receipts: Receipt[];
  onMerge: (plans: MergePlan[]) => void;
  onClose: () => void;
}

const nameOf = (e: Establishment): string => (e.aliasName && e.aliasName.trim()) || titleCase(e.originalName) || 'Sem nome';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const badge = (g: StoreGroup): { label: string; cls: string } =>
  g.source === 'ia'
    ? { label: 'IA', cls: 'bg-sky-500/10 text-sky-400 border-sky-500/30' }
    : g.confidence === 'alta'
      ? { label: 'Certeza alta', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' }
      : { label: 'Conferir', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };

const StoreDuplicatesSheet: React.FC<Props> = ({ establishments, receipts, onMerge, onClose }) => {
  // A lista é fixada ao abrir: se os dados mudarem por trás (sincronização), a conferência da pessoa não se perde.
  const [ruleGroups] = useState(() => findStoreGroups(establishments, receipts));
  const [groups, setGroups] = useState<StoreGroup[]>(ruleGroups);
  const aiCandidates = useMemo(() => {
    const blocks = candidateBlocks(buildUnits(establishments, receipts, ruleGroups));
    return blocks.reduce((s, b) => s + b.length, 0);
  }, [establishments, receipts, ruleGroups]);

  const [on, setOn] = useState<Record<string, boolean>>({});
  const [keepOf, setKeepOf] = useState<Record<string, string>>({});
  // Quem só tem indício fraco (ex.: outra filial com CNPJ certo e diferente no mesmo endereço) começa de fora do grupo
  const [outOf, setOutOf] = useState<Record<string, string[]>>(() => Object.fromEntries(ruleGroups.filter(g => g.weak && g.weak.length > 0).map(g => [g.id, [...g.weak!]])));

  const [phase, setPhase] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const [progress, setProgress] = useState<[number, number]>([0, 1]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState<{ asked: number; found: number; partial: string; skipped: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const included = (g: StoreGroup): StoreMember[] => g.members.filter(m => !(outOf[g.id] || []).includes(m.key));
  const keepKey = (g: StoreGroup): string => {
    const k = keepOf[g.id] ?? g.keep;
    return included(g).some(m => m.key === k) ? k : (included(g)[0]?.key ?? g.keep);
  };
  const canMerge = (g: StoreGroup) => included(g).length >= 2;
  const isOn = (g: StoreGroup): boolean => canMerge(g) && (on[g.id] ?? (g.source === 'regra' && g.confidence === 'alta'));

  const chosen = groups.filter(isOn);
  const removing = chosen.reduce((s, g) => s + included(g).length - 1, 0);
  const allOn = groups.length > 0 && groups.every(g => !canMerge(g) || isOn(g));

  const runAi = async () => {
    setPhase('loading'); setError(''); setProgress([0, 1]);
    try {
      const res = await reviewWithAI(establishments, receipts, ruleGroups, { onProgress: (d, t) => setProgress([d, t]) });
      setGroups(res.groups);
      setInfo({ asked: res.asked, found: res.found, partial: res.failed || '', skipped: res.skipped });
      setPhase('done');
    } catch (e: any) {
      setError(String(e?.message || e)); setPhase('error');
    }
  };

  const apply = () => {
    const plans: MergePlan[] = chosen.map(g => ({ keep: keepKey(g), members: included(g).map(m => m.key) }));
    if (plans.length === 0) return;
    onMerge(plans);
    onClose();
  };

  const toggleOut = (g: StoreGroup, key: string) =>
    setOutOf(prev => {
      const cur = prev[g.id] || [];
      return { ...prev, [g.id]: cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key] };
    });

  return (
    <div className="fixed inset-0 z-[250] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md animate-in fade-in duration-150" onClick={onClose} data-testid="dup-sheet">
      <div role="dialog" aria-modal="true" aria-labelledby="dup-title" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-xl max-h-[92dvh] flex flex-col bg-[#0c0c0e] border border-luxury-gold/30 rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl">
        <div className="flex items-start gap-3 p-5 sm:p-6 border-b border-white/5">
          <div className="shrink-0 w-10 h-10 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold flex items-center justify-center"><Copy className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <h3 id="dup-title" className="text-lg font-serif text-white tracking-tight">Lojas repetidas</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Confira cada grupo. Os cupons passam para a loja que ficar; dá para desfazer em Pontos de restauração.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
        {/* IA: só para o que as regras não resolveram */}
        <div className="px-5 sm:px-6 pt-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
            {phase === 'loading' ? (
              <div className="flex items-center gap-3" data-testid="dup-ai-loading">
                <Loader2 className="w-5 h-5 text-luxury-gold animate-spin shrink-0" />
                <p className="text-sm text-zinc-300">Conferindo lojas parecidas{progress[1] > 1 ? ` (parte ${Math.min(progress[0] + 1, progress[1])} de ${progress[1]})` : ''}…</p>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-200 font-semibold">{phase === 'done' ? 'Conferido com IA' : 'Conferido sem IA'}</p>
                  <p className="text-xs text-zinc-500 mt-0.5" data-testid="dup-ai-status">
                    {phase === 'done' && info
                      ? (info.found > 0
                        ? `A IA olhou ${plural(info.asked, 'loja parecida', 'lojas parecidas')} e achou ${plural(info.found, 'grupo novo', 'grupos novos')}. Eles vêm desmarcados.`
                        : `A IA olhou ${plural(info.asked, 'loja parecida', 'lojas parecidas')} e não achou mais nenhuma repetida.`)
                      : aiCandidates > 0
                        ? `Por CNPJ, nome e endereço. Há ${plural(aiCandidates, 'loja parecida', 'lojas parecidas')} que as regras não resolvem: a IA pode conferir.`
                        : 'Por CNPJ, nome e endereço. Não há outras lojas parecidas para a IA conferir.'}
                    {info?.partial ? ` Só parte foi conferida: ${info.partial}` : ''}
                    {info && info.skipped > 0 ? ` Ficaram ${plural(info.skipped, 'parte', 'partes')} de fora; confira de novo depois de juntar.` : ''}
                  </p>
                  {phase === 'error' && (
                    <p className="text-xs text-red-400 mt-1.5 flex items-start gap-1.5 break-words" data-testid="dup-ai-error"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{error}</p>
                  )}
                </div>
                {(aiCandidates > 0 || phase === 'error') && phase !== 'done' && (
                  <button type="button" onClick={runAi} data-testid="dup-ai"
                    className="shrink-0 inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-luxury-gold/10 text-luxury-gold border border-luxury-gold/30 text-xs font-bold hover:bg-luxury-gold hover:text-black transition-colors">
                    {phase === 'error' ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {phase === 'error' ? 'Tentar de novo' : 'Conferir com IA'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 sm:px-6 pt-4 pb-2 flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-400" data-testid="dup-summary">
            {groups.length === 0
              ? 'Nenhuma loja repetida por aqui.'
              : `${plural(groups.length, 'grupo', 'grupos')} · ${plural(removableCount(groups), 'cadastro', 'cadastros')} a menos se juntar tudo`}
          </p>
          {groups.length > 0 && (
            <button type="button" data-testid="dup-all" onClick={() => setOn(Object.fromEntries(groups.map(g => [g.id, !allOn])))} className="shrink-0 text-xs font-bold text-luxury-gold">
              {allOn ? 'Desmarcar todos' : 'Marcar todos'}
            </button>
          )}
        </div>

        <ul className="px-3 sm:px-4 pb-3 space-y-2.5" data-testid="dup-list">
          {groups.map(g => {
            const keep = keepKey(g);
            const act = isOn(g);
            const b = badge(g);
            const inc = included(g);
            const keeper = g.members.find(m => m.key === keep) || g.members[0];
            const rc = inc.reduce((s, m) => s + m.receipts, 0);
            return (
              <li key={g.id} data-testid="dup-group" data-confidence={g.confidence} data-source={g.source} data-on={act ? 'true' : 'false'}
                className={`rounded-2xl border p-3.5 transition-colors ${act ? 'border-luxury-gold/30 bg-luxury-gold/[0.04]' : 'border-white/5 bg-white/[0.02]'}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={act} disabled={!canMerge(g)} onChange={e => setOn(prev => ({ ...prev, [g.id]: e.target.checked }))} data-testid="dup-check"
                    aria-label={`Juntar ${nameOf(keeper.est)}`} className="mt-0.5 w-5 h-5 shrink-0 accent-[#D4AF37]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-zinc-100 font-semibold leading-snug break-words min-w-0" data-testid="dup-title-name">{nameOf(keeper.est)}</p>
                      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${b.cls}`} data-testid="dup-badge">{b.label}</span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {plural(inc.length, 'cadastro', 'cadastros')} · {plural(rc, 'cupom', 'cupons')}
                    </p>
                    <p className="text-[11px] text-zinc-500 mt-0.5 break-words" data-testid="dup-reasons">{g.reasons.join(' · ')}</p>
                  </div>
                </div>

                <ul className="mt-3 space-y-1.5">
                  {g.members.map(m => {
                    const out = (outOf[g.id] || []).includes(m.key);
                    const isKeep = m.key === keep;
                    const place = [titleCase(m.est.city), m.est.state].filter(Boolean).join(' - ');
                    return (
                      <li key={m.key} data-testid="dup-member" data-keep={isKeep ? 'true' : 'false'} data-out={out ? 'true' : 'false'}
                        className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 ${out ? 'opacity-50 border-white/5' : isKeep ? 'border-luxury-gold/40 bg-white/[0.03]' : 'border-white/10'}`}>
                        <button type="button" disabled={out} onClick={() => setKeepOf(prev => ({ ...prev, [g.id]: m.key }))} data-testid="dup-keep"
                          aria-label={`Manter ${titleCase(m.est.originalName)}`} aria-pressed={isKeep}
                          className={`shrink-0 w-6 h-6 rounded-full border flex items-center justify-center ${isKeep ? 'bg-luxury-gold border-luxury-gold text-black' : 'border-white/20 text-transparent'}`}>
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className={`text-[13px] leading-tight break-words ${out ? 'line-through text-zinc-500' : 'text-zinc-200 font-medium'}`}>{titleCase(m.est.originalName)}</p>
                          <p className="text-[11px] text-zinc-500 mt-0.5 break-words">
                            <span className="tabular-nums">{formatCNPJ(m.est.cnpj) || 'Sem CNPJ'}</span>
                            {m.est.cnpj && !m.cnpjOk && <span className="text-amber-400"> (dígitos não conferem)</span>}
                            {place && <> · {place}</>}
                            {` · ${plural(m.receipts, 'cupom', 'cupons')}`}
                            {m.spent > 0 && <> · {money(m.spent)}</>}
                          </p>
                          {isKeep && !out && <p className="text-[11px] font-bold text-luxury-gold mt-0.5" data-testid="dup-keep-label">Fica este</p>}
                          {g.weak?.includes(m.key) && (
                            <p className="text-[11px] text-amber-400 mt-0.5" data-testid="dup-weak-note">
                              {out ? 'Tem outro CNPJ certo: pode ser outra filial. Fica de fora; toque em Voltar se for a mesma loja.' : 'Tem outro CNPJ certo: confira se é a mesma loja.'}
                            </p>
                          )}
                        </div>
                        {!isKeep && (
                          <button type="button" onClick={() => toggleOut(g, m.key)} data-testid="dup-exclude"
                            aria-label={out ? `Voltar ${titleCase(m.est.originalName)} ao grupo` : `Tirar ${titleCase(m.est.originalName)} do grupo, não é a mesma loja`}
                            className="shrink-0 min-w-[2.75rem] h-9 px-2 rounded-lg flex items-center justify-center gap-1 text-[11px] font-bold text-zinc-400 hover:text-luxury-gold border border-transparent hover:border-white/10">
                            {out ? <><Undo2 className="w-3.5 h-3.5" /> Voltar</> : <><X className="w-3.5 h-3.5" /> Não é</>}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
        </div>

        <div className="p-3.5 sm:p-5 border-t border-white/5 flex flex-row gap-2.5 sm:gap-3">
          <button type="button" onClick={onClose} data-testid="dup-close" className="w-24 sm:w-36 shrink-0 py-4 rounded-xl bg-white/5 border border-white/10 text-zinc-300 font-bold text-[11px] uppercase tracking-[0.08em] hover:bg-white/10 transition-colors">
            Fechar
          </button>
          <button type="button" onClick={apply} disabled={chosen.length === 0} data-testid="dup-apply"
            className="flex-1 py-3 sm:py-4 px-2 rounded-xl font-bold text-[11px] uppercase tracking-[0.08em] bg-luxury-gold text-black hover:brightness-110 transition disabled:opacity-40 disabled:hover:brightness-100">
            {chosen.length === 0 ? 'Juntar lojas' : <>Juntar {plural(chosen.length, 'grupo', 'grupos')}<span className="block text-[10px] font-semibold normal-case tracking-normal opacity-80 mt-0.5">{plural(removing, 'cadastro a menos', 'cadastros a menos')}</span></>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StoreDuplicatesSheet;
