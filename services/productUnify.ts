import { Receipt, MasterProduct } from '../types';
import { cleanDescriptionForMatching } from './productMasterService';

/* Unificação de produtos feita pela pessoa.
   Um "produto" do app é um cadastro mestre (MAE0001…): vários nomes de cupom (aliases) que valem o mesmo item.
   Unificar = juntar cadastros num só. Os cupons não são alterados: o que liga cada nome ao produto é a lista de aliases,
   e é ela que o app consulta ao ler um cupom novo, ao buscar item e ao somar preços. */

export const descKey = (d: string | undefined | null): string => (d || '').trim().toUpperCase();

export interface GroupDesc {
  desc: string;       // nome como vem no cupom (MAIÚSCULAS)
  count: number;      // linhas de compra
  total: number;      // R$ gasto
  cats: string[];     // categorias que essas linhas têm hoje
  category: string;   // a mais comum
}

export interface ProductGroup {
  key: string;        // "M:MAE0012" (cadastro) ou "D:NOME" (nome ainda sem cadastro)
  code: string;       // MAE0012, vazio se ainda não tem cadastro
  name: string;       // nome padrão do produto
  category: string;   // categoria mais comprada
  unit: string;
  descs: GroupDesc[]; // nomes de cupom, mais comprados primeiro
  count: number;
  total: number;
  curated: boolean;   // já foi unificado à mão
}

const top = (m: Map<string, number>): string => {
  let best = '', n = -1;
  m.forEach((v, k) => { if (v > n) { n = v; best = k; } });
  return best;
};

/* Todos os produtos que a pessoa já comprou, cada um com os nomes de cupom que ele reúne. */
export const buildProductGroups = (receipts: Receipt[], masters: MasterProduct[] = []): ProductGroup[] => {
  const owner = new Map<string, MasterProduct>();
  masters.forEach(m => (m.aliases || []).forEach(a => { const k = descKey(a); if (k && !owner.has(k)) owner.set(k, m); }));

  type D = { count: number; total: number; cats: Map<string, number>; units: Map<string, number> };
  const byDesc = new Map<string, D>();
  receipts.forEach(r => (r.items || []).forEach(item => {
    const k = descKey(item.description);
    if (!k) return;
    let d = byDesc.get(k);
    if (!d) { d = { count: 0, total: 0, cats: new Map(), units: new Map() }; byDesc.set(k, d); }
    d.count += 1;
    d.total += Number(item.totalPrice) || 0;
    const c = item.category || 'Outros';
    d.cats.set(c, (d.cats.get(c) || 0) + 1);
    const u = (item.unitType || '').trim().toUpperCase();
    if (u) d.units.set(u, (d.units.get(u) || 0) + 1);
  }));

  type G = { key: string; master?: MasterProduct; descs: GroupDesc[]; catVotes: Map<string, number>; unitVotes: Map<string, number> };
  const groups = new Map<string, G>();
  byDesc.forEach((d, k) => {
    const master = owner.get(k);
    const key = master ? `M:${master.code}` : `D:${k}`;
    let g = groups.get(key);
    if (!g) { g = { key, master, descs: [], catVotes: new Map(), unitVotes: new Map() }; groups.set(key, g); }
    g.descs.push({ desc: k, count: d.count, total: d.total, cats: Array.from(d.cats.keys()), category: top(d.cats) });
    d.cats.forEach((v, c) => g!.catVotes.set(c, (g!.catVotes.get(c) || 0) + v));
    d.units.forEach((v, u) => g!.unitVotes.set(u, (g!.unitVotes.get(u) || 0) + v));
  });

  const out: ProductGroup[] = Array.from(groups.values()).map(g => {
    g.descs.sort((a, b) => b.count - a.count || a.desc.localeCompare(b.desc, 'pt-BR'));
    return {
      key: g.key,
      code: g.master?.code || '',
      name: g.master ? g.master.description : g.descs[0].desc,
      category: top(g.catVotes) || g.master?.category || 'Outros',
      unit: g.master?.unitType || top(g.unitVotes) || 'UN',
      descs: g.descs,
      count: g.descs.reduce((s, d) => s + d.count, 0),
      total: g.descs.reduce((s, d) => s + d.total, 0),
      curated: !!g.master?.curated,
    };
  });
  return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
};

const nextCode = (masters: MasterProduct[]): string => {
  const n = masters.reduce((mx, m) => {
    const x = parseInt(String(m.code || '').replace('MAE', ''), 10);
    return isNaN(x) ? mx : Math.max(mx, x);
  }, 14) + 1; // o app começa em MAE0015
  return `MAE${String(n).padStart(4, '0')}`;
};

const byName = (a: MasterProduct, b: MasterProduct) => a.description.localeCompare(b.description, 'pt-BR');

export interface UnifyResult {
  masters: MasterProduct[];
  code: string;     // cadastro que ficou
  descs: string[];  // todos os nomes de cupom que agora apontam para ele
}

/* Junta os produtos escolhidos em um só: um cadastro (o do produto mais comprado) fica com o nome e a categoria
   escolhidos e com todos os nomes de cupom; os outros cadastros somem. Nenhum nome fica em dois produtos. */
export const unifyGroups = (
  masters: MasterProduct[],
  groups: ProductGroup[],
  o: { name: string; category: string; unit?: string },
): UnifyResult => {
  const codes = new Set(groups.map(g => g.code).filter(Boolean));
  const picked = masters.filter(m => codes.has(m.code));
  const survivorCode = groups.filter(g => g.code).sort((a, b) => b.count - a.count)[0]?.code || nextCode(masters);
  const survivorOld = picked.find(m => m.code === survivorCode);

  const all = new Set<string>();
  const est: Record<string, string> = {};
  // cadastro que fica escreve por último, então o código de loja dele vence um conflito
  [...picked.filter(m => m.code !== survivorCode), ...(survivorOld ? [survivorOld] : [])].forEach(m => {
    (m.aliases || []).forEach(a => { const k = descKey(a); if (k) all.add(k); });
    Object.assign(est, m.establishmentCodes || {});
  });
  groups.forEach(g => g.descs.forEach(d => { if (d.desc) all.add(d.desc); }));

  const merged: MasterProduct = {
    code: survivorCode,
    description: descKey(o.name),
    unitType: descKey(o.unit || survivorOld?.unitType || groups[0]?.unit || 'UN') || 'UN',
    category: o.category || survivorOld?.category || groups[0]?.category || 'Outros',
    aliases: Array.from(all),
    establishmentCodes: est,
    curated: true,
  };

  const rest: MasterProduct[] = [];
  masters.forEach(m => {
    if (codes.has(m.code)) return;
    if (!(m.aliases || []).some(a => all.has(descKey(a)))) { rest.push(m); return; }
    const aliases = m.aliases.filter(a => !all.has(descKey(a)));
    if (aliases.length) rest.push({ ...m, aliases });
  });

  return { masters: [...rest, merged].sort(byName), code: survivorCode, descs: merged.aliases };
};

/* Tira um nome de cupom do produto e faz dele um produto à parte (desfaz uma unificação). */
export const splitDesc = (
  masters: MasterProduct[],
  desc: string,
  o: { category?: string; unit?: string } = {},
): { masters: MasterProduct[]; code: string } => {
  const k = descKey(desc);
  const code = nextCode(masters);
  let ownerOld: MasterProduct | undefined;
  const rest: MasterProduct[] = [];
  masters.forEach(m => {
    if (!ownerOld && (m.aliases || []).some(a => descKey(a) === k)) {
      ownerOld = m;
      const aliases = m.aliases.filter(a => descKey(a) !== k);
      if (aliases.length) rest.push({ ...m, aliases });
    } else rest.push(m);
  });
  rest.push({
    code,
    description: k,
    unitType: descKey(o.unit || ownerOld?.unitType || 'UN') || 'UN',
    category: o.category || ownerOld?.category || 'Outros',
    aliases: [k],
    establishmentCodes: {},
    curated: true,
  });
  return { masters: rest.sort(byName), code };
};

/* ───────────────────────── sugestões de duplicados ───────────────────────── */

export interface DupCluster {
  id: string;
  groups: ProductGroup[];
  count: number;
}

const wordsOf = (clean: string): string[] => clean.split(' ').filter(w => w.length > 2);

// Mesma conta do app para juntar nomes (productMasterService.calculateSimilarity), com o texto já limpo.
const jaccard = (ca: string, wa: Set<string>, cb: string, wb: Set<string>): number => {
  if (ca === cb && ca.length > 0) return 1;
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  wa.forEach(w => { if (wb.has(w)) inter++; });
  return inter / new Set([...wa, ...wb]).size;
};

/* Produtos que parecem ser o mesmo item (nomes quase iguais). Só sugere: quem decide é a pessoa. */
export const suggestClusters = (groups: ProductGroup[], opts: { min?: number; cap?: number } = {}): DupCluster[] => {
  const min = opts.min ?? 0.6;
  const cap = opts.cap ?? 60;
  const n = groups.length;
  const clean = groups.map(g => cleanDescriptionForMatching(g.name));
  const words = clean.map(c => new Set(wordsOf(c)));

  const index = new Map<string, number[]>();
  words.forEach((ws, i) => ws.forEach(w => { const l = index.get(w); if (l) l.push(i); else index.set(w, [i]); }));

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const seen = new Set<number>();

  index.forEach(list => {
    if (list.length < 2 || list.length > 250) return; // palavra comum demais ("integral") não diz nada
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a], j = list[b];
        const pair = i * n + j;
        if (seen.has(pair)) continue;
        seen.add(pair);
        if (jaccard(clean[i], words[i], clean[j], words[j]) >= min) {
          const ri = find(i), rj = find(j);
          if (ri !== rj) parent[ri] = rj;
        }
      }
    }
  });

  const buckets = new Map<number, ProductGroup[]>();
  groups.forEach((g, i) => { const r = find(i); const l = buckets.get(r); if (l) l.push(g); else buckets.set(r, [g]); });

  const out: DupCluster[] = [];
  buckets.forEach(list => {
    if (list.length < 2) return;
    list.sort((a, b) => b.count - a.count);
    out.push({ id: list.map(g => g.key).sort().join('|'), groups: list, count: list.reduce((s, g) => s + g.count, 0) });
  });
  return out.sort((a, b) => b.count - a.count).slice(0, cap);
};
