// Nomes de loja e de produto vêm do cupom em CAIXA ALTA ("COMPRETUDO SUPERMERCADO LTDA-F01").
// Em lista, caixa alta ocupa muito mais largura e cansa a leitura; aqui viram "Compretudo Supermercado Ltda-F01".

const KEEP_UPPER = new Set(['LTDA', 'S/A', 'SA', 'ME', 'EPP', 'EIRELI', 'CIA', 'KG', 'ML', 'UN', 'G', 'L', 'MG', 'II', 'III', 'IV', 'ST', 'PET', 'TV', 'PC', 'USB', 'LED', 'RJ', 'SP', 'SC', 'PR', 'RS', 'MG', 'BA', 'GO', 'DF']);
const SMALL_WORDS = new Set(['E', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'COM', 'EM', 'PARA', 'POR', 'NA', 'NO']);
const UNIT_TOKEN = /^\d+([.,]\d+)?(kg|g|mg|ml|l|un|und|m|cm|mm|pct|cx)$/i;

const fixWord = (w: string, keep: Set<string> = KEEP_UPPER): string => {
  if (!w) return w;
  const up = w.toUpperCase();
  if (keep.has(up) || UNIT_TOKEN.test(w)) return up;
  const lower = w.toLowerCase();
  // primeira letra de cada pedaço separado por hífen, barra ou ponto ("LTDA-F01" -> "Ltda-F01")
  return lower.replace(/(^|[-/.])([a-zà-ú])/g, (_m, sep, ch) => sep + ch.toUpperCase());
};

// Iniciais maiúsculas e o resto minúsculo, qualquer que seja a caixa de entrada
// ("LATICÍNIOS E FRIOS", "laticínios e frios" e "Laticínios E Frios" -> "Laticínios e Frios").
// Para nomes de departamento/categoria, onde não existe sigla de embalagem (PET, KG...).
const DEPT_KEEP = new Set(['TV', 'USB', 'LED', 'II', 'III', 'IV']);
export const properCase = (s: string | undefined | null, keep: Set<string> = DEPT_KEEP): string => {
  const text = (s ?? '').trim();
  if (!text) return '';
  return text.split(/\s+/).map((w, i) => (i > 0 && SMALL_WORDS.has(w.toUpperCase()) ? w.toLowerCase() : fixWord(w, keep))).join(' ');
};

// Só mexe em texto todo em maiúsculas; se a pessoa já escreveu "Mercado do Zé", mantém como está.
export const titleCase = (s: string | undefined | null): string => {
  const text = (s ?? '').trim();
  if (!text) return '';
  const letters = text.replace(/[^A-Za-zÀ-ú]/g, '');
  if (letters && letters !== letters.toUpperCase()) return text;
  return properCase(text, KEEP_UPPER);
};

/* ───────────────────────── rótulos curtos que não se repetem ───────────────────────── */

const plain = (s: string): string =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Departamento = o que vem antes de " - " na categoria ("Hortifruti - Frutas" -> "Hortifruti").
// A chave ignora caixa e acento, então "HORTIFRUTI", "Hortifruti" e "hortifruti" são o mesmo departamento.
export const masterOf = (category?: string | null): string => String(category ?? '').split(' - ')[0].trim();
export const deptKey = (category?: string | null): string => plain(masterOf(category));
export const sameDept = (category: string | null | undefined, name: string | null | undefined): boolean => deptKey(category) === deptKey(name);
// Categoria inteira ("Hortifruti - Frutas"), comparável sem caixa nem acento.
export const catKey = (category?: string | null): string => plain(String(category ?? '').split(' - ').map(p => p.trim()).join(' - '));

// Nome que o app grava (ou que a leitura devolve) quando o cupom não trouxe a loja.
const UNIDENTIFIED = new Set([
  '', 'estabelecimento', 'estabelecimento desconhecido', 'desconhecido', 'nao identificado', 'nao informado',
  'sem identificacao', 'sem nome', 'nd', 'n d',
]);
export const UNIDENTIFIED_LABEL = 'Sem identificação';
export const isUnidentifiedName = (name?: string | null): boolean => UNIDENTIFIED.has(plain(String(name ?? '')));

// Rótulo curto = primeira palavra. Se dois nomes diferentes dão o mesmo rótulo
// ("Carne Bovina" e "Carne Suína" -> "Carne"), só esses ganham mais uma palavra por vez
// até se distinguirem. Nomes iguais continuam com o mesmo rótulo.
export const shortLabels = (names: string[]): string[] => {
  const words = names.map(n => String(n ?? '').trim().split(/\s+/).filter(Boolean));
  const take = words.map(() => 1);
  const labelOf = (i: number) => words[i].slice(0, take[i]).join(' ') || String(names[i] ?? '');
  for (let guard = 0; guard < 12; guard++) {
    const groups = new Map<string, number[]>();
    names.forEach((_, i) => {
      const k = plain(labelOf(i));
      const g = groups.get(k);
      if (g) g.push(i); else groups.set(k, [i]);
    });
    let changed = false;
    groups.forEach(idx => {
      const distinct = new Set(idx.map(i => plain(String(names[i]))));
      if (distinct.size < 2) return;
      idx.forEach(i => { if (take[i] < words[i].length) { take[i] += 1; changed = true; } });
    });
    if (!changed) break;
  }
  return names.map((_, i) => labelOf(i));
};
