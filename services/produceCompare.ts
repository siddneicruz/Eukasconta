import { deptObservations, ProduceObs } from './quotes';

/* Comparativo de mercados no Hortifruti, feito só com os cupons da pessoa (todo o histórico, não só o período da tela).
   Para comparar mercados sem favorecer quem vende só o item caro, cada preço vira um ÍNDICE: o preço do mercado dividido
   pela média dos mercados para aquele mesmo item (−8% = 8% mais barato que a média). O índice do mercado é a média dos
   índices dos itens que ele tem em comum com outro mercado. Várias compras no mesmo dia viram a média do dia. */

export const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const MIN_ITEMS_RANK = 3;   // itens em comum para o mercado entrar no ranking de preço
export const MIN_DAY_OBS = 3;      // compras (item+dia) numa mesma semana-dia para apontar o dia mais barato

export interface StoreScore { id: string; cnpj: string; name: string; index: number | null; items: number; days: number }
export const MAX_STORES_PER_ITEM = 5;
/** Preço de um item numa loja: o último preço lido (e quando) e a média de todo o histórico. */
export interface ItemCell { id: string; name: string; last: number; date: string; mean: number; n: number }
export interface ItemRow { mids: string[]; cells: ItemCell[]; item: string; label: string; ean: string; unit: string; all: { id: string; name: string; price: number; n: number }[]; cheap: { id: string; name: string; price: number }; dear: { id: string; name: string; price: number }; spread: number; stores: number; n: number }
export interface WeekdayCell { wd: number; index: number; n: number }
export interface StoreWeekdays { id: string; name: string; cells: WeekdayCell[]; best: WeekdayCell | null; worst: WeekdayCell | null; obs: number }
export interface ProduceCompare {
  stores: StoreScore[]; items: ItemRow[]; weekdays: StoreWeekdays[]; overall: WeekdayCell[];
  nObs: number; nItems: number; firstDate: string; lastDate: string;
}

const wdOf = (iso: string) => new Date(`${iso}T12:00:00`).getDay();
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export const buildProduceCompare = (receipts: Parameters<typeof deptObservations>[0], nameOf: (name: string, cnpj: string) => string, dept = 'HORTIFRUTI', minItems = MIN_ITEMS_RANK, obsOverride?: ProduceObs[]): ProduceCompare => {
  const obs = obsOverride ?? deptObservations(receipts, dept);
  const sid = (o: ProduceObs) => o.cnpj || o.store;
  const names = new Map<string, string>(); const cnpjs = new Map<string, string>();
  
  // nome mostrado de cada item: a descrição mais frequente (o mesmo EAN pode vir escrito diferente em cada loja)
  const labelCount = new Map<string, Map<string, number>>(); const eanOfItem = new Map<string, string>();
  const midsOf = new Map<string, Set<string>>();
  obs.forEach(o => { if (o.mid) (midsOf.get(o.item) || midsOf.set(o.item, new Set()).get(o.item)!).add(o.mid); });
  obs.forEach(o => { const m = labelCount.get(o.item) || new Map(); m.set(o.label, (m.get(o.label) || 0) + 1); labelCount.set(o.item, m); if (o.ean) eanOfItem.set(o.item, o.ean); });
  const labelOf = (item: string) => [...(labelCount.get(item) || new Map([[item, 1]])).entries()].sort((a, b) => b[1] - a[1])[0][0];
  // um item = nome (ou EAN); fica a unidade com mais compras (kg e un não se misturam)
  const unitCount = new Map<string, Map<string, number>>();
  obs.forEach(o => { const m = unitCount.get(o.item) || new Map(); m.set(o.unit, (m.get(o.unit) || 0) + 1); unitCount.set(o.item, m); });
  const unitOf = new Map<string, string>();
  unitCount.forEach((m, item) => unitOf.set(item, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]));
  const use = obs.filter(o => unitOf.get(o.item) === o.unit);
  use.forEach(o => { names.set(sid(o), nameOf(o.store, o.cnpj)); cnpjs.set(sid(o), o.cnpj); });   // só mercado com compra usada na conta

  // média do dia por (item, loja, dia)
  const dayMap = new Map<string, { item: string; store: string; date: string; sum: number; k: number }>();
  use.forEach(o => {
    const k = `${o.item}|${sid(o)}|${o.date}`;
    const c = dayMap.get(k) || { item: o.item, store: sid(o), date: o.date, sum: 0, k: 0 };
    c.sum += o.price; c.k += 1; dayMap.set(k, c);
  });
  const days = [...dayMap.values()].map(d => ({ item: d.item, store: d.store, date: d.date, price: d.sum / d.k }));

  // preço médio do item por loja
  const byItemStore = new Map<string, Map<string, number[]>>();
  days.forEach(d => {
    const m = byItemStore.get(d.item) || new Map<string, number[]>();
    const a = m.get(d.store) || []; a.push(d.price); m.set(d.store, a); byItemStore.set(d.item, m);
  });

  // último preço lido de cada item em cada loja (a média do dia mais recente)
  const lastBy = new Map<string, { date: string; price: number }>();
  days.forEach(d => { const k = `${d.item}|${d.store}`; const c = lastBy.get(k); if (!c || d.date > c.date) lastBy.set(k, { date: d.date, price: d.price }); });
  // por item: mais barato x mais caro entre mercados
  const items: ItemRow[] = [];
  const idx = new Map<string, number[]>();   // loja -> índices dos itens em comum
  byItemStore.forEach((m, item) => {
    const avgs = [...m.entries()].map(([id, ps]) => ({ id, name: names.get(id) || id, price: mean(ps), n: ps.length })).sort((a, b) => a.price - b.price);
    if (avgs.length < 2) return;
    const ref = mean(avgs.map(a => a.price));
    avgs.forEach(a => { const l = idx.get(a.id) || []; l.push(a.price / ref - 1); idx.set(a.id, l); });
    const lo = avgs[0], hi = avgs[avgs.length - 1];
    items.push({ mids: [...(midsOf.get(item) || [])], cells: avgs.map(a => ({ id: a.id, name: a.name, mean: a.price, n: a.n, last: lastBy.get(`${item}|${a.id}`)!.price, date: lastBy.get(`${item}|${a.id}`)!.date })), item, label: labelOf(item), ean: eanOfItem.get(item) || '', unit: unitOf.get(item) || '', all: avgs.slice(0, MAX_STORES_PER_ITEM).map(a => ({ id: a.id, name: a.name, price: a.price, n: a.n })), cheap: { id: lo.id, name: lo.name, price: lo.price }, dear: { id: hi.id, name: hi.name, price: hi.price }, spread: hi.price / lo.price - 1, stores: avgs.length, n: avgs.reduce((s, a) => s + a.n, 0) });
  });
  items.sort((a, b) => b.n - a.n || b.spread - a.spread);

  const dayCount = new Map<string, Set<string>>(); const itemCount = new Map<string, Set<string>>();
  days.forEach(d => { (dayCount.get(d.store) || dayCount.set(d.store, new Set()).get(d.store)!).add(d.date); (itemCount.get(d.store) || itemCount.set(d.store, new Set()).get(d.store)!).add(d.item); });
  const stores: StoreScore[] = [...names.keys()].map(id => {
    const l = idx.get(id) || [];
    return { id, cnpj: cnpjs.get(id) || '', name: names.get(id) || id, index: l.length >= minItems ? mean(l) : null, items: l.length, days: dayCount.get(id)?.size || 0 };
  }).sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity) || b.days - a.days);

  // dia da semana: preço do dia dividido pela média do mesmo item na mesma loja (tira o efeito de "loja cara" e de "item caro")
  const itemStoreMean = new Map<string, number>();
  byItemStore.forEach((m, item) => m.forEach((ps, st) => itemStoreMean.set(`${item}|${st}`, mean(ps))));
  const wdAcc = new Map<string, number[][]>();   // loja -> [dia da semana] -> índices
  const allAcc: number[][] = Array.from({ length: 7 }, () => []);
  days.forEach(d => {
    const base = itemStoreMean.get(`${d.item}|${d.store}`)!;
    if ((byItemStore.get(d.item)!.get(d.store)!.length) < 2) return;   // item comprado uma vez nessa loja não diz nada sobre o dia
    const ix = d.price / base - 1; const w = wdOf(d.date);
    const a = wdAcc.get(d.store) || Array.from({ length: 7 }, () => []); a[w].push(ix); wdAcc.set(d.store, a); allAcc[w].push(ix);
  });
  const cellsOf = (a: number[][]): WeekdayCell[] => a.map((l, wd) => ({ wd, index: l.length ? mean(l) : 0, n: l.length })).filter(c => c.n > 0);
  const weekdays: StoreWeekdays[] = [...wdAcc.entries()].map(([id, a]) => {
    const cells = cellsOf(a); const ok = cells.filter(c => c.n >= MIN_DAY_OBS);
    const sorted = [...ok].sort((x, y) => x.index - y.index);
    return { id, name: names.get(id) || id, cells, best: sorted.length >= 2 ? sorted[0] : null, worst: sorted.length >= 2 ? sorted[sorted.length - 1] : null, obs: cells.reduce((s, c) => s + c.n, 0) };
  }).sort((a, b) => b.obs - a.obs);

  const dates = days.map(d => d.date).sort();
  return { stores, items, weekdays, overall: cellsOf(allAcc), nObs: days.length, nItems: byItemStore.size, firstDate: dates[0] || '', lastDate: dates[dates.length - 1] || '' };
};

const dayNum = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
export const ageDays = (iso: string, todayIso: string) => Math.max(0, dayNum(todayIso) - dayNum(iso));
export interface RankedCell extends ItemCell { age: number }
/** Ordena as lojas de um item pelo ÚLTIMO preço lido, só entre as que foram lidas dentro da janela (dias).
    As mais antigas saem da disputa (não são "melhor" nem "pior") e aparecem à parte, com a idade da leitura.
    Assim uma promoção de meses atrás não segura o 1º lugar. */
export const rankItem = (r: ItemRow, windowDays: number, todayIso: string) => {
  const cells: RankedCell[] = r.cells.map(c => ({ ...c, age: ageDays(c.date, todayIso) }));
  const fresh = cells.filter(c => c.age <= windowDays).sort((a, b) => a.last - b.last);
  const stale = cells.filter(c => c.age > windowDays).sort((a, b) => a.age - b.age);
  const spread = fresh.length >= 2 ? fresh[fresh.length - 1].last / fresh[0].last - 1 : 0;
  return { fresh, stale, spread };
};

/** Junta a base compartilhada com as compras locais sem contar a mesma leitura duas vezes (mesma loja, dia e preço). */
export const mergeObs = (shared: ProduceObs[], local: ProduceObs[]): ProduceObs[] => {
  const key = (o: ProduceObs) => `${o.cnpj || o.store}|${o.date}|${o.price.toFixed(2)}`;
  const seen = new Set(shared.map(key));
  return [...shared, ...local.filter(o => !seen.has(key(o)))];
};
