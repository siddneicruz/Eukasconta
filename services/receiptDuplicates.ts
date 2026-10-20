import { Receipt } from '../types';
import { normStoreKey } from './productCodes';

/* Cupom lido duas vezes. A IA lê a mesma foto de um jeito um pouco diferente a cada vez (loja "LTDA EPP" ou "LTDA-F01",
   CNPJ com um dígito trocado, 1,358 kg ou 1,356 kg), então comparar o nome exato da loja deixava o repetido passar.
   Aqui o mesmo cupom é o que tem a mesma data, o mesmo total, a mesma hora (quando as duas são conhecidas) e a mesma loja
   OU os mesmos itens. Usado ao gravar um cupom lido e na tela "Cupons repetidos". */

const cents = (n: unknown): number => Math.round((Number(n) || 0) * 100);
const plainText = (s: string): string =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Hora do cupom em HH:MM ("18:30:50" e "18:30" são a mesma). 12:00 é a hora "padrão" que o app usa quando o cupom não traz hora: não serve para comparar.
const knownTime = (t?: string): string => {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const hhmm = `${m[1].padStart(2, '0')}:${m[2]}`;
  return hhmm === '12:00' ? '' : hhmm;
};

/** Quanto dos itens dos dois cupons bate (pelo valor de cada item), de 0 a 1. 0 quando um deles não tem itens. */
export const itemOverlap = (a: Receipt, b: Receipt): number => {
  const ia = a.items || [], ib = b.items || [];
  if (!ia.length || !ib.length) return 0;
  const pool = new Map<number, number>();
  ib.forEach(i => { const c = cents(i.totalPrice); pool.set(c, (pool.get(c) || 0) + 1); });
  let hit = 0;
  ia.forEach(i => {
    const c = cents(i.totalPrice);
    const left = pool.get(c) || 0;
    if (left > 0) { hit++; pool.set(c, left - 1); }
  });
  return hit / Math.max(ia.length, ib.length);
};

const digits = (s?: string): string => String(s || '').replace(/\D/g, '');
const hamming = (x: string, y: string): number => { let d = 0; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++; return d; };

type StoreRel = 'same' | 'maybe' | 'other';
const storeRel = (a: Receipt, b: Receipt): StoreRel => {
  const da = digits(a.cnpj), db = digits(b.cnpj);
  if (da.length === 14 && db.length === 14) {
    if (da === db) return 'same';
    if (hamming(da, db) <= 2) return 'maybe';          // dígito lido errado
  }
  const na = plainText(a.establishmentName), nb = plainText(b.establishmentName);
  if (na && nb && na === nb) return 'same';
  const ka = normStoreKey(a.establishmentName), kb = normStoreKey(b.establishmentName);
  if (!ka || !kb) return 'maybe';                       // loja sem nome: não dá para negar
  const wa = na.split(' ').slice(0, 2).join(' '), wb = nb.split(' ').slice(0, 2).join(' ');
  return wa && wa === wb ? 'maybe' : 'other';
};

/** Os dois cupons são a mesma compra? */
export const isSameCupom = (a: Receipt, b: Receipt): boolean => {
  if (a.id && a.id === b.id) return true;
  if (a.date !== b.date) return false;
  const ta = cents(a.totalAmount), tb = cents(b.totalAmount);
  if (ta !== tb || ta <= 0) return false;

  const timeA = knownTime(a.time), timeB = knownTime(b.time);
  if (timeA && timeB && timeA !== timeB) return false;
  const sameTime = !!timeA && timeA === timeB;
  const overlap = itemOverlap(a, b);
  const bothItems = (a.items?.length || 0) > 0 && (b.items?.length || 0) > 0;
  const enoughItems = Math.min(a.items?.length || 0, b.items?.length || 0) >= 2;

  switch (storeRel(a, b)) {
    case 'same':
      // mesma loja, dia e total: é o mesmo cupom, a não ser que a hora seja desconhecida e os itens não tenham nada em comum
      return sameTime || !bothItems || overlap >= 0.3;
    case 'maybe':
      return (sameTime && overlap >= 0.5 && enoughItems) || (overlap >= 0.8 && enoughItems);
    default:
      return sameTime && overlap >= 0.8 && enoughItems;
  }
};

/* ───────────────────────────── grupos de repetidos ───────────────────────────── */

/** Itens em que quantidade × preço bate com o total (a leitura errada costuma errar a quantidade e deixar o total certo). */
export const consistentItems = (r: Receipt): number =>
  (r.items || []).filter(i => Math.abs((Number(i.quantity) || 0) * (Number(i.unitPrice) || 0) - (Number(i.totalPrice) || 0)) <= 0.021).length;

const rank = (r: Receipt): number => consistentItems(r) * 1000 + (r.items?.length || 0) * 10;

export interface DuplicateGroup {
  /** assinatura estável do grupo (ids ordenados): serve para lembrar "manter os dois" */
  key: string;
  keep: Receipt;
  remove: { receipt: Receipt; reason: string }[];
}

const reasonFor = (keep: Receipt, r: Receipt): string => {
  const ni = r.items?.length || 0;
  if (ni === 0) return 'sem itens';
  const ck = consistentItems(keep), cr = consistentItems(r);
  if (cr < ck) return `${ni - cr} ${ni - cr === 1 ? 'item com a conta errada' : 'itens com a conta errada'}`;
  if (ni < (keep.items?.length || 0)) return 'menos itens';
  return 'lido depois';
};

export const findDuplicateGroups = (receipts: Receipt[]): DuplicateGroup[] => {
  // só compara cupons do mesmo dia com o mesmo total
  const byDate = new Map<string, Receipt[]>();
  receipts.forEach(r => {
    if (cents(r.totalAmount) <= 0) return;
    const l = byDate.get(r.date);
    if (l) l.push(r); else byDate.set(r.date, [r]);
  });

  const out: DuplicateGroup[] = [];
  byDate.forEach(day => {
    if (day.length < 2) return;
    const list = [...day].sort((x, y) => cents(x.totalAmount) - cents(y.totalAmount));
    // une quem é o mesmo cupom (transitivo)
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && cents(list[j].totalAmount) === cents(list[i].totalAmount); j++) {
        if (isSameCupom(list[i], list[j])) parent[find(i)] = find(j);
      }
    }
    const groups = new Map<number, Receipt[]>();
    list.forEach((r, i) => { const g = find(i); const l = groups.get(g); if (l) l.push(r); else groups.set(g, [r]); });
    groups.forEach(members => {
      if (members.length < 2) return;
      const sorted = [...members].sort((x, y) => rank(y) - rank(x) || String(x.scannedAt || '').localeCompare(String(y.scannedAt || '')) || x.id.localeCompare(y.id));
      const keep = sorted[0];
      out.push({ key: members.map(m => m.id).sort().join('+'), keep, remove: sorted.slice(1).map(receipt => ({ receipt, reason: reasonFor(keep, receipt) })) });
    });
  });
  return out.sort((a, b) => b.keep.date.localeCompare(a.keep.date) || a.key.localeCompare(b.key));
};

/** Quantos cupons sobrariam a mais (soma do que seria removido). */
export const duplicateRemovalCount = (groups: DuplicateGroup[]): number => groups.reduce((s, g) => s + g.remove.length, 0);

/* "Manter os dois": o grupo escolhido não aparece mais na revisão (guardado no aparelho e no backup da conta). */
export const DUP_IGNORED_KEY = 'eukasconta_cupom_dup_ignored';

export const loadIgnoredGroups = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(DUP_IGNORED_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
};

export const saveIgnoredGroups = (keys: string[]): void => {
  try { localStorage.setItem(DUP_IGNORED_KEY, JSON.stringify(Array.from(new Set(keys)))); } catch { /* sem espaço: o grupo volta a aparecer */ }
};
