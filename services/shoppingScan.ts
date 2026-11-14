import { MasterProduct, Receipt } from '../types';
import { History, Product, makeKeyer } from './shoppingList';
import { MasterData } from './masterService';

/* Ler o código de barras de um produto durante a compra: acha o produto (tabela mãe, cupons com EAN, ou o nome que
   a pessoa já deu a esse código) e traz o último preço pago. Sem preço no histórico, a pessoa informa. */

const LEARN_KEY = 'eukasconta_shop_codes';
type Learned = Record<string, string>;
const loadLearned = (): Learned => { try { return JSON.parse(localStorage.getItem(LEARN_KEY) || '{}') || {}; } catch { return {}; } };
export const learnCode = (code: string, name: string) => {
  try { const m = loadLearned(); m[code] = name.trim(); localStorage.setItem(LEARN_KEY, JSON.stringify(m)); } catch { /* sem armazenamento */ }
};

export interface ScanHit {
  code: string;
  pid: string;
  name: string;
  unit: string;
  dept: string;
  category: string;
  /** último preço pago (0 = nunca comprou: a pessoa informa) */
  price: number;
  priceDate: string;
  store: string;
  source: 'historico' | 'tabela' | 'aprendido';
  /** marca e embalagem/peso (da tabela mãe e do nome) para ajudar a escolher entre produtos parecidos */
  brand?: string;
  size?: string;
  avg?: number;
  avgN?: number;
}

export const infoOf = (h: Pick<ScanHit, 'brand' | 'size' | 'unit'>): string => [h.brand, h.size, h.unit && h.unit !== 'UN' ? h.unit : ''].filter(Boolean).join(' · ');

const SIZE_RE = /(\d+(?:[.,]\d+)?)\s?(kg|g|gr|ml|l|lt|un|und)\b/i;
export const sizeOfName = (name: string): string => { const m = SIZE_RE.exec(name || ''); return m ? m[0].replace(/\s+/g, ' ') : ''; };

/** O que o catálogo de EAN diz sobre o código lido (nome, marca, peso/embalagem). */
export interface EanInfo { description: string; brand: string; size: string; taxDept?: string; taxSub?: string }
export const fetchEanInfo = async (code: string): Promise<EanInfo | null> => {
  try {
    const c = stripKey(code);
    const { data } = await supabase.from('ean_catalog').select('description,brand,size_text,size_value,size_unit,tax_dept,tax_sub').in('ean', [c, c.padStart(13, '0')]).limit(1).maybeSingle();
    if (!data) return null;
    const size = data.size_text || (data.size_value ? `${data.size_value} ${data.size_unit || ''}`.trim() : '') || sizeOfName(data.description || '');
    return { description: data.description || '', brand: data.brand || '', size, taxDept: data.tax_dept || '', taxSub: data.tax_sub || '' };
  } catch { return null; }
};

const stripKey = (c: string) => String(c || '').replace(/\D/g, '');
const same = (a: string, b: string) => { const x = stripKey(a), y = stripKey(b); return !!x && !!y && (x === y || x.replace(/^0+/, '') === y.replace(/^0+/, '')); };

const normTok = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 3 && !['com', 'cob', 'cobertura', 'sem', 'para', 'tipo'].includes(w));

/** Item sem categoria (veio do catálogo de EAN): herda o departamento do produto mais parecido que você já comprou
 *  (precisa dividir pelo menos 2 palavras do nome, ex.: "pão de mel Bauducco" ↔ "PAO MEL BAUDUCCO 180G"). */
const inheritDept = (name: string, prods: Iterable<Product>): { dept: string; category: string } | null => {
  const a = new Set(normTok(name));
  if (a.size < 2) return null;
  let best: { dept: string; category: string } | null = null, bestScore = 0;
  for (const p of prods) {
    if (!p.dept || p.dept === 'Outros') continue;
    const b = new Set(normTok(p.name));
    let shared = 0; a.forEach(w => { if (b.has(w)) shared++; });
    if (shared < 2) continue;
    const score = shared / (a.size + b.size - shared);
    if (score > bestScore) { bestScore = score; best = { dept: p.dept, category: p.category }; }
  }
  return bestScore >= 0.3 ? best : null;
};

export const resolveBarcode = (code: string, ctx: { masters: MasterProduct[]; master: MasterData | null; receipts: Receipt[]; history: History }): ScanHit[] => {
  const out: ScanHit[] = [];
  const keyer = makeKeyer(ctx.masters);
  const prods = new Map<string, Product>();
  ctx.history.longProducts.forEach(p => prods.set(p.pid, p));
  ctx.history.products.forEach(p => { if (!prods.has(p.pid)) prods.set(p.pid, p); });
  const fromProduct = (p: Product, source: ScanHit['source']): ScanHit => ({ size: sizeOfName(p.name), code, pid: p.pid, name: p.name, unit: p.unit, dept: p.dept, category: p.category, price: p.price, avg: p.avg, avgN: p.avgN, priceDate: p.priceDate, store: p.store, source });

  // 0. escolha que a pessoa já fez para este código (vale mais que a tabela)
  const learnedName = loadLearned()[code];
  // 1. produtos da tabela mãe com esse EAN: se for mais de um, a tabela está em dúvida e quem decide é a pessoa
  const cand = new Map<string, { code: string; desc: string; unit: string; category: string }>();
  (ctx.master?.codes || []).forEach(c => { if (c.kind === 'ean' && same(c.code, code)) cand.set(c.master, { code: c.master, desc: c.desc, unit: c.unit || 'UN', category: c.category || '' }); });
  ctx.masters.forEach(m => { if ((m.eans || []).some(e => same(e, code))) cand.set(m.code, { code: m.code, desc: m.description, unit: m.unitType || 'UN', category: m.category || '' }); });
  const list = [...cand.values()];
  const brandOf = new Map<string, string>();
  (ctx.master?.products || []).forEach(x => { if (x.brand) brandOf.set(x.code, x.brand); });
  const toHit = (c: { code: string; desc: string; unit: string; category: string }): ScanHit => {
    const p = prods.get(`M:${c.code}`);
    const extra = { brand: brandOf.get(c.code) || '', size: sizeOfName(p?.name || c.desc) };
    return p ? { ...fromProduct(p, 'tabela'), ...extra } : { ...extra, code, pid: `M:${c.code}`, name: c.desc, unit: c.unit, dept: (c.category || '').split(' - ')[0] || 'Outros', category: c.category, price: 0, priceDate: '', store: '', source: 'tabela' };
  };
  const withDept = (h: ScanHit): ScanHit => {
    if (h.dept && h.dept !== 'Outros') return h;
    const g = inheritDept(h.name, prods.values());
    return g ? { ...h, dept: g.dept, category: h.category || g.category } : h;
  };
  if (!learnedName && list.length > 1) { out.push(...list.map(toHit).map(withDept)); return out; }
  if (!learnedName && list.length === 1) return [withDept(toHit(list[0]))];
  // 2. cupom que trouxe esse código (XML ou cupom impresso)
  for (const r of ctx.receipts) {
    for (const it of r.items || []) {
      if (same(String(it.code || ''), code)) {
        const k = keyer(it.description);
        const p = k ? prods.get(k.pid) : undefined;
        if (p) return [fromProduct(p, 'historico')];
      }
    }
  }
  // 3. nome que a pessoa já deu a esse código
  const nm = learnedName;
  if (nm) {
    const k = keyer(nm);
    const p = k ? prods.get(k.pid) : undefined;
    if (p) return [fromProduct(p, 'aprendido')];
    return [withDept({ code, pid: `U:${nm.toUpperCase()}`, name: nm, unit: 'UN', dept: 'Outros', category: '', price: 0, priceDate: '', store: '', source: 'aprendido' })];
  }
  return [];
};

import { ShoppingList, addManual, setPrice, setQty, toggleCart } from './shoppingList';

/** Põe o produto lido no carrinho da compra: se já estava planejado, só marca; se não, entra na lista já no carrinho. */
export const scanIntoCart = (l: ShoppingList, pi: number, hit: ScanHit, qty: number, price: number): ShoppingList => {
  const p = l.purchases[pi];
  if (!p) return l;
  const cur = p.entries.find(e => e.pid === hit.pid);
  let n = l;
  if (cur) {
    n = cur.cart ? setQty(n, pi, hit.pid, cur.qty + qty) : toggleCart(n, pi, hit.pid, cur.group);
  } else {
    n = addManual(n, pi, { pid: hit.pid, name: hit.name, unit: hit.unit, price, info: infoOf(hit), avg: hit.avg, dept: hit.dept, category: hit.category, qty, priceDate: hit.priceDate, store: hit.store, group: 'manual' });
    n = toggleCart(n, pi, hit.pid, 'manual');
  }
  if (price > 0 && (!cur || Math.abs(cur.price - price) > 0.004)) n = setPrice(n, hit.pid, price);
  return n;
};

import { supabase } from './supabaseClient';
import { NearbyPrice, bestPricesNearby, getCurrentPosition } from './cloudService';

/* Preço de quem está por perto: usa os preços que todos os usuários já registraram (por produto da tabela mãe) e
   escolhe o estabelecimento MAIS PRÓXIMO de onde a pessoa está. */
export interface NearPrices { rows: NearbyPrice[]; nearest: NearbyPrice | null; error?: string }

const masterIdOf = async (hit: ScanHit): Promise<string | null> => {
  try {
    if (hit.pid.startsWith('M:')) {
      const { data } = await supabase.from('master_products').select('id').eq('code', hit.pid.slice(2)).maybeSingle();
      if (data?.id) return String(data.id);
    }
    const { data } = await supabase.from('master_product_codes').select('master_product_id').eq('kind', 'ean').eq('code', hit.code).limit(1).maybeSingle();
    return data?.master_product_id ? String(data.master_product_id) : null;
  } catch { return null; }
};

export const nearbyPrices = async (hit: ScanHit, radiusKm = 25): Promise<NearPrices> => {
  let origin;
  try { origin = await getCurrentPosition(); } catch (e: any) { return { rows: [], nearest: null, error: e?.message || 'Sem localização.' }; }
  const id = await masterIdOf(hit);
  if (!id) return { rows: [], nearest: null };
  try {
    const all = await bestPricesNearby(id, origin, radiusKm, 90);
    const ok = all.filter(r => r.unit_price > 0 && (!r.unit_type || !hit.unit || r.unit_type.toUpperCase() === hit.unit.toUpperCase())).sort((a, b) => a.distance_km - b.distance_km || a.unit_price - b.unit_price);
    return { rows: ok.slice(0, 4), nearest: ok[0] || null };
  } catch { return { rows: [], nearest: null }; }
};
