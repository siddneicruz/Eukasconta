import { Receipt } from '../types';
import { fold } from './itemSearch';

/* Regras simples de categoria para o que a IA costuma errar.
   Hoje: carnes trabalhadas (linguiça, bacon, toucinho). Não são corte de carne: entram na categoria de linguiças e embutidos
   em vez de "Carne Suína"/"Carne Bovina"/"Aves". A categoria de destino é procurada na lista de categorias da própria pessoa,
   então funciona com a estrutura dela; se a lista não tiver uma categoria assim, a regra não faz nada. */

export interface CategoryRule {
  id: string;
  title: string;                          // nome da seção na revisão
  short: string;                          // como aparece numa frase ("linguiça")
  note: string;                           // por que
  pattern: RegExp;                        // sobre a descrição sem acento e em minúsculas
  exclude?: RegExp;                       // o mesmo, para tirar falsos positivos
  pickTarget: (categories: string[]) => string | null;
}

// categoria de embutidos frescos (linguiças, hambúrgueres…) dentro das categorias da pessoa
const embutidos = (categories: string[]): string | null =>
  categories.find(c => fold(c).includes('linguica') && fold(c).includes('embutido'))
  || categories.find(c => fold(c).includes('linguica'))
  || null;

export const CATEGORY_RULES: CategoryRule[] = [
  {
    id: 'linguica',
    title: 'Linguiças',
    short: 'linguiça',
    note: 'Carne trabalhada, não é corte de porco ou boi.',
    pattern: /\blinguic/,
    exclude: /vegetal|vegan|soja|plant/,
    pickTarget: embutidos,
  },
  {
    id: 'bacon',
    title: 'Bacon e toucinho',
    short: 'bacon',
    note: 'É suíno, mas é carne trabalhada (curada e defumada).',
    pattern: /\b(bacon|baco[mn]|toucinho)\b/,
    exclude: /sabor|batata|salgadinho|snack|pizza|\bpao\b|maionese|hamburg|burger|queijo|molho|biscoito|pastel|ovo|tempero/,
    pickTarget: embutidos,
  },
];

// Só mexe em itens que estão numa categoria de carne in natura (ou sem categoria): o que a pessoa
// já pôs em linguiças, frios ou qualquer outro lugar fica como está.
const isFreshMeatCategory = (category: string | undefined | null): boolean => {
  const f = fold(category);
  if (!f || f === 'outros') return true;
  if (f.includes('linguica') || f.includes('embutido') || f.includes('frios')) return false;
  return /acougue|carne|aves|suina|bovina|churrasco|frango/.test(f);
};

export const matchRule = (description: string): CategoryRule | null => {
  const d = fold(description);
  if (!d) return null;
  return CATEGORY_RULES.find(r => r.pattern.test(d) && !(r.exclude && r.exclude.test(d))) || null;
};

/* Categoria certa para um item que a IA acabou de ler, ou null para deixar como está. */
export const ruleCategoryFor = (description: string, currentCategory: string, categories: string[]): string | null => {
  const rule = matchRule(description);
  if (!rule || !isFreshMeatCategory(currentCategory)) return null;
  const target = rule.pickTarget(categories);
  return target && target !== currentCategory ? target : null;
};

/* ───────────────────────── revisão do que já foi comprado ───────────────────────── */

export interface FixItem {
  desc: string;       // nome no cupom (MAIÚSCULAS)
  count: number;      // linhas de compra fora do lugar
  total: number;      // R$
  from: string[];     // onde estão hoje
}

export interface FixSection {
  ruleId: string;
  title: string;
  short: string;
  note: string;
  target: string;     // categoria sugerida
  items: FixItem[];
  count: number;
  total: number;
}

export const suggestCategoryFixes = (receipts: Receipt[], categories: string[]): FixSection[] => {
  const sections = new Map<string, { rule: CategoryRule; target: string; items: Map<string, { count: number; total: number; from: Set<string> }> }>();

  receipts.forEach(r => (r.items || []).forEach(item => {
    const desc = (item.description || '').trim().toUpperCase();
    if (!desc) return;
    const rule = matchRule(desc);
    if (!rule) return;
    const current = item.category || '';
    if (!isFreshMeatCategory(current)) return;
    const target = rule.pickTarget(categories);
    if (!target || target === current) return;

    let s = sections.get(rule.id);
    if (!s) { s = { rule, target, items: new Map() }; sections.set(rule.id, s); }
    let it = s.items.get(desc);
    if (!it) { it = { count: 0, total: 0, from: new Set() }; s.items.set(desc, it); }
    it.count += 1;
    it.total += Number(item.totalPrice) || 0;
    it.from.add(current || 'Outros');
  }));

  return CATEGORY_RULES
    .map(rule => sections.get(rule.id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map(s => {
      const items: FixItem[] = Array.from(s.items.entries())
        .map(([desc, v]) => ({ desc, count: v.count, total: v.total, from: Array.from(v.from) }))
        .sort((a, b) => b.count - a.count || a.desc.localeCompare(b.desc, 'pt-BR'));
      return {
        ruleId: s.rule.id,
        title: s.rule.title,
        short: s.rule.short,
        note: s.rule.note,
        target: s.target,
        items,
        count: items.reduce((n, i) => n + i.count, 0),
        total: items.reduce((n, i) => n + i.total, 0),
      };
    });
};
