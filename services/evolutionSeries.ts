// Série da "Timeline do Estúdio": escolhe a escala certa (dia, mês ou trimestre) para o período e
// separa poucos rótulos do eixo, em passos regulares, para o gráfico não ficar embolado em período longo.

export interface EvoPoint {
  name: string;    // rótulo curto do eixo ("OUT 25", "12/10")
  label: string;   // rótulo completo do balão ("Outubro de 2025", "12/10/2026")
  value: number;
}

export interface EvoSeries {
  points: EvoPoint[];
  ticks: string[];          // quais `name` aparecem no eixo
  caption: string;          // "Por mês, de ago/24 a out/26"
  unit: 'day' | 'month' | 'quarter';
  showAllDots: boolean;     // poucos pontos: todos com bolinha; muitos: só o pico e o último
}

export interface EvoConfig {
  year: number;
  month: number | null;
  quickFilter?: string | null;
  customStartDate?: string;
  customEndDate?: string;
}

export interface EvoReceipt { date: string; totalAmount: number }

const MONTHS_UP = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const MONTHS_LOW = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => new Date(`${s}T12:00:00`);
const valid = (d: Date) => !isNaN(d.getTime());

// Escolhe rótulos em passos regulares, no maior número que cabe sem encostar um no outro.
// `plotWidth` é a largura útil do gráfico em px; cada rótulo ocupa cerca de 6,8 px por letra (fonte de 11 px em negrito).
// `anchor` diz de que ponta contar: meses e trimestres contam do último (o mais recente sempre aparece);
// dias contam do primeiro (dia 1, 8, 15...).
export const pickTicks = (names: string[], anchor: 'first' | 'last', steps: number[], plotWidth: number): string[] => {
  const n = names.length;
  if (n <= 1) return names.slice();
  const labelPx = Math.max(...names.map(x => x.length)) * 6.8;
  const need = labelPx + 18;                        // rótulo + respiro entre vizinhos
  const perPoint = Math.max(1, plotWidth) / (n - 1);
  const step = steps.find(s => perPoint * s >= need) ?? Math.ceil(need / perPoint);
  if (step <= 1) return names.slice();
  const idx: number[] = [];
  if (anchor === 'last') for (let i = n - 1; i >= 0; i -= step) idx.unshift(i);
  else for (let i = 0; i < n; i += step) idx.push(i);
  return idx.map(i => names[i]);
};

const MONTH_STEPS = [1, 2, 3, 6, 12, 24];
const DAY_STEPS = [1, 2, 3, 5, 7, 10, 14];

const dailySeries = (receipts: EvoReceipt[], start: Date, end: Date, plotWidth: number): EvoSeries => {
  const byDay = new Map<string, number>();
  receipts.forEach(r => byDay.set(r.date, (byDay.get(r.date) || 0) + (Number(r.totalAmount) || 0)));
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  const points: EvoPoint[] = [];
  const cur = new Date(start);
  for (let guard = 0; cur <= end && guard < 400; guard++) {
    const key = ymd(cur);
    points.push({
      name: sameMonth ? pad(cur.getDate()) : `${pad(cur.getDate())}/${pad(cur.getMonth() + 1)}`,
      label: `${pad(cur.getDate())}/${pad(cur.getMonth() + 1)}/${cur.getFullYear()}`,
      value: byDay.get(key) || 0,
    });
    cur.setDate(cur.getDate() + 1);
  }
  const first = points[0], last = points[points.length - 1];
  const caption = sameMonth
    ? `Por dia, em ${MONTHS_LOW[start.getMonth()]}/${String(start.getFullYear()).slice(-2)}`
    : `Por dia, de ${first?.name} a ${last?.name}`;
  return { points, ticks: pickTicks(points.map(p => p.name), 'first', DAY_STEPS, plotWidth), caption, unit: 'day', showAllDots: points.length <= 12 };
};

const monthlySeries = (receipts: EvoReceipt[], start: Date, end: Date, plotWidth: number, multiYear: boolean): EvoSeries => {
  const byMonth = new Map<string, number>();
  receipts.forEach(r => {
    const d = parse(r.date);
    if (!valid(d)) return;
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    byMonth.set(k, (byMonth.get(k) || 0) + (Number(r.totalAmount) || 0));
  });
  const points: EvoPoint[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1, 12);
  const stop = new Date(end.getFullYear(), end.getMonth(), 1, 12);
  for (let guard = 0; cur <= stop && guard < 600; guard++) {
    const y = cur.getFullYear(), m = cur.getMonth();
    points.push({
      name: multiYear ? `${MONTHS_UP[m]} ${String(y).slice(-2)}` : MONTHS_UP[m],
      label: `${MONTHS_FULL[m]} de ${y}`,
      value: byMonth.get(`${y}-${m}`) || 0,
    });
    cur.setMonth(m + 1);
  }
  const f = points.length ? start : end;
  const caption = `Por mês, de ${MONTHS_LOW[f.getMonth()]}/${String(f.getFullYear()).slice(-2)} a ${MONTHS_LOW[end.getMonth()]}/${String(end.getFullYear()).slice(-2)}`;
  return { points, ticks: pickTicks(points.map(p => p.name), 'last', MONTH_STEPS, plotWidth), caption, unit: 'month', showAllDots: points.length <= 12 };
};

const quarterlySeries = (receipts: EvoReceipt[], start: Date, end: Date, plotWidth: number): EvoSeries => {
  const byQ = new Map<string, number>();
  receipts.forEach(r => {
    const d = parse(r.date);
    if (!valid(d)) return;
    const k = `${d.getFullYear()}-${Math.floor(d.getMonth() / 3)}`;
    byQ.set(k, (byQ.get(k) || 0) + (Number(r.totalAmount) || 0));
  });
  const points: EvoPoint[] = [];
  let y = start.getFullYear(), q = Math.floor(start.getMonth() / 3);
  const ey = end.getFullYear(), eq = Math.floor(end.getMonth() / 3);
  for (let guard = 0; (y < ey || (y === ey && q <= eq)) && guard < 400; guard++) {
    points.push({ name: `T${q + 1} ${String(y).slice(-2)}`, label: `${q + 1}º trimestre de ${y}`, value: byQ.get(`${y}-${q}`) || 0 });
    q++; if (q > 3) { q = 0; y++; }
  }
  const caption = `Por trimestre, de ${points[0]?.name} a ${points[points.length - 1]?.name}`;
  return { points, ticks: pickTicks(points.map(p => p.name), 'last', [1, 2, 4, 8], plotWidth), caption, unit: 'quarter', showAllDots: points.length <= 12 };
};

/** Monta a série da timeline. `receipts` já vem filtrado pelo período (e por categoria/loja). */
export const buildEvolution = (receipts: EvoReceipt[], cfg: EvoConfig, plotWidth = 230, now: Date = new Date()): EvoSeries => {
  // período escolhido no calendário
  if (cfg.quickFilter === 'custom' && cfg.customStartDate && cfg.customEndDate) {
    const start = parse(cfg.customStartDate), end = parse(cfg.customEndDate);
    if (valid(start) && valid(end) && start <= end) {
      const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
      if (days <= 62) return dailySeries(receipts, start, end, plotWidth);
      const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
      if (months > 36) return quarterlySeries(receipts, start, end, plotWidth);
      return monthlySeries(receipts, start, end, plotWidth, start.getFullYear() !== end.getFullYear());
    }
  }
  // 7 ou 30 dias
  if (cfg.quickFilter === '7d' || cfg.quickFilter === '30d') {
    const n = cfg.quickFilter === '7d' ? 7 : 30;
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const start = new Date(end); start.setDate(start.getDate() - n);
    return dailySeries(receipts, start, end, plotWidth);
  }
  // um mês
  if (cfg.month !== null && cfg.month !== undefined) {
    const isCurrent = cfg.year === now.getFullYear() && cfg.month === now.getMonth();
    const lastDay = isCurrent ? now.getDate() : new Date(cfg.year, cfg.month + 1, 0).getDate();
    return dailySeries(receipts, new Date(cfg.year, cfg.month, 1, 12), new Date(cfg.year, cfg.month, lastDay, 12), plotWidth);
  }
  // o ano todo: janeiro até hoje (no ano corrente não desenha meses que ainda não chegaram)
  const lastMonth = cfg.year === now.getFullYear() ? now.getMonth() : 11;
  const s = monthlySeries(receipts, new Date(cfg.year, 0, 1, 12), new Date(cfg.year, lastMonth, 1, 12), plotWidth, false);
  return { ...s, caption: `Por mês, em ${cfg.year}` };
};
