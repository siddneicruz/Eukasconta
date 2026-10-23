import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { ReceiptItem } from '../types';
import { getCategoryColor, getCategoryIcon } from './Dashboard';
import ItemCategoryPicker from './ItemCategoryPicker';
import EggCountPicker from './EggCountPicker';
import { useLayers } from './LayersContext';
import { isEggItem } from '../services/eggs';
import { leafFor } from '../services/categoryLayers';
import { titleCase } from '../services/textFormat';

/* O cupom "Estruturado", no mesmo jeito compacto da edição: uma linha por categoria (com a fatia do total), e dentro dela
   linhas pequenas por item que abrem para ver o código e trocar a categoria. */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const qtyFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const NONE = 'Outros - Não Classificado';

interface Row { item: ReceiptItem; idx: number }
interface Group { category: string; rows: Row[]; total: number }

interface Props {
  items: ReceiptItem[];
  totalAmount: number;
  categories: string[];
  onEditItem: (index: number, newCategory: string) => void;
  onEggCount?: (index: number, count: number | undefined) => void;
  eggSame?: (index: number) => number;
  onEggApplySame?: (index: number) => void;
}

const splitCategory = (cat: string): { dept: string; name: string } => {
  const i = cat.indexOf(' - ');
  return i > 0 ? { dept: cat.slice(0, i), name: cat.slice(i + 3) } : { dept: '', name: cat };
};

const ReceiptStructuredView: React.FC<Props> = ({ items, totalAmount, categories, onEditItem, onEggCount, eggSame, onEggApplySame }) => {
  const layers = useLayers();
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    items.forEach((item, idx) => {
      const category = item.category && item.category.trim() !== '' ? item.category : NONE;
      let g = map.get(category);
      if (!g) { g = { category, rows: [], total: 0 }; map.set(category, g); }
      g.rows.push({ item, idx });
      g.total += Number(item.totalPrice) || 0;
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [items]);

  const sum = groups.reduce((s, g) => s + g.total, 0);
  const base = totalAmount > 0 ? totalAmount : sum;
  const pctOf = (v: number) => (base > 0 ? (v / base) * 100 : 0);

  // poucos itens: tudo aberto; muitos: só a categoria de maior gasto
  const [openCats, setOpenCats] = useState<Set<string>>(() => new Set(items.length <= 10 ? groups.map(g => g.category) : groups.slice(0, 1).map(g => g.category)));
  const [openItem, setOpenItem] = useState<number | null>(null);
  const allOpen = groups.length > 0 && groups.every(g => openCats.has(g.category));
  const toggleCat = (c: string) => setOpenCats(prev => { const n = new Set(prev); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  const layerText = (item: ReceiptItem): { text: string; none: boolean } => {
    const leaf = leafFor(layers, item.category, item.description);
    if (!leaf) return { text: 'sem grupo', none: true };
    if (leaf.rest) return { text: `${leaf.group} (geral)`, none: false };
    return { text: leaf.level === 4 ? `${leaf.group} › ${leaf.label}` : leaf.label, none: false };
  };

  if (items.length === 0) return <p className="py-10 text-center text-sm text-zinc-500">Este cupom não tem itens.</p>;

  return (
    <div className="space-y-3 pb-6" data-testid="struct-view">
      {/* o total dividido por categoria, numa barra só */}
      <div>
        <div className="flex h-2.5 w-full rounded-full overflow-hidden gap-px bg-white/5" role="img"
          aria-label={groups.map(g => `${splitCategory(g.category).name} ${pctOf(g.total).toFixed(0)}%`).join(', ')} data-testid="struct-bar">
          {groups.map(g => (
            <button key={g.category} type="button" onClick={() => setOpenCats(prev => new Set(prev).add(g.category))} tabIndex={-1} aria-hidden
              style={{ width: `${pctOf(g.total)}%`, backgroundColor: getCategoryColor(g.category) }} className="h-full min-w-[3px]" />
          ))}
        </div>
        <div className="flex items-center justify-between mt-2 px-0.5">
          <p className="text-[12px] text-zinc-400" data-testid="struct-summary">
            {items.length} {items.length === 1 ? 'item' : 'itens'} · {groups.length} {groups.length === 1 ? 'categoria' : 'categorias'}
          </p>
          <button type="button" data-testid="struct-toggle-all" onClick={() => setOpenCats(allOpen ? new Set() : new Set(groups.map(g => g.category)))}
            className="flex items-center gap-1.5 px-3 h-8 rounded-full border border-white/10 text-xs font-semibold text-zinc-300 active:opacity-80">
            {allOpen ? <><ChevronsDownUp className="w-3.5 h-3.5" /> Recolher</> : <><ChevronsUpDown className="w-3.5 h-3.5" /> Expandir</>}
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        {groups.map(g => {
          const color = getCategoryColor(g.category);
          const Icon = getCategoryIcon(g.category);
          const { dept, name } = splitCategory(g.category);
          const isOpen = openCats.has(g.category);
          const pct = pctOf(g.total);
          return (
            <section key={g.category} data-testid="struct-cat" className={`rounded-2xl border transition-colors ${isOpen ? 'bg-zinc-900/50 border-white/10' : 'bg-zinc-900/40 border-white/5'}`}>
              <button type="button" onClick={() => toggleCat(g.category)} aria-expanded={isOpen} data-testid="struct-cat-toggle"
                className="w-full flex items-center gap-3 px-3 pt-2.5 pb-1.5 text-left">
                <span className="w-8 h-8 shrink-0 rounded-full bg-black/60 border border-white/10 flex items-center justify-center" style={{ color }}>
                  {React.createElement(Icon, { className: 'w-4 h-4' })}
                </span>
                <span className="min-w-0 flex-1">
                  {dept && <span className="block text-[11px] text-zinc-500 truncate">{dept}</span>}
                  <span className="block text-sm font-semibold text-zinc-100 truncate">{name}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-bold text-luxury-gold tabular-nums">{brl.format(g.total)}</span>
                  <span className="block text-[11px] text-zinc-500 tabular-nums">{pct >= 10 ? Math.round(pct) : pct.toFixed(1).replace('.', ',')}% · {g.rows.length} {g.rows.length === 1 ? 'item' : 'itens'}</span>
                </span>
                <ChevronDown className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              <div className="mx-3 mb-2 h-1 rounded-full bg-white/5 overflow-hidden" aria-hidden>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color, opacity: 0.85 }} />
              </div>

              {isOpen && (
                <ul className="border-t border-white/5 px-2">
                  {g.rows.map(({ item, idx }) => {
                    const open = openItem === idx;
                    const lay = layerText(item);
                    return (
                      <li key={idx} data-testid={`struct-item-${idx}`} className="border-b border-white/5 last:border-0">
                        <button type="button" onClick={() => setOpenItem(open ? null : idx)} aria-expanded={open} data-testid={`struct-item-toggle-${idx}`}
                          className="w-full flex items-start gap-2 px-1.5 py-2 text-left">
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13.5px] font-medium text-zinc-100 leading-snug break-words">{titleCase(item.description)}</span>
                            <span className="block text-[11px] text-zinc-500 leading-snug break-words">
                              {qtyFmt.format(Number(item.quantity) || 0)} {(item.unitType || 'UN').toLowerCase()} × {brl.format(Number(item.unitPrice) || 0)}
                              {' · '}<span className={lay.none ? 'text-amber-500/80' : ''} data-testid="struct-layer">{lay.text}</span>
                            </span>
                          </span>
                          <span className="shrink-0 text-[13px] font-semibold text-zinc-200 tabular-nums">{brl.format(Number(item.totalPrice) || 0)}</span>
                        </button>
                        {open && (
                          <div className="pb-3 pt-0.5 px-1.5 space-y-2.5" data-testid={`struct-item-detail-${idx}`}>
                            {item.code && <p className="text-xs text-zinc-500 tabular-nums" data-testid="item-code">Código {item.code}</p>}
                            {item.readDescription && <p className="text-xs text-zinc-500 break-words" data-testid="item-read-description">Na foto: {item.readDescription}</p>}
                            <div>
                              <span className="block text-xs text-zinc-500 mb-1.5">Categoria</span>
                              <ItemCategoryPicker category={item.category || g.category} description={item.description} categories={categories}
                                testId={`struct-cat-${idx}`} onPick={c => { onEditItem(idx, c); setOpenCats(prev => new Set(prev).add(c)); }} />
                            </div>
                            {onEggCount && isEggItem(item) && (
                              <EggCountPicker item={item} testId={`egg-picker-${idx}`} onChange={n => onEggCount(idx, n)}
                                sameCount={eggSame ? eggSame(idx) : 0} onApplySame={onEggApplySame ? () => onEggApplySame(idx) : undefined} />
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default ReceiptStructuredView;
