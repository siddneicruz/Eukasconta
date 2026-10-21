import { Receipt, ReceiptItem } from '../types';
import { normalizeProductName } from './productNormalization';
import { priceBasis, eggNeedsCount } from './eggs';
import { getActiveLayers, pinKey } from './categoryLayers';

// Preço de um produto (menor, teto, médio) olhando TODO o histórico de cupons.
// Não depende do período escolhido na tela: um preço de setembro continua valendo em outubro.

export interface PriceObservation {
  unitPrice: number;
  unitType: string;
  date: string;
  establishment: string;
  description: string;
  // Ovo sem a quantidade da bandeja: o preço é de uma bandeja de tamanho desconhecido e não entra na conta da dúzia
  eggPending?: boolean;
}

export interface PriceStats {
  min: number;
  max: number;
  avg: number;
  count: number;
  minObs: PriceObservation | null;
  maxObs: PriceObservation | null;
}

export const stripAccentsUpper = (s: string): string =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// Cada mercado escreve a unidade de um jeito ("UN", "UNID", "UND", "UNIDADE"...). Para os
// gráficos e comparações de preço isso é a mesma coisa, então a unidade é unificada na
// LEITURA; os cupons salvos continuam exatamente como vieram.
const UNIT_ALIASES: Record<string, string> = {
  UN: 'UN', UND: 'UN', UNID: 'UN', UNI: 'UN', UNT: 'UN', UNIT: 'UN', UNIDADE: 'UN', UNIDADES: 'UN',
  KG: 'KG', KGS: 'KG', KILO: 'KG', KILOS: 'KG', QUILO: 'KG', QUILOS: 'KG', QUILOGRAMA: 'KG',
  G: 'G', GR: 'G', GRS: 'G', GRAMA: 'G', GRAMAS: 'G',
  L: 'L', LT: 'L', LTS: 'L', LITRO: 'L', LITROS: 'L',
  ML: 'ML', MILILITRO: 'ML', MILILITROS: 'ML',
  PCT: 'PCT', PACOTE: 'PCT', PACOTES: 'PCT',
  CX: 'CX', CAIXA: 'CX', CAIXAS: 'CX',
  DZ: 'DZ', DZA: 'DZ', DUZIA: 'DZ', DUZIAS: 'DZ',
};
export const normalizeUnit = (raw?: string | null): string => {
  const k = stripAccentsUpper(String(raw || '')).replace(/[^A-Z0-9]/g, '');
  if (!k) return 'UN';
  return UNIT_ALIASES[k] || k;
};

// normalizeProductName monta várias expressões a cada chamada; as descrições se repetem muito entre cupons.
const genericCache = new Map<string, string>();
const genericOf = (description: string): string => {
  let g = genericCache.get(description);
  if (g === undefined) {
    g = normalizeProductName(description);
    genericCache.set(description, g);
  }
  return g;
};

// Nome do produto de uma compra: o grupo/item em que a pessoa FIXOU a descrição (edição do cupom) e, sem fixação, o nome genérico.
// É o mesmo nome que a lista "Artigos identificados" usa, então o dashboard acompanha o que foi escolhido no cupom.
export const productKeyOf = (item: ReceiptItem): string => {
  const desc = item.description || '';
  const idx = getActiveLayers();
  if (idx.pins.size && item.category) {
    const node = idx.byKey.get(idx.pins.get(pinKey(item.category, desc)) || '');
    if (node && node.leaf) return node.rest ? node.group : node.label;
  }
  return genericOf(desc);
};

// O item pertence ao produto só quando o nome dele (fixado ou genérico) É o do produto. Comparar sem acento.
// Antes valia também "o texto contém o nome": abrir "Carne" trazia Carne Moída, Alcatra e qualquer cupom
// que tivesse a palavra "carne" na descrição. O segundo argumento (categoria aberta) ficou só por compatibilidade.
export const itemBelongsToProduct = (item: ReceiptItem, genericName: string, _subCategoryName?: string): boolean => {
  const key = stripAccentsUpper(genericName);
  if (!key) return false;
  return stripAccentsUpper(productKeyOf(item)) === key;
};

export const collectPriceObservations = (receipts: Receipt[], genericName: string, subCategoryName: string): PriceObservation[] => {
  const out: PriceObservation[] = [];
  receipts.forEach(r => {
    (r.items || []).forEach(item => {
      if (!itemBelongsToProduct(item, genericName, subCategoryName)) return;
      // ovo com a quantidade conhecida entra pelo preço da dúzia (o resto fica como no cupom)
      const basis = priceBasis(item);
      const p = basis.unitPrice;
      if (!(p > 0)) return;
      out.push({
        unitPrice: p,
        unitType: normalizeUnit(basis.unitType),
        date: r.date,
        establishment: r.establishmentName,
        description: item.description,
        ...(eggNeedsCount(item) ? { eggPending: true } : {}),
      });
    });
  });
  // Quando já há ovos com a quantidade conhecida (preço da dúzia), os de bandeja sem quantidade ficam de fora do
  // menor/teto/médio: misturar o preço de uma bandeja qualquer com o da dúzia dava um teto falso.
  if (out.some(o => o.eggPending) && out.some(o => !o.eggPending)) return out.filter(o => !o.eggPending);
  return out;
};

export const computePriceStats = (obs: PriceObservation[]): PriceStats => {
  if (obs.length === 0) return { min: 0, max: 0, avg: 0, count: 0, minObs: null, maxObs: null };
  let minObs = obs[0];
  let maxObs = obs[0];
  let sum = 0;
  obs.forEach(o => {
    sum += o.unitPrice;
    // empate: fica o mais recente
    if (o.unitPrice < minObs.unitPrice || (o.unitPrice === minObs.unitPrice && o.date > minObs.date)) minObs = o;
    if (o.unitPrice > maxObs.unitPrice || (o.unitPrice === maxObs.unitPrice && o.date > maxObs.date)) maxObs = o;
  });
  return { min: minObs.unitPrice, max: maxObs.unitPrice, avg: sum / obs.length, count: obs.length, minObs, maxObs };
};

/* ───────────────────────── período, série e variação ───────────────────────── */

export interface PeriodConfig {
  year: number;
  month: number | null;
  quickFilter: '7d' | '30d' | 'custom' | null;
  customStartDate: string;
  customEndDate: string;
}

// Mesma regra de período usada nas telas de categoria/produto.
export const isDateInPeriod = (date: string, config: PeriodConfig, now: Date = new Date()): boolean => {
  const d = new Date(date + 'T12:00:00');
  if (config.quickFilter === 'custom') {
    if (config.customStartDate && date < config.customStartDate) return false;
    if (config.customEndDate && date > config.customEndDate) return false;
    return true;
  }
  if (config.quickFilter === '7d' || config.quickFilter === '30d') {
    const limit = new Date(now);
    limit.setDate(limit.getDate() - (config.quickFilter === '7d' ? 7 : 30));
    return d >= limit;
  }
  if (d.getFullYear() !== config.year) return false;
  if (config.month !== null && d.getMonth() !== config.month) return false;
  return true;
};

const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const monthNamePt = (m: number): string => MONTHS_PT[m] || '';

const brDate = (iso: string): string => iso.split('-').reverse().join('/');

export const periodLabel = (config: PeriodConfig): string => {
  if (config.quickFilter === '7d') return 'Últimos 7 dias';
  if (config.quickFilter === '30d') return 'Últimos 30 dias';
  if (config.quickFilter === 'custom') {
    if (config.customStartDate && config.customEndDate) return `${brDate(config.customStartDate)} a ${brDate(config.customEndDate)}`;
    if (config.customStartDate) return `Desde ${brDate(config.customStartDate)}`;
    if (config.customEndDate) return `Até ${brDate(config.customEndDate)}`;
    return 'Período personalizado';
  }
  if (config.month !== null) return `${monthNamePt(config.month).replace(/^./, c => c.toUpperCase())} de ${config.year}`;
  return `Ano de ${config.year}`;
};

export interface HistoryItem {
  key: string;            // id único da linha (cupom + posição)
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  unitType?: string;
  date: string;
  establishment: string;
}

export interface SeriesPoint {
  t: number;              // meio-dia local do dia (ms)
  date: string;           // AAAA-MM-DD
  price: number;          // preço médio pago naquele dia (ponderado pela quantidade)
  qty: number;
  count: number;          // linhas de compra no dia
  stores: string[];
}

export interface PriceSeries {
  unit: string;
  units: string[];        // unidades presentes, a mais usada primeiro
  points: SeriesPoint[];
  avg: number;            // preço médio pago no período (ponderado)
  min: number;
  max: number;
  count: number;
}

const qtyOf = (i: { quantity: number }) => (Number(i.quantity) > 0 ? Number(i.quantity) : 1);

export const buildPriceSeries = (items: HistoryItem[], unit?: string): PriceSeries => {
  const valid = items.filter(i => Number(i.unitPrice) > 0);
  const counts = new Map<string, number>();
  valid.forEach(i => { const u = normalizeUnit(i.unitType); counts.set(u, (counts.get(u) || 0) + 1); });
  const units = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const wanted = unit ? normalizeUnit(unit) : '';
  const chosen = wanted && counts.has(wanted) ? wanted : (units[0] || 'UN');
  const sel = valid.filter(i => normalizeUnit(i.unitType) === chosen);

  const byDay = new Map<string, { money: number; qty: number; count: number; stores: Set<string> }>();
  let money = 0, qtySum = 0;
  sel.forEach(i => {
    const q = qtyOf(i);
    const g = byDay.get(i.date) || { money: 0, qty: 0, count: 0, stores: new Set<string>() };
    g.money += i.unitPrice * q; g.qty += q; g.count += 1; g.stores.add(i.establishment);
    byDay.set(i.date, g);
    money += i.unitPrice * q; qtySum += q;
  });

  const points: SeriesPoint[] = Array.from(byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, g]) => ({
      t: new Date(date + 'T12:00:00').getTime(), date,
      price: g.money / g.qty, qty: g.qty, count: g.count, stores: Array.from(g.stores),
    }));

  const prices = points.map(p => p.price);
  return {
    unit: chosen, units, points,
    avg: qtySum > 0 ? money / qtySum : 0,
    min: prices.length ? Math.min(...prices) : 0,
    max: prices.length ? Math.max(...prices) : 0,
    count: sel.length,
  };
};

// Variação de cada compra em relação à compra anterior do mesmo produto na mesma unidade (usa todo o histórico).
export const computeDeltas = (items: HistoryItem[]): Map<string, number | null> => {
  const asc = [...items].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const last = new Map<string, number>();
  const out = new Map<string, number | null>();
  asc.forEach(i => {
    const u = normalizeUnit(i.unitType);
    const prev = last.get(u);
    out.set(i.key, prev && prev > 0 && i.unitPrice > 0 ? ((i.unitPrice - prev) / prev) * 100 : null);
    if (i.unitPrice > 0) last.set(u, i.unitPrice);
  });
  return out;
};

export const weightedAverage = (items: { unitPrice: number; quantity: number }[]): number => {
  let money = 0, q = 0;
  items.forEach(i => { if (i.unitPrice > 0) { const w = qtyOf(i); money += i.unitPrice * w; q += w; } });
  return q > 0 ? money / q : 0;
};
