import { Receipt, MasterProduct } from '../types';
import { priceBasis } from './eggs';
import { normalizeUnit, stripAccentsUpper } from './productPriceStats';
import { deptKey, masterOf, properCase, titleCase } from './textFormat';
import { localTodayIso } from './productNormalization';
import { resolveIds, seedFrom, shuffled, weekPick } from './shoppingCatalog';

/* Lista de compras.
   Tudo aqui é conta feita sobre os cupons que já estão no aparelho: nada depende de internet nem de IA.
   A IA (shoppingListAI.ts) só opina sobre o período e sobre os itens; quem monta a lista é este arquivo.

   Ideia central: de cada produto sai um "consumo por dia" (quanto foi comprado na janela de compras recentes dividido
   pelos dias que essas compras cobriram). A lista de N dias compra consumo × N, arredondado para o que se compra de verdade
   (unidades inteiras, décimos de quilo). O preço é o da última compra. */

/* ───────────────────────── datas ───────────────────────── */

const pad = (n: number) => String(n).padStart(2, '0');
const utc = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
export const isIso = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(utc(s));
export const addDays = (iso: string, n: number): string => fromUtc(utc(iso) + n * 86_400_000);
export const diffDays = (a: string, b: string): number => Math.round((utc(b) - utc(a)) / 86_400_000);
export const weekdayOf = (iso: string): number => new Date(utc(iso)).getUTCDay();   // 0 = domingo
export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();   // month 1..12

export const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const shortDate = (iso: string): string => `${WEEKDAYS_SHORT[weekdayOf(iso)]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const median = (a: number[]): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/* ───────────────────────── unidades ───────────────────────── */

const STEP: Record<string, number> = { UN: 1, PCT: 1, CX: 1, DZ: 1, KG: 0.1, G: 50, L: 0.5, ML: 100 };
const MIN_QTY: Record<string, number> = { KG: 0.15, G: 80, L: 0.4, ML: 150 };
/** De quanto em quanto se compra: 1 unidade, 100 g, meio litro... */
export const stepOf = (unit: string): number => STEP[unit] ?? 1;
const minQtyOf = (unit: string): number => MIN_QTY[unit] ?? 0.6;
export const roundTo = (n: number, step: number): number => round3(Math.round(n / step + 1e-9) * step);

const UNIT_LABEL: Record<string, string> = { UN: 'un', KG: 'kg', G: 'g', L: 'L', ML: 'ml', PCT: 'pct', CX: 'cx', DZ: 'dz' };
export const unitLabel = (unit: string): string => UNIT_LABEL[unit] ?? unit.toLowerCase();
export const fmtQty = (qty: number, unit: string): string => {
  const n = round3(qty);
  const txt = Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return `${txt} ${unitLabel(unit)}`;
};

/** Reparte `total` entre as compras na proporção dos dias, em múltiplos de `step`, sem perder nem criar nenhuma unidade. */
export const distribute = (total: number, weights: number[], step: number): number[] => {
  const units = Math.round(total / step + 1e-9);
  const sum = weights.reduce((s, w) => s + w, 0);
  if (units <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map(w => (units * w) / sum);
  const base = raw.map(r => Math.floor(r + 1e-9));
  let left = units - base.reduce((s, b) => s + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r + 1e-9) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k].i] += 1;
  return base.map(u => round3(u * step));
};

/* ───────────────────────── o que entra na conta ───────────────────────── */

// Departamentos que não são compra de mercado (restaurante, combustível, serviços...). Departamento sem nome entra.
const NOT_MARKET = /restaurante|lanchonete|churrascaria|combust|transporte|servic|lazer|viagem|educa|imposto|taxa|salario|moradia|aluguel|energia|internet|telefon|vestu|roupa|calcad|eletro|veicul|automov|farmac|medic|\bsaude\b|presente|doac/;
// Departamentos de perecível: o que não é daqui dura na despensa.
const FRESH = new Set(['acougue', 'peixaria', 'hortifruti', 'padaria e confeitaria', 'frios e laticinios', 'laticinios e frios', 'rotisseria e comida pronta']);
const TREATS = new Set(['tabacaria e conveniencia', 'rotisseria e comida pronta', 'bazar e utilidades domesticas']);

export type Kind = 'fruta' | 'verdura' | 'outro';
export type MeatClass = 'bovina' | 'linguica' | 'frango' | 'suina';

const kindOf = (category: string): Kind => {
  const c = stripAccentsUpper(category);
  if (!/^HORTIFRUTI/.test(c)) return 'outro';
  if (/FRUTA/.test(c)) return 'fruta';
  if (/LEGUME|VERDURA|FOLHA|HORTALIC|TEMPERO|ERVA/.test(c)) return 'verdura';
  return 'outro';
};

const BOVINA = /PICANHA|FRALDINHA|MAMINHA|ALCATRA|CONTRA ?FILE|COSTELA BOV|COSTELA|CUPIM|ENTRECOT|ANCHO|VAZIO|RIB ?EYE|FILE MIGNON|T ?BONE|BAVETE|COXAO MOLE|COXAO DURO|LAGARTO|ESPETINHO BOV|ACEM/;
const SUINA = /COSTELINHA|COSTELA SUIN|PERNIL|BISTECA|COPA LOMBO|PANCETA|LOMBO|SUIN|PORCO|TOUCINHO/;
const LINGUICA = /LINGUI[CÇ]A|SALSICH|TOSCANA|CALABRESA|CHORIZO|CHOURI[CÇ]O/;
const FRANGO = /\bCOXAS?\b|SOBRECOXAS?|\bASAS?\b|ASINHA|CORACAO|TULIPA|ESPETINHO FRANGO|FRANGO INTEIRO/;
const NOT_BBQ = /MOIDA|HAMBURG|STROGON|EMPANAD|NUGGET|ALMONDEG|KIBE|STEAK|APERITIVO|DEFUMAD/;

export const meatClassOf = (description: string, dept: string): MeatClass | null => {
  if (deptKey(dept) !== 'acougue') return null;
  const d = stripAccentsUpper(description);
  if (NOT_BBQ.test(d) && !LINGUICA.test(d)) return null;
  if (LINGUICA.test(d)) return 'linguica';
  if (FRANGO.test(d)) return 'frango';
  if (SUINA.test(d)) return 'suina';
  if (BOVINA.test(d)) return 'bovina';
  return null;
};

/** Peso da embalagem pelo nome ("LINGUICA TOSCANA 500G" -> 0,5 kg). */
export const packKgOf = (description: string): number | null => {
  const m = /(\d+(?:[.,]\d+)?)\s*(KG|GRS?|G)\b/.exec(stripAccentsUpper(description));
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  const kg = m[2] === 'KG' ? n : n / 1000;
  return kg >= 0.05 && kg <= 10 ? kg : null;
};

/* ───────────────────────── produtos e histórico ───────────────────────── */

export const makeKeyer = (masters: MasterProduct[] = []) => {
  const alias = new Map<string, MasterProduct>();
  masters.forEach(m => (m.aliases || []).forEach(a => { if (!alias.has(a)) alias.set(a, m); }));
  return (description: string): { pid: string; name: string } | null => {
    const key = (description || '').trim().toUpperCase();
    if (!key) return null;
    const m = alias.get(key);
    return m ? { pid: `M:${m.code}`, name: m.description } : { pid: `D:${key}`, name: description.trim() };
  };
};

interface PLine {
  pid: string; name: string; dept: string; category: string; unit: string;
  date: string; qty: number; price: number; total: number; store: string; desc: string; rid: string;
}

export const collectLines = (receipts: Receipt[], masters: MasterProduct[], today: string): PLine[] => {
  const keyer = makeKeyer(masters);
  const out: PLine[] = [];
  receipts.forEach(r => {
    if (!isIso(r.date) || r.date > today) return;
    (r.items || []).forEach(item => {
      const k = keyer(item.description);
      if (!k) return;
      const category = String(item.category || '').trim();
      if (category && NOT_MARKET.test(deptKey(category))) return;
      const b = priceBasis(item);
      const qty = Number(b.quantity) > 0 ? Number(b.quantity) : 1;
      const total = Number(item.totalPrice) || 0;
      let price = Number(b.unitPrice) || 0;
      if (!(price > 0) && total > 0) price = total / qty;
      if (!(price > 0) && !(total > 0)) return;
      out.push({
        pid: k.pid, name: k.name, dept: masterOf(category) || 'Sem categoria', category, unit: normalizeUnit(b.unitType),
        date: r.date, qty, price, total: total > 0 ? total : price * qty, store: r.establishmentName, desc: item.description, rid: r.id,
      });
    });
  });
  return out;
};

export interface Product {
  pid: string;
  name: string;           // nome para mostrar
  dept: string;
  category: string;
  unit: string;           // unidade da última compra: o preço e as quantidades usam esta
  price: number;          // preço da última compra
  priceDate: string;
  store: string;
  buys: number;           // dias de compra na janela
  qty: number;            // quantidade comprada na janela
  typical: number;        // quantidade comum por dia de compra
  rate: number;           // consumo por dia
  freq: number;           // 0..1: em que fração das idas ao mercado aparece
  gap: number | null;     // dias entre compras
  daysSince: number;
  lastDate: string;
  kind: Kind;
  meat: MeatClass | null;
  packKg: number | null;
  score: number;
}

export interface TripInfo { date: string; stores: string[]; items: number; spend: number }

export interface History {
  today: string;
  empty: boolean;
  lowData: boolean;               // poucas idas ao mercado: a lista é uma estimativa grosseira
  window: { from: string; to: string };
  cycle: number;                  // dias entre uma ida ao mercado e a seguinte
  span: number;                   // dias que as compras da janela cobrem
  trips: TripInfo[];              // idas ao mercado, da mais antiga para a mais nova
  tripCount: number;              // idas dentro da janela
  products: Product[];            // consumo na janela
  longProducts: Product[];        // últimos 12 meses (para variedade e para completar o mínimo)
  firstDate: string;
  lastDate: string;
  avgTrip: number;                // gasto médio por ida ao mercado na janela
  perDay: number;                 // gasto por dia na janela
}

const emptyHistory = (today: string): History => ({
  today, empty: true, lowData: true, window: { from: today, to: today }, cycle: 14, span: 14, trips: [], tripCount: 0,
  products: [], longProducts: [], firstDate: today, lastDate: today, avgTrip: 0, perDay: 0,
});

const buildProducts = (lines: PLine[], from: string, to: string, span: number, tripCount: number, today: string): Product[] => {
  const byPid = new Map<string, PLine[]>();
  lines.forEach(l => { const a = byPid.get(l.pid); if (a) a.push(l); else byPid.set(l.pid, [l]); });
  const out: Product[] = [];
  byPid.forEach((all, pid) => {
    let last = all[0];
    all.forEach(l => { if (l.date >= last.date) last = l; });
    const unit = last.unit;
    const same = all.filter(l => l.unit === unit);
    const inWin = same.filter(l => l.date >= from && l.date <= to);
    if (!inWin.length) return;
    const perDay = new Map<string, number>();
    inWin.forEach(l => perDay.set(l.date, (perDay.get(l.date) || 0) + l.qty));
    const dates = Array.from(perDay.keys()).sort();
    const qty = Array.from(perDay.values()).reduce((s, q) => s + q, 0);
    const lastDate = same.reduce((m, l) => (l.date > m ? l.date : m), '');
    const category = last.category;
    const kind = kindOf(category);
    const freq = Math.min(1, dates.length / Math.max(1, tripCount));
    const gap = dates.length >= 2 ? diffDays(dates[0], dates[dates.length - 1]) / (dates.length - 1) : null;
    const daysSince = Math.max(0, diffDays(lastDate, today));
    const due = dates.length >= 2 && gap !== null && gap > 0 && daysSince >= gap * 0.9;
    const score = freq * 100 + (due ? 15 : 0) - (TREATS.has(deptKey(last.dept)) ? 25 : 0);
    out.push({
      pid, name: titleCase(last.name), dept: properCase(last.dept), category, unit, price: last.price, priceDate: last.date, store: last.store,
      buys: dates.length, qty, typical: median(Array.from(perDay.values())), rate: qty / span, freq, gap, daysSince, lastDate, kind,
      meat: meatClassOf(last.desc, last.dept), packKg: packKgOf(last.desc), score: Math.max(0, score),
    });
  });
  return out.sort((a, b) => b.score - a.score || b.buys - a.buys || a.name.localeCompare(b.name, 'pt-BR'));
};

export interface AnalyzeOpts {
  today?: string;
  window?: { from?: string; to?: string };   // período que a IA (ou a pessoa) escolheu
  cycle?: number;
  lookbackDays?: number;                     // período maior escolhido pela pessoa (a partir da última ida ao mercado)
}

/** Olha os cupons e descobre: quando a pessoa vai ao mercado, de quantos em quantos dias, e quanto de cada produto ela consome. */
export const analyzeHistory = (receipts: Receipt[], masters: MasterProduct[] = [], o: AnalyzeOpts = {}): History => {
  const today = o.today && isIso(o.today) ? o.today : localTodayIso();
  const lines = collectLines(receipts, masters, today);
  if (!lines.length) return emptyHistory(today);

  const byDate = new Map<string, { n: number; spend: number; stores: Set<string> }>();
  lines.forEach(l => {
    const g = byDate.get(l.date) || { n: 0, spend: 0, stores: new Set<string>() };
    g.n += 1; g.spend += l.total; g.stores.add(l.store);
    byDate.set(l.date, g);
  });
  const allDates = Array.from(byDate.keys()).sort();
  // ida ao mercado = dia com 3 itens ou mais, ou R$ 40 ou mais; compras miúdas não marcam o ritmo
  let tripDays = allDates.filter(d => { const g = byDate.get(d)!; return g.n >= 3 || g.spend >= 40; });
  if (!tripDays.length) tripDays = allDates;

  // idas em dias seguidos (ou com 1 dia de intervalo) contam como uma ida só
  const starts: string[] = [];
  tripDays.forEach((d, i) => { if (i === 0 || diffDays(tripDays[i - 1], d) > 2) starts.push(d); });
  const gaps: number[] = [];
  starts.slice(-9).forEach((d, i, a) => { if (i > 0) gaps.push(diffDays(a[i - 1], d)); });
  const measured = gaps.length ? Math.round(median(gaps)) : 14;
  const cycle = clamp(Math.round(o.cycle && o.cycle > 0 ? o.cycle : measured), 3, 35);

  let to = tripDays[tripDays.length - 1];
  let from = addDays(to, -Math.max(56, cycle * 6, o.lookbackDays && o.lookbackDays > 0 ? o.lookbackDays : 0));
  if (o.window?.to && isIso(o.window.to)) to = o.window.to > today ? today : o.window.to;
  if (o.window?.from && isIso(o.window.from)) from = o.window.from;
  let inWin = tripDays.filter(d => d >= from && d <= to);
  if (!inWin.length) {                                   // período que a IA propôs sem nenhuma ida: volta ao padrão
    to = tripDays[tripDays.length - 1];
    from = addDays(to, -Math.max(56, cycle * 6, o.lookbackDays && o.lookbackDays > 0 ? o.lookbackDays : 0));
    inWin = tripDays.filter(d => d >= from && d <= to);
  }
  const fromTrip = inWin[0];
  const toTrip = inWin[inWin.length - 1];
  const span = Math.max(cycle, diffDays(fromTrip, toTrip) + cycle);
  const tripCount = inWin.length;

  const longFrom = addDays(today, -365);
  const longTrips = tripDays.filter(d => d >= longFrom && d <= today).length;
  const firstDate = allDates[0];
  const longSpan = Math.max(60, Math.min(365, diffDays(firstDate, today) + 1));

  const trips: TripInfo[] = tripDays.slice(-120).map(d => {
    const g = byDate.get(d)!;
    return { date: d, stores: Array.from(g.stores), items: g.n, spend: Math.round(g.spend * 100) / 100 };
  });

  const winSpend = lines.filter(l => l.date >= fromTrip && l.date <= toTrip).reduce((sum, l) => sum + l.total, 0);

  return {
    today, empty: false, lowData: starts.length < 3, window: { from: fromTrip, to: toTrip }, cycle, span, trips, tripCount,
    products: buildProducts(lines, fromTrip, toTrip, span, tripCount, today),
    longProducts: buildProducts(lines, longFrom, today, longSpan, Math.max(1, longTrips), today),
    firstDate, lastDate: allDates[allDates.length - 1],
    avgTrip: winSpend / Math.max(1, tripCount), perDay: winSpend / span,
  };
};

/** Procura no que a pessoa comprou nos últimos 12 meses (para "adicionar item"). */
export const findProducts = (h: History, query: string, limit = 8): Product[] => {
  const q = stripAccentsUpper(query).replace(/\s+/g, ' ').trim();
  if (q.length < 2) return [];
  const tokens = q.split(' ');
  return h.longProducts.filter(p => { const f = stripAccentsUpper(p.name); return tokens.every(t => f.includes(t)); }).sort(byUse).slice(0, limit);
};

/* ───────────────────────── datas de compra ───────────────────────── */

export interface PurchasePlan { date: string; days: number }

export type Mode = 'single' | 'weekly' | 'month';

export interface Setup {
  mode: Mode;
  days: number;               // uma compra: quantos dias ela cobre
  weekday: number;            // por semana: dia da semana da compra (0 = domingo)
  weeks: number;              // por semana: quantas semanas
  year: number;               // mês
  month: number;              // 1..12
  monthDays: number[];        // mês: dias do mês em que vai ao mercado
  min: number | null;
  max: number | null;
  fruitVeg: boolean;
  fruits: number;
  veggies: number;
  /** cardápio escolhido no catálogo (ids); vazio = automático, pelo que a pessoa mais compra */
  fruitPool: string[];
  veggiePool: string[];
  meatPool: string[];
  churrasco: boolean;
  churrascoWeekday: number;
  people: number;
  grams: number;              // carne por pessoa, em gramas
  useAi: boolean;
  lookback: number;           // período analisado: 0 = automático (últimas semanas); senão, dias para trás a partir da última compra
}

/** Períodos de análise que a pessoa pode escolher (em dias; 0 = automático, 3650 = todo o histórico). */
export const LOOKBACKS = [0, 90, 180, 365, 3650];
export const lookbackLabel = (days: number): string =>
  days === 0 ? 'Automático' : days >= 3650 ? 'Tudo' : days === 90 ? '3 meses' : days === 180 ? '6 meses' : days === 365 ? '12 meses' : `${days} dias`;

export const defaultSetup = (today: string, cycle = 7): Setup => ({
  mode: 'single', days: clamp(Math.round(cycle), 3, 35), weekday: weekdayOf(today), weeks: 4,
  year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)), monthDays: [],
  min: null, max: null, fruitVeg: false, fruits: 4, veggies: 5, fruitPool: [], veggiePool: [], meatPool: [], churrasco: false, churrascoWeekday: 6, people: 4, grams: 400, useAi: true, lookback: 0,
});

export const weeklyPurchases = (weekday: number, weeks: number, today: string): PurchasePlan[] => {
  const first = addDays(today, (weekday - weekdayOf(today) + 7) % 7);
  return Array.from({ length: clamp(Math.round(weeks) || 1, 1, 8) }, (_, i) => ({ date: addDays(first, i * 7), days: 7 }));
};

/** Dias do mês escolhidos viram compras; cada uma cobre os dias até a próxima, e a última até o fim do mês. */
export const monthPurchases = (year: number, month: number, chosen: number[], today: string): PurchasePlan[] => {
  const dim = daysInMonth(year, month);
  const isNow = today.slice(0, 7) === `${year}-${pad(month)}`;
  const minDay = isNow ? Number(today.slice(8, 10)) : 1;
  const ds = Array.from(new Set(chosen.map(Math.round))).filter(d => d >= minDay && d <= dim).sort((a, b) => a - b);
  return ds.map((d, i) => ({ date: `${year}-${pad(month)}-${pad(d)}`, days: (i + 1 < ds.length ? ds[i + 1] : dim + 1) - d }));
};

export const purchasesFromSetup = (s: Setup, today: string): PurchasePlan[] => {
  if (s.mode === 'weekly') return weeklyPurchases(s.weekday, s.weeks, today);
  if (s.mode === 'month') return monthPurchases(s.year, s.month, s.monthDays, today);
  return [{ date: today, days: clamp(Math.round(s.days) || 7, 1, 60) }];
};

export type MonthPreset = 'semanal' | 'quinzenal' | 'mensal';

/** Dias sugeridos para o mês: toda semana, a cada 15 dias ou uma compra só, começando hoje (mês atual) ou no dia 1. */
export const presetMonthDays = (kind: MonthPreset, year: number, month: number, today: string): number[] => {
  const dim = daysInMonth(year, month);
  const start = today.slice(0, 7) === `${year}-${pad(month)}` ? Number(today.slice(8, 10)) : 1;
  const every = kind === 'semanal' ? 7 : kind === 'quinzenal' ? 15 : dim;
  const out: number[] = [];
  for (let d = start; d <= dim; d += every) out.push(d);
  while (out.length > 1 && dim - out[out.length - 1] + 1 < 4) out.pop();     // sobra de 1 a 3 dias não vira compra
  return out;
};

const num = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? clamp(n, lo, hi) : dflt;
};
const ids = (v: unknown): string[] => Array.isArray(v) ? Array.from(new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 90))).slice(0, 120) : [];
const money = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/** Lê o que veio do armazenamento sem confiar nele. */
export const sanitizeSetup = (raw: any, today: string, cycle = 7): Setup => {
  const d = defaultSetup(today, cycle);
  if (!raw || typeof raw !== 'object') return d;
  const mode: Mode = raw.mode === 'weekly' || raw.mode === 'month' ? raw.mode : 'single';
  return {
    mode,
    days: num(raw.days, 1, 60, d.days),
    weekday: num(raw.weekday, 0, 6, d.weekday),
    weeks: num(raw.weeks, 1, 8, d.weeks),
    year: num(raw.year, 2000, 2100, d.year),
    month: num(raw.month, 1, 12, d.month),
    monthDays: Array.isArray(raw.monthDays) ? (Array.from(new Set(raw.monthDays.map((x: unknown) => Number(x)).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 31))) as number[]).sort((a, b) => a - b) : [],
    min: money(raw.min), max: money(raw.max),
    fruitVeg: !!raw.fruitVeg, fruits: num(raw.fruits, 0, 12, d.fruits), veggies: num(raw.veggies, 0, 12, d.veggies),
    fruitPool: ids(raw.fruitPool), veggiePool: ids(raw.veggiePool), meatPool: ids(raw.meatPool),
    churrasco: !!raw.churrasco, churrascoWeekday: num(raw.churrascoWeekday, 0, 6, d.churrascoWeekday),
    people: num(raw.people, 1, 60, d.people), grams: num(raw.grams, 100, 1000, d.grams),
    useAi: raw.useAi !== false,
    lookback: LOOKBACKS.includes(Number(raw.lookback)) ? Number(raw.lookback) : 0,
  };
};

/* ───────────────────────── a lista ───────────────────────── */

export type Group = 'regular' | 'fruta' | 'verdura' | 'churrasco' | 'extra' | 'manual';

export interface Entry {
  pid: string;
  name: string;
  dept: string;
  category: string;
  unit: string;
  price: number;          // 0 = sem histórico: a pessoa informa
  priceDate: string;
  store: string;
  qty: number;
  group: Group;
  cart: boolean;          // já está no carrinho
  note?: string;
}

export interface PlanPurchase { id: string; date: string; days: number; entries: Entry[] }

export interface CutLine {
  pid: string; name: string; dept: string; category: string; unit: string; price: number; priceDate: string; store: string;
  group: Group;
  qtys: number[];         // quanto iria em cada compra
  why: 'orcamento' | 'ia' | 'removido';
  reason: string;
}

export interface Advice {
  items?: Record<string, { qty?: number; drop?: string }>;
  seasonal?: string[];    // pids de hortifruti de época
}

export interface PlanOptions {
  purchases: PurchasePlan[];
  min?: number | null;
  max?: number | null;
  fruitVeg?: { fruits: number; veggies: number; fruitPool?: string[]; veggiePool?: string[] } | null;
  churrasco?: { weekday: number; people: number; grams: number; pool?: string[] } | null;
  /** semente do sorteio do cardápio escolhido (a mesma semente dá a mesma lista) */
  seed?: number;
}

export interface PlanResult { purchases: PlanPurchase[]; cut: CutLine[]; notes: string[] }

interface Row {
  pid: string; name: string; dept: string; category: string; unit: string; price: number; priceDate: string; store: string;
  group: Group; qtys: number[]; notes: (string | undefined)[]; score: number;
}

const cost = (r: { price: number; qtys: number[] }) => r.price * r.qtys.reduce((s, q) => s + q, 0);
const rowOf = (p: Product, group: Group, n: number, score: number): Row => ({
  pid: p.pid, name: p.name, dept: p.dept, category: p.category, unit: p.unit, price: p.price, priceDate: p.priceDate, store: p.store,
  group, qtys: new Array(n).fill(0), notes: new Array(n).fill(undefined), score,
});

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const byUse = (a: Product, b: Product) => b.buys - a.buys || (b.lastDate > a.lastDate ? 1 : b.lastDate < a.lastDate ? -1 : 0) || a.name.localeCompare(b.name, 'pt-BR');

/* — churrasco — */

const BASE_SHARE: Record<MeatClass, number> = { bovina: 0.5, linguica: 0.2, frango: 0.2, suina: 0.1 };
const CLASS_NAME: Record<MeatClass, string> = { bovina: 'carne bovina', linguica: 'linguiça', frango: 'frango', suina: 'carne suína' };
const CLASS_SCORE: Record<MeatClass, number> = { bovina: 66, linguica: 62, frango: 60, suina: 58 };
const DEFAULTS: Partial<Record<MeatClass, string>> = { bovina: 'Picanha', linguica: 'Linguiça toscana', frango: 'Coxa e sobrecoxa de frango' };

const planChurrasco = (h: History, c: NonNullable<PlanOptions['churrasco']>, P: PurchasePlan[], seed = 0) => {
  const n = P.length;
  const notes: string[] = [];
  const claimed = new Set<string>();
  const rows = new Map<string, Row>();

  const first = P[0].date;
  const end = addDays(P[n - 1].date, P[n - 1].days - 1);
  const occ: { date: string; idx: number }[] = [];
  for (let d = addDays(first, (c.weekday - weekdayOf(first) + 7) % 7); d <= end; d = addDays(d, 7)) {
    let idx = 0;
    P.forEach((p, i) => { if (p.date <= d) idx = i; });
    occ.push({ date: d, idx });
  }
  if (!occ.length) return { rows, claimed, notes };

  // cardápio escolhido pela pessoa no catálogo (pode ter carne que ela nunca comprou); sem escolha, vale o que ela já compra
  const chosen = c.pool && c.pool.length ? resolveIds(h, c.pool, 'carne') : null;
  const chosenExtras: Product[] = [];
  const pool: Record<MeatClass, Product[]> = { bovina: [], linguica: [], frango: [], suina: [] };
  h.longProducts.filter(p => p.meat && (p.unit === 'KG' || (p.packKg && (p.unit === 'UN' || p.unit === 'PCT')))).sort(byUse)
    .forEach(p => { if (!chosen) pool[p.meat!].push(p); claimed.add(p.pid); });
  if (chosen) {
    chosen.forEach(it => {
      claimed.add(it.id);
      if (it.cls && it.cls !== 'extra') pool[it.cls].push(it.product); else chosenExtras.push(it.product);
    });
    (Object.keys(pool) as MeatClass[]).forEach(k => { pool[k] = shuffled(pool[k], seed + seedFrom(k)); });
  }
  const hasAny = (Object.keys(pool) as MeatClass[]).some(k => pool[k].length);
  const classes = (Object.keys(pool) as MeatClass[]).filter(k => pool[k].length || (!chosen && !hasAny && DEFAULTS[k]));
  const shareSum = classes.reduce((s, k) => s + BASE_SHARE[k], 0);
  const totalKg = Math.max(0.2, (c.people * c.grams) / 1000);
  if (!hasAny && !chosen) notes.push('Não achei carne de churrasco nos seus cupons: coloquei sugestões sem preço. Informe o valor de cada uma.');

  const labelOf = (d: string) => `churrasco ${shortDate(d)}`;
  const addTo = (key: string, make: () => Row, idx: number, qty: number, date: string) => {
    let r = rows.get(key);
    if (!r) { r = make(); rows.set(key, r); }
    r.qtys[idx] = round3(r.qtys[idx] + qty);
    const lab = labelOf(date);
    r.notes[idx] = r.notes[idx] ? (r.notes[idx]!.includes(lab) ? r.notes[idx] : `${r.notes[idx]}; ${lab}`) : lab;
  };

  occ.forEach((o, k) => {
    classes.forEach(cls => {
      const kg = Math.max(0.2, roundTo((totalKg * BASE_SHARE[cls]) / shareSum, 0.1));
      const list = pool[cls];
      if (list.length) {
        const p = list[k % list.length];
        const perKg = p.unit === 'KG' ? 1 : (p.packKg || 1);
        const qty = p.unit === 'KG' ? kg : Math.max(1, Math.round(kg / perKg));
        addTo(p.pid, () => rowOf(p, 'churrasco', n, CLASS_SCORE[cls]), o.idx, qty, o.date);
      } else {
        const name = DEFAULTS[cls]!;
        addTo(`X:${cls}`, () => ({
          pid: `X:${cls}`, name, dept: 'Açougue', category: 'Açougue', unit: 'KG', price: 0, priceDate: '', store: '',
          group: 'churrasco', qtys: new Array(n).fill(0), notes: new Array(n).fill(undefined), score: CLASS_SCORE[cls],
        }), o.idx, kg, o.date);
      }
    });
    const alho = (p: Product) => (p.unit === 'KG' ? 0.3 : Math.max(1, Math.ceil(c.people / 3)));
    if (chosen) {
      // só o que a pessoa escolheu (pão de alho, queijo coalho, carvão...), em todo churrasco
      chosenExtras.forEach(p => {
        const qty = /PAO DE ALHO/.test(stripAccentsUpper(p.name)) ? alho(p) : p.unit === 'KG' ? Math.max(0.2, p.typical) : 1;
        addTo(p.pid, () => rowOf(p, 'churrasco', n, 64), o.idx, qty, o.date);
      });
      return;
    }
    // carvão e pão de alho, se a pessoa já comprou
    const extra = (re: RegExp, qtyOf: (p: Product) => number) => {
      const p = h.longProducts.filter(x => re.test(stripAccentsUpper(x.name))).sort(byUse)[0];
      if (!p) return;
      claimed.add(p.pid);
      addTo(p.pid, () => rowOf(p, 'churrasco', n, 64), o.idx, qtyOf(p), o.date);
    };
    extra(/CARVAO/, () => 1);
    extra(/PAO DE ALHO/, alho);
  });

  const kinds = classes.map(k => CLASS_NAME[k]).join(', ');
  notes.push(`Churrasco ${WEEKDAYS[c.weekday]}: ${occ.length} ${occ.length === 1 ? 'vez' : 'vezes'}, ${c.people} pessoas × ${c.grams} g (${kinds || 'sem carnes escolhidas'}). As carnes do churrasco saem da lista comum para não contar duas vezes.`);
  if (chosen) notes.push(`Carnes do churrasco: ${chosen.length} ${chosen.length === 1 ? 'escolhida' : 'escolhidas'} por você no catálogo${chosen.some(i => !i.bought) ? '; as que você nunca comprou ficam sem preço' : ''}.`);
  return { rows, claimed, notes };
};

/* — frutas e verduras da semana — */

const planFruitVeg = (h: History, fv: NonNullable<PlanOptions['fruitVeg']>, P: PurchasePlan[], seasonal: Set<string>, seed = 0) => {
  const n = P.length;
  const rows = new Map<string, Row>();
  const notes: string[] = [];
  const poolOf = (kind: Kind): Product[] => {
    const list = h.longProducts.filter(p => p.kind === kind && p.price > 0).sort(byUse);
    if (!seasonal.size) return list;
    return [...list.filter(p => seasonal.has(p.pid)), ...list.filter(p => !seasonal.has(p.pid))];
  };
  const pick = (pool: Product[], want: number, i: number): Product[] => {
    if (want <= 0 || !pool.length) return [];
    if (pool.length <= want) return pool;
    const fixed = Math.ceil(want / 2);
    const rest = pool.slice(fixed, fixed + want * 3);
    const take = want - fixed;
    const out = pool.slice(0, fixed);
    for (let k = 0; k < take && rest.length; k++) out.push(rest[(i * take + k) % rest.length]);
    return Array.from(new Set(out));
  };
  const chosenCount: Record<string, number> = {};
  (['fruta', 'verdura'] as const).forEach(kind => {
    const want = kind === 'fruta' ? fv.fruits : fv.veggies;
    // cardápio escolhido no catálogo: sorteia entre eles, mudando a cada semana; sem escolha, o que a pessoa mais compra
    const ids = kind === 'fruta' ? fv.fruitPool : fv.veggiePool;
    const chosen = ids && ids.length ? resolveIds(h, ids, kind).map(i => i.product) : null;
    const menu = chosen ? shuffled(chosen, seed + seedFrom(kind)) : null;
    if (menu) chosenCount[kind] = menu.length;
    const pool = menu || poolOf(kind);
    if (want > 0 && !pool.length) notes.push(`Sem ${kind === 'fruta' ? 'frutas' : 'verduras e legumes'} nos seus cupons para sugerir.`);
    P.forEach((pl, i) => {
      const scale = clamp(pl.days / 7, 0.5, 4);
      (menu ? weekPick(menu, want, i) : pick(pool, want, i)).forEach(p => {
        let r = rows.get(p.pid);
        if (!r) { r = rowOf(p, kind, n, 55 + Math.min(30, p.buys * 3)); rows.set(p.pid, r); }
        const step = stepOf(p.unit);
        r.qtys[i] = Math.max(step, roundTo(Math.max(p.typical, step) * scale, step));
      });
    });
  });
  if (rows.size) notes.push(`Frutas e verduras: ${fv.fruits} frutas e ${fv.veggies} verduras/legumes por semana${Object.keys(chosenCount).length < 2 ? `, a partir do que você mais compra${seasonal.size ? ' (as de época primeiro)' : ''}` : ''}.`);
  (['fruta', 'verdura'] as const).forEach(kind => {
    const m = chosenCount[kind];
    const want = kind === 'fruta' ? fv.fruits : fv.veggies;
    if (m && want > 0) notes.push(`${kind === 'fruta' ? 'Frutas' : 'Verduras e legumes'}: ${m <= want ? `as ${m} que você escolheu entram em toda compra` : `sorteei ${want} a cada compra entre as ${m} que você escolheu, trocando de uma para outra`}.`);
  });
  return { rows, notes };
};

/* — montagem — */

export const buildList = (h: History, opts: PlanOptions, advice: Advice = {}): PlanResult => {
  const P = opts.purchases;
  const n = P.length;
  const notes: string[] = [];
  if (!n) return { purchases: [], cut: [], notes: ['Escolha ao menos um dia de compra.'] };
  const weights = P.map(p => p.days);
  const H = weights.reduce((s, w) => s + w, 0);
  const rows: Row[] = [];
  const claimed = new Set<string>();
  const aiCut: CutLine[] = [];

  if (opts.churrasco) {
    const ch = planChurrasco(h, opts.churrasco, P, opts.seed ?? 0);
    ch.rows.forEach(r => rows.push(r));
    ch.claimed.forEach(id => claimed.add(id));
    notes.push(...ch.notes);
  }
  if (opts.fruitVeg) {
    const fv = planFruitVeg(h, opts.fruitVeg, P, new Set(advice.seasonal || []), opts.seed ?? 0);
    fv.rows.forEach(r => { if (!claimed.has(r.pid)) rows.push(r); });
    notes.push(...fv.notes);
  }

  let regular = 0;
  h.products.forEach(p => {
    if (claimed.has(p.pid)) return;
    if (opts.fruitVeg && (p.kind === 'fruta' || p.kind === 'verdura')) return;
    const step = stepOf(p.unit);
    const adv = advice.items?.[p.pid];
    const e = p.rate * H;
    let units = 0;
    let first = false;
    if (adv && adv.qty !== undefined && Number.isFinite(adv.qty) && adv.qty >= 0) {
      units = roundTo(Math.min(adv.qty, Math.max(e * 3, p.typical * 2, step * 2)), step);
    } else if (e >= minQtyOf(p.unit) && (p.buys >= 2 || h.tripCount <= 2)) {      // compra única (panela, presente) não vira rotina
      units = Math.max(step, roundTo(e, step));
    } else if (p.buys >= 2 && p.gap && p.daysSince >= p.gap * 0.9) {
      units = Math.max(step, roundTo(p.typical, step));       // chegou a hora de repor
      first = true;
    }
    const row = rowOf(p, 'regular', n, p.score);
    if (adv && typeof adv.drop === 'string' && units > 0) {
      row.qtys = first ? [units, ...new Array(n - 1).fill(0)] : distribute(units, weights, step);
      aiCut.push({ ...cutOf(row, 'ia', `IA: ${adv.drop || 'não precisa agora'}`) });
      return;
    }
    if (units <= 0) return;
    row.qtys = first ? [units, ...new Array(n - 1).fill(0)] : distribute(units, weights, step);
    if (row.qtys.some(q => q > 0)) { rows.push(row); regular += 1; }
  });

  /* — teto — */
  let total = rows.reduce((s, r) => s + cost(r), 0);
  const intended = total;
  let kept = [...rows];
  const dropped: Row[] = [];
  const max = opts.max && opts.max > 0 ? opts.max : 0;
  const min = opts.min && opts.min > 0 ? opts.min : 0;
  if (max && total > max) {
    const order = kept.filter(r => r.price > 0).sort((a, b) => a.score - b.score || cost(b) - cost(a));
    for (const r of order) {
      if (total <= max) break;
      dropped.push(r);
      total -= cost(r);
      kept = kept.filter(x => x !== r);
    }
    for (const r of [...dropped].sort((a, b) => b.score - a.score || cost(a) - cost(b))) {     // o que ainda cabe volta
      if (total + cost(r) <= max + 1e-9) { kept.push(r); total += cost(r); dropped.splice(dropped.indexOf(r), 1); }
    }
    if (dropped.length) notes.push(`Teto de ${brl(max)}: a lista pretendida dava ${brl(intended)}; tirei ${dropped.length} ${dropped.length === 1 ? 'item' : 'itens'} (os menos frequentes primeiro) e ficou em ${brl(total)}.`);
  }

  /* — mínimo — */
  const sub = (i: number) => kept.reduce((s, r) => s + r.price * r.qtys[i], 0);
  const lightest = () => { let b = 0; let bv = Infinity; for (let i = 0; i < n; i++) { const v = sub(i) / P[i].days; if (v < bv) { bv = v; b = i; } } return b; };
  if (min && total < min) {
    const before = total;
    const have = new Set([...kept, ...dropped].map(r => r.pid));
    aiCut.forEach(c => have.add(c.pid));
    const pool = h.longProducts.filter(p => !have.has(p.pid) && !claimed.has(p.pid) && p.price > 0
      && !(opts.fruitVeg && (p.kind === 'fruta' || p.kind === 'verdura')) && !p.meat).sort((a, b) => b.score - a.score || byUse(a, b));
    let added = 0;
    for (const p of pool) {
      if (total >= min) break;
      const step = stepOf(p.unit);
      const q = Math.max(step, roundTo(p.typical, step));
      const c = p.price * q;
      if (max && total + c > max + 1e-9) continue;
      const row = rowOf(p, 'extra', n, p.score);
      row.qtys[lightest()] = q;
      row.notes[row.qtys.findIndex(x => x > 0)] = 'para chegar ao mínimo';
      kept.push(row); total += c; added += 1;
    }
    let reinforced = 0;
    if (total < min) {
      const stock = kept.filter(r => r.price > 0 && r.group === 'regular' && !FRESH.has(deptKey(r.dept))).sort((a, b) => b.score - a.score);
      for (let round = 0; round < 3 && total < min && stock.length; round++) {
        for (const r of stock) {
          if (total >= min) break;
          const step = stepOf(r.unit);
          if (max && total + r.price * step > max + 1e-9) continue;
          const i = lightest();
          r.qtys[i] = round3(r.qtys[i] + step);
          total += r.price * step; reinforced += 1;
        }
      }
    }
    if (added) notes.push(`Mínimo de ${brl(min)}: a lista dava ${brl(before)}; juntei ${added} ${added === 1 ? 'item' : 'itens'} que você já comprou antes${reinforced ? ` e reforcei o estoque de ${reinforced} ${reinforced === 1 ? 'item' : 'itens'} de despensa` : ''}.`);
    else if (reinforced) notes.push(`Mínimo de ${brl(min)}: reforcei o estoque de ${reinforced} ${reinforced === 1 ? 'item' : 'itens'} de despensa.`);
    if (total < min - 0.005) notes.push(`Faltam ${brl(min - total)} para o mínimo de ${brl(min)}: não há mais itens do seu histórico para completar.`);
  }

  const noPrice = kept.filter(r => r.price <= 0).length;
  if (noPrice) notes.push(`${noPrice} ${noPrice === 1 ? 'item está' : 'itens estão'} sem preço (nunca comprados): informe o valor para entrar na soma.`);
  if (h.lowData) notes.push('Há poucas idas ao mercado nos cupons: quanto mais cupons, mais certeira fica a lista.');
  if (!regular && !kept.length) notes.push('Não achei compras suficientes nos cupons para montar a lista.');

  const purchases: PlanPurchase[] = P.map((p, i) => ({
    id: `p${i + 1}`, date: p.date, days: p.days,
    entries: kept.filter(r => r.qtys[i] > 0).map<Entry>(r => ({
      pid: r.pid, name: r.name, dept: r.dept, category: r.category, unit: r.unit, price: r.price, priceDate: r.priceDate, store: r.store,
      qty: r.qtys[i], group: r.group, cart: false, ...(r.notes[i] ? { note: r.notes[i] } : {}),
    })).sort(entryOrder),
  }));
  const cut: CutLine[] = [
    ...dropped.map(r => cutOf(r, 'orcamento', 'não cabe no teto')),
    ...aiCut,
  ];
  return { purchases, cut, notes };
};

const cutOf = (r: Row, why: CutLine['why'], reason: string): CutLine => ({
  pid: r.pid, name: r.name, dept: r.dept, category: r.category, unit: r.unit, price: r.price, priceDate: r.priceDate, store: r.store,
  group: r.group, qtys: [...r.qtys], why, reason,
});

const GROUP_ORDER: Record<Group, number> = { churrasco: 0, fruta: 1, verdura: 2, regular: 3, extra: 4, manual: 5 };
export const entryOrder = (a: Entry, b: Entry): number =>
  a.dept.localeCompare(b.dept, 'pt-BR') || GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.name.localeCompare(b.name, 'pt-BR');

/* ───────────────────────── lista salva e totais ───────────────────────── */

export interface BaseInfo {
  from: string; to: string; cycle: number; trips: number;
  source: 'historico' | 'ia';
  aiLabel?: string;
  note?: string;
  aiError?: string;
  /** lista feita à mão: sem histórico por trás */
  manual?: boolean;
  /** nome da lista base de onde partiu */
  base?: string;
  /** período analisado escolhido (dias; 0 = automático) */
  lookback?: number;
}

export interface ShoppingList {
  id: string;
  name: string;
  createdAt: string;
  setup: Setup;
  info: BaseInfo;
  purchases: PlanPurchase[];
  cut: CutLine[];
  notes: string[];
  /** quando a pessoa apertou "Gravar" (ou deu nome) à lista; sem isso a lista fica salva sozinha, mas ainda sem "gravar" */
  savedAt?: number;
}

export const entryCost = (e: Entry): number => (e.price > 0 ? e.price * e.qty : 0);
export const purchaseTotal = (p: PlanPurchase): number => p.entries.reduce((s, e) => s + entryCost(e), 0);
export const listTotal = (l: Pick<ShoppingList, 'purchases'>): number => l.purchases.reduce((s, p) => s + purchaseTotal(p), 0);
export const cartTotal = (p: PlanPurchase): number => p.entries.reduce((s, e) => s + (e.cart ? entryCost(e) : 0), 0);
export const cutTotal = (l: Pick<ShoppingList, 'cut'>): number => l.cut.reduce((s, c) => s + (c.price > 0 ? c.price * c.qtys.reduce((a, q) => a + q, 0) : 0), 0);

export interface BudgetState { total: number; min: number | null; max: number | null; status: 'ok' | 'acima' | 'abaixo' | 'livre'; gap: number }
export const budgetState = (l: Pick<ShoppingList, 'purchases' | 'setup'>): BudgetState => {
  const total = listTotal(l);
  const { min, max } = l.setup;
  if (max && total > max + 0.005) return { total, min, max, status: 'acima', gap: total - max };
  if (min && total < min - 0.005) return { total, min, max, status: 'abaixo', gap: min - total };
  return { total, min, max, status: min || max ? 'ok' : 'livre', gap: 0 };
};

export const newListId = (): string => `sl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const listName = (s: Setup, purchases: PlanPurchase[]): string => {
  if (s.mode === 'month') return `Compras de ${MONTHS[s.month - 1]} de ${s.year}`;
  if (s.mode === 'weekly') return `Compras de ${purchases.length} ${purchases.length === 1 ? 'semana' : 'semanas'}`;
  return `Compra de ${shortDate(purchases[0]?.date || localTodayIso())}`;
};

/** Os produtos da lista base como se fossem o consumo da pessoa: o ritmo vem das quantidades da base e o preço, do último cupom. */
export const baseProducts = (h: History, base: Pick<ShoppingList, 'purchases'>): Product[] => {
  const days = base.purchases.reduce((n, p) => n + Math.max(1, p.days), 0) || 1;
  const first = new Map<string, Entry>();
  const sum = new Map<string, number>();
  base.purchases.forEach(p => p.entries.forEach(e => {
    if (e.group !== 'regular' && e.group !== 'manual') return;   // frutas, verduras e churrasco têm as próprias opções
    sum.set(e.pid, (sum.get(e.pid) || 0) + e.qty);
    if (!first.has(e.pid)) first.set(e.pid, e);
  }));
  const known = new Map<string, Product>();
  h.longProducts.forEach(p => known.set(p.pid, p));
  h.products.forEach(p => known.set(p.pid, p));
  const out: Product[] = [];
  sum.forEach((q, pid) => {
    const e = first.get(pid)!;
    const rate = q / days;
    const k = known.get(pid);
    if (k && k.unit === e.unit) {
      out.push({ ...k, rate, buys: Math.max(2, k.buys), freq: Math.max(k.freq, 0.5), score: 100 + k.score / 100 });
    } else {
      out.push({
        pid, name: e.name, dept: e.dept, category: e.category, unit: e.unit, price: e.price, priceDate: e.priceDate, store: e.store,
        buys: 2, qty: q, typical: q / Math.max(1, base.purchases.length), rate, freq: 0.5, gap: null, daysSince: 0,
        lastDate: e.priceDate || h.today, kind: kindOf(e.category), meat: null, packKg: null, score: 100,
      });
    }
  });
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt-BR'));
};

/** O histórico trocado pelo consumo da lista base: a lista nova sai com os itens dela, nas quantidades certas para os dias novos. */
export const withBase = (h: History, base: Pick<ShoppingList, 'purchases'>): History => ({ ...h, products: baseProducts(h, base) });

/** Lista vazia, para a pessoa montar à mão. */
export const manualPlan = (purchases: PurchasePlan[]): PlanResult => ({
  purchases: purchases.map((p, i) => ({ id: `p${i + 1}`, date: p.date, days: p.days, entries: [] })),
  cut: [],
  notes: [],
});

/** Cópia para mexer sem estragar a original: carrinho limpo e nome novo. */
export const duplicateList = (l: ShoppingList, name: string): ShoppingList => ({
  ...l, id: newListId(), name, createdAt: localTodayIso(), savedAt: undefined,
  purchases: l.purchases.map(p => ({ ...p, entries: p.entries.map(e => ({ ...e, cart: false })) })),
});

/* — mexer na lista (sempre devolve uma lista nova) — */

const withPurchases = (l: ShoppingList, purchases: PlanPurchase[], cut: CutLine[] = l.cut): ShoppingList => ({ ...l, purchases, cut });

export const toggleCart = (l: ShoppingList, pi: number, pid: string, group?: Group): ShoppingList =>
  withPurchases(l, l.purchases.map((p, i) => (i !== pi ? p : { ...p, entries: p.entries.map(e => (e.pid === pid && (!group || e.group === group) ? { ...e, cart: !e.cart } : e)) })));

export const setAllCart = (l: ShoppingList, pi: number, value: boolean): ShoppingList =>
  withPurchases(l, l.purchases.map((p, i) => (i !== pi ? p : { ...p, entries: p.entries.map(e => ({ ...e, cart: value })) })));

export const setQty = (l: ShoppingList, pi: number, pid: string, qty: number): ShoppingList => {
  const q = round3(Math.max(0, qty));
  return withPurchases(l, l.purchases.map((p, i) => (i !== pi ? p : { ...p, entries: p.entries.map(e => (e.pid === pid ? { ...e, qty: q } : e)).filter(e => e.qty > 0 || e.pid !== pid) })));
};

export const setPrice = (l: ShoppingList, pid: string, price: number): ShoppingList => {
  const v = Number.isFinite(price) && price > 0 ? round3(price) : 0;
  return {
    ...l,
    purchases: l.purchases.map(p => ({ ...p, entries: p.entries.map(e => (e.pid === pid ? { ...e, price: v } : e)) })),
    cut: l.cut.map(c => (c.pid === pid ? { ...c, price: v } : c)),
  };
};

/** Tira o item desta compra e guarda em "fora da lista", de onde dá para voltar. */
export const removeEntry = (l: ShoppingList, pi: number, pid: string): ShoppingList => {
  const e = l.purchases[pi]?.entries.find(x => x.pid === pid);
  if (!e) return l;
  const n = l.purchases.length;
  const purchases = l.purchases.map((p, i) => (i !== pi ? p : { ...p, entries: p.entries.filter(x => x.pid !== pid) }));
  const cut = l.cut.map(c => ({ ...c, qtys: [...c.qtys] }));
  let c = cut.find(x => x.pid === pid && x.why === 'removido');
  if (!c) {
    c = { pid, name: e.name, dept: e.dept, category: e.category, unit: e.unit, price: e.price, priceDate: e.priceDate, store: e.store, group: e.group, qtys: new Array(n).fill(0), why: 'removido', reason: 'tirado por você' };
    cut.push(c);
  }
  c.qtys[pi] = round3((c.qtys[pi] || 0) + e.qty);
  return withPurchases(l, purchases, cut);
};

/** Devolve um item de "fora da lista" para as compras. */
export const restoreCut = (l: ShoppingList, pid: string, why?: CutLine['why']): ShoppingList => {
  const c = l.cut.find(x => x.pid === pid && (!why || x.why === why));
  if (!c) return l;
  const purchases = l.purchases.map((p, i) => {
    const q = c.qtys[i] || 0;
    if (!(q > 0)) return p;
    const had = p.entries.find(e => e.pid === pid);
    const entries = had
      ? p.entries.map(e => (e.pid === pid ? { ...e, qty: round3(e.qty + q) } : e))
      : [...p.entries, { pid: c.pid, name: c.name, dept: c.dept, category: c.category, unit: c.unit, price: c.price, priceDate: c.priceDate, store: c.store, qty: q, group: c.group, cart: false } as Entry].sort(entryOrder);
    return { ...p, entries };
  });
  return withPurchases(l, purchases, l.cut.filter(x => x !== c));
};

export const addManual = (l: ShoppingList, pi: number, item: { pid?: string; name: string; unit?: string; price?: number; dept?: string; category?: string; qty?: number; priceDate?: string; store?: string; group?: Group; note?: string }): ShoppingList => {
  const name = item.name.trim();
  if (!name || !l.purchases[pi]) return l;
  const pid = item.pid || `U:${name.toUpperCase()}`;
  const unit = item.unit || 'UN';
  const qty = round3(item.qty && item.qty > 0 ? item.qty : stepOf(unit));
  const purchases = l.purchases.map((p, i) => {
    if (i !== pi) return p;
    if (p.entries.some(e => e.pid === pid)) return { ...p, entries: p.entries.map(e => (e.pid === pid ? { ...e, qty: round3(e.qty + qty) } : e)) };
    const entry: Entry = {
      pid, name, dept: item.dept || 'Outros', category: item.category || '', unit, price: item.price && item.price > 0 ? item.price : 0,
      priceDate: item.priceDate || '', store: item.store || '', qty, group: item.group || 'manual', cart: false, ...(item.note ? { note: item.note } : {}),
    };
    return { ...p, entries: [...p.entries, entry].sort(entryOrder) };
  });
  return withPurchases(l, purchases, l.cut.filter(c => c.pid !== pid));
};

/* ───────────────────────── conferência com os cupons ───────────────────────── */

export interface LineCheck {
  pid: string; name: string; unit: string;
  planned: number; bought: number | null; estPrice: number; paidPrice: number | null;
  plannedCost: number; paidCost: number;
  status: 'comprado' | 'parcial' | 'faltou';
}
export interface ExtraCheck { pid: string; name: string; unit: string; qty: number; cost: number }
export interface PurchaseCheck {
  index: number;
  state: 'futuro' | 'aguardando' | 'conferida';
  receiptIds: string[];
  lines: LineCheck[];
  extras: ExtraCheck[];
  planned: number;        // quanto a lista previa
  paid: number;           // quanto os cupons mostram (itens do mercado)
  extraCost: number;      // parte do pago que não estava na lista
  priceEst: number;       // o que os itens comprados custariam pelos últimos preços (na quantidade que veio)
  pricePaid: number;      // o que se pagou por eles: a diferença é só de preço, não de quantidade
  priced: number;         // quantos itens entraram nessa comparação de preço
}

/** A compra dona de um cupom é a última cujo dia chegou (com 1 dia de folga antes), e só vale até o fim da cobertura dela. */
const ownerOf = (date: string, P: PlanPurchase[]): number => {
  let idx = -1;
  P.forEach((p, i) => { if (diffDays(p.date, date) >= -1) idx = i; });
  if (idx < 0) return -1;
  const p = P[idx];
  const limit = idx === P.length - 1 ? p.days + 2 : Infinity;
  return diffDays(p.date, date) <= limit ? idx : -1;
};

export const validateList = (l: ShoppingList, receipts: Receipt[], masters: MasterProduct[] = [], today: string = localTodayIso()): PurchaseCheck[] => {
  const all = collectLines(receipts, masters, '9999-12-31');
  const byPurchase = new Map<number, PLine[]>();
  all.forEach(line => {
    const i = ownerOf(line.date, l.purchases);
    if (i < 0) return;
    const a = byPurchase.get(i);
    if (a) a.push(line); else byPurchase.set(i, [line]);
  });
  return l.purchases.map((p, index) => {
    const lines = byPurchase.get(index) || [];
    const receiptIds = Array.from(new Set(lines.map(x => x.rid)));
    const planned = purchaseTotal(p);
    if (!receiptIds.length) {
      return { index, state: diffDays(today, p.date) > 1 ? 'futuro' : 'aguardando', receiptIds, lines: [], extras: [], planned, paid: 0, extraCost: 0, priceEst: 0, pricePaid: 0, priced: 0 } as PurchaseCheck;
    }
    const byPid = new Map<string, PLine[]>();
    lines.forEach(x => { const a = byPid.get(x.pid); if (a) a.push(x); else byPid.set(x.pid, [x]); });
    const checks: LineCheck[] = p.entries.map(e => {
      const got = byPid.get(e.pid) || [];
      const same = got.filter(x => x.unit === e.unit);
      const qty = same.reduce((s, x) => s + x.qty, 0);
      const sameCost = same.reduce((s, x) => s + x.total, 0);
      const paidCost = got.reduce((s, x) => s + x.total, 0);
      const status: LineCheck['status'] = !got.length ? 'faltou' : (same.length && qty < e.qty * 0.9 ? 'parcial' : 'comprado');
      return {
        pid: e.pid, name: e.name, unit: e.unit, planned: e.qty, bought: same.length ? round3(qty) : null, estPrice: e.price,
        paidPrice: same.length && qty > 0 ? sameCost / qty : null, plannedCost: entryCost(e), paidCost, status,
      };
    });
    const planPids = new Set(p.entries.map(e => e.pid));
    const extras: ExtraCheck[] = [];
    byPid.forEach((ls, pid) => {
      if (planPids.has(pid)) return;
      extras.push({ pid, name: titleCase(ls[0].name), unit: ls[0].unit, qty: round3(ls.reduce((s, x) => s + x.qty, 0)), cost: ls.reduce((s, x) => s + x.total, 0) });
    });
    extras.sort((a, b) => b.cost - a.cost);
    const paid = lines.reduce((s, x) => s + x.total, 0);
    let priceEst = 0, pricePaid = 0, priced = 0;
    p.entries.forEach(e => {
      const same = (byPid.get(e.pid) || []).filter(x => x.unit === e.unit);
      const qty = same.reduce((s, x) => s + x.qty, 0);
      if (!(e.price > 0) || !(qty > 0)) return;
      priceEst += e.price * qty; pricePaid += same.reduce((s, x) => s + x.total, 0); priced += 1;
    });
    return { index, state: 'conferida', receiptIds, lines: checks, extras, planned, paid, extraCost: extras.reduce((s, x) => s + x.cost, 0), priceEst, pricePaid, priced } as PurchaseCheck;
  });
};
