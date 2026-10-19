import { Receipt, TaxonomyNode, TaxonomySource, AILearningEntry, MasterProduct } from '../types';
import { fold } from './itemSearch';
import { catKey, deptKey } from './textFormat';
import { layerSlug } from './categoryLayers';

/* Categorias duplicadas: achar, mesclar e acertar tudo que aponta para elas.

   "Duplicada" = duas categorias irmãs (mesmo pai, mesmo nível) que são a mesma coisa:
   - igual:    o mesmo nome, só muda a caixa, o acento ou o plural ("Açougue" e "AÇOUGUE", "Legume" e "Legumes");
   - parecida: um nome é parte do outro ("Açougue" e "Açougue e Peixaria") ou são sinônimos conhecidos
               ("Cuidados Pessoais" e "Higiene e Perfumaria"). Só sugerimos; quem decide é a pessoa.

   Mesclar = escolher a que fica e juntar a(s) outra(s) nela: os filhos passam para a que fica (os de mesmo nome se juntam,
   também por dentro) e tudo que usava a categoria antiga passa a usar a nova: itens dos cupons, produtos mestres, aprendizado
   da IA, metas, cores/ícones, filtros e recortes. */

/* ───────────────────────── nomes ───────────────────────── */

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'para', 'em', 'a', 'o', 'as', 'os', 'no', 'na', 'ou']);

// plural simples do português: legumes→legume, combustíveis→combustivel, pães→pao, limões→limao
const stem = (t: string): string => {
  if (t.length >= 4 && (t.endsWith('oes') || t.endsWith('aes'))) return t.slice(0, -3) + 'ao';
  if (t.length > 4 && t.endsWith('eis')) return t.slice(0, -3) + 'el';
  if (t.length > 4 && t.endsWith('ais')) return t.slice(0, -3) + 'al';
  if (t.length > 3 && t.endsWith('ns')) return t.slice(0, -2) + 'm';
  if (t.length > 4 && /[rz]es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
};

export const tokensOf = (s: string): string[] =>
  fold(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(t => t && !STOP.has(t)).map(stem);

/** Chave de igualdade: palavras sem acento, sem "de/e/com", no singular e em ordem ("Pães e Bolos" = "Bolos e Pães"). */
export const sameKey = (name: string): string => Array.from(new Set(tokensOf(name))).sort().join(' ');

/** Os pedaços de um nome composto: "Açougue e Peixaria" → ["acougue", "peixaria"]. */
export const segmentsOf = (name: string): string[] =>
  name.split(/\s+e\s+|\s*[,/&]\s*|\s+ou\s+/i).map(sameKey).filter(Boolean);

// nomes diferentes que querem dizer o mesmo (já sem acento e no singular)
const SYNONYMS: string[][] = [
  ['cuidado pessoal', 'higiene perfumaria', 'higiene pessoal', 'higiene'],
  ['combustivel', 'combustivel automotivo'],
  ['bebida alcoolica', 'bebida alcool'],
  ['pet', 'pet shop', 'animal domestico'],
];
const synonymGroup = (key: string): number => SYNONYMS.findIndex(g => g.includes(key));

/* ───────────────────────── achar duplicadas ───────────────────────── */

export type DupKind = 'igual' | 'parecida';

export interface DupMember { id: string; name: string; level: 1 | 2 | 3 | 4; path: string; kids: number; descendants: number }
export interface DupGroup {
  id: string;
  level: 1 | 2 | 3 | 4;
  parentId: string | null;
  parentPath: string;
  kind: DupKind;
  reason: string;
  members: DupMember[];
}

const byIdOf = (tax: TaxonomyNode[]): Map<string, TaxonomyNode> => {
  const m = new Map<string, TaxonomyNode>();
  tax.forEach(n => m.set(n.id, n));
  return m;
};

/** "Açougue - Carne Bovina - Cortes Nobres" (nomes do caminho até a raiz). */
export const pathNames = (node: TaxonomyNode, byId: Map<string, TaxonomyNode>): string[] => {
  const out: string[] = [];
  let cur: TaxonomyNode | undefined = node;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur.name.trim());
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
};

const childrenMap = (tax: TaxonomyNode[]): Map<string | null, TaxonomyNode[]> => {
  const m = new Map<string | null, TaxonomyNode[]>();
  tax.forEach(n => { const k = n.parentId ?? null; const a = m.get(k); if (a) a.push(n); else m.set(k, [n]); });
  return m;
};

const countDescendants = (id: string, kids: Map<string | null, TaxonomyNode[]>): number => {
  let n = 0;
  (kids.get(id) || []).forEach(k => { n += 1 + countDescendants(k.id, kids); });
  return n;
};

interface Relation { kind: DupKind; reason: string }

const relate = (a: TaxonomyNode, b: TaxonomyNode): Relation | null => {
  const ka = sameKey(a.name), kb = sameKey(b.name);
  if (!ka || !kb) return null;
  if (ka === kb) return { kind: 'igual', reason: 'mesmo nome' };
  const sa = segmentsOf(a.name), sb = segmentsOf(b.name);
  // um nome é parte do outro: "Açougue" ⊂ "Açougue e Peixaria"
  if (sb.length > 1 && sa.every(x => sb.includes(x)) && sa.length < sb.length) return { kind: 'parecida', reason: `"${a.name.trim()}" já está dentro de "${b.name.trim()}"` };
  if (sa.length > 1 && sb.every(x => sa.includes(x)) && sb.length < sa.length) return { kind: 'parecida', reason: `"${b.name.trim()}" já está dentro de "${a.name.trim()}"` };
  const ga = synonymGroup(ka), gb = synonymGroup(kb);
  if (ga >= 0 && ga === gb) return { kind: 'parecida', reason: 'costumam ser a mesma coisa' };
  // "Combustível" e "Combustíveis Automotivos": o nome curto é a primeira palavra do comprido
  const ta = ka.split(' '), tb = kb.split(' ');
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (a.level <= 2 && short.length === 1 && long.length === 2 && short[0].length >= 6 && long.includes(short[0]) && ta.length !== tb.length) {
    return { kind: 'parecida', reason: 'um nome é a versão mais curta do outro' };
  }
  return null;
};

/** Grupos de irmãs que parecem a mesma categoria. Igual primeiro, depois as parecidas; dentro disso, de cima para baixo.
    Uma categoria idêntica a outra aparece no grupo "igual"; se também for parecida com uma terceira, aparece de novo no
    grupo "parecida" (quem mostra a lista esconde esse até as idênticas serem juntadas). */
export const detectDuplicates = (tax: TaxonomyNode[]): DupGroup[] => {
  if (!tax || tax.length < 2) return [];
  const byId = byIdOf(tax);
  const kids = childrenMap(tax);
  const out: DupGroup[] = [];

  const member = (m: TaxonomyNode): DupMember => ({
    id: m.id, name: m.name.trim(), level: m.level, path: pathNames(m, byId).join(' - '),
    kids: (kids.get(m.id) || []).length, descendants: countDescendants(m.id, kids),
  });

  kids.forEach((siblings, parentId) => {
    if (siblings.length < 2) return;
    // nó cujo pai não existe mais não é irmão de ninguém
    if (parentId !== null && !byId.has(parentId)) return;
    const parent = parentId ? byId.get(parentId) : undefined;
    const parentPath = parent ? pathNames(parent, byId).join(' - ') : '';

    // 1) idênticas: mesma chave de nome
    const byKey = new Map<string, TaxonomyNode[]>();
    siblings.forEach(n => { const k = sameKey(n.name); if (!k) return; const a = byKey.get(k); if (a) a.push(n); else byKey.set(k, [n]); });
    byKey.forEach(members => {
      if (members.length < 2) return;
      out.push({ id: 'i:' + members.map(m => m.id).sort().join('+'), level: members[0].level, parentId, parentPath, kind: 'igual', reason: 'mesmo nome', members: members.map(member) });
    });

    // 2) parecidas: junta os "nomes" (um por chave) que têm relação
    const keys = Array.from(byKey.keys());
    if (keys.length < 2) return;
    const rep = keys.map(k => byKey.get(k)![0]);
    const uf = keys.map((_, i) => i);
    const find = (i: number): number => (uf[i] === i ? i : (uf[i] = find(uf[i])));
    const reasons = new Map<number, string>();
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const r = relate(rep[i], rep[j]);
        if (!r) continue;
        uf[find(i)] = find(j);
        reasons.set(find(j), r.reason);
      }
    }
    const comps = new Map<number, number[]>();
    keys.forEach((_, i) => { const r = find(i); const a = comps.get(r); if (a) a.push(i); else comps.set(r, [i]); });
    comps.forEach((idxs, root) => {
      if (idxs.length < 2) return;
      const members = idxs.flatMap(i => byKey.get(keys[i])!);
      let reason = reasons.get(root) || 'nomes parecidos';
      if (!reasons.has(root)) {
        for (let x = 0; x < idxs.length; x++) for (let y = x + 1; y < idxs.length; y++) { const r = relate(rep[idxs[x]], rep[idxs[y]]); if (r) { reason = r.reason; } }
      }
      out.push({ id: 'p:' + members.map(m => m.id).sort().join('+'), level: members[0].level, parentId, parentPath, kind: 'parecida', reason, members: members.map(member) });
    });
  });

  return out.sort((a, b) =>
    (a.kind === b.kind ? 0 : a.kind === 'igual' ? -1 : 1) || a.level - b.level ||
    a.parentPath.localeCompare(b.parentPath, 'pt-BR') || a.members[0].name.localeCompare(b.members[0].name, 'pt-BR'));
};

/** O que mostrar na lista: as idênticas e, das parecidas, só as que não têm membro em grupo de idênticas (essas voltam depois). */
export const visibleDuplicates = (groups: DupGroup[]): { shown: DupGroup[]; pendingSimilar: number } => {
  const inEqual = new Set<string>();
  groups.filter(g => g.kind === 'igual').forEach(g => g.members.forEach(m => inEqual.add(m.id)));
  let pendingSimilar = 0;
  const shown = groups.filter(g => {
    if (g.kind === 'igual') return true;
    if (g.members.some(m => inEqual.has(m.id))) { pendingSimilar += 1; return false; }
    return true;
  });
  return { shown, pendingSimilar };
};

/* ───────────────────────── uso nas compras ───────────────────────── */

export interface Usage { items: number; total: number }

/** Quantos itens e quanto gasto cada departamento (`d`) e categoria (`c:`) tem nas compras. */
export const usageByKey = (receipts: Receipt[]): Map<string, Usage> => {
  const m = new Map<string, Usage>();
  const bump = (k: string, v: number) => { const u = m.get(k); if (u) { u.items += 1; u.total += v; } else m.set(k, { items: 1, total: v }); };
  receipts.forEach(r => (r.items || []).forEach(i => {
    const v = Number(i.totalPrice) || 0;
    const cat = String(i.category || '');
    bump(deptKey(cat), v);
    bump(`c:${catKey(cat)}`, v);
  }));
  return m;
};

/** Uso de um nó nas compras: departamento e categoria contam; grupo e item não têm compra própria (0). */
export const usageOfNode = (node: TaxonomyNode, tax: TaxonomyNode[], use: Map<string, Usage>): Usage => {
  const none: Usage = { items: 0, total: 0 };
  if (node.level === 1) return use.get(deptKey(node.name)) || none;
  if (node.level === 2) {
    const parent = tax.find(n => n.id === node.parentId);
    return parent ? use.get(`c:${catKey(`${parent.name.trim()} - ${node.name.trim()}`)}`) || none : none;
  }
  return none;
};

/** Qual deixar: a que mais tem compra; empate, a que tem mais filhos; empate, a de nome mais completo. */
export const suggestKeeper = (g: DupGroup, tax: TaxonomyNode[], use: Map<string, Usage>): string => {
  const byId = byIdOf(tax);
  const ranked = [...g.members].sort((a, b) => {
    const ua = byId.get(a.id) ? usageOfNode(byId.get(a.id)!, tax, use).items : 0;
    const ub = byId.get(b.id) ? usageOfNode(byId.get(b.id)!, tax, use).items : 0;
    return ub - ua || b.descendants - a.descendants || b.name.length - a.name.length;
  });
  return ranked[0].id;
};

/* ───────────────────────── mesclar ───────────────────────── */

export interface MergeResult {
  taxonomy: TaxonomyNode[];
  /** categoria que sumiu (id) → categoria que ficou (id), incluindo os filhos que se juntaram */
  idMap: Map<string, string>;
  /** quantas categorias saíram da lista */
  removed: number;
}

/** Junta `dropIds` em `keepId` (todos do mesmo nível). Quem ficou mantém nome, ícone e cor; os filhos dos outros passam para
    ela e os de mesmo nome se juntam, até o último nível. Não mexe no que recebe. */
export const mergeNodes = (tax: TaxonomyNode[], keepId: string, dropIds: string[]): MergeResult => {
  const list: TaxonomyNode[] = tax.map(n => ({ ...n }));
  const byId = byIdOf(list);
  const idMap = new Map<string, string>();
  const keep = byId.get(keepId);
  const noop: MergeResult = { taxonomy: tax, idMap, removed: 0 };
  if (!keep) return noop;

  const isUnder = (id: string, ancestorId: string): boolean => {
    let cur = byId.get(id);
    const seen = new Set<string>();
    while (cur && cur.parentId && !seen.has(cur.id)) {
      if (cur.parentId === ancestorId) return true;
      seen.add(cur.id);
      cur = byId.get(cur.parentId);
    }
    return false;
  };

  const removedIds = new Set<string>();
  const kidsOf = (id: string) => list.filter(n => n.parentId === id && !removedIds.has(n.id));

  const absorb = (dropId: string, intoId: string) => {
    const drop = byId.get(dropId), into = byId.get(intoId);
    if (!drop || !into || dropId === intoId) return;
    idMap.set(dropId, intoId);
    if (!into.icon && drop.icon) into.icon = drop.icon;
    if (!into.color && drop.color) into.color = drop.color;
    removedIds.add(dropId);
    kidsOf(dropId).forEach(kid => {
      const twin = kidsOf(intoId).find(k => k.id !== kid.id && sameKey(k.name) === sameKey(kid.name));
      if (twin) absorb(kid.id, twin.id);
      else kid.parentId = intoId;
    });
  };

  let removed = 0;
  dropIds.forEach(id => {
    const d = byId.get(id);
    if (!d || id === keepId || d.level !== keep.level) return;
    if (isUnder(id, keepId) || isUnder(keepId, id)) return;   // um dentro do outro: não é duplicata, é hierarquia
    absorb(id, keepId);
  });
  removed = removedIds.size;
  if (removed === 0) return noop;

  keep.sourceType = TaxonomySource.USER_CUSTOMIZED;
  keep.isCustomized = true;
  keep.lastUpdated = Date.now();
  return { taxonomy: list.filter(n => !removedIds.has(n.id)), idMap, removed };
};

/** Junta várias mesclagens numa só: o mapa final vai de cada id antigo ao id que ficou no fim. */
export const composeIdMaps = (first: Map<string, string>, second: Map<string, string>): Map<string, string> => {
  const out = new Map<string, string>();
  first.forEach((to, from) => out.set(from, second.get(to) ?? to));
  second.forEach((to, from) => { if (!out.has(from)) out.set(from, to); });
  return out;
};

export interface MergeOp { keepId: string; dropIds: string[] }

/** Várias mesclagens em sequência. Se uma categoria já foi juntada antes, a operação segue para onde ela foi parar. */
export const mergeMany = (tax: TaxonomyNode[], ops: MergeOp[]): MergeResult => {
  let cur = tax;
  let map = new Map<string, string>();
  let removed = 0;
  ops.forEach(op => {
    const keepId = map.get(op.keepId) ?? op.keepId;
    const drops = Array.from(new Set(op.dropIds.map(id => map.get(id) ?? id))).filter(id => id !== keepId);
    if (drops.length === 0) return;
    const r = mergeNodes(cur, keepId, drops);
    if (r.removed === 0) return;
    cur = r.taxonomy;
    map = composeIdMaps(map, r.idMap);
    removed += r.removed;
  });
  return { taxonomy: cur, idMap: map, removed };
};

/** Junta de uma vez todas as iguais (mesmo nome), de cima para baixo: o departamento primeiro, que já junta as de dentro. */
export const mergeIdentical = (tax: TaxonomyNode[], use: Map<string, Usage>): MergeResult => {
  let cur = tax;
  let map = new Map<string, string>();
  let removed = 0;
  for (let round = 0; round < 8; round++) {
    const groups = detectDuplicates(cur).filter(g => g.kind === 'igual');
    if (groups.length === 0) break;
    const level = Math.min(...groups.map(g => g.level));
    const ops = groups.filter(g => g.level === level).map(g => {
      const keepId = suggestKeeper(g, cur, use);
      return { keepId, dropIds: g.members.map(m => m.id).filter(id => id !== keepId) };
    });
    const r = mergeMany(cur, ops);
    if (r.removed === 0) break;
    cur = r.taxonomy;
    map = composeIdMaps(map, r.idMap);
    removed += r.removed;
  }
  return { taxonomy: cur, idMap: map, removed };
};

/** Departamentos de fábrica que saíram da lista nesta mesclagem (e não têm outro com o mesmo nome): para não voltarem sozinhos. */
export const droppedDefaultRoots = (oldTax: TaxonomyNode[], newTax: TaxonomyNode[], idMap: Map<string, string>, defaultSlugs: string[]): string[] => {
  const stay = new Set(newTax.filter(n => n.level === 1).map(n => n.slug));
  const def = new Set(defaultSlugs);
  const out = new Set<string>();
  oldTax.forEach(n => { if (n.level === 1 && idMap.has(n.id) && def.has(n.slug) && !stay.has(n.slug)) out.add(n.slug); });
  return Array.from(out);
};

/* ───────────────────────── acertar o que aponta para elas ───────────────────────── */

export interface Remapper {
  /** "Açougue - Carne" → o nome novo da categoria (igual ao de entrada quando nada mudou) */
  category: (cat: string) => string;
  /** chave de filtro/recorte (departamento, "c:", "g:", "i:", "o:") → a chave nova */
  key: (key: string) => string;
  /** nome completo da meta ("Açougue - Carne - Cortes") → o novo, ou null se nada mudou */
  path: (full: string) => string | null;
  node: (id: string) => string;
  /** categorias que mudaram de nome (antigo → novo), para o resumo */
  changed: Map<string, string>;
}

const labelOf = (node: TaxonomyNode, byId: Map<string, TaxonomyNode>): string => pathNames(node, byId).join(' - ');

/** Chaves de um nó nas listas de filtro: departamento, categoria (c: e o:), grupo (g:) ou item (i:). */
const keysOfNode = (node: TaxonomyNode, byId: Map<string, TaxonomyNode>): string[] => {
  const names = pathNames(node, byId);
  if (names.length !== node.level) return [];            // caminho incompleto
  if (node.level === 1) return [deptKey(names[0])];
  const ck = catKey(`${names[0]} - ${names[1]}`);
  if (node.level === 2) return [`c:${ck}`, `o:${ck}`];
  const g = layerSlug(names[2]);
  if (!g) return [];
  if (node.level === 3) return [`g:${ck}|${g}`, `o:${ck}|${g}`];
  const it = layerSlug(names[3]);
  return it ? [`i:${ck}|${g}|${it}`] : [];
};

/** Monta o "de-para" depois de uma mesclagem. `oldTax` é a árvore de antes; `newTax`, a de depois. */
export const buildRemapper = (oldTax: TaxonomyNode[], newTax: TaxonomyNode[], idMap: Map<string, string>): Remapper => {
  const oldById = byIdOf(oldTax), newById = byIdOf(newTax);
  const resolve = (id: string): string => idMap.get(id) ?? id;
  const dropped = new Set(idMap.keys());

  // só entra no de-para quem sumiu ou ficou debaixo de quem sumiu: o resto não é tocado
  const affected = (n: TaxonomyNode): boolean => {
    let cur: TaxonomyNode | undefined = n;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      if (dropped.has(cur.id)) return true;
      seen.add(cur.id);
      cur = cur.parentId ? oldById.get(cur.parentId) : undefined;
    }
    return false;
  };

  const catExact = new Map<string, string>();
  const catFold = new Map<string, string>();
  const l1Fold = new Map<string, string>();          // departamento antigo (sem acento) → nome novo
  const keyMap = new Map<string, string>();
  const pathFold = new Map<string, string>();
  const changed = new Map<string, string>();

  oldTax.forEach(n => {
    if (!affected(n)) return;
    const target = newById.get(resolve(n.id));
    if (!target) return;
    const oldLabel = labelOf(n, oldById), newLabel = labelOf(target, newById);
    if (oldLabel !== newLabel) pathFold.set(fold(oldLabel), newLabel);
    if (n.level <= 2 && oldLabel !== newLabel) {
      catExact.set(oldLabel, newLabel);
      catFold.set(fold(oldLabel), newLabel);
      changed.set(oldLabel, newLabel);
      if (n.level === 1) l1Fold.set(fold(oldLabel), newLabel);
    }
    const ok = keysOfNode(n, oldById), nk = keysOfNode(target, newById);
    if (ok.length === nk.length) ok.forEach((k, i) => { if (k !== nk[i]) keyMap.set(k, nk[i]); });
  });

  const category = (cat: string): string => {
    const c = String(cat ?? '');
    const hit = catExact.get(c) ?? catFold.get(fold(c));
    if (hit !== undefined) return hit;
    // "Departamento - algo que não é categoria conhecida": troca só o departamento
    const i = c.indexOf(' - ');
    if (i > 0) {
      const head = l1Fold.get(fold(c.slice(0, i)));
      if (head !== undefined) return `${head}${c.slice(i)}`;
    }
    return c;
  };

  return {
    category,
    key: (k: string) => keyMap.get(k) ?? k,
    path: (full: string) => pathFold.get(fold(full)) ?? null,
    node: resolve,
    changed,
  };
};

/* Aplicação nos dados guardados (puras: devolvem o novo e dizem se mudou) */

export const remapReceipts = (receipts: Receipt[], rm: Remapper): { receipts: Receipt[]; items: number } => {
  let items = 0;
  const out = receipts.map(r => {
    let touched = false;
    const next = (r.items || []).map(i => {
      const nc = rm.category(i.category);
      if (nc === i.category) return i;
      touched = true; items += 1;
      return { ...i, category: nc };
    });
    return touched ? { ...r, items: next } : r;
  });
  return { receipts: items > 0 ? out : receipts, items };
};

export const remapMasters = (masters: MasterProduct[], rm: Remapper): MasterProduct[] => {
  let any = false;
  const out = masters.map(m => {
    const nc = rm.category(m.category);
    if (nc === m.category) return m;
    any = true;
    return { ...m, category: nc };
  });
  return any ? out : masters;
};

export const remapLearning = (learning: AILearningEntry[], rm: Remapper): AILearningEntry[] => {
  let any = false;
  const out = learning.map(l => {
    const t = rm.node(l.targetNodeId);
    if (t === l.targetNodeId) return l;
    any = true;
    return { ...l, targetNodeId: t };
  });
  return any ? out : learning;
};

/** Metas: se a categoria que ficou já tinha meta, vale a dela; senão herda a da que saiu. */
export const remapGoals = (goals: Record<string, number>, rm: Remapper): Record<string, number> => {
  const out: Record<string, number> = {};
  const pending: [string, number][] = [];
  Object.entries(goals || {}).forEach(([k, v]) => {
    const nk = rm.path(k);
    if (nk === null) out[k] = v; else pending.push([nk, v]);
  });
  pending.forEach(([nk, v]) => {
    const exists = Object.keys(out).some(k => fold(k) === fold(nk));
    if (!exists) out[nk] = v;
  });
  return out;
};

/** Ícone/cor guardados por nome: o que era da categoria antiga passa para a nova (se ela não tiver). */
export const remapMeta = (meta: Record<string, any>, rm: Remapper, droppedNames: { from: string; to: string }[]): Record<string, any> => {
  const out: Record<string, any> = { ...meta };
  let any = false;
  const move = (from: string, to: string) => {
    if (from === to || !(from in out)) return;
    if (!(to in out)) out[to] = out[from];
    delete out[from];
    any = true;
  };
  Object.keys(meta || {}).forEach(k => { const nk = rm.category(k); if (nk !== k) move(k, nk); });
  droppedNames.forEach(({ from, to }) => move(from, to));
  return any ? out : meta;
};

export const remapFilterKeys = (keys: string[], rm: Remapper): string[] => Array.from(new Set(keys.map(rm.key)));

/* ───────────────────────── departamentos de fábrica ───────────────────────── */

export const HIDDEN_DEFAULTS_KEY = 'eukasconta_taxonomy_hidden';

/** Departamentos de fábrica que a pessoa juntou em outro (ou apagou): não voltam sozinhos quando o app abre. */
export const loadHiddenDefaults = (): string[] => {
  try {
    const raw = localStorage.getItem(HIDDEN_DEFAULTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string') : [];
  } catch { return []; }
};

export const addHiddenDefaults = (slugs: string[]): void => {
  if (slugs.length === 0) return;
  try {
    const next = Array.from(new Set([...loadHiddenDefaults(), ...slugs]));
    localStorage.setItem(HIDDEN_DEFAULTS_KEY, JSON.stringify(next));
  } catch { /* sem armazenamento: volta na próxima abertura */ }
};
