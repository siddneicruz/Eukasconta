import { supabase, isSupabaseConfigured } from './supabaseClient';
import { titleCase } from './textFormat';

/* Ficha do produto a partir do código de barras (EAN).
   Ordem: tabela product_info (catálogos dos fabricantes) → Open Food Facts (e guarda a resposta para os próximos). */

export interface ProductInfo {
  ean: string;
  name: string;
  brand?: string;
  category?: string;
  quantity?: number;
  unit?: string;
  ncm?: string;
  unitsPerBox?: number;
  imageUrl?: string;
  source: string;
}

const cache = new Map<string, ProductInfo | null>();

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : (v as number);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** "500 g", "1 l", "350ml" → { quantity, unit } */
export function parseQuantity(text?: string): { quantity?: number; unit?: string } {
  const m = (text || '').toLowerCase().replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(kg|g|gr|mg|ml|l|lt|un)\b/);
  if (!m) return {};
  let q = parseFloat(m[1]); let u = m[2];
  if (u === 'kg') { q *= 1000; u = 'g'; } else if (u === 'l' || u === 'lt') { q *= 1000; u = 'ml'; } else if (u === 'gr') u = 'g';
  return { quantity: q, unit: u };
}

export function formatQuantity(q?: number, u?: string): string {
  if (!q) return '';
  if (u === 'g' && q >= 1000) return `${q / 1000} kg`;
  if (u === 'ml' && q >= 1000) return `${q / 1000} L`;
  return `${q} ${u || ''}`.trim();
}

async function fromTable(ean: string): Promise<ProductInfo | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data } = await supabase.from('product_info').select('*').eq('ean', ean).maybeSingle();
    if (!data) return null;
    return {
      ean, name: data.name || '', brand: data.brand || undefined, category: data.category || undefined,
      quantity: num(data.quantity), unit: data.unit || undefined, ncm: data.ncm || undefined,
      unitsPerBox: data.units_per_box || undefined, imageUrl: data.image_url || undefined, source: data.source || 'Catálogo',
    };
  } catch { return null; }
}

async function fromOpenFoodFacts(ean: string): Promise<ProductInfo | null> {
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,product_name_pt,brands,categories,quantity,image_front_small_url`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    const p = j.product;
    const name = (p.product_name_pt || p.product_name || '').trim();
    if (!name) return null;
    const q = parseQuantity(p.quantity);
    const cats = String(p.categories || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    return {
      ean, name: titleCase(name), brand: p.brands ? titleCase(String(p.brands).split(',')[0].trim()) : undefined,
      category: cats.length ? cats[cats.length - 1] : undefined, quantity: q.quantity, unit: q.unit,
      imageUrl: p.image_front_small_url || undefined, source: 'Open Food Facts',
    };
  } catch { return null; }
}

async function remember(info: ProductInfo) {
  if (!isSupabaseConfigured()) return;
  try {
    await supabase.from('product_info').insert({
      ean: info.ean, name: info.name, brand: info.brand ?? null, category: info.category ?? null,
      quantity: info.quantity ?? null, unit: info.unit ?? null, image_url: info.imageUrl ?? null, source: 'Open Food Facts',
    });
  } catch { /* guardar é opcional */ }
}

export async function lookupProductInfo(ean: string): Promise<ProductInfo | null> {
  const code = ean.replace(/\D/g, '');
  if (cache.has(code)) return cache.get(code)!;
  let info = await fromTable(code);
  if (!info) {
    info = await fromOpenFoodFacts(code);
    if (info) void remember(info);
  }
  cache.set(code, info);
  return info;
}
