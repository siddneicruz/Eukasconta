import { useCallback, useEffect, useState } from 'react';
import { Receipt } from '../types';
import { catKey, deptKey, masterOf, properCase } from './textFormat';

/* Filtro de categorias que fica gravado no aparelho.
   Dois modos com a mesma lista:
   - 'exclude': analisa tudo, MENOS o que está na lista ("tirei Transporte");
   - 'only':    analisa SÓ o que está na lista.
   Inverter é só trocar o modo: o que estava de fora vira o único dentro, e de novo para voltar.

   Cada item da lista é um departamento inteiro ("hortifruti") ou uma categoria dele ("c:hortifruti - frutas").
   Chaves sem prefixo são departamentos, como já estavam gravadas antes. */

export type DeptMode = 'exclude' | 'only';
export interface DeptFilter { mode: DeptMode; keys: string[] }

export const NO_DEPT_FILTER: DeptFilter = { mode: 'exclude', keys: [] };
export const DEPT_FILTER_KEY = 'eukasconta_dept_filter';
export const NO_CATEGORY_LABEL = 'Sem categoria';
export const NO_SUBCATEGORY_LABEL = 'Sem subcategoria';

export const isDeptFilterActive = (f: DeptFilter): boolean => f.keys.length > 0;

/** Aceita qualquer coisa vinda do armazenamento e devolve um filtro válido. */
export const normalizeDeptFilter = (raw: unknown): DeptFilter => {
  const r = raw as { mode?: unknown; keys?: unknown } | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.keys)) return NO_DEPT_FILTER;
  const keys = Array.from(new Set(r.keys.filter((k): k is string => typeof k === 'string')));
  if (keys.length === 0) return NO_DEPT_FILTER;
  return { mode: r.mode === 'only' ? 'only' : 'exclude', keys };
};

/** Troca o lado: o que estava de fora passa a ser o único analisado (e vice-versa). Sem filtro, nada a inverter. */
export const invertDeptFilter = (f: DeptFilter): DeptFilter =>
  isDeptFilterActive(f) ? { mode: f.mode === 'exclude' ? 'only' : 'exclude', keys: f.keys } : f;

/** Texto curto para o botão: "Todas categorias", "Sem Transporte", "Só Hortifruti +1". */
export const deptFilterLabel = (f: DeptFilter, labelOf: (key: string) => string): string => {
  if (!isDeptFilterActive(f)) return 'Todas categorias';
  const first = labelOf(f.keys[0]);
  const rest = f.keys.length - 1;
  return `${f.mode === 'only' ? 'Só' : 'Sem'} ${first}${rest > 0 ? ` +${rest}` : ''}`;
};

/* ───────────────────────── aplicar nos cupons ───────────────────────── */

// "Hortifruti - Frutas" -> chave do departamento e da categoria (cache: as mesmas strings se repetem muito)
const keyCache = new Map<string, { d: string; c: string }>();
const keysOf = (category?: string | null): { d: string; c: string } => {
  const raw = String(category ?? '');
  let k = keyCache.get(raw);
  if (!k) { k = { d: deptKey(raw), c: `c:${catKey(raw)}` }; keyCache.set(raw, k); }
  return k;
};

/** Cupons só com as linhas que entram. Cupom sem nenhuma linha some;
    cupom que perdeu linhas passa a valer a soma das que sobraram; cupom intacto não muda. */
export const applyDeptFilter = (receipts: Receipt[], f: DeptFilter): Receipt[] => {
  if (!isDeptFilterActive(f)) return receipts;
  const set = new Set(f.keys);
  const only = f.mode === 'only';
  const keeps = (category?: string | null) => {
    const k = keysOf(category);
    const hit = set.has(k.d) || set.has(k.c);
    return only ? hit : !hit;
  };
  const out: Receipt[] = [];
  receipts.forEach(r => {
    const items = r.items || [];
    const kept = items.filter(i => keeps(i.category));
    if (kept.length === items.length) { out.push(r); return; }
    if (kept.length === 0) return;
    out.push({ ...r, items: kept, totalAmount: kept.reduce((s, i) => s + (Number(i.totalPrice) || 0), 0) });
  });
  return out;
};

/* ───────────────────────── lista para a folha de escolha ───────────────────────── */

export interface DeptOption {
  key: string;            // 'hortifruti' (departamento) | 'c:hortifruti - frutas' (categoria)
  kind: 'dept' | 'cat';
  label: string;          // "Hortifruti" | "Frutas"
  full: string;           // "Hortifruti" | "Hortifruti - Frutas"
  dept: string;           // chave do departamento a que pertence
  total: number;          // gasto no período
}

interface DeptAcc { name: string; variants: Map<string, number>; total: number }
interface CatAcc { dept: string; variants: Map<string, number>; total: number }

const hasSub = (category: string) => category.includes(' - ');
const subOf = (category: string) => category.split(' - ').slice(1).map(p => p.trim()).filter(Boolean).join(' - ');
const topVariant = (m: Map<string, number>): string => Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0][0];

/** Departamentos e categorias que existem nas compras (`all`), com quanto gastaram no período (`period`).
    Mais gasto primeiro. Departamento que também tem compras sem subcategoria ganha a opção "Sem subcategoria". */
export const buildDeptOptions = (all: Receipt[], period: Receipt[]): DeptOption[] => {
  const depts = new Map<string, DeptAcc>();
  const cats = new Map<string, CatAcc>();
  const visit = (receipts: Receipt[], count: boolean) => {
    receipts.forEach(r => (r.items || []).forEach(i => {
      const cat = String(i.category || '').trim();
      const name = masterOf(cat) || NO_CATEGORY_LABEL;
      const k = keysOf(cat);
      const price = Number(i.totalPrice) || 0;
      let d = depts.get(k.d);
      if (!d) { d = { name, variants: new Map(), total: 0 }; depts.set(k.d, d); }
      d.variants.set(name, (d.variants.get(name) || 0) + Math.abs(price));
      if (count) d.total += price;
      const sub = hasSub(cat) ? subOf(cat) : '';
      if (sub) {
        const full = `${name} - ${sub}`;
        let c = cats.get(k.c);
        if (!c) { c = { dept: k.d, variants: new Map(), total: 0 }; cats.set(k.c, c); }
        c.variants.set(full, (c.variants.get(full) || 0) + Math.abs(price));
        if (count) c.total += price;
      } else {
        // compras só com o departamento: a "folha" é 'c:<departamento>'
        let c = cats.get(`own:${k.d}`);
        if (!c) { c = { dept: k.d, variants: new Map(), total: 0 }; cats.set(`own:${k.d}`, c); }
        c.variants.set(name, 1);
        if (count) c.total += price;
      }
    }));
  };
  visit(all, false);
  visit(period, true);

  const subCount = new Map<string, number>();
  cats.forEach((c, key) => { if (!key.startsWith('own:')) subCount.set(c.dept, (subCount.get(c.dept) || 0) + 1); });

  const out: DeptOption[] = [];
  depts.forEach((d, key) => {
    const label = properCase(topVariant(d.variants)) || NO_CATEGORY_LABEL;
    out.push({ key, kind: 'dept', label, full: label, dept: key, total: d.total });
  });
  cats.forEach((c, key) => {
    const deptLabel = properCase(topVariant(depts.get(c.dept)!.variants)) || NO_CATEGORY_LABEL;
    if (key.startsWith('own:')) {
      // só aparece como linha própria quando o departamento tem subcategorias
      if ((subCount.get(c.dept) || 0) === 0) return;
      out.push({ key: `c:${c.dept}`, kind: 'cat', label: NO_SUBCATEGORY_LABEL, full: `${deptLabel} - ${NO_SUBCATEGORY_LABEL}`, dept: c.dept, total: c.total });
      return;
    }
    const sub = properCase(topVariant(c.variants).split(' - ').slice(1).join(' - '));
    out.push({ key, kind: 'cat', label: sub, full: `${deptLabel} - ${sub}`, dept: c.dept, total: c.total });
  });
  return out.sort((a, b) => b.total - a.total || a.full.localeCompare(b.full, 'pt-BR'));
};

/** Nome da opção a partir da chave (se ela não existe mais nas compras, deixa a chave com iniciais maiúsculas). */
export const deptLabelFor = (options: DeptOption[], key: string): string => {
  const o = options.find(x => x.key === key);
  if (o) return o.label;
  const raw = key.startsWith('c:') ? key.slice(2).split(' - ').pop() || '' : key;
  return properCase(raw) || NO_CATEGORY_LABEL;
};

/** Nome completo ("Hortifruti - Frutas") para textos longos. */
export const deptFullFor = (options: DeptOption[], key: string): string => {
  const o = options.find(x => x.key === key);
  if (o) return o.full;
  return key.startsWith('c:') ? key.slice(2).split(' - ').map(p => properCase(p)).join(' - ') : (properCase(key) || NO_CATEGORY_LABEL);
};

/* ───────────────────────── escolher dentro da lista ─────────────────────────
   Por baixo, toda escolha é "quais folhas entram". Folha = categoria ('c:...'); departamento sem
   subcategorias tem uma folha só ('c:<departamento>'). A chave volta compacta: se todas as folhas
   de um departamento estão do mesmo lado, grava só o departamento (que vale também para categorias novas). */

export interface DeptIndex {
  depts: DeptOption[];
  catsOf: Map<string, DeptOption[]>;     // departamento -> suas categorias (maior gasto primeiro)
  leavesOf: Map<string, string[]>;       // departamento -> chaves das folhas
  allLeaves: string[];
  byKey: Map<string, DeptOption>;
}

export const indexOptions = (options: DeptOption[]): DeptIndex => {
  const depts = options.filter(o => o.kind === 'dept');
  const catsOf = new Map<string, DeptOption[]>();
  options.filter(o => o.kind === 'cat').forEach(c => {
    const arr = catsOf.get(c.dept);
    if (arr) arr.push(c); else catsOf.set(c.dept, [c]);
  });
  const leavesOf = new Map<string, string[]>();
  const allLeaves: string[] = [];
  depts.forEach(d => {
    const cats = catsOf.get(d.key);
    const leaves = cats && cats.length ? cats.map(c => c.key) : [`c:${d.key}`];
    leavesOf.set(d.key, leaves);
    allLeaves.push(...leaves);
  });
  const byKey = new Map<string, DeptOption>();
  options.forEach(o => byKey.set(o.key, o));
  return { depts, catsOf, leavesOf, allLeaves, byKey };
};

const leafDeptOf = (idx: DeptIndex, leaf: string): string => {
  const o = idx.byKey.get(leaf);
  return o ? o.dept : leaf.slice(2);
};

/** Folhas que entram na análise com este filtro. */
export const includedLeaves = (f: DeptFilter, idx: DeptIndex): Set<string> => {
  const set = new Set(f.keys);
  const out = new Set<string>();
  idx.allLeaves.forEach(l => {
    const hit = set.has(leafDeptOf(idx, l)) || set.has(l);
    if ((f.mode === 'only') === hit) out.add(l);
  });
  return out;
};

export type SelState = 'all' | 'some' | 'none';
const stateOf = (leaves: string[], inc: Set<string>): SelState => {
  const n = leaves.filter(l => inc.has(l)).length;
  return n === 0 ? 'none' : n === leaves.length ? 'all' : 'some';
};
export const deptState = (idx: DeptIndex, inc: Set<string>, dept: string): SelState => stateOf(idx.leavesOf.get(dept) || [], inc);
export const optionState = (idx: DeptIndex, inc: Set<string>, o: DeptOption): SelState =>
  o.kind === 'dept' ? deptState(idx, inc, o.key) : stateOf([o.key], inc);

// Volta de "quais folhas entram" para um filtro compacto, no mesmo modo de antes.
const fromIncluded = (inc: Set<string>, idx: DeptIndex, mode: DeptMode, prev: DeptFilter): DeptFilter => {
  if (idx.allLeaves.every(l => inc.has(l))) return NO_DEPT_FILTER;
  const side = (l: string) => (mode === 'only') === inc.has(l);   // folhas que a lista precisa citar
  const keys: string[] = [];
  idx.depts.forEach(d => {
    const leaves = idx.leavesOf.get(d.key) || [];
    const cited = leaves.filter(side);
    if (cited.length === 0) return;
    if (cited.length === leaves.length) keys.push(d.key); else keys.push(...cited);
  });
  // chaves de categorias que já não existem nas compras: continuam como estavam
  prev.keys.forEach(k => {
    const known = idx.byKey.has(k) || (k.startsWith('c:') && idx.allLeaves.includes(k));
    if (!known && !keys.includes(k)) keys.push(k);
  });
  return keys.length ? { mode, keys } : NO_DEPT_FILTER;
};

/** Marca ou desmarca um departamento inteiro (todas as categorias dele). Sempre sobra algo dentro. */
export const toggleDeptSel = (f: DeptFilter, idx: DeptIndex, dept: string): DeptFilter => {
  const inc = includedLeaves(f, idx);
  const leaves = idx.leavesOf.get(dept) || [];
  if (leaves.length === 0) return f;
  if (leaves.every(l => inc.has(l))) {
    leaves.forEach(l => inc.delete(l));
    if (inc.size === 0) return f;
  } else {
    leaves.forEach(l => inc.add(l));
  }
  return fromIncluded(inc, idx, f.mode, f);
};

/** Marca ou desmarca uma categoria. Sempre sobra algo dentro. */
export const toggleLeafSel = (f: DeptFilter, idx: DeptIndex, leaf: string): DeptFilter => {
  const inc = includedLeaves(f, idx);
  if (inc.has(leaf)) {
    inc.delete(leaf);
    if (inc.size === 0) return f;
  } else {
    inc.add(leaf);
  }
  return fromIncluded(inc, idx, f.mode, f);
};

const leavesOfOption = (idx: DeptIndex, o: DeptOption): string[] => (o.kind === 'dept' ? idx.leavesOf.get(o.key) || [] : [o.key]);

/** Só estes (departamentos e/ou categorias) entram. */
export const onlySel = (idx: DeptIndex, options: DeptOption[]): DeptFilter => {
  const inc = new Set<string>();
  options.forEach(o => leavesOfOption(idx, o).forEach(l => inc.add(l)));
  if (inc.size === 0) return NO_DEPT_FILTER;
  return fromIncluded(inc, idx, 'only', NO_DEPT_FILTER);
};

/** Marca (on) ou tira (!on) vários de uma vez, por exemplo os resultados de uma busca. */
export const setManySel = (f: DeptFilter, idx: DeptIndex, options: DeptOption[], on: boolean): DeptFilter => {
  const inc = includedLeaves(f, idx);
  options.forEach(o => leavesOfOption(idx, o).forEach(l => { if (on) inc.add(l); else inc.delete(l); }));
  if (inc.size === 0) return f;
  return fromIncluded(inc, idx, f.mode, f);
};

/* ───────────────────────── gravação no aparelho ───────────────────────── */

export const loadDeptFilter = (storageKey: string = DEPT_FILTER_KEY): DeptFilter => {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? normalizeDeptFilter(JSON.parse(raw)) : NO_DEPT_FILTER;
  } catch { return NO_DEPT_FILTER; }
};

export const saveDeptFilter = (f: DeptFilter, storageKey: string = DEPT_FILTER_KEY): void => {
  try {
    if (isDeptFilterActive(f)) localStorage.setItem(storageKey, JSON.stringify(f));
    else localStorage.removeItem(storageKey);
  } catch { /* sem armazenamento: vale só até fechar o app */ }
};

/** O filtro gravado: lê ao abrir, grava a cada mudança e acompanha outras abas. */
export const useDeptFilter = (storageKey: string = DEPT_FILTER_KEY): [DeptFilter, (f: DeptFilter) => void] => {
  const [filter, setFilter] = useState<DeptFilter>(() => loadDeptFilter(storageKey));
  const update = useCallback((next: DeptFilter) => {
    setFilter(next);
    saveDeptFilter(next, storageKey);
  }, [storageKey]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === storageKey) setFilter(loadDeptFilter(storageKey)); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);
  return [filter, update];
};
