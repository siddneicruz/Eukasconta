// Códigos nativos da tabela mãe (código de barras e código de cada loja) entram no cadastro de produtos do app de todos:
// é o que ajuda a ler cupom com item rasurado ou mal escrito, sempre ligado à loja onde o código vale.
import { MasterProduct } from '../types';
import type { MasterCodeRef } from './masterService';
import { addEan, addStoreCode, cleanCode, isBlockedCode, noEanKey, noStoreKey, normStoreKey } from './productCodes';

export const applyMasterCodes = (masters: MasterProduct[], codes: MasterCodeRef[] | undefined): { masters: MasterProduct[]; changed: number } => {
  if (!codes || codes.length === 0) return { masters, changed: 0 };
  const next = masters.map(m => ({ ...m }));
  const byCode = new Map(next.map((m, i) => [m.code, i] as const));
  const byEan = new Map<string, number>();
  next.forEach((m, i) => (m.eans || []).forEach(e => byEan.set(e.replace(/^0+/, ''), i)));
  let changed = 0;
  const touched = new Set<number>();
  for (const c of codes) {
    const code = cleanCode(c.code);
    if (!code) continue;
    let idx = byCode.get(c.master);
    if (idx === undefined && c.kind === 'ean') idx = byEan.get(code.replace(/^0+/, ''));
    if (idx === undefined) {
      next.push({ code: c.master, description: c.desc, unitType: c.unit || 'UN', category: c.category, aliases: [], establishmentCodes: {} });
      idx = next.length - 1; byCode.set(c.master, idx); changed++; touched.add(idx);
    }
    const m = next[idx];
    if (c.kind === 'ean') {
      if (isBlockedCode(m, noEanKey(code))) continue;
      if (addEan(m, code)) { changed++; touched.add(idx); byEan.set(code.replace(/^0+/, ''), idx); }
    } else {
      const key = normStoreKey(c.storeKey);
      if (!key || isBlockedCode(m, noStoreKey(key, code))) continue;
      if (addStoreCode(m, key, code)) { changed++; touched.add(idx); }
    }
  }
  return { masters: changed > 0 ? next : masters, changed };
};
