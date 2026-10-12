import { Receipt, ReceiptItem, MasterProduct, ItemFilter } from '../types';
import { titleCase } from './textFormat';
import { HistoryItem, normalizeUnit } from './productPriceStats';

/* Busca de itens: índice dos produtos comprados (para o autocompletar), filtro por item e
   projeção dos cupons só com as linhas escolhidas. Tudo local, sobre os cupons que já estão no aparelho. */

// minúsculo, sem acento e com espaços simples: "Pão  de Açúcar" -> "pao de acucar"
export const fold = (s: string | undefined | null): string =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// mesma chave que o cadastro de produtos usa nos apelidos
const descKey = (d: string | undefined | null): string => (d || '').trim().toUpperCase();

export const MIN_QUERY = 2;       // letras para começar a sugerir
export const MIN_CHART_QUERY = 3; // letras para a busca livre virar gráfico de preço

export const queryTokens = (q: string): string[] => fold(q).split(' ').filter(Boolean);

/* ───────────────────────── filtro ───────────────────────── */

const matcherCache = new WeakMap<ItemFilter, (item: ReceiptItem) => boolean>();

export const makeItemMatcher = (f: ItemFilter): ((item: ReceiptItem) => boolean) => {
  const hit = matcherCache.get(f);
  if (hit) return hit;
  let fn: (item: ReceiptItem) => boolean;
  if (f.descs && f.descs.length) {
    const set = new Set(f.descs.map(descKey));
    fn = item => set.has(descKey(item.description));
  } else if (f.text) {
    const tokens = queryTokens(f.text);
    fn = tokens.length ? item => { const d = fold(item.description); return tokens.every(t => d.includes(t)); } : () => false;
  } else {
    fn = () => false;
  }
  matcherCache.set(f, fn);
  return fn;
};

// Busca livre digitada (ex.: "cebola") como filtro; nulo quando é curta demais para valer como item.
export const textFilter = (text: string): ItemFilter | null => {
  const t = text.trim();
  return fold(t).length >= MIN_CHART_QUERY ? { label: t, text: t } : null;
};

export const itemFilterTitle = (f: ItemFilter): string => (f.text && !f.descs ? `itens com “${f.label}”` : f.label);

const sumTotal = (items: ReceiptItem[]) => items.reduce((s, i) => s + (Number(i.totalPrice) || 0), 0);

// Os mesmos cupons, mas só com as linhas do item; o total passa a ser o dessas linhas. Cupom sem o item some.
export const projectReceipts = (receipts: Receipt[], f: ItemFilter | null | undefined): Receipt[] => {
  if (!f) return receipts;
  const match = makeItemMatcher(f);
  const out: Receipt[] = [];
  receipts.forEach(r => {
    const items = (r.items || []).filter(match);
    if (!items.length) return;
    out.push(items.length === (r.items || []).length ? r : { ...r, items, totalAmount: sumTotal(items) });
  });
  return out;
};

// Linhas de compra do item, prontas para o gráfico de preço.
export const toHistoryItems = (receipts: Receipt[], match: (item: ReceiptItem) => boolean): HistoryItem[] => {
  const out: HistoryItem[] = [];
  receipts.forEach(r => {
    (r.items || []).forEach((item, idx) => {
      if (!match(item)) return;
      const unitPrice = Number(item.unitPrice);
      if (!(unitPrice > 0)) return;
      out.push({
        key: `${r.id}:${idx}`,
        unitPrice,
        quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
        totalPrice: Number(item.totalPrice) || unitPrice,
        unitType: item.unitType,
        date: r.date,
        establishment: r.establishmentName,
      });
    });
  });
  return out;
};

/* ───────────────────────── índice e sugestões ───────────────────────── */

export interface ItemEntry {
  id: string;
  label: string;          // nome para mostrar
  labelFold: string;
  hay: string;            // nome + descrições dos cupons, sem acento, para procurar
  descs: string[];        // descrições (MAIÚSCULAS) dos cupons que formam este produto
  count: number;          // linhas de compra
  stores: number;
  lastDate: string;
  lastPrice: number;
  lastUnit: string;
}

export interface ItemIndex {
  entries: ItemEntry[];
  rows: { fold: string; count: number }[]; // cada descrição distinta, para contar a busca livre
}

export const buildItemIndex = (receipts: Receipt[], masters: MasterProduct[] = []): ItemIndex => {
  const aliasToMaster = new Map<string, MasterProduct>();
  masters.forEach(m => (m.aliases || []).forEach(a => { if (!aliasToMaster.has(a)) aliasToMaster.set(a, m); }));

  type G = { id: string; label: string; descs: Set<string>; count: number; stores: Set<string>; lastDate: string; lastPrice: number; lastUnit: string };
  const groups = new Map<string, G>();
  const rowMap = new Map<string, { fold: string; count: number }>();

  receipts.forEach(r => {
    (r.items || []).forEach(item => {
      const key = descKey(item.description);
      if (!key) return;
      const master = aliasToMaster.get(key);
      const id = master ? `M:${master.code}` : `D:${key}`;
      let g = groups.get(id);
      if (!g) {
        g = { id, label: master ? master.description : item.description.trim(), descs: new Set(), count: 0, stores: new Set(), lastDate: '', lastPrice: 0, lastUnit: 'UN' };
        groups.set(id, g);
      }
      g.descs.add(key);
      g.count += 1;
      g.stores.add(r.establishmentName);
      const price = Number(item.unitPrice);
      if (price > 0 && (r.date || '') >= g.lastDate) { g.lastDate = r.date || ''; g.lastPrice = price; g.lastUnit = normalizeUnit(item.unitType); }
      const row = rowMap.get(key);
      if (row) row.count += 1; else rowMap.set(key, { fold: fold(item.description), count: 1 });
    });
  });

  const entries: ItemEntry[] = Array.from(groups.values()).map(g => {
    const label = titleCase(g.label);
    const descs = Array.from(g.descs);
    return {
      id: g.id, label, labelFold: fold(label),
      hay: [fold(label), ...descs.map(fold)].join('|'),
      descs, count: g.count, stores: g.stores.size,
      lastDate: g.lastDate, lastPrice: g.lastPrice, lastUnit: g.lastUnit,
    };
  });
  return { entries, rows: Array.from(rowMap.values()) };
};

export interface ItemSuggestion {
  id: string;
  kind: 'text' | 'product';
  label: string;
  sub: string;
  filter: ItemFilter;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Quanto mais perto do começo do nome, melhor: "cebola roxa" antes de "molho de cebola".
const rank = (e: ItemEntry, first: string): number => {
  if (e.labelFold.startsWith(first)) return 0;
  if (e.labelFold.includes(' ' + first)) return 1;
  if (e.labelFold.includes(first)) return 2;
  return 3;
};

export const searchItems = (index: ItemIndex, query: string, opts: { limit?: number; textRow?: boolean } = {}): ItemSuggestion[] => {
  const limit = opts.limit ?? 8;
  const tokens = queryTokens(query);
  if (!tokens.length || fold(query).length < MIN_QUERY) return [];

  const found = index.entries.filter(e => tokens.every(t => e.hay.includes(t)));
  if (!found.length) return [];
  found.sort((a, b) => rank(a, tokens[0]) - rank(b, tokens[0]) || b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));

  const out: ItemSuggestion[] = [];

  if (opts.textRow && found.length > 1) {
    let lines = 0, distinct = 0;
    index.rows.forEach(r => { if (tokens.every(t => r.fold.includes(t))) { lines += r.count; distinct += 1; } });
    if (distinct > 1) {
      const raw = query.trim();
      out.push({
        id: 'text', kind: 'text', label: `Tudo com “${raw}”`,
        sub: `${plural(lines, 'compra', 'compras')} em ${plural(distinct, 'descrição', 'descrições')}`,
        filter: { label: raw, text: raw },
      });
    }
  }

  found.slice(0, limit).forEach(e => {
    const bits = [plural(e.count, 'compra', 'compras')];
    if (e.stores > 1) bits.push(`${e.stores} lojas`);
    if (e.lastPrice > 0) bits.push(`última ${brl.format(e.lastPrice)}/${e.lastUnit.toLowerCase()}`);
    out.push({ id: e.id, kind: 'product', label: e.label, sub: bits.join(' · '), filter: { label: e.label, descs: e.descs } });
  });
  return out;
};
