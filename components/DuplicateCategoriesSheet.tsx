import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, GitMerge, Check, Search, Sparkles } from 'lucide-react';
import { Receipt, TaxonomyNode } from '../types';
import {
  DupGroup, MergeResult, Usage, detectDuplicates, mergeIdentical, mergeMany, pathNames, suggestKeeper, usageByKey, usageOfNode, visibleDuplicates,
} from '../services/taxonomyDedupe';
import { fold } from '../services/itemSearch';
import { titleCase } from '../services/textFormat';

/* Categorias repetidas: a lista do que parece a mesma categoria escrita duas vezes, para juntar com um toque,
   e a folha "Juntar com…" para escolher à mão (serve também para o que o app não percebe, como "Cuidados Pessoais" e
   "Higiene"). Juntar não perde nada: as compras, as metas e os filtros passam para a categoria que fica. */

const LEVEL_NAME: Record<number, string> = { 1: 'Departamento', 2: 'Categoria', 3: 'Grupo', 4: 'Item' };
const IGNORED_KEY = 'eukasconta_dup_cat_ignored';
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const loadIgnored = (): string[] => {
  try { const a = JSON.parse(localStorage.getItem(IGNORED_KEY) || '[]'); return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
};
const saveIgnored = (ids: string[]) => { try { localStorage.setItem(IGNORED_KEY, JSON.stringify(ids)); } catch { /* vale só até fechar */ } };

const Shell: React.FC<{ title: string; hint?: string; onClose: () => void; testId: string; children: React.ReactNode; footer?: React.ReactNode }> = ({ title, hint, onClose, testId, children, footer }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-150" onClick={onClose} data-testid={testId}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[90dvh] flex flex-col bg-[#0c0c0e] border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] shadow-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="shrink-0 w-9 h-9 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold flex items-center justify-center"><GitMerge className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-serif text-white tracking-tight leading-tight">{title}</h3>
            {hint && <p className="text-xs text-zinc-400 mt-0.5 leading-snug">{hint}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-2">{children}</div>
        {footer && <div className="px-5 pt-3 border-t border-white/5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

const Radio: React.FC<{ on: boolean }> = ({ on }) => (
  <span className={`shrink-0 w-[18px] h-[18px] rounded-full border flex items-center justify-center ${on ? 'border-luxury-gold bg-luxury-gold/15' : 'border-white/20'}`}>
    {on && <span className="w-2 h-2 rounded-full bg-luxury-gold" />}
  </span>
);

const Box: React.FC<{ on: boolean }> = ({ on }) => (
  <span className={`shrink-0 w-[18px] h-[18px] rounded-md border flex items-center justify-center ${on ? 'border-luxury-gold bg-luxury-gold text-black' : 'border-white/20'}`}>
    {on && <Check className="w-3 h-3" strokeWidth={3} />}
  </span>
);

const usageText = (u: Usage, kids: number): string => {
  const parts: string[] = [];
  if (u.items > 0) parts.push(`${u.items} ${u.items === 1 ? 'item comprado' : 'itens comprados'}${u.total > 0 ? ` · ${brl(u.total)}` : ''}`);
  if (kids > 0) parts.push(`${kids} ${kids === 1 ? 'subcategoria' : 'subcategorias'}`);
  return parts.join(' · ') || 'sem compras';
};

/* ───────────────────────── lista das repetidas ───────────────────────── */

interface ListProps {
  taxonomy: TaxonomyNode[];
  receipts: Receipt[];
  onApply: (res: MergeResult, summary: string) => void;
  onClose: () => void;
}

export const DuplicateCategoriesSheet: React.FC<ListProps> = ({ taxonomy, receipts, onApply, onClose }) => {
  const [ignored, setIgnored] = useState<string[]>(loadIgnored);
  const use = useMemo(() => usageByKey(receipts), [receipts]);
  const groups = useMemo(() => detectDuplicates(taxonomy), [taxonomy]);
  const { shown: all, pendingSimilar } = useMemo(() => visibleDuplicates(groups), [groups]);
  const shown = useMemo(() => all.filter(g => !ignored.includes(g.id)), [all, ignored]);
  const equalCount = shown.filter(g => g.kind === 'igual').length;
  const identicalPlan = useMemo(() => (equalCount > 0 ? mergeIdentical(taxonomy, use) : null), [taxonomy, use, equalCount]);

  // escolha de cada grupo: quem fica e quem entra
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [off, setOff] = useState<Record<string, string[]>>({});
  const byId = useMemo(() => new Map(taxonomy.map(n => [n.id, n] as const)), [taxonomy]);
  const keeperOf = (g: DupGroup) => keep[g.id] && g.members.some(m => m.id === keep[g.id]) ? keep[g.id] : suggestKeeper(g, taxonomy, use);
  const offOf = (g: DupGroup) => off[g.id] || [];

  const ignore = (g: DupGroup) => { const next = [...ignored, g.id]; setIgnored(next); saveIgnored(next); };

  const applyGroup = (g: DupGroup) => {
    const keepId = keeperOf(g);
    const drops = g.members.map(m => m.id).filter(id => id !== keepId && !offOf(g).includes(id));
    if (drops.length === 0) return;
    const res = mergeMany(taxonomy, [{ keepId, dropIds: drops }]);
    if (res.removed === 0) return;
    const k = byId.get(keepId);
    onApply(res, `${drops.length + 1} categorias juntadas em “${k ? titleCase(k.name) : ''}”`);
  };

  const applyIdentical = () => {
    if (!identicalPlan || identicalPlan.removed === 0) return;
    onApply(identicalPlan, `${identicalPlan.removed} categorias repetidas juntadas`);
  };

  return (
    <Shell title="Categorias repetidas" onClose={onClose} testId="dup-sheet"
      hint="Escolha qual fica. As compras, metas e filtros passam para ela — nada se perde."
      footer={<div className="flex items-center justify-between gap-3 pb-1">
        <span className="text-xs text-zinc-500 tabular-nums" data-testid="dup-count">{shown.length === 0 ? 'Nada para revisar' : `${shown.length} ${shown.length === 1 ? 'grupo' : 'grupos'}`}</span>
        <button type="button" onClick={onClose} className="h-11 px-6 rounded-xl bg-luxury-gold text-black text-sm font-bold" data-testid="dup-done">Pronto</button>
      </div>}>
      {equalCount > 0 && identicalPlan && (
        <div className="mb-3 rounded-2xl border border-luxury-gold/30 bg-luxury-gold/10 p-3.5" data-testid="dup-identical-card">
          <p className="text-[13px] font-semibold text-luxury-gold flex items-center gap-1.5"><Sparkles className="w-4 h-4" /> {equalCount} {equalCount === 1 ? 'grupo idêntico' : 'grupos idênticos'}</p>
          <p className="text-xs text-zinc-400 mt-1 leading-snug">Mesmo nome escrito duas vezes. Junto todos de uma vez, deixando a que tem mais compras ({identicalPlan.removed} {identicalPlan.removed === 1 ? 'sai da lista' : 'saem da lista'}).</p>
          <button type="button" onClick={applyIdentical} data-testid="dup-merge-identical"
            className="mt-2.5 w-full h-11 rounded-xl bg-luxury-gold text-black text-sm font-bold">Juntar todas as idênticas</button>
        </div>
      )}

      {shown.length === 0 && (
        <div className="py-10 text-center" data-testid="dup-empty">
          <p className="text-sm text-zinc-300 font-semibold">Nenhuma categoria repetida</p>
          <p className="text-xs text-zinc-500 mt-1">Para juntar duas que o app não percebeu, use o botão de juntar ao lado de cada categoria.</p>
        </div>
      )}

      <ul className="space-y-3">
        {shown.map(g => {
          const keeper = keeperOf(g);
          const off_ = offOf(g);
          const joining = g.members.filter(m => m.id !== keeper && !off_.includes(m.id)).length;
          return (
            <li key={g.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5" data-testid="dup-group" data-kind={g.kind} data-level={g.level}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${g.kind === 'igual' ? 'text-luxury-gold border-luxury-gold/40 bg-luxury-gold/10' : 'text-zinc-300 border-white/15 bg-white/5'}`}>{g.kind === 'igual' ? 'Idêntica' : 'Parecida'}</span>
                <span className="text-[11px] text-zinc-500">{LEVEL_NAME[g.level]}{g.parentPath ? ` em ${titleCase(g.parentPath)}` : ''}</span>
              </div>
              {g.kind === 'parecida' && <p className="text-[11.5px] text-zinc-500 mt-1 leading-snug">{g.reason}</p>}
              <ul className="mt-2 space-y-1.5">
                {g.members.map(m => {
                  const node = byId.get(m.id);
                  const u = node ? usageOfNode(node, taxonomy, use) : { items: 0, total: 0 };
                  const isKeeper = m.id === keeper;
                  const included = isKeeper || !off_.includes(m.id);
                  return (
                    <li key={m.id} data-testid="dup-member" data-keeper={isKeeper ? 'true' : 'false'}
                      className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 ${isKeeper ? 'border-luxury-gold/40 bg-luxury-gold/5' : 'border-white/10'}`}>
                      <button type="button" aria-label={isKeeper ? `${m.name} é a que fica` : `Deixar ${m.name}`} onClick={() => setKeep(s => ({ ...s, [g.id]: m.id }))} data-testid="dup-keep" className="shrink-0 w-8 h-8 flex items-center justify-center"><Radio on={isKeeper} /></button>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold text-zinc-100 leading-tight break-words">{titleCase(m.name)}</p>
                        <p className="text-[11px] text-zinc-500 leading-tight mt-0.5">{usageText(u, m.kids)}</p>
                      </div>
                      {isKeeper
                        ? <span className="shrink-0 text-[11px] font-bold text-luxury-gold">Fica</span>
                        : <button type="button" onClick={() => setOff(s => { const cur = s[g.id] || []; return { ...s, [g.id]: cur.includes(m.id) ? cur.filter(x => x !== m.id) : [...cur, m.id] }; })}
                            aria-label={included ? `Não juntar ${m.name}` : `Juntar ${m.name}`} aria-pressed={included} data-testid="dup-include"
                            className="shrink-0 h-8 pl-1.5 pr-2 flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400"><Box on={included} /> Juntar</button>}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => ignore(g)} data-testid="dup-ignore"
                  className="h-10 rounded-xl border border-white/10 bg-white/5 text-zinc-300 text-xs font-bold">Manter separadas</button>
                <button type="button" onClick={() => applyGroup(g)} disabled={joining === 0} data-testid="dup-merge"
                  className="h-10 rounded-xl bg-luxury-gold text-black text-xs font-bold disabled:opacity-40 truncate px-2">
                  {joining === 0 ? 'Nada a juntar' : `Juntar as ${joining + 1}`}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {pendingSimilar > 0 && (
        <p className="mt-3 text-[11.5px] text-zinc-500 leading-snug" data-testid="dup-pending">Mais {pendingSimilar} {pendingSimilar === 1 ? 'parecida aparece' : 'parecidas aparecem'} depois de juntar as idênticas.</p>
      )}
      {ignored.length > 0 && (
        <button type="button" onClick={() => { setIgnored([]); saveIgnored([]); }} className="mt-3 text-[11.5px] text-zinc-500 underline underline-offset-2">Mostrar de novo as que mandei manter separadas ({ignored.length})</button>
      )}
    </Shell>
  );
};

/* ───────────────────────── juntar com… (à mão) ───────────────────────── */

interface WithProps {
  taxonomy: TaxonomyNode[];
  receipts: Receipt[];
  sourceId: string;
  onApply: (res: MergeResult, summary: string) => void;
  onClose: () => void;
}

export const MergeWithSheet: React.FC<WithProps> = ({ taxonomy, receipts, sourceId, onApply, onClose }) => {
  const byId = useMemo(() => new Map(taxonomy.map(n => [n.id, n] as const)), [taxonomy]);
  const source = byId.get(sourceId);
  const use = useMemo(() => usageByKey(receipts), [receipts]);
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [keepSource, setKeepSource] = useState(false);

  const isUnder = (id: string, ancestor: string): boolean => {
    let cur = byId.get(id); const seen = new Set<string>();
    while (cur && cur.parentId && !seen.has(cur.id)) { if (cur.parentId === ancestor) return true; seen.add(cur.id); cur = byId.get(cur.parentId); }
    return false;
  };

  const options = useMemo(() => {
    if (!source) return [];
    const q = fold(query);
    return taxonomy
      .filter(n => n.level === source.level && n.id !== source.id && !isUnder(n.id, source.id) && !isUnder(source.id, n.id))
      .map(n => ({ node: n, path: pathNames(n, byId).map(titleCase).join(' › ') }))
      .filter(o => !q || fold(o.path).includes(q))
      .sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'))
      .slice(0, 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxonomy, source, query]);

  if (!source) return null;
  const target = targetId ? byId.get(targetId) : null;
  const srcUse = usageOfNode(source, taxonomy, use);

  const apply = () => {
    if (!target) return;
    const keepId = keepSource ? source.id : target.id;
    const dropId = keepSource ? target.id : source.id;
    const res = mergeMany(taxonomy, [{ keepId, dropIds: [dropId] }]);
    if (res.removed === 0) return;
    onApply(res, `“${titleCase(source.name)}” juntada com “${titleCase(target.name)}”`);
  };

  return (
    <Shell title={target ? 'Juntar estas duas?' : `Juntar “${titleCase(source.name)}” com…`} onClose={onClose} testId="merge-with-sheet"
      hint={target ? 'As subcategorias de uma passam para a outra; as de mesmo nome se juntam.' : `Escolha ${source.level === 1 ? 'o departamento' : 'a categoria'} que vai ficar junto com ela.`}
      footer={target ? (
        <div className="grid grid-cols-2 gap-2 pb-1">
          <button type="button" onClick={() => setTargetId(null)} className="h-11 rounded-xl border border-white/10 bg-white/5 text-zinc-300 text-sm font-bold" data-testid="merge-with-back">Voltar</button>
          <button type="button" onClick={apply} className="h-11 rounded-xl bg-luxury-gold text-black text-sm font-bold" data-testid="merge-with-apply">Juntar</button>
        </div>
      ) : undefined}>
      {!target ? (
        <>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar" autoComplete="off" spellCheck={false} data-testid="merge-with-search"
              className="w-full bg-white/5 border border-white/5 rounded-xl py-2.5 pl-10 pr-3 text-[13px] text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-luxury-gold/40" />
          </div>
          <ul className="divide-y divide-white/5">
            {options.length === 0 && <li className="py-8 text-center text-sm text-zinc-500">Nenhuma opção{query ? ` com “${query.trim()}”` : ''}.</li>}
            {options.map(o => (
              <li key={o.node.id}>
                <button type="button" onClick={() => { setTargetId(o.node.id); setKeepSource(false); }} data-testid="merge-with-option"
                  className="w-full text-left py-2.5 min-h-[48px]">
                  <p className="text-[13.5px] font-semibold text-zinc-100 leading-tight break-words">{o.path}</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">{usageText(usageOfNode(o.node, taxonomy, use), taxonomy.filter(n => n.parentId === o.node.id).length)}</p>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="space-y-2" data-testid="merge-with-confirm">
          {[{ n: target, keepIt: !keepSource }, { n: source, keepIt: keepSource }].map(({ n, keepIt }) => (
            <button key={n.id} type="button" onClick={() => setKeepSource(n.id === source.id)} aria-pressed={keepIt} data-testid="merge-with-pick"
              className={`w-full text-left flex items-center gap-3 rounded-2xl border px-3.5 py-3 ${keepIt ? 'border-luxury-gold/40 bg-luxury-gold/5' : 'border-white/10'}`}>
              <Radio on={keepIt} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-zinc-100 leading-tight break-words">{pathNames(n, byId).map(titleCase).join(' › ')}</span>
                <span className="block text-[11px] text-zinc-500 mt-0.5">{usageText(usageOfNode(n, taxonomy, use), taxonomy.filter(k => k.parentId === n.id).length)}</span>
              </span>
              <span className={`shrink-0 text-[11px] font-bold ${keepIt ? 'text-luxury-gold' : 'text-zinc-500'}`}>{keepIt ? 'Fica' : 'Sai'}</span>
            </button>
          ))}
          <p className="text-[11.5px] text-zinc-500 leading-snug pt-1">
            {srcUse.items > 0 || (target && usageOfNode(target, taxonomy, use).items > 0) ? 'Os itens comprados nas duas passam a contar na que fica.' : 'Nenhuma das duas tem compras ainda.'}
          </p>
        </div>
      )}
    </Shell>
  );
};
