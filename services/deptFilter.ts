import { useCallback, useEffect, useState } from 'react';
import { Receipt } from '../types';
import { deptKey, properCase } from './textFormat';
import { buildCompareOptions } from './categoryCompare';

/* Filtro de categorias (departamentos) que fica gravado no aparelho.
   Dois modos com a mesma lista de departamentos:
   - 'exclude': analisa tudo, MENOS os da lista ("tirei Transporte");
   - 'only':    analisa SÓ os da lista.
   Inverter é só trocar o modo: o que estava de fora vira o único dentro, e de novo para voltar. */

export type DeptMode = 'exclude' | 'only';
export interface DeptFilter { mode: DeptMode; keys: string[] }

export const NO_DEPT_FILTER: DeptFilter = { mode: 'exclude', keys: [] };
export const DEPT_FILTER_KEY = 'eukasconta_dept_filter';

export const isDeptFilterActive = (f: DeptFilter): boolean => f.keys.length > 0;

/** O departamento (chave sem caixa nem acento) entra na análise? */
export const deptIncluded = (f: DeptFilter, key: string): boolean =>
  f.mode === 'only' ? f.keys.includes(key) : !f.keys.includes(key);

/** Aceita qualquer coisa vinda do armazenamento e devolve um filtro válido. */
export const normalizeDeptFilter = (raw: unknown): DeptFilter => {
  const r = raw as { mode?: unknown; keys?: unknown } | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.keys)) return NO_DEPT_FILTER;
  const keys = Array.from(new Set(r.keys.filter((k): k is string => typeof k === 'string')));
  if (keys.length === 0) return NO_DEPT_FILTER;
  return { mode: r.mode === 'only' ? 'only' : 'exclude', keys };
};

// Se tudo o que existe está dentro, não há filtro nenhum.
const tidy = (f: DeptFilter, allKeys: string[]): DeptFilter => {
  if (f.keys.length === 0) return NO_DEPT_FILTER;
  if (f.mode === 'only' && allKeys.length > 0 && allKeys.every(k => f.keys.includes(k))) return NO_DEPT_FILTER;
  return f;
};

/** Marca ou desmarca um departamento. Sempre sobra pelo menos um dentro da análise. */
export const toggleDept = (f: DeptFilter, key: string, allKeys: string[]): DeptFilter => {
  const has = f.keys.includes(key);
  if (f.mode === 'exclude') {
    if (has) return tidy({ mode: 'exclude', keys: f.keys.filter(k => k !== key) }, allKeys);
    const left = allKeys.filter(k => k !== key && !f.keys.includes(k));
    if (left.length === 0) return f;
    return { mode: 'exclude', keys: [...f.keys, key] };
  }
  if (has) {
    if (f.keys.length === 1) return f;
    return { mode: 'only', keys: f.keys.filter(k => k !== key) };
  }
  return tidy({ mode: 'only', keys: [...f.keys, key] }, allKeys);
};

export const onlyDept = (key: string): DeptFilter => ({ mode: 'only', keys: [key] });

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

/** Cupons só com as linhas dos departamentos que entram. Cupom sem nenhuma linha some;
    cupom que perdeu linhas passa a valer a soma das que sobraram; cupom intacto não muda. */
export const applyDeptFilter = (receipts: Receipt[], f: DeptFilter): Receipt[] => {
  if (!isDeptFilterActive(f)) return receipts;
  const out: Receipt[] = [];
  receipts.forEach(r => {
    const items = r.items || [];
    const kept = items.filter(i => deptIncluded(f, deptKey(i.category)));
    if (kept.length === items.length) { out.push(r); return; }
    if (kept.length === 0) return;
    out.push({ ...r, items: kept, totalAmount: kept.reduce((s, i) => s + (Number(i.totalPrice) || 0), 0) });
  });
  return out;
};

/* ───────────── lista para a folha de escolha ───────────── */

export interface DeptOption { key: string; label: string; total: number }

/** Todos os departamentos que existem nas compras (`all`), com quanto gastaram no período (`period`). Mais gasto primeiro. */
export const buildDeptOptions = (all: Receipt[], period: Receipt[]): DeptOption[] =>
  buildCompareOptions(all, period)
    .filter(o => o.kind === 'dept')
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'pt-BR'))
    .map(o => ({ key: o.id.slice(2), label: o.label, total: o.total }));

/** Nome do departamento a partir da chave (se ele não existe mais nas compras, deixa a chave com iniciais maiúsculas). */
export const deptLabelFor = (options: DeptOption[], key: string): string =>
  options.find(o => o.key === key)?.label || properCase(key) || 'Sem categoria';

/* ───────────── gravação no aparelho ───────────── */

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
