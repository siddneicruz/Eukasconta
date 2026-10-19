import { Receipt, TaxonomyNode } from '../types';
import { catKey, deptKey, titleCase } from './textFormat';
import { fold } from './itemSearch';

/* Camadas 3 e 4 das categorias (grupo e item), como "Carne Bovina › Cortes Nobres › Picanha".

   O cupom só grava "Departamento - Categoria" no item. Os dois níveis de baixo vêm da estrutura de categorias da pessoa
   (a taxonomia) e são ligados ao item pelo nome: o item "PICANHA BOV KG" que está em "Açougue - Carne Bovina" cai no item
   "Picanha" daquela categoria. Cada linha de compra cai em NO MÁXIMO um item (o de nome mais específico), então os
   totais de cima são sempre a soma dos de baixo. O que não casa com nenhum item fica em "Outros itens" da categoria.

   Chaves (começam com a letra do nível, para não se confundir com as de departamento e categoria):
     g:<categoria>|<grupo>            grupo (camada 3)
     i:<categoria>|<grupo>|<item>     item (camada 4)
     o:<categoria>                    "Outros itens" da categoria
     o:<categoria>|<grupo>            "Outros itens" de um grupo que tem itens: o que casa com o grupo ("Carne Moída") mas
                                      com nenhum item dele ("Moída de Patinho").
   A pessoa também pode "fixar" uma descrição num grupo ou item (layerPins.ts): vale para todas as compras com aquela
   descrição, na mesma categoria.                                                                                  */

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'para', 'em', 'a', 'o', 'as', 'os', 'no', 'na']);

const tokensOf = (s: string): string[] => fold(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const slug = (s: string): string => tokensOf(s).join(' ');
/** O nome de um grupo/item como entra nas chaves (g:/i:). */
export const layerSlug = slug;

export const REST_LABEL = 'Outros itens';

export interface LayerNode {
  key: string;            // chave do próprio nó (g:... ou i:...)
  level: 3 | 4;
  catKey: string;         // chave da categoria (sem o prefixo "c:")
  cat: string;            // "Açougue - Carne Bovina"
  groupKey: string;       // chave do grupo a que pertence (ele mesmo, se for grupo)
  group: string;          // nome do grupo
  label: string;          // nome do nó
  parentKey: string;      // acima dele: "c:<categoria>" (grupo) ou a chave do grupo (item)
  alts: { tokens: string[]; joined: string }[];   // jeitos de escrever o nome ("Leite integral / desnatado" tem dois)
  leaf: boolean;          // recebe itens de compra (item, ou grupo sem itens abaixo)
  rest?: boolean;         // "Outros itens" de um grupo que tem itens
}

export interface LayerIndex {
  nodes: LayerNode[];
  byKey: Map<string, LayerNode>;
  leavesByCat: Map<string, LayerNode[]>;
  cache: Map<string, LayerNode | null>;
  keyCache: Map<string, ItemKeys>;
  /** descrição fixada pela pessoa (pinKey) → chave do grupo/item */
  pins: Map<string, string>;
}

export const EMPTY_LAYERS: LayerIndex = { nodes: [], byKey: new Map(), leavesByCat: new Map(), cache: new Map(), keyCache: new Map(), pins: new Map() };

/** Chave de uma descrição fixada: categoria + descrição, do jeito que a busca por nome enxerga (sem acento nem pontuação). */
export const pinKey = (category: string | undefined | null, description: string | undefined | null): string => `${catKey(category)}\u0001${slug(String(description ?? ''))}`;

const altsOf = (name: string) =>
  name.split(/\s*[/,]\s*|\s+ou\s+/i)
    .map(part => { const tokens = tokensOf(part).filter(t => !STOP.has(t)); return { tokens, joined: tokens.join('') }; })
    .filter(a => a.tokens.length > 0);

/** Monta o índice a partir da taxonomia (níveis 1 a 4). Nó órfão (sem o caminho completo até o departamento) é ignorado. */
export const buildLayerIndex = (taxonomy: TaxonomyNode[], pins: Record<string, string> = {}): LayerIndex => {
  if (!taxonomy || taxonomy.length === 0) return EMPTY_LAYERS;
  const byId = new Map<string, TaxonomyNode>();
  taxonomy.forEach(n => byId.set(n.id, n));
  const kidsCount = new Map<string, number>();
  taxonomy.forEach(n => { if (n.parentId) kidsCount.set(n.parentId, (kidsCount.get(n.parentId) || 0) + 1); });

  const nodes: LayerNode[] = [];
  const byKey = new Map<string, LayerNode>();
  const leavesByCat = new Map<string, LayerNode[]>();
  const add = (n: LayerNode) => {
    if (byKey.has(n.key)) return;
    byKey.set(n.key, n);
    nodes.push(n);
    if (n.leaf) {
      const arr = leavesByCat.get(n.catKey);
      if (arr) arr.push(n); else leavesByCat.set(n.catKey, [n]);
    }
  };

  taxonomy.forEach(n => {
    if (n.level !== 3 && n.level !== 4) return;
    const l3 = n.level === 3 ? n : (n.parentId ? byId.get(n.parentId) : undefined);
    if (!l3 || l3.level !== 3) return;
    const l2 = l3.parentId ? byId.get(l3.parentId) : undefined;
    if (!l2 || l2.level !== 2) return;
    const l1 = l2.parentId ? byId.get(l2.parentId) : undefined;
    if (!l1 || l1.level !== 1) return;
    const cat = `${l1.name.trim()} - ${l2.name.trim()}`;
    const ck = catKey(cat);
    const g = slug(l3.name);
    if (!g) return;
    const groupKey = `g:${ck}|${g}`;
    if (n.level === 3) {
      const hasKids = (kidsCount.get(n.id) || 0) > 0;
      add({ key: groupKey, level: 3, catKey: ck, cat, groupKey, group: titleCase(l3.name), label: titleCase(l3.name), parentKey: `c:${ck}`, alts: altsOf(l3.name), leaf: !hasKids });
      // grupo com itens: o que casa com o nome do grupo mas com nenhum item dele cai em "Outros itens" do próprio grupo
      if (hasKids) add({ key: `o:${ck}|${g}`, level: 4, catKey: ck, cat, groupKey, group: titleCase(l3.name), label: REST_LABEL, parentKey: groupKey, alts: altsOf(l3.name), leaf: true, rest: true });
    } else {
      const it = slug(n.name);
      if (!it) return;
      add({ key: `i:${ck}|${g}|${it}`, level: 4, catKey: ck, cat, groupKey, group: titleCase(l3.name), label: titleCase(n.name), parentKey: groupKey, alts: altsOf(n.name), leaf: true });
    }
  });
  if (nodes.length === 0) return EMPTY_LAYERS;
  return { nodes, byKey, leavesByCat, cache: new Map(), keyCache: new Map(), pins: new Map(Object.entries(pins || {})) };
};

// A palavra do nome aparece na descrição? Aceita plural e variações curtas ("picanhas"), e o nome colado ("contrafile").
const wordHit = (descTokens: string[], descJoined: string, t: string): boolean => {
  for (const d of descTokens) {
    if (d === t) return true;
    if (d.length > t.length && d.length - t.length <= 2 && d.startsWith(t)) return true;
    if (t.length > d.length && t.length - d.length <= 2 && d.length >= 4 && t.startsWith(d)) return true;
  }
  return t.length >= 5 && descJoined.includes(t);
};

const weightOf = (node: LayerNode, descTokens: string[], descJoined: string): number => {
  let best = 0;
  for (const a of node.alts) {
    const all = a.tokens.every(t => wordHit(descTokens, descJoined, t));
    const glued = a.tokens.length > 1 && a.joined.length >= 5 && descJoined.includes(a.joined);
    if (all || glued) best = Math.max(best, a.joined.length);
  }
  return best;
};

/** O item (ou grupo sem itens) da categoria que melhor casa com a descrição; nulo se nenhum casa. */
export const leafFor = (idx: LayerIndex, category: string | undefined | null, description: string | undefined | null): LayerNode | null => {
  const ck = catKey(category);
  const leaves = idx.leavesByCat.get(ck);
  if (!leaves || leaves.length === 0) return null;
  const ckey = `${ck}\u0001${description || ''}`;
  const hit = idx.cache.get(ckey);
  if (hit !== undefined) return hit;
  // fixado pela pessoa: vale antes de qualquer casamento por nome (se o grupo ou item ainda existe nesta categoria)
  const pinned = idx.pins.size ? idx.byKey.get(idx.pins.get(pinKey(category, description)) || '') : undefined;
  if (pinned && pinned.leaf && pinned.catKey === ck) { idx.cache.set(ckey, pinned); return pinned; }
  const dt = tokensOf(String(description || ''));
  const dj = dt.join('');
  let best: LayerNode | null = null, bestW = 0;
  for (const n of leaves) {
    const raw = weightOf(n, dt, dj);
    // "outros itens" do grupo só vale quando nenhum item do grupo casou: peso mínimo, só desempata entre grupos
    const w = n.rest ? (raw > 0 ? 0.01 + raw / 1000 : 0) : raw;
    if (w > bestW) { best = n; bestW = w; }
  }
  idx.cache.set(ckey, best);
  return best;
};

export interface ItemKeys { d: string; c: string; g?: string; i?: string; o?: string }

// O índice "em uso" pelo app: quem monta as telas troca quando a taxonomia muda e as funções puras o usam por padrão.
let active: LayerIndex = EMPTY_LAYERS;
export const setActiveLayers = (idx: LayerIndex): void => { active = idx; };
export const getActiveLayers = (): LayerIndex => active;

/** Todas as chaves a que uma linha de compra pertence (departamento, categoria e, se houver, grupo, item ou "outros itens"). */
export const itemKeys = (category: string | undefined | null, description: string | undefined | null, idx: LayerIndex = active): ItemKeys => {
  const cat = String(category ?? '');
  const ck = catKey(cat);
  const base: ItemKeys = { d: deptKey(cat), c: `c:${ck}` };
  if (!idx.leavesByCat.has(ck)) return base;
  const k = `${cat}\u0001${description || ''}`;
  const hit = idx.keyCache.get(k);
  if (hit) return hit;
  const leaf = leafFor(idx, cat, description);
  const out: ItemKeys = leaf
    ? { ...base, g: leaf.groupKey, i: leaf.level === 4 && !leaf.rest ? leaf.key : undefined, o: leaf.rest ? leaf.key : undefined }
    : { ...base, o: `o:${ck}` };
  idx.keyCache.set(k, out);
  return out;
};

/** A chave é de uma camada de baixo (grupo, item ou "outros itens")? */
export const isLayerKey = (key: string): boolean => /^[gio]:/.test(key);

/* ───────────────────────── opções para as listas ───────────────────────── */

export interface LayerOpt {
  key: string;
  kind: 'grp' | 'item' | 'rest';
  level: 3 | 4;
  label: string;
  groupLabel: string;     // grupo a que pertence (igual ao rótulo, se for o próprio grupo)
  parent: string;         // "c:<categoria>" (grupo e "outros") ou a chave do grupo (item)
  catKey: string;
  total: number;
  items: number;
}

/** Grupos, itens e "outros itens" que existem nas compras (`all`) com o gasto no período (`period`).
    Com `includeUnused`, entram também os da estrutura de categorias que ainda não têm compra. */
export const buildLayerOpts = (all: Receipt[], period: Receipt[], idx: LayerIndex = active, includeUnused = false): LayerOpt[] => {
  if (idx.nodes.length === 0) return [];
  const map = new Map<string, LayerOpt>();
  const ensure = (o: Omit<LayerOpt, 'total' | 'items'>): LayerOpt => {
    let cur = map.get(o.key);
    if (!cur) { cur = { ...o, total: 0, items: 0 }; map.set(o.key, cur); }
    return cur;
  };
  const ensureNode = (n: LayerNode): LayerOpt =>
    ensure({ key: n.key, kind: n.rest ? 'rest' : n.level === 3 ? 'grp' : 'item', level: n.level, label: n.label, groupLabel: n.group, parent: n.parentKey, catKey: n.catKey });
  const visit = (receipts: Receipt[], count: boolean) => {
    receipts.forEach(r => (r.items || []).forEach(i => {
      const cat = String(i.category || '').trim();
      const ck = catKey(cat);
      if (!idx.leavesByCat.has(ck)) return;
      const price = Number(i.totalPrice) || 0;
      const leaf = leafFor(idx, cat, i.description);
      const touched: LayerOpt[] = [];
      if (leaf) {
        const group = idx.byKey.get(leaf.groupKey);
        if (group) touched.push(ensureNode(group));
        if (leaf.level === 4) touched.push(ensureNode(leaf));
      } else {
        touched.push(ensure({ key: `o:${ck}`, kind: 'rest', level: 3, label: REST_LABEL, groupLabel: REST_LABEL, parent: `c:${ck}`, catKey: ck }));
      }
      if (count) touched.forEach(t => { t.total += price; t.items += 1; });
    }));
  };
  visit(all, false);
  visit(period, true);
  if (includeUnused) idx.nodes.forEach(n => { if (!n.rest) ensureNode(n); });   // "outros itens" de grupo só aparece quando tem compra
  return Array.from(map.values());
};
