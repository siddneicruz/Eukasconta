import React, { useEffect, useMemo, useState } from 'react';
import { Merge, X, Sparkles } from 'lucide-react';
import { ProductGroup, DupCluster } from '../services/productUnify';
import { fold } from '../services/itemSearch';
import { titleCase } from '../services/textFormat';

/* Duas folhas de baixo para cima:
   - ProductUnifySheet: confirma a unificação (qual nome fica, em que categoria, quem entra).
   - ProductDupSheet: lista os produtos que parecem repetidos para a pessoa decidir. */

export interface UnifyPlan {
  groups: ProductGroup[];
  name: string;
  category: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const useEscape = (onClose: () => void, off = false) => {
  useEffect(() => {
    if (off) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, off]);
};

const CUSTOM = '__custom';

/* ───────────────────────── unificar ───────────────────────── */

interface UnifyProps {
  groups: ProductGroup[];
  categories: string[];
  onConfirm: (plan: UnifyPlan) => void;
  onClose: () => void;
}

export const ProductUnifySheet: React.FC<UnifyProps> = ({ groups, categories, onConfirm, onClose }) => {
  useEscape(onClose);

  const [off, setOff] = useState<Record<string, boolean>>({});
  const checked = useMemo(() => groups.filter(g => !off[g.key]), [groups, off]);

  // nomes possíveis: os dos produtos marcados, sem repetir; o mais comprado vem primeiro
  const options = useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; name: string; count: number }[] = [];
    [...checked].sort((a, b) => b.count - a.count).forEach(g => {
      const id = fold(g.name);
      if (seen.has(id)) return;
      seen.add(id);
      list.push({ id, name: g.name, count: g.count });
    });
    return list;
  }, [checked]);

  const [pick, setPick] = useState<string>('');
  const [custom, setCustom] = useState('');
  const effectivePick = pick === CUSTOM || options.some(o => o.id === pick) ? pick : (options[0]?.id || CUSTOM);
  const name = effectivePick === CUSTOM ? custom.trim() : (options.find(o => o.id === effectivePick)?.name || '');

  // categoria: a mais comprada entre as marcadas, até a pessoa escolher outra
  const [catPick, setCatPick] = useState('');
  const topCategory = useMemo(() => {
    const votes = new Map<string, number>();
    checked.forEach(g => g.descs.forEach(d => votes.set(d.category, (votes.get(d.category) || 0) + d.count)));
    let best = '', n = -1;
    votes.forEach((v, k) => { if (v > n) { n = v; best = k; } });
    return best || checked[0]?.category || 'Outros';
  }, [checked]);
  const category = catPick || topCategory;
  const categoryList = categories.includes(category) ? categories : [category, ...categories];

  const totals = useMemo(() => ({
    names: checked.reduce((s, g) => s + g.descs.length, 0),
    buys: checked.reduce((s, g) => s + g.count, 0),
  }), [checked]);

  const canApply = checked.length >= 2 && name.length > 0;

  return (
    <div className="fixed inset-0 z-[270] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md animate-in fade-in duration-150" onClick={onClose} data-testid="unify-sheet">
      <div role="dialog" aria-modal="true" aria-labelledby="unify-title" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-xl max-h-[92dvh] flex flex-col bg-[#0c0c0e] border border-luxury-gold/30 rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl">
        <div className="flex items-start gap-3 p-5 sm:p-6 border-b border-white/5">
          <div className="shrink-0 w-10 h-10 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold flex items-center justify-center"><Merge className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <h3 id="unify-title" className="text-lg font-serif text-white tracking-tight">Unificar produtos</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Os itens marcados passam a ser um só. Seus cupons não mudam, e os próximos já caem aqui.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-5">
          <section>
            <h4 className="text-xs font-semibold text-zinc-400 mb-2 px-1">Itens que viram um só</h4>
            <ul className="space-y-2" data-testid="unify-members">
              {groups.map(g => {
                const on = !off[g.key];
                return (
                  <li key={g.key}>
                    <label className={`flex items-start gap-3 rounded-2xl border p-3 cursor-pointer transition-colors ${on ? 'border-luxury-gold/30 bg-luxury-gold/[0.04]' : 'border-white/5 bg-white/[0.02] opacity-70'}`} data-testid="unify-member">
                      <input type="checkbox" checked={on} onChange={e => setOff(prev => ({ ...prev, [g.key]: !e.target.checked }))}
                        aria-label={`Incluir ${titleCase(g.name)}`} className="mt-0.5 w-5 h-5 shrink-0 accent-[#D4AF37]" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-zinc-100 leading-snug break-words">{titleCase(g.name)}</span>
                        <span className="block text-xs text-zinc-500 mt-0.5">
                          {plural(g.count, 'compra', 'compras')}
                          {g.descs.length > 1 && ` · ${plural(g.descs.length, 'nome', 'nomes')} no cupom`}
                          {g.code && <span className="tabular-nums"> · {g.code}</span>}
                        </span>
                        {g.descs.length > 1 && (
                          <span className="block text-xs text-zinc-600 mt-0.5 break-words">{g.descs.slice(0, 4).map(d => titleCase(d.desc)).join(' · ')}{g.descs.length > 4 ? ` · +${g.descs.length - 4}` : ''}</span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h4 className="text-xs font-semibold text-zinc-400 mb-2 px-1">Nome do produto</h4>
            <div className="space-y-1.5" role="radiogroup" aria-label="Nome do produto">
              {options.map(o => (
                <label key={o.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 min-h-[48px] cursor-pointer transition-colors ${effectivePick === o.id ? 'border-luxury-gold/40 bg-luxury-gold/[0.06]' : 'border-white/5 bg-white/[0.02]'}`} data-testid="unify-name-option">
                  <input type="radio" name="unify-name" checked={effectivePick === o.id} onChange={() => setPick(o.id)} className="w-4 h-4 shrink-0 accent-[#D4AF37]" />
                  <span className="min-w-0 flex-1 text-sm font-semibold text-zinc-100 break-words">{titleCase(o.name)}</span>
                  <span className="shrink-0 text-xs text-zinc-500">{plural(o.count, 'compra', 'compras')}</span>
                </label>
              ))}
              <label className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 min-h-[48px] cursor-pointer transition-colors ${effectivePick === CUSTOM ? 'border-luxury-gold/40 bg-luxury-gold/[0.06]' : 'border-white/5 bg-white/[0.02]'}`}>
                <input type="radio" name="unify-name" checked={effectivePick === CUSTOM} onChange={() => setPick(CUSTOM)} className="w-4 h-4 shrink-0 accent-[#D4AF37]" aria-label="Outro nome" />
                <input type="text" value={custom} placeholder="Outro nome" data-testid="unify-name-custom"
                  onFocus={() => setPick(CUSTOM)} onChange={e => { setCustom(e.target.value); setPick(CUSTOM); }}
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-luxury-gold placeholder:text-zinc-500 placeholder:font-medium outline-none" />
              </label>
            </div>
          </section>

          <section>
            <h4 className="text-xs font-semibold text-zinc-400 mb-2 px-1">Categoria</h4>
            <select value={category} onChange={e => setCatPick(e.target.value)} data-testid="unify-category"
              className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-3 text-[13px] text-zinc-200 focus:border-luxury-gold/50 outline-none font-medium">
              {categoryList.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <p className="text-xs text-zinc-500 mt-1.5 px-1">Todas as compras desses itens passam para esta categoria.</p>
          </section>
        </div>

        <div className="p-4 sm:p-5 border-t border-white/5 space-y-3">
          <p className="text-xs text-zinc-400 text-center" data-testid="unify-summary">
            {checked.length < 2
              ? 'Marque pelo menos 2 itens.'
              : `${plural(checked.length, 'item', 'itens')} · ${plural(totals.names, 'nome', 'nomes')} no cupom · ${plural(totals.buys, 'compra', 'compras')} viram 1 produto`}
          </p>
          <div className="flex gap-3">
            <button type="button" disabled={!canApply} data-testid="unify-apply"
              onClick={() => onConfirm({ groups: checked, name, category })}
              className="flex-1 py-4 rounded-xl font-bold text-[11px] uppercase tracking-[0.08em] bg-luxury-gold text-black hover:bg-white transition-colors disabled:opacity-40 disabled:hover:bg-luxury-gold">
              {checked.length >= 2 ? `Unificar ${checked.length} em 1` : 'Unificar'}
            </button>
            <button type="button" onClick={onClose} className="w-28 sm:w-36 py-4 rounded-xl bg-white/5 border border-white/10 text-zinc-300 font-bold text-[11px] uppercase tracking-[0.08em] hover:bg-white/10 transition-colors">
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ───────────────────────── sugestões ───────────────────────── */

interface DupProps {
  clusters: DupCluster[];
  covered?: boolean; // outra folha aberta por cima
  onPick: (c: DupCluster) => void;
  onIgnore: (c: DupCluster) => void;
  onClose: () => void;
}

export const ProductDupSheet: React.FC<DupProps> = ({ clusters, covered, onPick, onIgnore, onClose }) => {
  useEscape(onClose, covered);

  return (
    <div className="fixed inset-0 z-[250] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md animate-in fade-in duration-150" onClick={onClose} data-testid="dup-sheet">
      <div role="dialog" aria-modal="true" aria-labelledby="dup-title" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-xl max-h-[92dvh] flex flex-col bg-[#0c0c0e] border border-luxury-gold/30 rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl">
        <div className="flex items-start gap-3 p-5 sm:p-6 border-b border-white/5">
          <div className="shrink-0 w-10 h-10 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold flex items-center justify-center"><Sparkles className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <h3 id="dup-title" className="text-lg font-serif text-white tracking-tight">Produtos parecidos</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Nomes quase iguais que talvez sejam o mesmo item. Você decide o que unificar.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <ul className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-3" data-testid="dup-list">
          {clusters.length === 0 && (
            <li className="py-12 px-6 text-center text-sm text-zinc-400" data-testid="dup-empty">Nenhum produto parecido por agora.</li>
          )}
          {clusters.map(c => (
            <li key={c.id} className="rounded-2xl border border-white/5 bg-white/[0.02] p-3.5" data-testid="dup-cluster">
              <p className="text-xs text-zinc-500 mb-2">{plural(c.groups.length, 'produto', 'produtos')} · {plural(c.count, 'compra', 'compras')}</p>
              <ul className="space-y-1">
                {c.groups.slice(0, 5).map(g => (
                  <li key={g.key} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-sm font-semibold text-zinc-100 break-words">{titleCase(g.name)}</span>
                    <span className="shrink-0 text-xs text-zinc-500 tabular-nums">{g.count}×</span>
                  </li>
                ))}
                {c.groups.length > 5 && <li className="text-xs text-zinc-500">e mais {c.groups.length - 5}</li>}
              </ul>
              <div className="flex gap-2 mt-3">
                <button type="button" onClick={() => onPick(c)} data-testid="dup-pick"
                  className="flex-1 py-3 rounded-xl bg-luxury-gold text-black font-bold text-[11px] uppercase tracking-[0.08em] hover:bg-white transition-colors">
                  Unificar…
                </button>
                <button type="button" onClick={() => onIgnore(c)} data-testid="dup-ignore"
                  className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-zinc-300 font-bold text-[11px] uppercase tracking-[0.08em] hover:bg-white/10 transition-colors">
                  Não é o mesmo
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="p-4 sm:p-5 border-t border-white/5">
          <button type="button" onClick={onClose} className="w-full py-4 rounded-xl bg-white/5 border border-white/10 text-zinc-300 font-bold text-[11px] uppercase tracking-[0.08em] hover:bg-white/10 transition-colors">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
