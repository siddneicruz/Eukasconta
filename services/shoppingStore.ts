import { ShoppingList, Setup, sanitizeSetup, isIso } from './shoppingList';

/* As listas de compras ficam no aparelho (e entram no backup junto com o resto, porque a chave começa com "eukasconta_"). */

export const SHOPPING_KEY = 'eukasconta_shopping_lists';
export const SHOPPING_SETUP_KEY = 'eukasconta_shopping_setup';

const validList = (l: any): l is ShoppingList =>
  !!l && typeof l === 'object' && typeof l.id === 'string' && Array.isArray(l.purchases) && l.purchases.length > 0
  && l.purchases.every((p: any) => p && isIso(p.date) && Array.isArray(p.entries))
  && l.setup && typeof l.setup === 'object' && Array.isArray(l.cut);

export const loadLists = (): ShoppingList[] => {
  try {
    const raw = localStorage.getItem(SHOPPING_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(validList).map(l => ({ ...l, notes: Array.isArray(l.notes) ? l.notes : [], info: l.info || { from: '', to: '', cycle: 7, trips: 0, source: 'historico' } })) : [];
  } catch { return []; }
};

export const saveLists = (lists: ShoppingList[]): void => {
  try {
    if (lists.length) localStorage.setItem(SHOPPING_KEY, JSON.stringify(lists));
    else localStorage.removeItem(SHOPPING_KEY);
  } catch { /* memória cheia: a tela continua com o que está em memória */ }
};

/** Últimas escolhas do formulário, para a próxima lista já sair com elas. */
export const loadSetup = (today: string, cycle = 7): Setup => {
  try {
    const raw = localStorage.getItem(SHOPPING_SETUP_KEY);
    return sanitizeSetup(raw ? JSON.parse(raw) : null, today, cycle);
  } catch { return sanitizeSetup(null, today, cycle); }
};

export const saveSetup = (s: Setup): void => {
  try { localStorage.setItem(SHOPPING_SETUP_KEY, JSON.stringify(s)); } catch { /* ignora */ }
};
