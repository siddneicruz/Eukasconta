import { TaxonomyNode } from '../types';
import { fold } from './itemSearch';
import { properCase } from './textFormat';
import { Remapper, pathNames } from './taxonomyDedupe';

/* Padrão de escrita da Estrutura de Taxonomia: iniciais maiúsculas e o resto minúsculo
   ("LATICÍNIOS E FRIOS" → "Laticínios e Frios", "ÁGUAS E SUCOS" → "Águas e Sucos").
   Só mexe em nome escrito todo em maiúsculas; siglas curtas ("IPA", "BCAA") e nomes já bem escritos ficam como estão.
   A comparação de nomes ignora caixa, então filtros, fixações e metas continuam valendo; o que muda é o texto
   gravado nos itens das compras, nos produtos mestres, na cor/ícone e nas metas, acertado por buildCaseRemapper. */

const KEEP = new Set(['TV', 'USB', 'LED', 'II', 'III', 'IV', 'UHT', 'PET', 'PVC', 'FPS']);

/** O nome no padrão, ou o mesmo nome quando já está bom. */
export const stdName = (name: string): string => {
  const text = String(name ?? '').trim();
  if (!text) return String(name ?? '');
  const letters = text.replace(/[^A-Za-zÀ-ú]/g, '');
  if (!letters || letters !== letters.toUpperCase()) return name;            // já tem minúsculas: não mexe
  const words = text.split(/\s+/);
  if (words.length === 1 && letters.length <= 4) return name;                // sigla curta (IPA, APA, BCAA)
  return properCase(text, KEEP);
};

export interface CaseResult { taxonomy: TaxonomyNode[]; renamed: number; pairs: { from: string; to: string }[] }

export const standardizeTaxonomy = (tax: TaxonomyNode[]): CaseResult => {
  let renamed = 0;
  const pairs: { from: string; to: string }[] = [];
  const out = tax.map(n => {
    const to = stdName(n.name);
    if (to === n.name) return n;
    renamed += 1;
    pairs.push({ from: n.name, to });
    return { ...n, name: to };
  });
  return { taxonomy: renamed > 0 ? out : tax, renamed, pairs };
};

/** De-para dos nomes antigos para os novos (mesmos nós, só a escrita muda). */
export const buildCaseRemapper = (oldTax: TaxonomyNode[], newTax: TaxonomyNode[]): Remapper => {
  const oldById = new Map(oldTax.map(n => [n.id, n] as const));
  const newById = new Map(newTax.map(n => [n.id, n] as const));
  const catExact = new Map<string, string>();
  const catFold = new Map<string, string>();
  const l1Fold = new Map<string, string>();
  const pathFold = new Map<string, string>();
  const changed = new Map<string, string>();
  oldTax.forEach(n => {
    const t = newById.get(n.id);
    if (!t) return;
    const a = pathNames(n, oldById).join(' - '), b = pathNames(t, newById).join(' - ');
    if (a === b) return;
    pathFold.set(fold(a), b);
    if (n.level <= 2) {
      catExact.set(a, b);
      catFold.set(fold(a), b);
      changed.set(a, b);
      if (n.level === 1) l1Fold.set(fold(a), b);
    }
  });
  const category = (cat: string): string => {
    const c = String(cat ?? '');
    const hit = catExact.get(c) ?? catFold.get(fold(c));
    if (hit !== undefined) return hit;
    const i = c.indexOf(' - ');
    if (i > 0) {
      const head = l1Fold.get(fold(c.slice(0, i)));
      if (head !== undefined) return `${head}${c.slice(i)}`;
    }
    return c;
  };
  return { category, key: (k: string) => k, path: (full: string) => pathFold.get(fold(full)) ?? null, node: (id: string) => id, changed };
};
