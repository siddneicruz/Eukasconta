import { Receipt } from '../types';
import { normalizeUnit } from './productPriceStats';
import { priceBasis } from './eggs';
import { getActiveLayers, leafFor } from './categoryLayers';
import { cleanDescriptionForMatching } from './descriptionClean';

// Escopo: só alimentos frescos do Açougue e do Hortifruti. Roupa, utensílio e industrializado têm marcas, modelos e
// embalagens demais para uma cotação honesta. O item é o mais detalhado possível (Tomate Salada, Batata Monalisa).
const FRESH_DEPTS = new Set(['ACOUGUE', 'HORTIFRUTI']);
const deptOf = (category?: string) => String(category || '').split(' - ')[0].trim();
const deptSlug = (d: string) => d.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const titleCase0 = (s: string) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

// Nome do item: o do cadastro quando a compra caiu num item específico; senão a descrição limpa do cupom, com até 4 palavras.
const detailName = (item: { category?: string; description?: string }): string => {
  const leaf = leafFor(getActiveLayers(), item.category, item.description);
  if (leaf && leaf.leaf && !leaf.rest && leaf.level === 4 && leaf.label) return leaf.label;
  const clean = cleanDescriptionForMatching(item.description || '').split(' ').filter(w => w.length > 1).slice(0, 4).join(' ');
  return clean ? titleCase0(clean) : '';
};

// Cotações: como o preço de cada produto que a pessoa compra anda. Só usa os cupons dela (etapa 1).
// O preço é sempre por unidade de medida (kg, litro, unidade, dúzia de ovos) e a conta é por DIA: várias compras no
// mesmo dia viram a média do dia, para uma promoção isolada não puxar tudo.

export interface Quote {
  key: string;
  name: string;
  unit: string;
  dept: string;
  last: number;            // preço mais recente
  lastDate: string;
  lastStore: string;
  prev: number | null;     // preço da penúltima compra
  prevDate: string | null;
  chgPrev: number | null;  // variação % contra a compra anterior (precisa de 2 dias de compra)
  base: number | null;     // mediana dos 90 dias antes da última compra
  chgBase: number | null;  // variação % contra essa mediana (precisa de 3 dias de compra)
  spark: number[];         // até 12 últimos preços diários
  days: number;            // quantos dias distintos de compra
  stale: boolean;          // última compra há mais de 90 dias
}

const DAY = 86400000;
const t = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
const pct = (a: number, b: number) => (b > 0 ? (a / b - 1) * 100 : null);

export const buildQuotes = (receipts: Receipt[], todayIso: string = new Date().toISOString().slice(0, 10)): Quote[] => {
  type Obs = { date: string; price: number; store: string };
  const groups = new Map<string, { name: string; dept: string; unit: string; obs: Obs[] }>();
  receipts.forEach(r => (r.items || []).forEach(item => {
    const b = priceBasis(item);
    if (!(b.unitPrice > 0) || !r.date) return;
    const unit = normalizeUnit(b.unitType);
    if (!FRESH_DEPTS.has(deptSlug(deptOf(item.category)))) return;
    const name = detailName(item);
    if (!name) return;
    const key = `${name.toUpperCase()}|${unit}`;
    let g = groups.get(key);
    if (!g) { g = { name, dept: String(item.category || '').split(' - ')[0].trim() || 'Outros', unit, obs: [] }; groups.set(key, g); }
    g.obs.push({ date: r.date, price: b.unitPrice, store: r.establishmentName });
  }));

  // um mesmo produto vendido em unidades diferentes (kg e un): fica a unidade com mais compras
  const best = new Map<string, { key: string; n: number }>();
  groups.forEach((g, key) => {
    const base = key.split('|')[0];
    const cur = best.get(base);
    if (!cur || g.obs.length > cur.n) best.set(base, { key, n: g.obs.length });
  });

  const out: Quote[] = [];
  best.forEach(({ key }) => {
    const g = groups.get(key)!;
    const byDay = new Map<string, { sum: number; n: number; store: string }>();
    g.obs.forEach(o => { const d = byDay.get(o.date) || { sum: 0, n: 0, store: o.store }; d.sum += o.price; d.n += 1; d.store = o.store; byDay.set(o.date, d); });
    const days = [...byDay.entries()].map(([date, v]) => ({ date, price: v.sum / v.n, store: v.store })).sort((a, b) => a.date.localeCompare(b.date));
    const lastD = days[days.length - 1];
    const prevD = days.length > 1 ? days[days.length - 2] : null;
    const window = days.slice(0, -1).filter(d => t(lastD.date) - t(d.date) <= 90 * DAY);
    const base = window.length >= 2 ? median(window.map(d => d.price)) : null;
    out.push({
      key, name: titleCase(g.name), unit: g.unit, dept: g.dept,
      last: lastD.price, lastDate: lastD.date, lastStore: lastD.store,
      prev: prevD ? prevD.price : null, prevDate: prevD ? prevD.date : null, chgPrev: prevD ? pct(lastD.price, prevD.price) : null,
      base, chgBase: base ? pct(lastD.price, base) : null,
      spark: days.slice(-12).map(d => d.price), days: days.length,
      stale: (t(todayIso) - t(lastD.date)) > 90 * DAY,
    });
  });
  return out;
};

// Maiores movimentos primeiro (alta ou queda), depois os com mais compras
export const topMovers = (qs: Quote[], n = 12): Quote[] =>
  qs.filter(q => q.chgPrev !== null && !q.stale && Math.abs(q.chgPrev) >= 0.5)
    .sort((a, b) => Math.abs(b.chgPrev as number) - Math.abs(a.chgPrev as number)).slice(0, n);
