import { useCallback, useEffect, useState } from 'react';
import { Receipt } from '../types';
import { catKey, deptKey, masterOf, properCase } from './textFormat';
import { LayerIndex, buildLayerOpts, getActiveLayers, isLayerKey, itemKeys } from './categoryLayers';

/* Filtro de categorias que fica gravado no aparelho.
   Dois modos com a mesma lista:
   - 'exclude': analisa tudo, MENOS o que está na lista ("tirei Transporte");
   - 'only':    analisa SÓ o que está na lista.
   Inverter é só trocar o modo: o que estava de fora vira o único dentro, e de novo para voltar.

   Cada item da lista é um departamento inteiro ("hortifruti"), uma categoria dele ("c:hortifruti frutas") ou, indo mais
   fundo, um grupo ("g:..."), um item ("i:...") ou os "outros itens" de uma categoria ("o:..."): ver categoryLayers.ts.
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
export const applyDeptFilter = (receipts: Receipt[], f: DeptFilter, layers: LayerIndex = getActiveLayers()): Receipt[] => {
  if (!isDeptFilterActive(f)) return receipts;
  const set = new Set(f.keys);
  const only = f.mode === 'only';
  const deep = f.keys.some(isLayerKey);    // só olha a descrição do item quando o filtro cita grupo, item ou "outros itens"
  const keeps = (category?: string | null, description?: string | null) => {
    let hit: boolean;
    if (deep) {
      const k = itemKeys(category, description, layers);
      hit = set.has(k.d) || set.has(k.c) || (!!k.g && set.has(k.g)) || (!!k.i && set.has(k.i)) || (!!k.o && set.has(k.o));
    } else {
      const k = keysOf(category);
      hit = set.has(k.d) || set.has(k.c);
    }
    return only ? hit : !hit;
  };
  const out: Receipt[] = [];
  receipts.forEach(r => {
    const items = r.items || [];
    const kept = items.filter(i => keeps(i.category, i.description));
    if (kept.length === items.length) { out.push(r); return; }
    if (kept.length === 0) return;
    out.push({ ...r, items: kept, totalAmount: kept.reduce((s, i) => s + (Number(i.totalPrice) || 0), 0) });
  });
  return out;
};

/* ───────────────────────── lista para a folha de escolha ───────────────────────── */

export type DeptKind = 'dept' | 'cat' | 'grp' | 'item' | 'rest';

export interface DeptOption {
  key: string;            // 'hortifruti' (departamento) | 'c:hortifruti frutas' (categoria) | 'g:...' | 'i:...' | 'o:...'
  kind: DeptKind;
  label: string;          // "Hortifruti" | "Frutas" | "Cortes Nobres" | "Picanha" | "Outros itens"
  full: string;           // "Hortifruti" | "Hortifruti - Frutas" | "Açougue - Carne Bovina - Cortes Nobres - Picanha"
  dept: string;           // chave do departamento a que pertence
  total: number;          // gasto no período
  level?: 1 | 2 | 3 | 4;
  parent?: string | null; // chave de quem está logo acima (categoria, para grupo e "outros itens"; grupo, para item)
}

interface DeptAcc { name: string; variants: Map<string, number>; total: number }
interface CatAcc { dept: string; variants: Map<string, number>; total: number }

const hasSub = (category: string) => category.includes(' - ');
const subOf = (category: string) => category.split(' - ').slice(1).map(p => p.trim()).filter(Boolean).join(' - ');
const topVariant = (m: Map<string, number>): string => Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0][0];

/** Departamentos e categorias que existem nas compras (`all`), com quanto gastaram no período (`period`).
    Mais gasto primeiro. Departamento que também tem compras sem subcategoria ganha a opção "Sem subcategoria". */
export const buildDeptOptions = (all: Receipt[], period: Receipt[], layers: LayerIndex = getActiveLayers()): DeptOption[] => {
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
    out.push({ key, kind: 'dept', label, full: label, dept: key, total: d.total, level: 1, parent: null });
  });
  cats.forEach((c, key) => {
    const deptLabel = properCase(topVariant(depts.get(c.dept)!.variants)) || NO_CATEGORY_LABEL;
    if (key.startsWith('own:')) {
      // só aparece como linha própria quando o departamento tem subcategorias
      if ((subCount.get(c.dept) || 0) === 0) return;
      out.push({ key: `c:${c.dept}`, kind: 'cat', label: NO_SUBCATEGORY_LABEL, full: `${deptLabel} - ${NO_SUBCATEGORY_LABEL}`, dept: c.dept, total: c.total, level: 2, parent: c.dept });
      return;
    }
    const sub = properCase(topVariant(c.variants).split(' - ').slice(1).join(' - '));
    out.push({ key, kind: 'cat', label: sub, full: `${deptLabel} - ${sub}`, dept: c.dept, total: c.total, level: 2, parent: c.dept });
  });

  // camadas 3 e 4 (grupo, item e "outros itens"), só das categorias que aparecem nas compras
  const catByKey = new Map<string, DeptOption>();
  out.forEach(o => { if (o.kind === 'cat') catByKey.set(o.key, o); });
  buildLayerOpts(all, period, layers).forEach(l => {
    const cat = catByKey.get(`c:${l.catKey}`);
    if (!cat) return;
    const full = l.kind === 'item' || (l.kind === 'rest' && l.level === 4) ? `${cat.full} - ${l.groupLabel} - ${l.label}` : `${cat.full} - ${l.label}`;
    out.push({ key: l.key, kind: l.kind, label: l.label, full, dept: cat.dept, total: l.total, level: l.level, parent: l.parent });
  });
  return out.sort((a, b) => b.total - a.total || a.full.localeCompare(b.full, 'pt-BR'));
};

/** Nome da opção a partir da chave (se ela não existe mais nas compras, deixa a chave com iniciais maiúsculas). */
export const deptLabelFor = (options: DeptOption[], key: string): string => {
  const o = options.find(x => x.key === key);
  if (o) return o.label;
  const raw = isLayerKey(key) ? key.slice(2).split('|').pop() || '' : key.startsWith('c:') ? key.slice(2).split(' - ').pop() || '' : key;
  return properCase(raw) || NO_CATEGORY_LABEL;
};

/** Nome completo ("Hortifruti - Frutas") para textos longos. */
export const deptFullFor = (options: DeptOption[], key: string): string => {
  const o = options.find(x => x.key === key);
  if (o) return o.full;
  if (isLayerKey(key)) return key.slice(2).split('|').map(p => properCase(p)).join(' - ');
  return key.startsWith('c:') ? key.slice(2).split(' - ').map(p => properCase(p)).join(' - ') : (properCase(key) || NO_CATEGORY_LABEL);
};

/* ───────────────────────── escolher dentro da lista ─────────────────────────
   Por baixo, toda escolha é "quais folhas entram". Folha = o ponto mais fundo da árvore: um item, um grupo sem itens, os
   "outros itens", uma categoria sem nada abaixo ('c:...'); departamento sem subcategorias tem uma folha só ('c:<departamento>').
   A chave volta compacta: se todas as folhas de um ramo estão do mesmo lado, grava só o ramo (que vale também para o que
   aparecer de novo nele). */

export interface DeptIndex {
  depts: DeptOption[];
  catsOf: Map<string, DeptOption[]>;     // departamento -> suas categorias (maior gasto primeiro)
  kidsOf: Map<string, DeptOption[]>;     // qualquer chave -> quem está logo abaixo (maior gasto primeiro)
  leavesOf: Map<string, string[]>;       // chave -> chaves das folhas dela
  allLeaves: string[];
  byKey: Map<string, DeptOption>;
  chainOf: Map<string, string[]>;        // folha -> ela mesma e tudo que está acima dela
}

const parentKeyOf = (o: DeptOption): string | null =>
  o.kind === 'dept' ? null : o.kind === 'cat' ? o.dept : (o.parent ?? o.dept);

export const indexOptions = (options: DeptOption[]): DeptIndex => {
  const depts = options.filter(o => o.kind === 'dept');
  const byKey = new Map<string, DeptOption>();
  options.forEach(o => byKey.set(o.key, o));
  const kidsOf = new Map<string, DeptOption[]>();
  const catsOf = new Map<string, DeptOption[]>();
  options.forEach(o => {
    const p = parentKeyOf(o);
    if (p === null) return;
    const arr = kidsOf.get(p);
    if (arr) arr.push(o); else kidsOf.set(p, [o]);
    if (o.kind === 'cat') { const c = catsOf.get(o.dept); if (c) c.push(o); else catsOf.set(o.dept, [o]); }
  });
  const leavesOf = new Map<string, string[]>();
  const leaves = (key: string, isDept: boolean): string[] => {
    const hit = leavesOf.get(key);
    if (hit) return hit;
    const kids = kidsOf.get(key);
    const res = kids && kids.length ? kids.flatMap(k => leaves(k.key, false)) : [isDept ? `c:${key}` : key];
    leavesOf.set(key, res);
    return res;
  };
  const allLeaves: string[] = [];
  depts.forEach(d => allLeaves.push(...leaves(d.key, true)));
  options.forEach(o => leaves(o.key, o.kind === 'dept'));
  const chainOf = new Map<string, string[]>();
  allLeaves.forEach(l => {
    const chain = [l];
    let cur = byKey.get(l);
    // a folha "virtual" de um departamento sem subcategorias ('c:<dept>') não é uma opção: sobe direto para o departamento
    let up: string | null = cur ? parentKeyOf(cur) : l.slice(2);
    while (up) {
      chain.push(up);
      cur = byKey.get(up);
      up = cur ? parentKeyOf(cur) : null;
    }
    chainOf.set(l, chain);
  });
  return { depts, catsOf, kidsOf, leavesOf, allLeaves, byKey, chainOf };
};

/** Folhas que entram na análise com este filtro. */
export const includedLeaves = (f: DeptFilter, idx: DeptIndex): Set<string> => {
  const set = new Set(f.keys);
  const out = new Set<string>();
  idx.allLeaves.forEach(l => {
    const chain = idx.chainOf.get(l) || [l];
    const hit = chain.some(k => set.has(k));
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
export const optionState = (idx: DeptIndex, inc: Set<string>, o: DeptOption): SelState => stateOf(idx.leavesOf.get(o.key) || [o.key], inc);

// Volta de "quais folhas entram" para um filtro compacto, no mesmo modo de antes.
const fromIncluded = (inc: Set<string>, idx: DeptIndex, mode: DeptMode, prev: DeptFilter): DeptFilter => {
  if (idx.allLeaves.every(l => inc.has(l))) return NO_DEPT_FILTER;
  const side = (l: string) => (mode === 'only') === inc.has(l);   // folhas que a lista precisa citar
  const keys: string[] = [];
  const emit = (o: DeptOption) => {
    const leaves = idx.leavesOf.get(o.key) || [o.key];
    const cited = leaves.filter(side);
    if (cited.length === 0) return;
    if (cited.length === leaves.length) { keys.push(o.key); return; }
    (idx.kidsOf.get(o.key) || []).forEach(emit);
  };
  idx.depts.forEach(emit);
  // chaves que já não existem nas compras: continuam como estavam
  const virtual = new Set(idx.allLeaves);
  prev.keys.forEach(k => {
    const known = idx.byKey.has(k) || virtual.has(k);
    if (!known && !keys.includes(k)) keys.push(k);
  });
  return keys.length ? { mode, keys } : NO_DEPT_FILTER;
};

/** Marca ou desmarca um ramo inteiro (departamento, categoria, grupo ou item). Sempre sobra algo dentro. */
export const toggleNodeSel = (f: DeptFilter, idx: DeptIndex, key: string): DeptFilter => {
  const inc = includedLeaves(f, idx);
  const leaves = idx.leavesOf.get(key) || [];
  if (leaves.length === 0) return f;
  if (leaves.every(l => inc.has(l))) {
    leaves.forEach(l => inc.delete(l));
    if (inc.size === 0) return f;
  } else {
    leaves.forEach(l => inc.add(l));
  }
  return fromIncluded(inc, idx, f.mode, f);
};
export const toggleDeptSel = toggleNodeSel;
export const toggleLeafSel = toggleNodeSel;

const leavesOfOption = (idx: DeptIndex, o: DeptOption): string[] => idx.leavesOf.get(o.key) || [o.key];

/** Só estes (departamentos, categorias, grupos e/ou itens) entram. */
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

/** Troca o lado de vários de uma vez: o que entrava sai e o que estava fora entra. Sempre sobra algo dentro. */
export const invertManySel = (f: DeptFilter, idx: DeptIndex, options: DeptOption[]): DeptFilter => {
  const inc = includedLeaves(f, idx);
  const leaves = new Set<string>();
  options.forEach(o => leavesOfOption(idx, o).forEach(l => leaves.add(l)));
  leaves.forEach(l => { if (inc.has(l)) inc.delete(l); else inc.add(l); });
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
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key === storageKey) setFilter(loadDeptFilter(storageKey)); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);
  return [filter, update];
};
