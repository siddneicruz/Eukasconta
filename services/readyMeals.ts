// Refeição pronta: o que se consome em restaurante, lanchonete, bar ou café não é compra de mercado.
// Esses itens vão para o departamento "Comer Fora e Delivery" e ficam fora do histórico de preços de produto,
// para um prato de R$ 70 não virar "preço da picanha" ao lado do quilo do açougue.
import { Receipt } from '../types';
import { sameDept } from './textFormat';

export const MEAL_DEPT = 'Comer Fora e Delivery';
const cat = (c: string) => `${MEAL_DEPT} - ${c}`;

const plain = (s: string): string => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Tipos de loja em que o que se compra é consumido pronto. */
export const isMealStoreType = (type: string | undefined | null): boolean =>
  /\b(restaurante|lanchonete|pizzaria|churrascaria|hamburgueria|cafeteria|cafe|bar|sorveteria|pastelaria|marmitaria|sushi)\b/.test(plain(type || ''));

export const isMealCategory = (category: string | undefined | null): boolean => !!category && sameDept(category, MEAL_DEPT);

const DESSERT = /\b(sobremesa|sorvete|pudim|mousse|brownie|petit gateau|acai|torta|doce|bolo|milkshake|picole|cheesecake|churros)\b/;
const SNACK = /\b(hamburguer|burger|x-?\w+|lanche|pizza|pastel|hot ?dog|cachorro quente|batata frita|sanduiche|coxinha|salgado|esfiha|empada|porcao|combo|refri|refrigerante|coca|guarana|fanta|sprite|suco)\b/;

/** Categoria que já existe em "Comer Fora e Delivery": sobremesa, lanche, ou almoço/jantar pelo horário do cupom. */
export const mealCategoryFor = (description: string, time?: string): string => {
  const d = plain(description);
  if (DESSERT.test(d)) return cat('Sobremesas e Doces');
  if (SNACK.test(d)) return cat('Lanches e Fast Food');
  const h = parseInt(String(time || '').slice(0, 2), 10);
  return cat(Number.isFinite(h) && h < 16 ? 'Almoço' : 'Jantar');
};

/** Itens do cupom de uma loja de consumo pronto passam para "Comer Fora e Delivery" (o que já está lá fica como está). */
export const applyMealCategories = (r: Receipt, typeOf: (name: string, cnpj?: string) => string): { receipt: Receipt; items: number } => {
  if (!isMealStoreType(typeOf(r.establishmentName, r.cnpj))) return { receipt: r, items: 0 };
  let n = 0;
  const items = (r.items || []).map(i => {
    if (isMealCategory(i.category)) return i;
    n += 1;
    return { ...i, category: mealCategoryFor(i.description, r.time) };
  });
  return n > 0 ? { receipt: { ...r, items }, items: n } : { receipt: r, items: 0 };
};

export interface MealPlan { receipts: number; items: number; stores: { name: string; items: number }[] }

export const planMeals = (receipts: Receipt[], typeOf: (name: string, cnpj?: string) => string, nameOf: (name: string, cnpj?: string) => string): MealPlan => {
  const by = new Map<string, number>();
  let rc = 0, it = 0;
  receipts.forEach(r => {
    const { items } = applyMealCategories(r, typeOf);
    if (items > 0) { rc += 1; it += items; const k = nameOf(r.establishmentName, r.cnpj); by.set(k, (by.get(k) || 0) + items); }
  });
  return { receipts: rc, items: it, stores: [...by.entries()].map(([name, items]) => ({ name, items })).sort((a, b) => b.items - a.items) };
};

export const applyMealsAll = (receipts: Receipt[], typeOf: (name: string, cnpj?: string) => string): Receipt[] =>
  receipts.map(r => applyMealCategories(r, typeOf).receipt);
