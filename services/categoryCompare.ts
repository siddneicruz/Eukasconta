import { Receipt, TaxonomyNode } from '../types';
import { catKey, deptKey, masterOf, properCase } from './textFormat';
import { buildEvolution, EvoConfig } from './evolutionSeries';
import { LayerIndex, buildLayerOpts, getActiveLayers, itemKeys } from './categoryLayers';

/* Comparativo de categorias: as opções vêm das compras do próprio usuário (nunca de uma lista fixa),
   cada opção é um departamento inteiro ("Hortifruti") ou uma categoria dele ("Hortifruti - Frutas"),
   e a série de cada uma sai da mesma escala de tempo da Timeline do Início. */

export type CompareKind = 'dept' | 'cat' | 'grp' | 'item' | 'rest';

export interface CompareOption {
  id: string;        // 'd:hortifruti' | 'c:hortifruti frutas' | 'g:...' | 'i:...' | 'o:...' (sem caixa nem acento)
  kind: CompareKind;
  label: string;     // "Hortifruti" | "Frutas" | "Cortes Nobres" | "Picanha"
  dept: string;      // "Hortifruti"
  full: string;      // "Hortifruti" | "Hortifruti - Frutas" | "Açougue - Carne Bovina - Cortes Nobres - Picanha"
  total: number;     // gasto no período escolhido
  items: number;     // linhas de item no período
  level?: 1 | 2 | 3 | 4;
  parent?: string | null;   // id de quem está logo acima
}

export const NO_CATEGORY = 'Sem categoria';

// Até 5 linhas ao mesmo tempo; cada escolha fica com a mesma cor até sair da comparação.
export const MAX_COMPARE = 5;
export const CMP_COLORS = ['#D4AF37', '#27A46D', '#3B82F6', '#EC4899', '#8B5CF6'];

// "Hortifruti - Frutas" -> departamento e categoria, já em chaves comparáveis (cache: as mesmas strings se repetem muito)
const keyCache = new Map<string, { d: string; c: string }>();
const keysOf = (category?: string | null): { d: string; c: string } => {
  const raw = String(category ?? '');
  let k = keyCache.get(raw);
  if (!k) {
    k = { d: deptKey(raw), c: catKey(raw) };
    keyCache.set(raw, k);
  }
  return k;
};
const hasSub = (category: string) => category.includes(' - ');
const subOf = (category: string) => category.split(' - ').slice(1).map(p => p.trim()).filter(Boolean).join(' - ');

export const deptId = (category?: string | null) => `d:${keysOf(category).d}`;
export const catId = (category?: string | null) => `c:${keysOf(category).c}`;

/** Diz se uma linha de compra (categoria + descrição) pertence à opção. A descrição só pesa para grupo, item e "outros itens". */
export const matcherFor = (id: string, layers: LayerIndex = getActiveLayers()): ((category: string, description?: string) => boolean) => {
  const key = id.slice(2);
  if (id.startsWith('d:')) return (category: string) => keysOf(category).d === key;
  if (id.startsWith('c:')) return (category: string) => keysOf(category).c === key;
  const field = id.startsWith('g:') ? 'g' : id.startsWith('i:') ? 'i' : id.startsWith('o:') ? 'o' : null;
  if (!field) return () => false;
  return (category: string, description?: string) => itemKeys(category, description, layers)[field] === id;
};

interface Acc { variants: Map<string, number>; total: number; items: number; dept: string; sub: string; kind: CompareKind }

export interface CompareBuildOpts {
  layers?: LayerIndex;
  /** Com a estrutura de categorias, entram também as que ainda não têm compra (para definir metas, por exemplo). */
  taxonomy?: TaxonomyNode[];
  includeUnused?: boolean;
}

/** Opções para o campo de busca. `all` define o que existe; `period` define quanto cada uma gastou agora. */
export const buildCompareOptions = (all: Receipt[], period: Receipt[], opts: CompareBuildOpts = {}): CompareOption[] => {
  const layers = opts.layers ?? getActiveLayers();
  const map = new Map<string, Acc>();
  const touch = (id: string, kind: CompareKind, dept: string, sub: string, price: number, count: boolean) => {
    let a = map.get(id);
    if (!a) { a = { variants: new Map(), total: 0, items: 0, dept, sub, kind }; map.set(id, a); }
    const v = kind === 'dept' ? dept : `${dept} - ${sub}`;
    a.variants.set(v, (a.variants.get(v) || 0) + Math.abs(price));
    if (count) { a.total += price; a.items += 1; }
  };
  const visit = (receipts: Receipt[], count: boolean) => {
    receipts.forEach(r => (r.items || []).forEach(i => {
      const cat = String(i.category || '').trim();
      const dept = masterOf(cat) || NO_CATEGORY;
      const price = Number(i.totalPrice) || 0;
      touch(deptId(cat), 'dept', dept, '', price, count);
      if (hasSub(cat) && subOf(cat)) touch(catId(cat), 'cat', dept, subOf(cat), price, count);
    }));
  };
  visit(all, false);
  visit(period, true);

  // categorias da estrutura da pessoa que ainda não têm compra
  if (opts.includeUnused && opts.taxonomy) {
    const byId = new Map(opts.taxonomy.map(n => [n.id, n] as [string, TaxonomyNode]));
    opts.taxonomy.forEach(n => {
      if (n.level === 1) {
        const id = deptId(n.name);
        if (!map.has(id)) touch(id, 'dept', n.name.trim(), '', 0, false);
      } else if (n.level === 2) {
        const l1 = n.parentId ? byId.get(n.parentId) : undefined;
        if (!l1) return;
        const cat = `${l1.name.trim()} - ${n.name.trim()}`;
        const did = deptId(cat), cid = catId(cat);
        if (!map.has(did)) touch(did, 'dept', l1.name.trim(), '', 0, false);
        if (!map.has(cid)) touch(cid, 'cat', l1.name.trim(), n.name.trim(), 0, false);
      }
    });
  }

  const best = (a: Acc): string => Array.from(a.variants.entries()).sort((x, y) => y[1] - x[1])[0][0];
  const out: CompareOption[] = Array.from(map.entries()).map(([id, a]) => {
    const top = best(a);
    const dept = properCase(a.kind === 'dept' ? top : top.split(' - ')[0]) || NO_CATEGORY;
    const sub = a.kind === 'cat' ? properCase(top.split(' - ').slice(1).join(' - ')) : '';
    return {
      id, kind: a.kind, dept,
      label: a.kind === 'dept' ? dept : sub,
      full: a.kind === 'dept' ? dept : `${dept} - ${sub}`,
      total: a.total, items: a.items,
      level: a.kind === 'dept' ? 1 : 2,
      parent: a.kind === 'dept' ? null : deptId(a.dept),
    } as CompareOption;
  });

  // camadas 3 e 4
  const cats = new Map<string, CompareOption>();
  out.forEach(o => { if (o.kind === 'cat') cats.set(o.id, o); });
  buildLayerOpts(all, period, layers, !!opts.includeUnused).forEach(l => {
    const cat = cats.get(`c:${l.catKey}`);
    if (!cat) return;
    const full = l.kind === 'item' ? `${cat.full} - ${l.groupLabel} - ${l.label}` : `${cat.full} - ${l.label}`;
    out.push({
      id: l.key, kind: l.kind, label: l.label, dept: cat.dept, full, total: l.total, items: l.items,
      level: l.level, parent: l.parent,
    });
  });
  return out;
};

/** Mais gasto no período primeiro; empate (ou sem gasto) em ordem alfabética. */
export const bySpend = (a: CompareOption, b: CompareOption) =>
  b.total - a.total || a.full.localeCompare(b.full, 'pt-BR');

export interface CompareSelection { id: string; color: string }

export interface CompareStats { total: number; items: number; receipts: number; avg: number; periodTotal: number }

/** Totais das opções escolhidas. Uma linha de item conta uma vez só, mesmo se casar com um departamento e com uma categoria dele. */
export const computeCompareStats = (period: Receipt[], ids: string[], layers: LayerIndex = getActiveLayers()): CompareStats => {
  const matchers = ids.map(id => matcherFor(id, layers));
  let total = 0, items = 0, receipts = 0, periodTotal = 0;
  period.forEach(r => {
    let hit = false;
    (r.items || []).forEach(i => {
      const price = Number(i.totalPrice) || 0;
      periodTotal += price;
      if (matchers.length && matchers.some(m => m(String(i.category || ''), i.description))) {
        total += price; items += 1; hit = true;
      }
    });
    if (hit) receipts += 1;
  });
  return { total, items, receipts, avg: receipts > 0 ? total / receipts : 0, periodTotal };
};

// Um ponto do eixo: rótulo curto, rótulo completo do balão e o valor de cada opção (s0, s1...)
export interface ComparePoint { name: string; label: string; [seriesKey: string]: number | string }

export interface CompareSeries {
  points: ComparePoint[];
  ticks: string[];
  caption: string;
  showAllDots: boolean;
  keys: string[];           // dataKey de cada opção, na mesma ordem de `ids` ("s0", "s1"...)
}

/** Uma linha por opção, todas na mesma escala (dia, mês ou trimestre) e com os mesmos rótulos do eixo. */
export const buildCompareSeries = (
  period: Receipt[], ids: string[], cfg: EvoConfig, plotWidth: number, now: Date = new Date(), layers: LayerIndex = getActiveLayers(),
): CompareSeries => {
  const base = buildEvolution([], cfg, plotWidth, now);
  const keys = ids.map((_, i) => `s${i}`);
  const points: ComparePoint[] = base.points.map(p => {
    const pt: ComparePoint = { name: p.name, label: p.label };
    keys.forEach(k => { pt[k] = 0; });
    return pt;
  });
  ids.forEach((id, idx) => {
    const match = matcherFor(id, layers);
    const perReceipt: { date: string; totalAmount: number }[] = [];
    period.forEach(r => {
      let sum = 0;
      (r.items || []).forEach(i => { if (match(String(i.category || ''), i.description)) sum += Number(i.totalPrice) || 0; });
      if (sum !== 0) perReceipt.push({ date: r.date, totalAmount: sum });
    });
    const evo = buildEvolution(perReceipt, cfg, plotWidth, now);
    evo.points.forEach((p, n) => { if (points[n]) points[n][keys[idx]] = p.value; });
  });
  return { points, ticks: base.ticks, caption: base.caption, showAllDots: base.showAllDots, keys };
};

/** Rótulo curto para chips e balão: só a categoria; com o departamento junto quando outra opção escolhida tem o mesmo nome. */
export const chipLabel = (opt: CompareOption, chosen: CompareOption[]): string => {
  if (opt.kind === 'dept') return opt.label;
  // "Outros itens" sozinho não diz de quê: leva a categoria junto
  if (opt.kind === 'rest') return opt.full.split(' - ').slice(-2).join(' - ');
  const clash = chosen.some(o => o.id !== opt.id && o.kind !== 'dept' && o.label === opt.label) ||
    chosen.some(o => o.id !== opt.id && o.kind === 'dept' && o.label === opt.label);
  if (!clash) return opt.label;
  return opt.kind === 'cat' ? `${opt.dept} - ${opt.label}` : opt.full;
};
