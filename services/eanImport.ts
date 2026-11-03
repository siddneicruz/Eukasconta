// Importação do catálogo de EAN (planilhas CSV dos fabricantes e distribuidores) com conferência antes de enviar.
// Regras de blindagem: só entra código com dígito verificador certo (GTIN 8/12/13/14); UPC que perdeu o zero da frente é
// completado e conferido; o resto é rejeitado com o motivo. O mesmo EAN em várias planilhas vira uma linha só, com todas as fontes.

export type EanSource = 'dpcnet' | 'dispan' | 'tirol';
export interface EanRow { ean: string; description: string; brand: string; manufacturer: string; category_src: string; ncm: string; dun14: string; size_value: number | null; size_unit: string | null; size_text: string | null; image_url: string; sources: { s: EanSource; sku: string; d: string }[] }
export interface EanReject { ean: string; source: string; reason: 'vazio' | 'tamanho' | 'digito_verificador' | 'sem_descricao'; description: string }
export interface EanPreview { catalog: EanRow[]; rejects: EanReject[]; perSource: Record<string, { rows: number; ok: number; fixed: number; rejected: number }>; conflicts: number; withSize: number; skipped: string[] }

const PRIORITY: Record<EanSource, number> = { dpcnet: 1, tirol: 2, dispan: 3 };

export const parseCsv = (text: string, sep = ';'): string[][] => {
  const out: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); out.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur.replace(/\r$/, '')); out.push(row); }
  return out.filter(r => r.some(x => x.trim() !== ''));
};

const checkDigit = (d: string): boolean => {
  let s = 0;
  for (let i = d.length - 2, k = 0; i >= 0; i--, k++) s += Number(d[i]) * (k % 2 === 0 ? 3 : 1);
  return (10 - (s % 10)) % 10 === Number(d[d.length - 1]);
};

export const fixEan = (raw: string): { ean: string | null; why: 'ok' | 'zeros' | 'vazio' | 'tamanho' | 'digito_verificador' } => {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return { ean: null, why: 'vazio' };
  const cands = [d];
  if (d.length < 14) [8, 12, 13, 14].forEach(n => { if (n > d.length) cands.push(d.padStart(n, '0')); });
  for (const c of cands) if ([8, 12, 13, 14].includes(c.length) && checkDigit(c)) return { ean: c, why: c === d ? 'ok' : 'zeros' };
  return { ean: null, why: [8, 12, 13, 14].includes(d.length) ? 'digito_verificador' : 'tamanho' };
};

const SZ = /(?<![\w.,])(\d+(?:[.,]\d+)?)\s*(kg|gr?|mg|ml|lts?|l|cl|un|und|m|cm|mm)\b/i;
const UNITS: Record<string, [string, number]> = { kg: ['g', 1000], g: ['g', 1], gr: ['g', 1], mg: ['g', 0.001], ml: ['ml', 1], l: ['ml', 1000], lt: ['ml', 1000], lts: ['ml', 1000], cl: ['ml', 10], un: ['un', 1], und: ['un', 1], m: ['m', 1], cm: ['cm', 1], mm: ['mm', 1] };
export const sizeOf = (desc: string): { value: number | null; unit: string | null; text: string | null } => {
  const m = SZ.exec(desc || '');
  if (!m) return { value: null, unit: null, text: null };
  const [u, f] = UNITS[m[2].toLowerCase()];
  return { value: Math.round(parseFloat(m[1].replace(',', '.')) * f * 1000) / 1000, unit: u, text: m[0] };
};

const clean = (s: string) => String(s || '').replace(/\s+/g, ' ').trim();
const noColon = (s: string) => clean(s).replace(/^:/, '');

export const detectSource = (header: string[]): EanSource | null => {
  const h = header.map(x => x.trim());
  if (h.includes('EAN 13') && h.includes('Volume/Peso')) return 'tirol';
  if (h.includes('Cód. Fabricante') && h.includes('URL Produto')) return 'dispan';
  if (h.includes('Código/SKU') && h.includes('Qtd. Emb.')) return 'dpcnet';
  return null;
};

export const buildPreview = (files: { name: string; text: string }[]): EanPreview => {
  const rejects: EanReject[] = []; const skipped: string[] = [];
  const perSource: EanPreview['perSource'] = {};
  type Raw = { src: EanSource; ean: string; desc: string; brand: string; maker: string; cat: string; ncm: string; dun: string; sku: string; img: string };
  const raws: Raw[] = [];
  files.forEach(f => {
    const rows = parseCsv(f.text);
    if (!rows.length) { skipped.push(`${f.name}: arquivo vazio`); return; }
    const src = detectSource(rows[0]);
    if (!src) { skipped.push(`${f.name}: formato não reconhecido (só entram DPCNet, Dispan e Tirol; a planilha da Nestlé está com colunas deslocadas e precisa ser extraída de novo)`); return; }
    const idx = (n: string) => rows[0].findIndex(x => x.trim() === n);
    const g = (r: string[], n: string) => { const i = idx(n); return i >= 0 ? r[i] ?? '' : ''; };
    const st = perSource[src] || { rows: 0, ok: 0, fixed: 0, rejected: 0 }; perSource[src] = st;
    rows.slice(1).forEach(r => {
      st.rows += 1;
      const eanRaw = src === 'tirol' ? g(r, 'EAN 13') : g(r, 'EAN');
      const desc = clean(src === 'tirol' ? (() => { const d = g(r, 'Descrição'), vp = g(r, 'Volume/Peso'); return vp && !d.toLowerCase().includes(vp.toLowerCase()) ? `${d} ${vp}` : d; })() : g(r, 'Produto/Descrição'));
      const fx = fixEan(eanRaw);
      if (!fx.ean) { st.rejected += 1; rejects.push({ ean: String(eanRaw).replace(/\D/g, ''), source: src, reason: fx.why as EanReject['reason'], description: desc.slice(0, 200) }); return; }
      if (!desc) { st.rejected += 1; rejects.push({ ean: fx.ean, source: src, reason: 'sem_descricao', description: '' }); return; }
      st.ok += 1; if (fx.why === 'zeros') st.fixed += 1;
      raws.push({ src, ean: fx.ean, desc, brand: src === 'tirol' ? 'Tirol' : noColon(g(r, 'Marca')), maker: src === 'tirol' ? 'Tirol' : noColon(g(r, 'Fornecedor')),
        cat: clean(g(r, 'Categoria')), ncm: g(r, src === 'tirol' ? 'Código NCM' : 'NCM').replace(/\D/g, '').slice(0, 8),
        dun: g(r, src === 'tirol' ? 'DUN 14' : 'DUN-14').replace(/\D/g, ''), sku: clean(g(r, src === 'tirol' ? 'Código' : 'Código/SKU')), img: src === 'tirol' ? '' : g(r, 'Link Imagem') });
    });
  });
  const by = new Map<string, Raw[]>();
  raws.forEach(r => { const a = by.get(r.ean) || []; a.push(r); by.set(r.ean, a); });
  const catalog: EanRow[] = []; let conflicts = 0, withSize = 0;
  by.forEach((rs, ean) => {
    rs.sort((a, b) => PRIORITY[a.src] - PRIORITY[b.src]);
    const p = rs[0];
    if (new Set(rs.map(x => x.desc.toLowerCase())).size > 1) conflicts += 1;
    const sz = sizeOf(p.desc); if (sz.value !== null) withSize += 1;
    catalog.push({ ean, description: p.desc, brand: p.brand, manufacturer: p.maker, category_src: p.cat, ncm: p.ncm, dun14: p.dun, size_value: sz.value, size_unit: sz.unit, size_text: sz.text, image_url: p.img,
      sources: rs.map(x => ({ s: x.src, sku: x.sku, d: x.desc })) });
  });
  return { catalog, rejects, perSource, conflicts, withSize, skipped };
};
