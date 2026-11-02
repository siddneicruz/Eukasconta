// Sugestões para quem lança uma compra à mão: ao digitar o nome de um item, mostra itens já conhecidos
// (compras anteriores e tabela mãe) com a categoria que cada um já tem, para escolher em vez de classificar de novo.
import { Receipt } from '../types';
import type { MasterData } from './masterService';

export interface ItemSuggestion { description: string; category: string; unitType?: string; uses: number }
export type ItemIndex = ItemSuggestion[];

const fold = (s: string): string => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const NO_CATEGORY = new Set(['', 'outros', 'sem categoria']);

export const buildItemIndex = (receipts: Receipt[], master?: MasterData | null): ItemIndex => {
  type Acc = { description: string; unitType?: string; cats: Map<string, number>; uses: number };
  const acc = new Map<string, Acc>();
  const add = (desc: string, cat: string, unit?: string, weight = 1) => {
    const key = fold(desc);
    if (!key) return;
    const a = acc.get(key) || { description: desc.trim(), unitType: unit, cats: new Map(), uses: 0 };
    a.uses += weight;
    if (cat && !NO_CATEGORY.has(fold(cat))) a.cats.set(cat, (a.cats.get(cat) || 0) + weight);
    if (!a.unitType && unit) a.unitType = unit;
    acc.set(key, a);
  };
  receipts.forEach(r => r.items?.forEach(i => add(i.description, i.category, i.unitType)));
  if (master) {
    const byId = new Map(master.nodes.map(n => [n.id, n] as const));
    const catOf = (nodeId: string | null): string => {
      if (!nodeId) return '';
      const chain: string[] = [];
      let cur = byId.get(nodeId);
      while (cur) { chain.unshift(cur.name); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
      return chain.length >= 2 ? `${chain[0]} - ${chain[1]}` : chain[0] || '';
    };
    master.products.forEach(p => add(p.desc, catOf(p.nodeId), undefined, 0.5));
  }
  const out: ItemSuggestion[] = [];
  acc.forEach(a => {
    const best = [...a.cats.entries()].sort((x, y) => y[1] - x[1])[0];
    if (best) out.push({ description: a.description, category: best[0], unitType: a.unitType, uses: a.uses });
  });
  return out;
};

export const suggestItems = (index: ItemIndex, query: string, limit = 6): ItemSuggestion[] => {
  const q = fold(query);
  if (q.length < 2) return [];
  const rank = (d: string): number => {
    const f = fold(d);
    if (f === q) return 0;
    if (f.startsWith(q)) return 1;
    if (f.split(' ').some(w => w.startsWith(q))) return 2;
    return f.includes(q) ? 3 : 9;
  };
  return index
    .map(s => ({ s, r: rank(s.description) }))
    .filter(x => x.r < 9)
    .sort((a, b) => a.r - b.r || b.s.uses - a.s.uses || a.s.description.length - b.s.description.length)
    .slice(0, limit)
    .map(x => x.s);
};

/** Categoria já usada para exatamente este nome de item (ignora maiúscula e acento), se houver. */
export const knownCategoryFor = (index: ItemIndex, description: string): ItemSuggestion | null => {
  const q = fold(description);
  return q ? index.find(s => fold(s.description) === q) ?? null : null;
};
