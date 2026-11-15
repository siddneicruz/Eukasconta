import type { ProduceObs } from './quotes';

/* "Bolsa" de itens: preço de mercado agora (últimos dias, todas as lojas) contra o período anterior.
   Sobe = preço do mercado subiu (ruim para quem compra); cai = baixou (bom). */

export interface TickerRow {
  item: string; label: string; unit: string;
  now: number;            // preço médio de mercado na janela recente
  before: number;         // preço médio de mercado na janela anterior
  pct: number;            // variação (now/before - 1)
  stores: number;         // lojas com leitura nas duas janelas
  n: number;              // leituras usadas
  last: string;           // data da leitura mais recente
  mine?: { price: number; date: string; vsMarket: number };   // sua última compra e quanto ficou acima (+) ou abaixo (−) do mercado
}
export interface TickerOpts { recentDays: number; baseDays: number; minReads: number; minPct: number }
export const DEFAULTS: TickerOpts = { recentDays: 7, baseDays: 30, minReads: 2, minPct: 0.04 };

const dayNum = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / 86400000);

/** média das médias por loja (cada loja pesa igual, quem compra todo dia não domina) */
const storeMean = (obs: ProduceObs[]): number => {
  const by = new Map<string, { s: number; n: number }>();
  obs.forEach(o => { const k = o.cnpj || o.store; const c = by.get(k) || by.set(k, { s: 0, n: 0 }).get(k)!; c.s += o.price; c.n++; });
  let t = 0; by.forEach(c => { t += c.s / c.n; });
  return by.size ? t / by.size : 0;
};

/** all = leituras de todos (inclui as suas); local = só as suas compras (para "você vs mercado") */
export const buildTicker = (all: ProduceObs[], local: ProduceObs[], todayIso: string, o: TickerOpts = DEFAULTS): TickerRow[] => {
  const today = dayNum(todayIso);
  const byItem = new Map<string, ProduceObs[]>();
  all.forEach(x => { if (x.price > 0 && x.date) (byItem.get(x.item) || byItem.set(x.item, []).get(x.item)!).push(x); });
  const mineBy = new Map<string, ProduceObs>();
  local.forEach(x => { const c = mineBy.get(x.item); if (!c || x.date > c.date) mineBy.set(x.item, x); });
  const out: TickerRow[] = [];
  byItem.forEach((list, item) => {
    const rec = list.filter(x => today - dayNum(x.date) <= o.recentDays && today - dayNum(x.date) >= 0);
    const base = list.filter(x => { const a = today - dayNum(x.date); return a > o.recentDays && a <= o.recentDays + o.baseDays; });
    if (rec.length < 1 || base.length < 1 || rec.length + base.length < o.minReads + 1) return;
    const stores = new Set(list.filter(x => today - dayNum(x.date) <= o.recentDays + o.baseDays).map(x => x.cnpj || x.store)).size;
    if (stores < 2) return;   // com uma loja só não é "mercado"
    const now = storeMean(rec), before = storeMean(base);
    if (!(now > 0) || !(before > 0)) return;
    const pct = now / before - 1;
    const first = list[0];
    const m = mineBy.get(item);
    const row: TickerRow = { item, label: first.label, unit: first.unit, now, before, pct, stores, n: rec.length + base.length, last: list.map(x => x.date).sort().pop() || '' };
    if (m && today - dayNum(m.date) <= o.recentDays + o.baseDays) row.mine = { price: m.price, date: m.date, vsMarket: m.price / now - 1 };
    out.push(row);
  });
  return out;
};

export const movers = (rows: TickerRow[], o: TickerOpts = DEFAULTS, take = 4) => ({
  up: rows.filter(r => r.pct >= o.minPct).sort((a, b) => b.pct - a.pct).slice(0, take),
  down: rows.filter(r => r.pct <= -o.minPct).sort((a, b) => a.pct - b.pct).slice(0, take),
  mine: rows.filter(r => r.mine).sort((a, b) => Math.abs((b.mine as any).vsMarket) - Math.abs((a.mine as any).vsMarket)).slice(0, take),
});
