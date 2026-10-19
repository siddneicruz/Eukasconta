import { Receipt } from '../types';

/* Durante a edição, os campos de número guardam o texto que a pessoa digita (para poder apagar e digitar de novo).
   Ao salvar, e ao ler os cupons gravados, tudo volta a ser número: um valor unitário "12.5" em texto derrubava a tela do
   cupom (`unitPrice.toFixed is not a function`) e, com ela, o app inteiro. */

const toNumber = (v: string): number => {
  const n = Number(v.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/** Devolve o mesmo cupom quando já está tudo certo; senão, uma cópia com quantidade, valores unitário e total (e o total do cupom) em número. */
export const normalizeReceiptNumbers = (r: Receipt): Receipt => {
  if (!r || typeof r !== 'object') return r;
  let changed = false;
  const items = Array.isArray(r.items)
    ? r.items.map(i => {
        if (!i || typeof i !== 'object') return i;
        const bad = [i.quantity, i.unitPrice, i.totalPrice].some(v => typeof v === 'string');
        if (!bad) return i;
        changed = true;
        return {
          ...i,
          quantity: typeof i.quantity === 'string' ? toNumber(i.quantity) : i.quantity,
          unitPrice: typeof i.unitPrice === 'string' ? toNumber(i.unitPrice) : i.unitPrice,
          totalPrice: typeof i.totalPrice === 'string' ? toNumber(i.totalPrice) : i.totalPrice,
        };
      })
    : r.items;
  const total: unknown = r.totalAmount;
  if (typeof total === 'string') changed = true;
  return changed ? { ...r, items, totalAmount: typeof total === 'string' ? toNumber(total) : r.totalAmount } : r;
};

export const normalizeReceiptList = (list: unknown): Receipt[] => {
  if (!Array.isArray(list)) return [];
  let changed = false;
  const out = list.map((r: Receipt) => { const n = normalizeReceiptNumbers(r); if (n !== r) changed = true; return n; });
  return changed ? out : (list as Receipt[]);
};
