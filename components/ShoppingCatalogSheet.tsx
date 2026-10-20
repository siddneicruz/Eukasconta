import React, { useMemo, useState } from 'react';
import { Check, Dices, Search } from 'lucide-react';
import { History, unitLabel } from '../services/shoppingList';
import { CatClass, CatGroup, CLASS_LABEL, CLASS_ORDER, GROUP_LABEL, PoolItem, buildPool, shuffled } from '../services/shoppingCatalog';
import { Sheet, brl } from './ShoppingSheets';

/* Catálogo para marcar vários itens de uma vez: frutas, verduras e legumes, ou carnes do churrasco.
   Mostra o que você já comprou (com o último preço) e também o que nunca comprou.
   Dois usos: escolher o "cardápio" do formulário (o sistema sorteia o que entra em cada semana) e
   adicionar itens direto num período da lista. */

interface Props {
  group: CatGroup;
  history: History;
  /** 'pool' = cardápio do formulário; 'add' = itens para um período da lista */
  mode: 'pool' | 'add';
  title: string;
  subtitle?: string;
  /** já marcados ao abrir */
  selected?: string[];
  /** itens que já estão no período (não dá para marcar de novo) */
  taken?: string[];
  /** quantos o sistema sorteia por semana (só no modo cardápio) */
  perWeek?: number;
  onConfirm: (ids: string[]) => void;
  onClose: () => void;
}

type Filter = 'todas' | 'minhas' | 'novas';
const FILTERS: { id: Filter; label: string }[] = [{ id: 'todas', label: 'Todas' }, { id: 'minhas', label: 'Já comprei' }, { id: 'novas', label: 'Nunca comprei' }];

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const ShoppingCatalogSheet: React.FC<Props> = ({ group, history, mode, title, subtitle, selected = [], taken = [], perWeek = 0, onConfirm, onClose }) => {
  const pool = useMemo(() => buildPool(history, group), [history, group]);
  const [sel, setSel] = useState<string[]>(() => selected.filter(id => pool.some(i => i.id === id) && !taken.includes(id)));
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('todas');
  const [cls, setCls] = useState<CatClass | 'todas'>('todas');

  const classes = useMemo(() => (group === 'carne' ? CLASS_ORDER.filter(c => pool.some(i => i.cls === c)) : []), [group, pool]);
  const visible = useMemo(() => {
    const tokens = fold(q).split(' ').filter(Boolean);
    return pool.filter(i => {
      if (filter === 'minhas' && !i.bought) return false;
      if (filter === 'novas' && i.bought) return false;
      if (cls !== 'todas' && i.cls !== cls) return false;
      if (!tokens.length) return true;
      const f = fold(i.name);
      return tokens.every(t => f.includes(t));
    });
  }, [pool, q, filter, cls]);

  const free = (i: PoolItem) => !taken.includes(i.id);
  const pickable = visible.filter(free);
  const allVisibleOn = pickable.length > 0 && pickable.every(i => sel.includes(i.id));
  const toggle = (id: string) => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  const markVisible = () => setSel(s => (allVisibleOn ? s.filter(id => !pickable.some(i => i.id === id)) : [...s, ...pickable.map(i => i.id).filter(id => !s.includes(id))]));

  // sortear: no cardápio, uma amostra de 3 semanas; ao adicionar, 3 itens
  const draw = mode === 'pool' ? Math.max(3, perWeek * 3) : 3;
  const drawN = Math.min(draw, pickable.length);
  const roll = () => {
    const seed = Math.floor(Math.random() * 1e9);
    setSel(shuffled(pickable.map(i => i.id), seed).slice(0, drawN));
  };

  const n = sel.length;
  const summary = mode === 'pool'
    ? (n === 0 ? 'Nada marcado: o sistema escolhe pelo seu histórico.'
      : perWeek > 0 && n > perWeek ? `Sorteia ${perWeek} por semana entre as ${n} marcadas.`
        : `As ${n} marcadas entram em toda semana.`)
    : (n === 0 ? 'Toque nos itens para marcar.' : `${n} ${plural(n, 'item marcado', 'itens marcados')}.`);
  const confirmLabel = mode === 'pool'
    ? (n === 0 ? 'Deixar automático' : `Usar ${n} ${plural(n, 'marcada', 'marcadas')}`)
    : (n === 0 ? 'Adicionar' : `Adicionar ${n}`);

  const footer = (
    <div className="pb-1">
      <p className="text-[11px] text-zinc-400 mb-2 leading-snug tabular-nums" data-testid="cat-summary" aria-live="polite">{summary}</p>
      <button type="button" data-testid="cat-confirm" disabled={mode === 'add' && n === 0} onClick={() => onConfirm(sel)}
        className="w-full h-12 rounded-xl bg-luxury-gold text-black text-[14px] font-bold active:opacity-80 disabled:opacity-40">{confirmLabel}</button>
    </div>
  );

  const chip = (on: boolean) => `shrink-0 h-9 px-3 rounded-full border text-[12px] font-semibold transition-colors ${on ? 'bg-luxury-gold text-black border-luxury-gold' : 'border-white/10 text-zinc-300'}`;

  return (
    <Sheet title={title} subtitle={subtitle} onClose={onClose} testId="cat-sheet" tall footer={footer}>
      <div className="sticky top-0 z-10 bg-[#0c0c0e] pb-2 -mx-5 px-5">
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input data-testid="cat-search" value={q} onChange={e => setQ(e.target.value)} enterKeyHint="done" onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} placeholder={`Procurar em ${GROUP_LABEL[group].toLowerCase()}`} aria-label="Procurar no catálogo"
            className="w-full h-11 rounded-xl bg-white/5 border border-white/10 pl-9 pr-3 text-[15px] text-white outline-none focus:border-luxury-gold/60 placeholder:text-zinc-500" />
        </div>
        <div className="flex gap-1.5 mt-2 overflow-x-auto -mx-5 px-5 pb-0.5" role="group" aria-label="Filtro">
          {FILTERS.map(f => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} data-testid={`cat-filter-${f.id}`} onClick={() => setFilter(f.id)} className={chip(filter === f.id)}>{f.label}</button>
          ))}
        </div>
      </div>

      <div className="pb-1">
        {classes.length > 1 && (
          <div className="flex gap-1.5 mb-1.5 overflow-x-auto -mx-5 px-5 pb-0.5" role="group" aria-label="Tipo de carne">
            <button type="button" aria-pressed={cls === 'todas'} data-testid="cat-class-todas" onClick={() => setCls('todas')} className={chip(cls === 'todas')}>Todos os tipos</button>
            {classes.map(c => (
              <button key={c} type="button" aria-pressed={cls === c} data-testid={`cat-class-${c}`} onClick={() => setCls(c)} className={chip(cls === c)}>{CLASS_LABEL[c]}</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 mb-1">
          <button type="button" data-testid="cat-roll" disabled={drawN === 0} onClick={roll}
            className="h-9 px-3 rounded-xl border border-luxury-gold/40 text-luxury-gold text-[12px] font-semibold flex items-center gap-1.5 active:bg-luxury-gold/10 disabled:opacity-30">
            <Dices className="w-4 h-4" /> Sortear {drawN}
          </button>
          <button type="button" data-testid="cat-mark-all" disabled={pickable.length === 0} onClick={markVisible}
            className="h-9 px-3 rounded-xl text-[12px] font-semibold text-zinc-300 active:text-luxury-gold disabled:opacity-30">{allVisibleOn ? 'Desmarcar' : 'Marcar'} {pickable.length} {plural(pickable.length, 'visível', 'visíveis')}</button>
          {n > 0 && <button type="button" data-testid="cat-clear" onClick={() => setSel([])} className="h-9 px-2 ml-auto text-[12px] font-semibold text-zinc-500 active:text-rose-400">Limpar</button>}
        </div>
      </div>

      <ul className="mb-2" data-testid="cat-list">
        {visible.map(i => {
          const on = sel.includes(i.id);
          const blocked = !free(i);
          return (
            <li key={i.id}>
              <button type="button" data-testid="cat-row" data-id={i.id} aria-pressed={on} disabled={blocked} onMouseDown={e => e.preventDefault()} onClick={() => toggle(i.id)}
                className={`w-full text-left flex items-center gap-3 min-h-[52px] px-2 py-1.5 rounded-2xl active:bg-white/10 ${blocked ? 'opacity-40' : 'hover:bg-white/5'}`}>
                <span className={`shrink-0 w-6 h-6 rounded-md border flex items-center justify-center ${on || blocked ? 'bg-luxury-gold border-luxury-gold text-black' : 'border-white/20'}`}>
                  {(on || blocked) && <Check className="w-4 h-4" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-zinc-100 truncate">{i.name}</span>
                  <span className="block text-[11px] text-zinc-500 tabular-nums truncate">
                    {blocked ? 'Já está neste período'
                      : i.bought ? `Comprou ${i.buys}× · ${brl(i.price)}/${unitLabel(i.unit)}`
                        : `Nunca comprou · sem preço${group === 'carne' && i.cls ? ` · ${CLASS_LABEL[i.cls]}` : ''}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!visible.length && <p className="text-[12px] text-zinc-500 py-4 text-center" data-testid="cat-empty">Nada com esse nome. Tente outra palavra ou mude o filtro.</p>}
    </Sheet>
  );
};

export default ShoppingCatalogSheet;
