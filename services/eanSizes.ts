import { supabase } from './supabaseClient';

/* Tamanho do produto (peso, volume, unidades) para distinguir o mesmo item em embalagens diferentes
   (ex.: Coca Zero 1,5 L e 2 L, presunto 180 g e 300 g). Fonte: catálogo de EAN; sem ele, lê da descrição. */

const fmtNum = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

export const fmtSize = (value: number, unitRaw: string): string => {
  const u = unitRaw.toLowerCase();
  if (u === 'ml' && value >= 1000) return `${fmtNum(value / 1000)} L`;
  if (u === 'g' && value >= 1000) return `${fmtNum(value / 1000)} kg`;
  if (u === 'ml') return `${fmtNum(value)} ml`;
  if (u === 'l') return `${fmtNum(value)} L`;
  if (u === 'kg') return `${fmtNum(value)} kg`;
  if (u === 'g') return `${fmtNum(value)} g`;
  return `${fmtNum(value)} ${u}`;
};

/** lê "2LT", "180G", "1,5 L", "395 gr", "c/12 un" na descrição do cupom */
export const sizeFromText = (text: string): string => {
  const t = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  const m = t.match(/(\d+(?:[.,]\d+)?)\s?(kg|gr|g|ml|lts?|l|litros?)\b/);
  if (m) {
    const v = Number(m[1].replace(',', '.'));
    const u = m[2];
    if (!(v > 0)) return '';
    if (u === 'gr' || u === 'g') return fmtSize(v, 'g');
    if (u === 'kg') return fmtSize(v, 'kg');
    if (u === 'ml') return fmtSize(v, 'ml');
    return fmtSize(v, 'l');
  }
  const pk = t.match(/\b(?:c\/|cx\s?c\/|com)\s?(\d{1,3})\s?(?:un|und|unid)?\b/);
  return pk ? `c/${pk[1]} un` : '';
};

const mem = new Map<string, string>();
const LS = 'eukasconta_ean_sizes_v1';
let loaded = false;
const load = () => { if (loaded) return; loaded = true; try { const o = JSON.parse(localStorage.getItem(LS) || '{}'); Object.entries(o).forEach(([k, v]) => mem.set(k, String(v))); } catch { /* sem cache */ } };
const save = () => { try { localStorage.setItem(LS, JSON.stringify(Object.fromEntries(mem))); } catch { /* sem cache */ } };

/** devolve {ean: "2 L"} para os EANs que o catálogo conhece; "" quando o catálogo não tem tamanho (não pergunta de novo) */
export const fetchEanSizes = async (eans: string[]): Promise<Record<string, string>> => {
  load();
  const want = Array.from(new Set(eans.filter(Boolean)));
  const todo = want.filter(e => !mem.has(e));
  for (let i = 0; i < todo.length; i += 80) {
    const chunk = todo.slice(i, i + 80);
    try {
      const keys = chunk.flatMap(e => [e, e.padStart(13, '0')]);
      const { data, error } = await supabase.from('ean_catalog').select('ean,size_text,size_value,size_unit').in('ean', keys);
      if (error) break;
      const got = new Map<string, string>();
      (data || []).forEach((r: any) => {
        const txt = r.size_value && r.size_unit ? fmtSize(Number(r.size_value), String(r.size_unit)) : sizeFromText(r.size_text || '');
        if (txt) got.set(String(r.ean).replace(/^0+/, ''), txt);
      });
      chunk.forEach(e => mem.set(e, got.get(e.replace(/^0+/, '')) || ''));
    } catch { break; }
  }
  save();
  const out: Record<string, string> = {};
  want.forEach(e => { out[e] = mem.get(e) || ''; });
  return out;
};
