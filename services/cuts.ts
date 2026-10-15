import { Receipt } from '../types';
import { DeptFilter, NO_DEPT_FILTER, applyDeptFilter, normalizeDeptFilter } from './deptFilter';
import { buildEvolution, EvoSeries } from './evolutionSeries';
import { deptKey, masterOf, properCase } from './textFormat';

/* Recortes: um pedaço do tempo (de um dia até outro) com, se a pessoa quiser, só algumas categorias.
   Ficam gravados no aparelho como etiquetas e cada um tem a sua própria análise, separada dos filtros da tela. */

export interface Cut {
  id: string;
  name: string;          // opcional; vazio = a etiqueta mostra as datas
  from: string;          // aaaa-mm-dd
  to: string;
  filter: DeptFilter;    // categorias que entram neste recorte
  createdAt: string;
}

export const CUTS_KEY = 'eukasconta_cuts';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const pad = (n: number) => String(n).padStart(2, '0');
const utc = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const todayIso = (now: Date = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

export const dayCount = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / 86_400_000) + 1;
export const addDays = (iso: string, n: number): string => fromUtc(utc(iso) + n * 86_400_000);

/** "11–20 nov 26", "28 out – 05 nov 26", "28 out 25 – 05 jan 26", "11 nov 26". */
export const rangeLabel = (from: string, to: string): string => {
  if (!ISO.test(from) || !ISO.test(to)) return '';
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  const yy = (y: number) => String(y).slice(-2);
  if (from === to) return `${pad(d1)} ${MONTHS_ABBR[m1 - 1]} ${yy(y1)}`;
  if (y1 === y2 && m1 === m2) return `${pad(d1)}–${pad(d2)} ${MONTHS_ABBR[m1 - 1]} ${yy(y1)}`;
  if (y1 === y2) return `${pad(d1)} ${MONTHS_ABBR[m1 - 1]} – ${pad(d2)} ${MONTHS_ABBR[m2 - 1]} ${yy(y1)}`;
  return `${pad(d1)} ${MONTHS_ABBR[m1 - 1]} ${yy(y1)} – ${pad(d2)} ${MONTHS_ABBR[m2 - 1]} ${yy(y2)}`;
};

export const cutTitle = (c: Cut): string => c.name.trim() || rangeLabel(c.from, c.to);

export const newCutId = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/* ───────────── gravação no aparelho ───────────── */

export const normalizeCuts = (raw: unknown): Cut[] => {
  if (!Array.isArray(raw)) return [];
  const out: Cut[] = [];
  const seen = new Set<string>();
  raw.forEach((r: any) => {
    if (!r || typeof r !== 'object') return;
    const from = String(r.from || ''), to = String(r.to || '');
    if (!ISO.test(from) || !ISO.test(to)) return;
    const lo = from <= to ? from : to, hi = from <= to ? to : from;
    const id = typeof r.id === 'string' && r.id && !seen.has(r.id) ? r.id : newCutId();
    seen.add(id);
    out.push({
      id, name: typeof r.name === 'string' ? r.name.slice(0, 60) : '', from: lo, to: hi,
      filter: normalizeDeptFilter(r.filter), createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    });
  });
  return out;
};

export const loadCuts = (): Cut[] => {
  try {
    const raw = localStorage.getItem(CUTS_KEY);
    return raw ? normalizeCuts(JSON.parse(raw)) : [];
  } catch { return []; }
};

export const saveCuts = (cuts: Cut[]): void => {
  try {
    if (cuts.length) localStorage.setItem(CUTS_KEY, JSON.stringify(cuts));
    else localStorage.removeItem(CUTS_KEY);
  } catch { /* sem armazenamento: vale só até fechar o app */ }
};

/* ───────────── análise ───────────── */

export interface CutDept { key: string; name: string; value: number; pct: number }
export interface CutStore { key: string; name: string; cnpj: string; value: number; count: number }

export interface CutAnalysis {
  days: number;               // dias do recorte
  elapsed: number;            // dias já decorridos (recorte que termina no futuro)
  total: number;
  receipts: number;
  items: number;
  perDay: number;
  perReceipt: number;
  prevFrom: string;
  prevTo: string;
  prevTotal: number;
  delta: number | null;       // % em relação ao período de mesmo tamanho logo antes
  series: EvoSeries;
  byDept: CutDept[];
  byStore: CutStore[];
  peak: { date: string; value: number } | null;   // dia que mais gastou
}

const inRange = (r: Receipt, from: string, to: string) => r.date >= from && r.date <= to;
const sumReceipts = (list: Receipt[]) => list.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);

/** Cupons do recorte: dentro das datas e só com as categorias que entram. */
export const cutReceipts = (all: Receipt[], from: string, to: string, filter: DeptFilter): Receipt[] =>
  applyDeptFilter(all.filter(r => inRange(r, from, to)), filter);

export const analyzeCut = (all: Receipt[], cut: Pick<Cut, 'from' | 'to' | 'filter'>, plotWidth = 260, now: Date = new Date()): CutAnalysis => {
  const { from, to, filter } = cut;
  const days = Math.max(1, dayCount(from, to));
  const today = todayIso(now);
  const end = to > today ? today : to;
  const elapsed = end >= from ? Math.max(1, dayCount(from, end)) : days;

  const list = cutReceipts(all, from, to, filter);
  const total = sumReceipts(list);
  const items = list.reduce((s, r) => s + (r.items || []).length, 0);

  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const prevTotal = sumReceipts(cutReceipts(all, prevFrom, prevTo, filter));
  const delta = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;

  const series = buildEvolution(list, { year: Number(from.slice(0, 4)), month: null, quickFilter: 'custom', customStartDate: from, customEndDate: to }, plotWidth, now);

  // por departamento ("HORTIFRUTI" e "Hortifruti" juntos; o nome mostrado é o que mais gastou)
  const dep = new Map<string, { value: number; variants: Map<string, number> }>();
  let depTotal = 0;
  list.forEach(r => (r.items || []).forEach(i => {
    const raw = masterOf(i.category) || 'Sem categoria';
    const key = deptKey(i.category);
    const v = Number(i.totalPrice) || 0;
    let g = dep.get(key);
    if (!g) { g = { value: 0, variants: new Map() }; dep.set(key, g); }
    g.value += v; depTotal += v;
    g.variants.set(raw, (g.variants.get(raw) || 0) + v);
  }));
  const byDept: CutDept[] = Array.from(dep.entries())
    .map(([key, g]) => ({
      key,
      name: properCase(Array.from(g.variants.entries()).sort((a, b) => b[1] - a[1])[0][0]),
      value: g.value,
      pct: depTotal > 0 ? (g.value / depTotal) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  // por loja
  const st = new Map<string, CutStore>();
  list.forEach(r => {
    const key = r.cnpj || r.establishmentName;
    let g = st.get(key);
    if (!g) { g = { key, name: r.establishmentName, cnpj: r.cnpj, value: 0, count: 0 }; st.set(key, g); }
    g.value += Number(r.totalAmount) || 0; g.count += 1;
  });
  const byStore = Array.from(st.values()).sort((a, b) => b.value - a.value);

  // dia de maior gasto
  const perDate = new Map<string, number>();
  list.forEach(r => perDate.set(r.date, (perDate.get(r.date) || 0) + (Number(r.totalAmount) || 0)));
  let peak: CutAnalysis['peak'] = null;
  perDate.forEach((value, date) => { if (!peak || value > peak.value) peak = { date, value }; });

  return {
    days, elapsed, total, receipts: list.length, items,
    perDay: total / elapsed, perReceipt: list.length ? total / list.length : 0,
    prevFrom, prevTo, prevTotal, delta, series, byDept, byStore, peak,
  };
};

export const emptyFilter = NO_DEPT_FILTER;
