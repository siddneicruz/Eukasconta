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
  variants: { desc: string; n: number; code: string }[];   // descrições do cupom que formam o item (mais compradas primeiro), com o código de barras quando veio
  descs: string[];         // descrições (MAIÚSCULAS) dos cupons que formam o item; levam à lista em Compras
  name: string;
  unit: string;
  dept: string;
  last: number;            // preço mais recente
  lastDate: string;
  lastStore: string;
  prev: number | null;     // preço da penúltima compra (só informativo)
  prevDate: string | null;
  ready: boolean;          // já tem compras suficientes (MIN_PURCHASES) para uma cotação confiável
  mean: number | null;     // preço médio: média aparada das até BASE_MAX compras anteriores à última (até 1 ano antes)
  lo: number | null;       // margem normal: preço médio ±10%
  hi: number | null;
  nBase: number;           // quantas compras entraram no preço médio
  chg: number | null;      // variação % da última compra contra o preço médio (só quando ready)
  zone: 'below' | 'normal' | 'above' | null;   // fora da faixa normal para baixo/cima, ou dentro dela
  odd: boolean;            // 2x ou mais (ou metade) do preço médio: provável erro de leitura ou de unidade
  spark: number[];         // até 12 últimos preços diários
  days: number;            // quantos dias distintos de compra
  stale: boolean;          // última compra há mais de 90 dias
}

// Regra: cotação só com histórico. Abaixo disso o preço de uma compra isolada engana (promoção, erro de leitura).
export const MARGIN = 0.1;        // margem fixa: até ±10% sobre o preço médio é "normal" (cinza)
export const MIN_PURCHASES = 10;   // dias de compra do item (a última incluída) para a cotação aparecer
const BASE_MAX = 30;               // quantas compras anteriores entram no preço médio (as mais recentes)
const BASE_DAYS = 365;             // e no máximo 1 ano para trás, para a inflação não contaminar a média

const DAY = 86400000;
const t = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return 0; const pos = (s.length - 1) * q; const lo = Math.floor(pos); const hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };
// média aparada: descarta os 10% mais baixos e os 10% mais altos (promoção e erro de leitura não puxam a média)
const trimmedMean = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const k = s.length >= 10 ? Math.floor(s.length * 0.1) : 0; const m = s.slice(k, s.length - k); return m.reduce((a, b) => a + b, 0) / m.length; };
const pct = (a: number, b: number) => (b > 0 ? (a / b - 1) * 100 : null);

export const buildQuotes = (receipts: Receipt[], todayIso: string = new Date().toISOString().slice(0, 10)): Quote[] => {
  type Obs = { date: string; price: number; store: string };
  const groups = new Map<string, { name: string; dept: string; unit: string; obs: Obs[]; vars: Map<string, { n: number; code: string }> }>();
  receipts.forEach(r => (r.items || []).forEach(item => {
    const b = priceBasis(item);
    if (!(b.unitPrice > 0) || !r.date) return;
    const unit = normalizeUnit(b.unitType);
    if (!FRESH_DEPTS.has(deptSlug(deptOf(item.category)))) return;
    let name = detailName(item);
    if (!name) return;
    // Açougue vendido por unidade (hambúrguer, linguiça embalada…): 150 g e 90 g têm preço por "un" que não se comparam,
    // então cada produto (EAN ou descrição) é o seu próprio item, em vez de tudo no cadastro "Hambúrguer".
    let idPart = name.toUpperCase();
    if (unit !== 'KG' && deptSlug(deptOf(item.category)) === 'ACOUGUE') {
      const code = String(item.code || '').replace(/\D/g, '');
      const own = cleanDescriptionForMatching(item.description || '').split(' ').filter(w => w.length > 0).slice(0, 6).join(' ');
      if (own) { name = titleCase0(own); idPart = code.length >= 8 ? `EAN${code}` : own.toUpperCase(); }
    }
    const key = `${idPart}|${unit}`;
    let g = groups.get(key);
    if (!g) { g = { name, dept: String(item.category || '').split(' - ')[0].trim() || 'Outros', unit, obs: [], vars: new Map() }; groups.set(key, g); }
    const dk = String(item.description || '').trim().toUpperCase();
    if (dk) { const v = g.vars.get(dk) || { n: 0, code: '' }; v.n += 1; const c = String(item.code || '').replace(/\D/g, ''); if (c.length >= 8 && !v.code) v.code = c; g.vars.set(dk, v); }
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
    const baseDays = days.slice(0, -1).filter(d => t(lastD.date) - t(d.date) <= BASE_DAYS * DAY).slice(-BASE_MAX);
    const ready = days.length >= MIN_PURCHASES && baseDays.length >= MIN_PURCHASES - 1;
    const prices = baseDays.map(d => d.price);
    const mean = ready ? trimmedMean(prices) : null;
    const lo = ready && mean !== null ? mean * (1 - MARGIN) : null;
    const hi = ready && mean !== null ? mean * (1 + MARGIN) : null;
    out.push({
      key, variants: [...g.vars.entries()].map(([desc, v]) => ({ desc, n: v.n, code: v.code })).sort((a, b) => b.n - a.n),
      descs: [...g.vars.keys()], name: titleCase(g.name), unit: g.unit, dept: g.dept,
      last: lastD.price, lastDate: lastD.date, lastStore: lastD.store,
      prev: prevD ? prevD.price : null, prevDate: prevD ? prevD.date : null,
      ready, mean, lo, hi, nBase: baseDays.length,
      chg: mean ? pct(lastD.price, mean) : null,
      zone: mean === null || lo === null || hi === null ? null : lastD.price < lo ? 'below' : lastD.price > hi ? 'above' : 'normal',
      odd: !!mean && (lastD.price / mean >= 2 || lastD.price / mean <= 0.5),
      spark: days.slice(-12).map(d => d.price), days: days.length,
      stale: (t(todayIso) - t(lastD.date)) > 90 * DAY,
    });
  });
  return out;
};

// Maiores movimentos primeiro (alta ou queda), depois os com mais compras
export const topMovers = (qs: Quote[], n = 12): Quote[] =>
  qs.filter(q => q.ready && q.chg !== null && !q.stale && !q.odd && q.zone !== 'normal' && Math.abs(q.chg) >= 0.5)
    .sort((a, b) => Math.abs(b.chg as number) - Math.abs(a.chg as number)).slice(0, n);
