import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ListChecks, Check, Search, ArrowRight } from 'lucide-react';
import { MasterProduct, Receipt, TaxonomyNode } from '../types';
import {
  AlignChoice, AlignRow, buildAlignIndex, buildAlignPlan, defaultAccepted, loadAliases, pendingRows, spellingRows, structureCategories,
} from '../services/categoryAlign';
import { fold } from '../services/itemSearch';
import { titleCase } from '../services/textFormat';

/* Alinhar categorias: a Estrutura de Taxonomia é a lista certa; aqui cada nome antigo que está nos cupons ganha a categoria
   dela. O app já vem com a melhor escolha marcada (certeza e "conferir"); o que não achou fica desmarcado para a pessoa
   escolher na lista. Nada se perde: os itens, o catálogo, as metas, os filtros e os recortes passam para a categoria nova. */

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const crumbs = (path: string) => path.split(' - ').join(' › ');

const Box: React.FC<{ on: boolean }> = ({ on }) => (
  <span className={`shrink-0 w-[18px] h-[18px] rounded-md border flex items-center justify-center ${on ? 'border-luxury-gold bg-luxury-gold text-black' : 'border-white/20'}`}>
    {on && <Check className="w-3 h-3" strokeWidth={3} />}
  </span>
);

const Shell: React.FC<{ title: string; hint?: string; onClose: () => void; testId: string; children: React.ReactNode; footer?: React.ReactNode }> = ({ title, hint, onClose, testId, children, footer }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-150" onClick={onClose} data-testid={testId}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[90dvh] flex flex-col bg-[#0c0c0e] border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] shadow-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="shrink-0 w-9 h-9 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold flex items-center justify-center"><ListChecks className="w-4 h-4" /></div>
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

interface Props {
  taxonomy: TaxonomyNode[];
  receipts: Receipt[];
  masters?: MasterProduct[];
  onApply: (choices: AlignChoice[], summary: string) => void;
  onClose: () => void;
}

const SECTIONS: { id: 'alta' | 'media' | 'resto'; title: string; hint: string }[] = [
  { id: 'alta', title: 'Certeza', hint: 'O nome é o mesmo ou quase: só mudou o departamento ou a escrita.' },
  { id: 'media', title: 'Conferir', hint: 'Veio de uma lista antiga. Veja se a categoria sugerida serve.' },
  { id: 'resto', title: 'Escolher', hint: 'Não achei uma categoria segura. Toque em “Escolher” para indicar a certa.' },
];

const sectionOf = (r: AlignRow): 'alta' | 'media' | 'resto' => (r.conf === 'alta' ? 'alta' : r.conf === 'media' ? 'media' : 'resto');

const AlignCategoriesSheet: React.FC<Props> = ({ taxonomy, receipts, masters = [], onApply, onClose }) => {
  const index = useMemo(() => buildAlignIndex(taxonomy), [taxonomy]);
  const aliases = useMemo(() => loadAliases(), []);
  const plan = useMemo(() => buildAlignPlan(taxonomy, receipts, masters, aliases, index), [taxonomy, receipts, masters, aliases, index]);
  const pending = useMemo(() => pendingRows(plan), [plan]);
  const spelling = useMemo(() => spellingRows(plan), [plan]);
  const defaults = useMemo(() => defaultAccepted(plan), [plan]);

  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [over, setOver] = useState<Record<string, string>>({});
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const targetOf = (r: AlignRow): string | null => over[r.key] ?? r.to;
  const isOn = (r: AlignRow): boolean => !!targetOf(r) && (sel[r.key] ?? defaults.has(r.key));

  const choices: AlignChoice[] = useMemo(() => {
    const out: AlignChoice[] = [];
    plan.rows.forEach(r => {
      if (r.same) return;
      const to = over[r.key] ?? r.to;
      if (!to) return;
      const on = r.conf === 'igual' ? true : (sel[r.key] ?? defaults.has(r.key));
      if (on) out.push({ key: r.key, from: r.from, variants: r.variants, to });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, sel, over, defaults]);
  const itemsAffected = useMemo(() => {
    const on = new Set(choices.map(c => c.key));
    return plan.rows.reduce((s, r) => s + (on.has(r.key) ? r.items : 0), 0);
  }, [plan, choices]);

  const apply = () => {
    if (choices.length === 0) return;
    const n = choices.length;
    onApply(choices, `${n} ${n === 1 ? 'categoria alinhada' : 'categorias alinhadas'} à Estrutura`);
    setDone(`${n} ${n === 1 ? 'nome alinhado' : 'nomes alinhados'}: ${itemsAffected} ${itemsAffected === 1 ? 'item passou' : 'itens passaram'} para a categoria da Estrutura.`);
    setSel({}); setOver({});
  };

  const pickRow = pickFor ? plan.rows.find(r => r.key === pickFor) : null;
  const options = useMemo(() => {
    if (!pickRow) return [];
    const q = fold(query);
    const all = structureCategories(taxonomy);
    const first = pickRow.alts.map(a => a.path).filter(p => all.includes(p));
    const list = q ? all.filter(p => fold(p).includes(q)) : all;
    const head = q ? [] : first;
    return [...head, ...list.filter(p => !head.includes(p))].slice(0, 150);
  }, [pickRow, taxonomy, query]);

  if (pickRow) {
    const cur = targetOf(pickRow);
    return (
      <Shell title="Escolher a categoria" onClose={() => { setPickFor(null); setQuery(''); }} testId="align-pick"
        hint={`Para “${titleCase(pickRow.from)}” (${pickRow.items} ${pickRow.items === 1 ? 'item' : 'itens'}).`}
        footer={<div className="pb-1"><button type="button" onClick={() => { setPickFor(null); setQuery(''); }} className="w-full h-11 rounded-xl border border-white/10 bg-white/5 text-zinc-300 text-sm font-bold" data-testid="align-pick-back">Voltar</button></div>}>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar na Estrutura" autoComplete="off" spellCheck={false} data-testid="align-pick-search"
            className="w-full bg-white/5 border border-white/5 rounded-xl py-2.5 pl-10 pr-3 text-[13px] text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-luxury-gold/40" />
        </div>
        <ul className="divide-y divide-white/5">
          {options.length === 0 && <li className="py-8 text-center text-sm text-zinc-500">Nenhuma categoria{query ? ` com “${query.trim()}”` : ''}.</li>}
          {options.map(p => (
            <li key={p}>
              <button type="button" data-testid="align-pick-option" data-path={p} aria-pressed={cur === p}
                onClick={() => { setOver(o => ({ ...o, [pickRow.key]: p })); setSel(s => ({ ...s, [pickRow.key]: true })); setPickFor(null); setQuery(''); }}
                className="w-full text-left py-2.5 min-h-[48px] flex items-center gap-3">
                <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-zinc-100 leading-tight break-words">{crumbs(p)}</span>
                {cur === p && <span className="shrink-0 text-[11px] font-bold text-luxury-gold">Escolhida</span>}
              </button>
            </li>
          ))}
        </ul>
      </Shell>
    );
  }

  const groups = SECTIONS.map(s => ({ ...s, rows: pending.filter(r => sectionOf(r) === s.id) })).filter(g => g.rows.length > 0);

  return (
    <Shell title="Alinhar categorias" onClose={onClose} testId="align-sheet"
      hint="A Estrutura de Taxonomia é a lista certa. Os nomes antigos dos cupons passam para ela; nada se perde."
      footer={<div className="flex items-center justify-between gap-3 pb-1">
        <span className="text-xs text-zinc-500 tabular-nums" data-testid="align-count">
          {choices.length === 0 ? 'Nada marcado' : `${choices.length} ${choices.length === 1 ? 'nome' : 'nomes'} · ${itemsAffected} ${itemsAffected === 1 ? 'item' : 'itens'}`}
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="h-11 px-4 rounded-xl border border-white/10 bg-white/5 text-zinc-300 text-sm font-bold" data-testid="align-close">Fechar</button>
          <button type="button" onClick={apply} disabled={choices.length === 0} data-testid="align-apply"
            className="h-11 px-5 rounded-xl bg-luxury-gold text-black text-sm font-bold disabled:opacity-40">Alinhar</button>
        </div>
      </div>}>
      {done && (
        <div className="mb-3 rounded-2xl border border-luxury-gold/40 bg-luxury-gold/5 p-3.5" data-testid="align-done" role="status">
          <p className="text-[13px] font-semibold text-zinc-100 flex items-center gap-1.5"><Check className="w-4 h-4 text-luxury-gold shrink-0" /> Pronto</p>
          <p className="text-[12px] text-zinc-400 mt-0.5 leading-snug">{done}</p>
        </div>
      )}
      <div className="mb-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5" data-testid="align-summary">
        {pending.length === 0 && spelling.length === 0 ? (
          <p className="text-sm text-zinc-200 font-semibold">Tudo alinhado</p>
        ) : (
          <p className="text-[13px] text-zinc-200 leading-snug">
            <span className="font-semibold">{pending.length + spelling.length} {pending.length + spelling.length === 1 ? 'nome' : 'nomes'} de categoria</span> nos seus cupons {pending.length + spelling.length === 1 ? 'não está' : 'não estão'} escritos como na Estrutura.
          </p>
        )}
        <p className="text-[11.5px] text-zinc-500 mt-1 leading-snug">{plan.itemsSame} de {plan.items} itens já estão em categorias da Estrutura.</p>
      </div>

      {pending.length === 0 && spelling.length === 0 && (
        <div className="py-8 text-center" data-testid="align-empty">
          <p className="text-xs text-zinc-500">Cupom novo com nome antigo já entra na categoria certa.</p>
        </div>
      )}

      {groups.map(g => (
        <section key={g.id} className="mb-4" data-testid="align-section" data-section={g.id}>
          <h4 className="text-[13px] font-semibold text-zinc-100">{g.title} <span className="text-zinc-500 font-normal tabular-nums">· {g.rows.length}</span></h4>
          <p className="text-[11.5px] text-zinc-500 mt-0.5 mb-2 leading-snug">{g.hint}</p>
          <ul className="space-y-2">
            {g.rows.map(r => {
              const to = targetOf(r);
              const on = isOn(r);
              return (
                <li key={r.key} data-testid="align-row" data-key={r.key} data-conf={r.conf} data-on={on ? 'true' : 'false'}
                  className={`rounded-2xl border p-3 ${on ? 'border-luxury-gold/40 bg-luxury-gold/5' : 'border-white/10 bg-white/[0.03]'}`}>
                  <div className="flex items-start gap-2.5">
                    <button type="button" role="checkbox" aria-checked={on} aria-label={`Alinhar ${r.from}`} disabled={!to}
                      onClick={() => setSel(s => ({ ...s, [r.key]: !on }))} data-testid="align-check"
                      className="shrink-0 w-8 h-8 -ml-1 flex items-center justify-center disabled:opacity-30"><Box on={on} /></button>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-zinc-400 leading-tight break-words" data-testid="align-from">{crumbs(titleCase(r.from))}</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5 tabular-nums">{r.items} {r.items === 1 ? 'item' : 'itens'}{r.total > 0 ? ` · ${brl(r.total)}` : ''}</p>
                      <p className="mt-1.5 flex items-start gap-1.5 text-[13.5px] font-semibold leading-tight break-words" data-testid="align-to">
                        <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-500" />
                        <span className={to ? 'text-zinc-100' : 'text-zinc-500 font-normal'}>{to ? crumbs(to) : 'Sem categoria na Estrutura'}</span>
                      </p>
                      {to && r.conf !== 'alta' && !over[r.key] && <p className="text-[11px] text-zinc-500 mt-1 leading-snug">{r.reason}</p>}
                      {r.fromAlias && !over[r.key] && <p className="text-[11px] text-zinc-500 mt-1 leading-snug">Escolha sua de antes.</p>}
                    </div>
                    <button type="button" onClick={() => { setPickFor(r.key); setQuery(''); }} data-testid="align-change"
                      className="shrink-0 h-9 px-3 rounded-xl border border-white/10 bg-white/5 text-[12px] font-bold text-zinc-200">{to ? 'Trocar' : 'Escolher'}</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {spelling.length > 0 && (
        <p className="text-[11.5px] text-zinc-500 leading-snug" data-testid="align-spelling">
          Mais {spelling.length} {spelling.length === 1 ? 'nome só muda' : 'nomes só mudam'} maiúsculas, acentos ou plural (como “HORTIFRUTI - Frutas”); {spelling.length === 1 ? 'é acertado' : 'são acertados'} junto.
        </p>
      )}
    </Shell>
  );
};

export default AlignCategoriesSheet;
