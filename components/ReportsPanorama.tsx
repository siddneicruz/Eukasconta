import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  ArrowDownRight, ArrowUpRight, CalendarDays, ChevronRight, Clock, Flame, Layers,
  Plus, ShoppingBag, Sparkles, Store, Tag, TrendingDown, TrendingUp, Zap,
} from 'lucide-react';
import { DashboardConfig, Receipt } from '../types';
import { normalizeUnit } from '../services/productPriceStats';
import { priceBasis } from '../services/eggs';
import { properCase } from '../services/textFormat';

/* ────────────────────────────────────────────────────────────────────────────
   PANORAMA — leitura analítica do período.

   Visual: mesmas superfícies do resto do app (cartões #121214, bordas
   white/5, ouro luxury, títulos Cinzel). Para o tema claro NÃO há cores
   fixas nos elementos HTML: só classes que o index.html já traduz
   (bg-[#121214], text-white, text-zinc-*, border-white/5, bg-white/5...).
   As únicas cores "cruas" ficam dentro dos gráficos SVG, e essas seguem o
   tema via useIsLight().
   ──────────────────────────────────────────────────────────────────────────── */

interface Props {
  receipts: Receipt[];
  config: DashboardConfig;
  displayName: (name: string, cnpj: string) => string;
  onQuickRange: (range: '7d' | '30d' | 'thisMonth' | 'thisYear') => void;
  onSelectEstablishment?: (name: string) => void;
  /** abre o cupom (a mesma tela do Histórico) */
  onOpenReceipt?: (id: string) => void;
  onAddManual?: () => void;
}

/* ───────────────────────────── formatação e datas ───────────────────────────── */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const compact = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',')}k` : `${Math.round(v)}`);
const round2 = (n: number) => Math.round(n * 100) / 100;
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// O app abrevia nomes longos ("COMPRETUDO SUPERME.."). Em frases e listas prefiro o
// nome inteiro, sem sufixos legais; se houver apelido do usuário, ele é mantido.
const fullName = (real: string, shown: string) =>
  shown.endsWith('..') ? (real.replace(/\b(LTDA|EIRELI|EPP|S\.?\/?A\.?|CIA|ME)\b\.?/gi, ' ').replace(/\s+/g, ' ').trim() || real) : shown;
const nice = (s: string) => (s && s === s.toUpperCase() ? s.toLowerCase() : s);

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s: string) => new Date(`${s}T12:00:00`);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();

const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const WD_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WD_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

// Iniciais Maiúsculas também junta "HORTIFRUTI" com "Hortifruti" no mesmo departamento.
const masterOf = (c?: string) => properCase(((c || 'Outros').split(' - ')[0] || 'Outros').trim()) || 'Outros';

/* ───────────────────────────── períodos ───────────────────────────── */

type Kind = 'month' | 'year' | 'days';
interface Span { start: Date; end: Date }
interface Ranges {
  kind: Kind;
  cur: Span;            // do início até hoje (ou até o fim, se já passou)
  prev: Span;           // mesmo intervalo no período anterior (comparação justa)
  plotEnd: Date;        // fim do período inteiro, usado para desenhar o eixo
  prevPlotEnd: Date;    // fim do período anterior inteiro
  prevLabel: string;
  title: string;
}

// Segue as mesmas regras de filtro do restante de Relatórios (7d/30d, período
// personalizado, mês, ano), mas devolve também o período anterior equivalente.
function resolveRanges(config: DashboardConfig): Ranges {
  const today = parseISO(iso(new Date()));
  const qf = config.quickFilter;
  const fmtDay = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');

  const days = (start: Date, end: Date): Ranges => {
    const len = daysBetween(start, end) + 1;
    const pEnd = addDays(start, -1);
    const pStart = addDays(pEnd, -(len - 1));
    return {
      kind: 'days', cur: { start, end }, prev: { start: pStart, end: pEnd },
      plotEnd: end, prevPlotEnd: pEnd, prevLabel: 'período anterior',
      title: `${fmtDay(start)} a ${fmtDay(end)}`,
    };
  };

  if (qf === '7d' || qf === '30d') {
    const n = qf === '7d' ? 7 : 30;
    return days(addDays(today, -(n - 1)), today);
  }
  if (qf === 'custom' && config.customStartDate) {
    const start = parseISO(config.customStartDate);
    let end = config.customEndDate ? parseISO(config.customEndDate) : today;
    if (end < start) end = start;
    if (end > today && start <= today) end = today;
    return days(start, end);
  }

  const y = config.year;
  const clampToday = (start: Date, fullEnd: Date) => (today < start ? start : today > fullEnd ? fullEnd : today);

  if (config.month !== null && config.month !== undefined) {
    const m = config.month;
    const start = new Date(y, m, 1, 12);
    const fullEnd = new Date(y, m, daysInMonth(y, m), 12);
    const end = clampToday(start, fullEnd);
    const elapsed = daysBetween(start, end) + 1;
    const py = m === 0 ? y - 1 : y;
    const pm = m === 0 ? 11 : m - 1;
    return {
      kind: 'month', cur: { start, end },
      prev: { start: new Date(py, pm, 1, 12), end: new Date(py, pm, Math.min(elapsed, daysInMonth(py, pm)), 12) },
      plotEnd: fullEnd, prevPlotEnd: new Date(py, pm, daysInMonth(py, pm), 12),
      prevLabel: 'mês anterior', title: `${cap(MONTH_NAMES[m])} de ${y}`,
    };
  }

  const start = new Date(y, 0, 1, 12);
  const fullEnd = new Date(y, 11, 31, 12);
  const end = clampToday(start, fullEnd);
  return {
    kind: 'year', cur: { start, end },
    prev: { start: new Date(y - 1, 0, 1, 12), end: new Date(y - 1, end.getMonth(), Math.min(end.getDate(), daysInMonth(y - 1, end.getMonth())), 12) },
    plotEnd: fullEnd, prevPlotEnd: new Date(y - 1, 11, 31, 12),
    prevLabel: 'ano anterior', title: String(y),
  };
}

/* ───────────────────────────── análise ───────────────────────────── */

interface SeriesRow {
  label: string; full: string;
  cur?: number; prev?: number; curCum?: number; prevCum?: number; proj?: number;
}
interface Dept { name: string; value: number; share: number; pct: number; prev: number; delta: number | null; color: string }
type Tone = 'gold' | 'good' | 'bad' | 'info';
interface Insight { icon: React.ComponentType<{ className?: string }>; tone: Tone; text: React.ReactNode; /** cupom que a leitura cita: tocar abre */ open?: string }

const DEPT_COLORS = ['#D4AF37', '#27A46D', '#3B82F6', '#EC4899', '#8B5CF6', '#06B6D4'];
const DEPT_REST = '#71717a';

function buildSeries(rg: Ranges, cur: Receipt[], prevPlot: Receipt[]) {
  const monthly = rg.kind === 'year' || daysBetween(rg.cur.start, rg.plotEnd) + 1 > 92;
  const rows: SeriesRow[] = [];
  let elapsed = 0;

  if (!monthly) {
    const sums = (list: Receipt[]) => {
      const m = new Map<string, number>();
      list.forEach(r => m.set(r.date, (m.get(r.date) || 0) + (r.totalAmount || 0)));
      return m;
    };
    const cm = sums(cur), pm = sums(prevPlot);
    const n = daysBetween(rg.cur.start, rg.plotEnd) + 1;
    elapsed = daysBetween(rg.cur.start, rg.cur.end);
    const prevLen = daysBetween(rg.prev.start, rg.prevPlotEnd) + 1;
    for (let i = 0; i < n; i++) {
      const d = addDays(rg.cur.start, i);
      rows.push({
        label: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`,
        full: cap(d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, '')),
        cur: i <= elapsed ? round2(cm.get(iso(d)) || 0) : undefined,
        prev: i < prevLen ? round2(pm.get(iso(addDays(rg.prev.start, i))) || 0) : undefined,
      });
    }
  } else {
    const sums = (list: Receipt[]) => {
      const m = new Map<string, number>();
      list.forEach(r => { const k = r.date.slice(0, 7); m.set(k, (m.get(k) || 0) + (r.totalAmount || 0)); });
      return m;
    };
    const cm = sums(cur), pm = sums(prevPlot);
    const base = monthIndex(rg.cur.start), pBase = monthIndex(rg.prev.start);
    const n = monthIndex(rg.plotEnd) - base + 1;
    elapsed = monthIndex(rg.cur.end) - base;
    const prevLen = monthIndex(rg.prevPlotEnd) - pBase + 1;
    const key = (mi: number) => `${Math.floor(mi / 12)}-${pad((mi % 12) + 1)}`;
    for (let i = 0; i < n; i++) {
      const mi = base + i;
      rows.push({
        label: MONTHS_SHORT[mi % 12],
        full: `${cap(MONTH_NAMES[mi % 12])} de ${Math.floor(mi / 12)}`,
        cur: i <= elapsed ? round2(cm.get(key(mi)) || 0) : undefined,
        prev: i < prevLen ? round2(pm.get(key(pBase + i)) || 0) : undefined,
      });
    }
  }

  let ac = 0, ap = 0;
  rows.forEach(r => {
    if (r.cur !== undefined) { ac += r.cur; r.curCum = round2(ac); }
    if (r.prev !== undefined) { ap += r.prev; r.prevCum = round2(ap); }
  });
  return { rows, elapsed, monthly };
}

function analyse(receipts: Receipt[], config: DashboardConfig, displayName: Props['displayName']) {
  const rg = resolveRanges(config);
  const sIso = iso(rg.cur.start), eIso = iso(rg.cur.end);
  const psIso = iso(rg.prev.start), peIso = iso(rg.prev.end), ppeIso = iso(rg.prevPlotEnd);

  const valid = receipts.filter(r => r && r.date);
  const cur = valid.filter(r => r.date >= sIso && r.date <= eIso);
  const prev = valid.filter(r => r.date >= psIso && r.date <= peIso);
  const prevPlot = valid.filter(r => r.date >= psIso && r.date <= ppeIso);

  const sum = (l: Receipt[]) => l.reduce((s, r) => s + (r.totalAmount || 0), 0);
  const total = sum(cur), prevTotal = sum(prev);
  const delta = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
  const spanDays = Math.max(1, daysBetween(rg.cur.start, rg.cur.end) + 1);
  const ticket = cur.length ? total / cur.length : 0;
  const prevTicket = prev.length ? prevTotal / prev.length : 0;

  /* série temporal + projeção de fechamento (só no mês em andamento) */
  const { rows, elapsed, monthly } = buildSeries(rg, cur, prevPlot);
  let projection: number | null = null;
  if (rg.kind === 'month' && total > 0 && elapsed < rows.length - 1 && elapsed + 1 >= 3) {
    const pace = total / (elapsed + 1);
    const atNow = rows[elapsed].curCum || 0;
    for (let i = elapsed; i < rows.length; i++) rows[i].proj = round2(atNow + pace * (i - elapsed));
    projection = pace * rows.length;
  }
  const prevClosed = rg.kind === 'month' ? sum(prevPlot) : null;

  /* departamentos (categoria mestre de cada item) */
  const deptMap = (list: Receipt[]) => {
    const m = new Map<string, number>();
    list.forEach(r => {
      if (r.items && r.items.length) r.items.forEach(i => m.set(masterOf(i.category), (m.get(masterOf(i.category)) || 0) + (i.totalPrice || 0)));
      else m.set('Outros', (m.get('Outros') || 0) + (r.totalAmount || 0));
    });
    return m;
  };
  const cd = deptMap(cur), pd = deptMap(prev);
  const deptTotal = Array.from(cd.values()).reduce((a, b) => a + b, 0);
  const sorted = Array.from(cd.entries()).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const mk = (name: string, value: number, prevV: number, color: string): Dept => ({
    name, value: round2(value), share: deptTotal ? (value / deptTotal) * 100 : 0, pct: 0,
    prev: prevV, delta: prevV > 0 ? ((value - prevV) / prevV) * 100 : null, color,
  });
  const depts: Dept[] = sorted.slice(0, 6).map(([n, v], i) => mk(n, v, pd.get(n) || 0, DEPT_COLORS[i]));
  if (sorted.length > 6) {
    const rest = sorted.slice(6);
    depts.push(mk(`Demais (${rest.length})`, rest.reduce((s, [, v]) => s + v, 0), rest.reduce((s, [n]) => s + (pd.get(n) || 0), 0), DEPT_REST));
  }

  // percentuais inteiros que fecham 100% (maior resto)
  {
    const floors = depts.map(d => Math.floor(d.share));
    let left = (depts.length ? 100 : 0) - floors.reduce((a, b) => a + b, 0);
    depts.map((d, i) => ({ i, r: d.share - floors[i] })).sort((a, b) => b.r - a.r).forEach(x => { if (left > 0) { floors[x.i]++; left--; } });
    depts.forEach((d, i) => { d.pct = floors[i]; });
  }

  /* ritmo: dia da semana e período do dia */
  const wd = Array(7).fill(0) as number[], wdN = Array(7).fill(0) as number[];
  cur.forEach(r => { const d = parseISO(r.date).getDay(); wd[d] += r.totalAmount || 0; wdN[d]++; });
  const weekRows = [1, 2, 3, 4, 5, 6, 0].map(d => ({ name: WD_SHORT[d], long: WD_LONG[d], value: round2(wd[d]), count: wdN[d] }));
  const parts = [{ name: 'Manhã', long: 'de manhã', value: 0, count: 0 }, { name: 'Tarde', long: 'à tarde', value: 0, count: 0 }, { name: 'Noite', long: 'à noite', value: 0, count: 0 }];
  cur.forEach(r => {
    const h = parseInt((r.time || '').split(':')[0], 10);
    if (isNaN(h)) return;
    const p = parts[h >= 5 && h < 12 ? 0 : h >= 12 && h < 18 ? 1 : 2];
    p.value += r.totalAmount || 0; p.count++;
  });
  const partRows = parts.map(p => ({ ...p, value: round2(p.value) }));
  const hasTime = partRows.some(p => p.count > 0);

  /* estabelecimentos */
  const sm = new Map<string, { key: string; real: string; cnpj: string; total: number; n: number }>();
  cur.forEach(r => {
    const key = r.cnpj || r.establishmentName || 'nd';
    const e = sm.get(key) || { key, real: r.establishmentName || 'Não identificado', cnpj: r.cnpj || '', total: 0, n: 0 };
    e.total += r.totalAmount || 0; e.n++; sm.set(key, e);
  });
  const storesAll = Array.from(sm.values()).sort((a, b) => b.total - a.total);
  const stores = storesAll.slice(0, 6).map(s => ({
    ...s, name: fullName(s.real, displayName(s.real, s.cnpj)), share: total ? (s.total / total) * 100 : 0, ticket: s.total / s.n,
  }));

  /* preços: mesmo produto, na mesma loja, primeira compra x última compra */
  const obs = new Map<string, { desc: string; store: string; pts: { d: string; p: number; id: string }[] }>();
  valid.forEach(r => {
    if (r.date > eIso) return;
    (r.items || []).forEach(it => {
      // ovo com a quantidade conhecida é comparado pelo preço da dúzia (bandeja de 12 e de 30 não se misturam)
      const basis = priceBasis(it);
      const p = basis.unitPrice;
      const raw = (it.description || '').trim();
      if (!raw || p <= 0) return;
      const desc = basis.eggs ? `${raw} (dúzia)` : raw;
      const k = `${desc.toUpperCase()}||${normalizeUnit(basis.unitType)}||${r.cnpj || r.establishmentName}`;
      const o = obs.get(k) || { desc, store: fullName(r.establishmentName, displayName(r.establishmentName, r.cnpj)), pts: [] as { d: string; p: number; id: string }[] };
      o.pts.push({ d: r.date, p, id: r.id }); obs.set(k, o);
    });
  });
  const moves: { desc: string; store: string; from: number; to: number; pct: number; rid: string }[] = [];
  obs.forEach(o => {
    if (o.pts.length < 2) return;
    o.pts.sort((a, b) => a.d.localeCompare(b.d));
    const f = o.pts[0], l = o.pts[o.pts.length - 1];
    if (f.d === l.d || l.d < sIso) return;
    const pct = ((l.p - f.p) / f.p) * 100;
    if (Math.abs(pct) < 1) return;
    moves.push({ desc: o.desc.replace(/^\d{3,14}\s*/, ''), store: o.store, from: f.p, to: l.p, pct, rid: l.id });
  });
  const rose = moves.filter(m => m.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 3);
  const fell = moves.filter(m => m.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 3);

  /* leituras em linguagem simples */
  const insights: Insight[] = [];
  const dm = depts.filter(d => d.delta !== null && d.prev > 0 && !d.name.startsWith('Demais'))
    .sort((a, b) => Math.abs(b.value - b.prev) - Math.abs(a.value - a.prev))[0];
  if (dm && Math.abs(dm.delta as number) >= 10) {
    const up = (dm.delta as number) > 0;
    insights.push({
      icon: up ? TrendingUp : TrendingDown, tone: up ? 'bad' : 'good',
      text: <><strong className="text-white font-semibold">{dm.name}</strong> {up ? 'subiu' : 'caiu'} {Math.abs(Math.round(dm.delta as number))}% em relação ao {rg.prevLabel} ({brl0.format(dm.prev)} para {brl0.format(dm.value)}).</>,
    });
  }
  const peakW = weekRows.reduce((a, b) => (b.value > a.value ? b : a), weekRows[0]);
  if (cur.length >= 3 && total > 0 && (peakW.value / total) * 100 >= 25) {
    insights.push({
      icon: Flame, tone: 'gold',
      text: <>Seu dia mais pesado é <strong className="text-white font-semibold">{peakW.long}</strong>: {Math.round((peakW.value / total) * 100)}% de tudo o que você gastou no período.</>,
    });
  }
  const big = cur.reduce<Receipt | null>((a, r) => (!a || (r.totalAmount || 0) > (a.totalAmount || 0) ? r : a), null);
  if (big && cur.length >= 2) {
    insights.push({
      icon: ShoppingBag, tone: 'info', open: big.id,
      text: <>A maior compra foi de <strong className="text-white font-semibold">{brl.format(big.totalAmount || 0)}</strong> em <span className="capitalize">{nice(fullName(big.establishmentName, displayName(big.establishmentName, big.cnpj))).toLowerCase()}</span>, no dia {parseISO(big.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}.</>,
    });
  }
  if (stores[0] && stores[0].share >= 50 && storesAll.length > 1) {
    insights.push({
      icon: Store, tone: 'gold',
      text: <><strong className="text-white font-semibold">{Math.round(stores[0].share)}%</strong> do gasto está concentrado em um único lugar: <span className="capitalize">{nice(stores[0].name).toLowerCase()}</span>.</>,
    });
  }
  if (prev.length > 0 && prevTicket > 0 && cur.length > 0) {
    const t = ((ticket - prevTicket) / prevTicket) * 100;
    if (Math.abs(t) >= 8) {
      insights.push({
        icon: t > 0 ? ArrowUpRight : ArrowDownRight, tone: t > 0 ? 'bad' : 'good',
        text: <>O ticket médio por compra {t > 0 ? 'subiu' : 'caiu'} {Math.abs(Math.round(t))}%: agora {brl.format(ticket)}, antes {brl.format(prevTicket)}.</>,
      });
    }
  }

  return {
    rg, cur, total, prevTotal, delta, spanDays, ticket, count: cur.length,
    rows, monthly, projection, prevClosed, depts, deptTotal, weekRows, partRows, hasTime,
    stores, storesAll: storesAll.length, rose, fell, insights: insights.slice(0, 4),
  };
}

/* ───────────────────────────── hooks ───────────────────────────── */

// Acompanha a classe que o App coloca no <html> quando o tema claro está ativo.
const useIsLight = () => {
  const read = () => typeof document !== 'undefined' && document.documentElement.classList.contains('light-theme');
  const [light, setLight] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setLight(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return light;
};

const usePrefersReducedMotion = () => {
  const [reduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  return reduced;
};

// Número que "desliza" até o novo valor, partindo do que já estava na tela.
const useCountUp = (target: number, disabled: boolean, duration = 1000) => {
  const [value, setValue] = useState(disabled ? target : 0);
  const from = useRef(disabled ? target : 0);
  useEffect(() => {
    if (disabled) { setValue(target); from.current = target; return; }
    const a = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const v = a + (target - a) * (1 - Math.pow(1 - t, 3));
      from.current = v; setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, disabled, duration]);
  return value;
};

// true um quadro depois de montar: faz as barras crescerem a partir de zero.
const useReady = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(id); }, []);
  return ready;
};

/* ───────────────────────────── blocos de UI ───────────────────────────── */

const GLOW = { gold: 'bg-luxury-gold/5', emerald: 'bg-emerald-500/5', blue: 'bg-blue-500/5', pink: 'bg-pink-500/5' };
const TONE: Record<Tone, string> = {
  gold: 'bg-luxury-gold/10 text-luxury-gold',
  good: 'bg-emerald-500/10 text-emerald-500',
  bad: 'bg-red-500/10 text-red-500',
  info: 'bg-blue-500/10 text-blue-500',
};

const Reveal: React.FC<{ i: number; className?: string; children: React.ReactNode }> = ({ i, className = '', children }) => (
  <div className={`animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both motion-reduce:animate-none ${className}`} style={{ animationDelay: `${i * 90}ms` }}>
    {children}
  </div>
);

const Card: React.FC<{ glow?: keyof typeof GLOW; className?: string; children: React.ReactNode }> = ({ glow, className = '', children }) => (
  <div className={`relative bg-[#121214] border border-white/5 rounded-[2rem] p-5 md:p-8 shadow-2xl overflow-hidden h-full ${className}`}>
    {glow && <div className={`absolute -top-24 -right-24 w-72 h-72 rounded-full blur-[100px] pointer-events-none ${GLOW[glow]}`} />}
    <div className="relative z-10">{children}</div>
  </div>
);

const CardTitle: React.FC<{ icon: React.ComponentType<{ className?: string }>; kicker: string; title: string; accent?: string; right?: React.ReactNode }> = ({ icon: Icon, kicker, title, accent = 'text-luxury-gold', right }) => (
  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-3 mb-6">
    <div className="min-w-0">
      <h3 className="text-[11px] text-zinc-400 uppercase tracking-[0.1em] font-bold mb-1 flex items-center gap-2">
        <Icon className={`w-3 h-3 ${accent}`} /> {kicker}
      </h3>
      <span className="text-xl md:text-2xl font-serif text-white tracking-tight">{title}</span>
    </div>
    {right}
  </div>
);

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; disabled?: boolean }[] }) {
  return (
    <div className="flex items-center gap-1 bg-white/[0.03] border border-white/5 rounded-xl p-1 shrink-0">
      {options.map(o => (
        <button
          key={o.id} disabled={o.disabled} onClick={() => onChange(o.id)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed ${value === o.id ? 'bg-luxury-gold text-black shadow-lg shadow-luxury-gold/10' : 'text-zinc-400 hover:text-white'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const DeltaPill: React.FC<{ delta: number | null; label: string }> = ({ delta, label }) => {
  if (delta === null) return <span className="text-xs text-zinc-500">Sem dados do {label} para comparar</span>;
  const up = delta > 0.5, down = delta < -0.5;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${up ? 'bg-red-500/10 text-red-500' : down ? 'bg-emerald-500/10 text-emerald-500' : 'bg-white/5 text-zinc-500'}`}>
      {up && <ArrowUpRight className="w-3.5 h-3.5" />}
      {down && <ArrowDownRight className="w-3.5 h-3.5" />}
      {Math.abs(Math.round(delta))}%
      <span className="font-medium opacity-70">vs {label}</span>
    </span>
  );
};

const TipRow: React.FC<{ color: string; label: string; value: number; dashed?: boolean }> = ({ color, label, value, dashed }) => (
  <div className="flex items-center justify-between gap-8">
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full" style={dashed ? { border: `1.5px dashed ${color}` } : { backgroundColor: color }} />
      <span className="text-xs font-semibold text-zinc-300">{label}</span>
    </div>
    <span className="text-xs font-sans font-bold text-white">{brl.format(value)}</span>
  </div>
);

const TipBox: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-zinc-950 border border-white/10 px-5 py-4 rounded-[1.5rem] shadow-2xl backdrop-blur-md min-w-[180px]">
    <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-[0.1em] mb-3 border-b border-white/5 pb-2">{title}</p>
    <div className="space-y-2">{children}</div>
  </div>
);

const HeroTooltip = ({ active, payload, mode, prevLabel, monthly }: any) => {
  if (!active || !payload || !payload.length) return null;
  const row: SeriesRow = payload[0].payload;
  const acum = mode === 'acum';
  const c = acum ? row.curCum : row.cur;
  const p = acum ? row.prevCum : row.prev;
  return (
    <TipBox title={row.full}>
      {c !== undefined && <TipRow color="#D4AF37" label={acum ? 'Acumulado' : monthly ? 'No mês' : 'No dia'} value={c} />}
      {c === undefined && row.proj !== undefined && <TipRow color="#D4AF37" label="Projeção" value={row.proj} dashed />}
      {p !== undefined && <TipRow color="#a1a1aa" label={cap(prevLabel)} value={p} dashed />}
    </TipBox>
  );
};

/* ───────────────────────────── componente ───────────────────────────── */

const ReportsPanorama: React.FC<Props> = ({ receipts, config, displayName, onQuickRange, onSelectEstablishment, onOpenReceipt, onAddManual }) => {
  const light = useIsLight();
  const reduced = usePrefersReducedMotion();
  const ready = useReady();

  const a = useMemo(() => analyse(receipts, config, displayName), [receipts, config, displayName]);

  const [mode, setMode] = useState<'acum' | 'dia'>('acum');
  const [rhythm, setRhythm] = useState<'semana' | 'hora'>('semana');
  const [activeDept, setActiveDept] = useState<number | null>(null);

  const animatedTotal = useCountUp(a.total, reduced);

  const ct = {
    grid: light ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)',
    tick: '#71717a',
    prev: light ? '#a1a1aa' : '#71717a',
    dot: light ? '#ffffff' : '#121214',
    barDim: light ? 'rgba(153,123,40,0.28)' : 'rgba(212,175,55,0.26)',
  };

  const quickActive = {
    d7: config.quickFilter === '7d',
    d30: config.quickFilter === '30d',
    month: !config.quickFilter && config.month === new Date().getMonth() && config.year === new Date().getFullYear(),
    year: !config.quickFilter && config.month === null,
  };
  const chips: { id: 'd7' | 'd30' | 'month' | 'year'; label: string; range: '7d' | '30d' | 'thisMonth' | 'thisYear' }[] = [
    { id: 'd7', label: '7 dias', range: '7d' },
    { id: 'd30', label: '30 dias', range: '30d' },
    { id: 'month', label: 'Este mês', range: 'thisMonth' },
    { id: 'year', label: 'Este ano', range: 'thisYear' },
  ];

  const chipRow = (
    <div className="grid grid-cols-4 sm:flex sm:items-center gap-1.5 sm:gap-2">
      {chips.map(c => (
        <button
          key={c.id} onClick={() => onQuickRange(c.range)}
          className={`px-1 sm:px-4 py-2.5 sm:py-2 rounded-full text-xs font-semibold whitespace-nowrap border transition-all duration-300 ${quickActive[c.id] ? 'bg-luxury-gold text-black border-luxury-gold shadow-lg shadow-luxury-gold/10' : 'bg-white/[0.03] border-white/5 text-zinc-400 hover:text-white hover:bg-white/5'}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );

  if (a.count === 0) {
    return (
      <div className="space-y-6">
        {chipRow}
        <Card glow="gold">
          <div className="py-10 md:py-16 flex flex-col items-center text-center gap-4">
            <div className="p-4 rounded-2xl bg-white/5 text-luxury-gold"><CalendarDays className="w-7 h-7" /></div>
            <h3 className="text-2xl font-serif text-white tracking-tight">Sem compras em {a.rg.title}</h3>
            <p className="text-sm text-zinc-500 max-w-sm leading-relaxed">Escolha outro período acima ou registre uma compra para ver as análises aqui.</p>
            {onAddManual && (
              <button onClick={onAddManual} className="mt-2 px-6 py-3 rounded-xl bg-luxury-gold text-black text-sm font-bold hover:bg-white transition-all flex items-center gap-2 shadow-lg shadow-luxury-gold/10">
                <Plus className="w-4 h-4" /> Novo lançamento
              </button>
            )}
          </div>
        </Card>
      </div>
    );
  }

  const yKey = mode === 'acum' ? 'curCum' : 'cur';
  const pKey = mode === 'acum' ? 'prevCum' : 'prev';
  const maxStore = Math.max(...a.stores.map(s => s.total), 1);
  const focus = activeDept !== null ? a.depts[activeDept] : null;

  const rhythmRows = rhythm === 'semana' ? a.weekRows : a.partRows;
  const rhythmPeak = rhythmRows.reduce((x, y) => (y.value > x.value ? y : x), rhythmRows[0]);
  const rhythmCaption = a.total > 0 && rhythmPeak.value > 0
    ? rhythm === 'semana'
      ? `${cap(rhythmPeak.long)} é o dia mais pesado: ${Math.round((rhythmPeak.value / a.total) * 100)}% do gasto.`
      : `Você compra mais ${rhythmPeak.long}: ${Math.round((rhythmPeak.value / a.total) * 100)}% do gasto.`
    : '';

  return (
    <div className="space-y-6 md:space-y-8 pb-4">
      <Reveal i={0}>{chipRow}</Reveal>

      {/* ── HERO ─────────────────────────────────────────────── */}
      <Reveal i={1}>
        <Card glow="gold">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-3 mb-5">
            <div className="min-w-0">
              <h3 className="text-[11px] text-zinc-400 uppercase tracking-[0.1em] font-bold mb-1 flex items-center gap-2">
                <Zap className="w-3 h-3 text-luxury-gold" /> Gasto no período
              </h3>
              <p className="text-xs text-zinc-500">{a.rg.title}</p>
            </div>
            <Segmented value={mode} onChange={setMode} options={[{ id: 'acum', label: 'Acumulado' }, { id: 'dia', label: a.monthly ? 'Mensal' : 'Diário' }]} />
          </div>

          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 mb-6">
            <span className="text-4xl md:text-6xl font-serif font-bold tracking-tighter text-white leading-none">{brl.format(animatedTotal)}</span>
            <DeltaPill delta={a.delta} label={a.rg.prevLabel} />
          </div>

          <div className="h-[220px] md:h-[320px] -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={a.rows} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                <defs>
                  <linearGradient id="pgGold" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#D4AF37" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#D4AF37" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ct.grid} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: ct.tick, fontSize: 10, fontWeight: 600 }} interval="preserveStartEnd" minTickGap={26} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: ct.tick, fontSize: 10 }} tickFormatter={compact} width={48} />
                <Tooltip cursor={{ stroke: '#D4AF37', strokeOpacity: 0.3, strokeDasharray: '3 3' }} content={(p: any) => <HeroTooltip {...p} mode={mode} prevLabel={a.rg.prevLabel} monthly={a.monthly} />} />
                <Line type="monotone" dataKey={pKey} stroke={ct.prev} strokeWidth={1.5} strokeDasharray="4 5" dot={false} activeDot={false} isAnimationActive={!reduced} animationDuration={1400} />
                {mode === 'acum' && a.projection !== null && (
                  <Line type="monotone" dataKey="proj" stroke="#D4AF37" strokeOpacity={0.7} strokeWidth={2} strokeDasharray="2 6" strokeLinecap="round" dot={false} activeDot={false} isAnimationActive={!reduced} animationDuration={1800} />
                )}
                <Area type="monotone" dataKey={yKey} stroke="#D4AF37" strokeWidth={2.5} fill="url(#pgGold)" dot={false}
                  activeDot={{ r: 5, stroke: '#D4AF37', strokeWidth: 2, fill: ct.dot }} isAnimationActive={!reduced} animationDuration={1400} animationEasing="ease-out" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-2 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-2"><span className="w-4 h-[2px] bg-luxury-gold rounded-full" /> Este período</span>
            <span className="inline-flex items-center gap-2"><span className="w-4 border-t-2 border-dashed border-zinc-500" /> {cap(a.rg.prevLabel)}</span>
            {mode === 'acum' && a.projection !== null && <span className="inline-flex items-center gap-2"><span className="w-4 border-t-2 border-dotted border-luxury-gold" /> Projeção</span>}
          </div>

          <div className="grid grid-cols-3 mt-6 pt-5 border-t border-white/5">
            {[
              { label: 'Compras', value: String(a.count) },
              { label: 'Ticket médio', value: brl.format(a.ticket) },
              { label: 'Média por dia', value: brl.format(a.total / a.spanDays) },
            ].map((s, i) => (
              <div key={s.label} className={`min-w-0 ${i > 0 ? 'border-l border-white/5 pl-4' : ''}`}>
                <p className="text-xs text-zinc-400 font-medium mb-1 leading-tight">{s.label}</p>
                <p className="text-base md:text-2xl font-serif font-bold text-white tracking-tight truncate">{s.value}</p>
              </div>
            ))}
          </div>

          {a.projection !== null && (
            <div className="mt-5 flex items-center gap-3 p-4 rounded-2xl bg-luxury-gold/5 border border-luxury-gold/20">
              <span className="p-2 rounded-xl bg-luxury-gold/10 text-luxury-gold shrink-0"><TrendingUp className="w-4 h-4" /></span>
              <p className="text-sm text-zinc-400 leading-relaxed">
                No ritmo atual o mês fecha em <strong className="text-white font-semibold">{brl.format(a.projection)}</strong>
                {a.prevClosed !== null && a.prevClosed > 0 && <>; o mês anterior fechou em {brl.format(a.prevClosed)}</>}.
              </p>
            </div>
          )}
        </Card>
      </Reveal>

      {/* ── LEITURAS ─────────────────────────────────────────── */}
      {a.insights.length > 0 && (
        <Reveal i={2}>
          <Card glow="blue">
            <CardTitle icon={Sparkles} kicker="Leituras" title="O que os números dizem" />
            <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {a.insights.map((it, i) => (
                <li key={i}>
                  {it.open && onOpenReceipt ? (
                    <button type="button" onClick={() => onOpenReceipt(it.open!)} data-testid="insight-open"
                      className="w-full text-left flex items-start gap-3 p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/5 active:bg-white/10 transition-colors">
                      <span className={`shrink-0 p-2 rounded-xl ${TONE[it.tone]}`}><it.icon className="w-4 h-4" /></span>
                      <p className="flex-1 text-sm text-zinc-400 leading-relaxed">{it.text}</p>
                      <ChevronRight className="w-4 h-4 mt-2 shrink-0 text-zinc-600" />
                    </button>
                  ) : (
                    <div className="flex items-start gap-3 p-4 rounded-2xl bg-white/[0.03] border border-white/5">
                      <span className={`shrink-0 p-2 rounded-xl ${TONE[it.tone]}`}><it.icon className="w-4 h-4" /></span>
                      <p className="text-sm text-zinc-400 leading-relaxed">{it.text}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 md:gap-8">
        {/* ── DEPARTAMENTOS ─────────────────────────────────── */}
        <Reveal i={3}>
          <Card glow="pink">
            <CardTitle icon={Layers} kicker="Departamentos" title="Para onde foi o dinheiro" accent="text-pink-500" />
            <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-6 items-center">
              <div className="relative h-[200px] w-full sm:w-[200px] mx-auto">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={a.depts} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="96%"
                      paddingAngle={a.depts.length > 1 ? 3 : 0} cornerRadius={6} stroke="none" startAngle={90} endAngle={-270}
                      isAnimationActive={!reduced} animationDuration={1200} animationEasing="ease-out"
                      onMouseEnter={(_: any, idx: number) => setActiveDept(idx)} onMouseLeave={() => setActiveDept(null)}
                      onClick={(_: any, idx: number) => setActiveDept(cur => (cur === idx ? null : idx))}
                    >
                      {a.depts.map((d, i) => (
                        <Cell key={d.name} fill={d.color} style={{ opacity: activeDept === null || activeDept === i ? 1 : 0.25, transition: 'opacity .3s ease', cursor: 'pointer', outline: 'none' }} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-10">
                  <span className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold max-w-full truncate">{focus ? focus.name : 'Total em itens'}</span>
                  <span className="text-lg font-serif font-bold text-white tracking-tight">{brl0.format(focus ? focus.value : a.deptTotal)}</span>
                  {focus && <span className="text-xs text-zinc-500 font-bold">{Math.round(focus.share)}% do total</span>}
                </div>
              </div>

              <ul className="space-y-3 min-w-0">
                {a.depts.map((d, i) => (
                  <li
                    key={d.name}
                    onMouseEnter={() => setActiveDept(i)} onMouseLeave={() => setActiveDept(null)}
                    onClick={() => setActiveDept(cur => (cur === i ? null : i))}
                    className={`cursor-pointer transition-opacity duration-300 ${activeDept === null || activeDept === i ? 'opacity-100' : 'opacity-40'}`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="text-xs font-sans font-bold text-white uppercase tracking-wide truncate">{d.name}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span data-testid="dept-pct" className="text-xs font-bold text-luxury-gold tabular-nums">{d.pct}%</span>
                        <span className="text-xs font-sans font-bold text-white">{brl0.format(d.value)}</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full transition-[width] duration-1000 ease-out" style={{ width: ready ? `${d.share}%` : '0%', backgroundColor: d.color, transitionDelay: `${i * 70}ms` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </Reveal>

        {/* ── RITMO ─────────────────────────────────────────── */}
        <Reveal i={4}>
          <Card glow="emerald">
            <CardTitle
              icon={Clock} kicker="Ritmo" title="Quando você compra" accent="text-emerald-500"
              right={<Segmented value={rhythm} onChange={setRhythm} options={[{ id: 'semana', label: 'Semana' }, { id: 'hora', label: 'Hora', disabled: !a.hasTime }]} />}
            />
            <div className="h-[220px] -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rhythmRows} margin={{ top: 10, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ct.grid} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: ct.tick, fontSize: 10, fontWeight: 600 }} dy={8} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: ct.tick, fontSize: 10 }} tickFormatter={compact} width={48} />
                  <Tooltip
                    cursor={{ fill: light ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)' }}
                    content={(p: any) => p.active && p.payload?.length ? (
                      <TipBox title={cap(p.payload[0].payload.long)}>
                        <TipRow color="#D4AF37" label="Gasto" value={p.payload[0].payload.value} />
                        <p className="text-[11px] text-zinc-500 font-bold uppercase tracking-[0.08em]">{p.payload[0].payload.count} {p.payload[0].payload.count === 1 ? 'compra' : 'compras'}</p>
                      </TipBox>
                    ) : null}
                  />
                  <Bar dataKey="value" radius={[8, 8, 8, 8]} maxBarSize={44} isAnimationActive={!reduced} animationDuration={1100} animationEasing="ease-out">
                    {rhythmRows.map(r => <Cell key={r.name} fill={r === rhythmPeak ? '#D4AF37' : ct.barDim} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {rhythmCaption && <p className="mt-4 text-sm text-zinc-400 leading-relaxed">{rhythmCaption}</p>}
          </Card>
        </Reveal>

        {/* ── ESTABELECIMENTOS ──────────────────────────────── */}
        <Reveal i={5}>
          <Card glow="blue">
            <CardTitle icon={Store} kicker="Estabelecimentos" title="Onde você mais gasta" accent="text-blue-500" />
            <ul className="space-y-2">
              {a.stores.map((s, i) => (
                <li key={s.key}>
                  <button
                    onClick={() => onSelectEstablishment?.(s.real)}
                    className="w-full text-left group p-3 -mx-3 rounded-2xl hover:bg-white/5 transition-colors duration-300"
                    style={{ width: 'calc(100% + 1.5rem)' }}
                  >
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className="text-sm font-semibold text-white line-clamp-2 break-words leading-snug capitalize">{nice(s.name).toLowerCase()}</span>
                      <span className="flex items-center gap-1 shrink-0">
                        <span className="text-sm font-sans font-bold text-white">{brl.format(s.total)}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-luxury-gold group-hover:translate-x-0.5 transition-all" />
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 mb-2">{s.n} {s.n === 1 ? 'compra' : 'compras'} · ticket {brl.format(s.ticket)} · {Math.round(s.share)}% do gasto</p>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full bg-blue-500 transition-[width] duration-1000 ease-out" style={{ width: ready ? `${(s.total / maxStore) * 100}%` : '0%', transitionDelay: `${i * 70}ms` }} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {a.storesAll > a.stores.length && <p className="mt-3 text-xs text-zinc-500">e mais {a.storesAll - a.stores.length} {a.storesAll - a.stores.length === 1 ? 'lugar' : 'lugares'}</p>}
          </Card>
        </Reveal>

        {/* ── PREÇOS ────────────────────────────────────────── */}
        <Reveal i={6}>
          <Card glow="gold">
            <CardTitle icon={Tag} kicker="Preços" title="O que ficou mais caro ou barato" />
            {a.rose.length === 0 && a.fell.length === 0 ? (
              <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/5">
                <p className="text-sm text-zinc-400 leading-relaxed">Ainda não há produto comprado duas vezes na mesma loja. Quando houver, a variação de preço aparece aqui.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {[{ title: 'Subiram', list: a.rose, up: true }, { title: 'Caíram', list: a.fell, up: false }].filter(g => g.list.length > 0).map(g => (
                  <div key={g.title}>
                    <p className={`text-[11px] font-bold uppercase tracking-[0.1em] mb-3 flex items-center gap-2 ${g.up ? 'text-red-500' : 'text-emerald-500'}`}>
                      {g.up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />} {g.title}
                    </p>
                    <ul className="space-y-2">
                      {g.list.map(m => (
                        <li key={m.desc + m.store}>
                          {(() => {
                            const body = (
                              <>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-white truncate capitalize">{m.desc.toLowerCase()}</p>
                                  <p className="text-xs text-zinc-500 truncate"><span className="capitalize">{nice(m.store).toLowerCase()}</span> · {brl.format(m.from)} para {brl.format(m.to)}</p>
                                </div>
                                <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold ${g.up ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                                  {g.up ? '+' : '−'}{Math.abs(Math.round(m.pct))}%
                                </span>
                              </>
                            );
                            return onOpenReceipt ? (
                              <button type="button" onClick={() => onOpenReceipt(m.rid)} data-testid="mover-open"
                                className="w-full text-left flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/5 active:bg-white/10 transition-colors">
                                {body}<ChevronRight className="w-3.5 h-3.5 shrink-0 text-zinc-600" />
                              </button>
                            ) : (
                              <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/5">{body}</div>
                            );
                          })()}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Reveal>
      </div>
    </div>
  );
};

export default ReportsPanorama;
