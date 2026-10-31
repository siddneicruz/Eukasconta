// Tabela mãe: a estrutura de categorias e os produtos que valem para todos os usuários (Supabase).
// O administrador publica pela planilha; todo app baixa, troca a estrutura local e reclassifica os itens pelo código do produto.
import { supabase } from './supabaseClient';
import { Receipt, TaxonomyNode, TaxonomySource } from '../types';
import { slugify } from './taxonomyService';
import { standardizeTaxonomy } from './taxonomyCase';
import { layerSlug } from './categoryLayers';
import { catKey } from './textFormat';
import { applyPinChanges } from './layerPins';

export interface MasterProductRef { code: string; desc: string; nodeId: string | null }
export interface MasterData {
  version: number;
  publishedAt: string | null;
  nodes: TaxonomyNode[];
  products: MasterProductRef[];
  /** códigos nativos: código de barras (todas as lojas) e código de cada loja, ligados ao produto da tabela mãe */
  codes?: MasterCodeRef[];
  /** tipos de estabelecimento (Mercado, Restaurante...), na ordem da planilha */
  storeTypes?: string[];
}
export interface MasterCodeRef {
  master: string; desc: string; unit: string; category: string;
  kind: 'ean' | 'store'; storeKey: string; storeName: string; code: string;
}

export const MASTER_KEY = 'eukasconta_master';
const ROLE_KEY = (uid: string) => `eukasconta_role_${uid}`;

export const loadMasterCache = (): MasterData | null => {
  try {
    const v = JSON.parse(localStorage.getItem(MASTER_KEY) || 'null');
    return v && typeof v.version === 'number' && v.version > 0 && Array.isArray(v.nodes) && v.nodes.length > 0 ? (v as MasterData) : null;
  } catch { return null; }
};
export const saveMasterCache = (m: MasterData | null) => {
  try { if (m) localStorage.setItem(MASTER_KEY, JSON.stringify(m)); else localStorage.removeItem(MASTER_KEY); } catch { /* sem espaço: baixa de novo na próxima vez */ }
};
export const cachedRole = (uid: string | null): 'admin' | 'user' => {
  if (!uid) return 'user';
  try { return localStorage.getItem(ROLE_KEY(uid)) === 'admin' ? 'admin' : 'user'; } catch { return 'user'; }
};
const cacheRole = (uid: string, role: string) => { try { localStorage.setItem(ROLE_KEY(uid), role); } catch { /* ok */ } };

const PAGE = 1000;
const fetchAll = async <T,>(table: string, cols: string, order: string, filter?: (q: any) => any): Promise<T[]> => {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q: any = supabase.from(table).select(cols).order(order, { ascending: true }).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
};

export const fetchMasterVersion = async (): Promise<{ version: number; publishedAt: string | null } | null> => {
  const { data, error } = await supabase.from('master_meta').select('version, published_at').eq('id', true).maybeSingle();
  if (error || !data) return null;
  return { version: Number((data as any).version) || 0, publishedAt: (data as any).published_at ?? null };
};

export const fetchRole = async (uid: string): Promise<'admin' | 'user'> => {
  const { data, error } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle();
  if (error || !data) return cachedRole(uid);
  const role = (data as any).role === 'admin' ? 'admin' : 'user';
  cacheRole(uid, role);
  return role;
};

type NodeRow = { id: string; parent_id: string | null; level: number; name: string; sort: number; icon: string | null; color: string | null; updated_at: string };

export const fetchMaster = async (version: number, publishedAt: string | null): Promise<MasterData> => {
  const [rows, prods, codeRows, typeRows] = await Promise.all([
    fetchAll<NodeRow>('taxonomy_master', 'id,parent_id,level,name,sort,icon,color,updated_at', 'sort'),
    fetchAll<{ code: string; description: string; node_id: string | null }>('master_products', 'code,description,node_id', 'code', q => q.not('node_id', 'is', null)),
    fetchAll<any>('master_product_codes', 'kind,store_key,store_name,code,master_products(code,description,unit_type,category)', 'id').catch(() => [] as any[]),
    fetchAll<{ name: string }>('store_types', 'name,sort', 'sort').catch(() => [] as { name: string }[]),
  ]);
  const codes: MasterCodeRef[] = codeRows.filter((c: any) => c.master_products).map((c: any) => ({
    master: c.master_products.code, desc: c.master_products.description, unit: c.master_products.unit_type || 'UN', category: c.master_products.category || '',
    kind: c.kind, storeKey: c.store_key || '', storeName: c.store_name || '', code: c.code,
  }));
  const raw: TaxonomyNode[] = rows.map(r => ({
    id: r.id, parentId: r.parent_id, level: r.level as 1 | 2 | 3 | 4, name: r.name, slug: slugify(r.name),
    ...(r.icon ? { icon: r.icon } : {}), ...(r.color ? { color: r.color } : {}),
    sourceType: TaxonomySource.SYSTEM, isCustomized: false, lastUpdated: Date.parse(r.updated_at) || 0,
  }));
  // mesma escrita do app (iniciais maiúsculas): assim a padronização local não briga com a tabela mãe
  const nodes = standardizeTaxonomy(raw).taxonomy;
  return { version, publishedAt, nodes, products: prods.map(p => ({ code: p.code, desc: p.description, nodeId: p.node_id })), codes, storeTypes: typeRows.map(t => t.name) };
};

/** Assinatura da estrutura, para saber se a local já é a da tabela mãe. */
export const taxonomySignature = (nodes: TaxonomyNode[]): string => nodes.map(n => `${n.id}|${n.parentId ?? ''}|${n.name}`).join('\n');

export interface MasterIndex {
  byCode: Map<string, string>;       // código do produto → id do nó
  byDesc: Map<string, string>;       // descrição (como a busca por nome enxerga), só quando só um nó a usa
  path: Map<string, string[]>;       // id do nó → ["Departamento", "Categoria", "Grupo", "Item"]
  hasKids: Set<string>;
}

export const buildMasterIndex = (m: MasterData): MasterIndex => {
  const byId = new Map(m.nodes.map(n => [n.id, n] as const));
  const path = new Map<string, string[]>();
  const pathOf = (id: string): string[] => {
    const hit = path.get(id);
    if (hit) return hit;
    const out: string[] = [];
    let cur = byId.get(id); let guard = 0;
    while (cur && guard++ < 6) { out.unshift(cur.name.trim()); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
    path.set(id, out);
    return out;
  };
  m.nodes.forEach(n => pathOf(n.id));
  const hasKids = new Set<string>();
  m.nodes.forEach(n => { if (n.parentId) hasKids.add(n.parentId); });
  const byCode = new Map<string, string>();
  const descSeen = new Map<string, string | null>();
  m.products.forEach(p => {
    if (!p.nodeId || !byId.has(p.nodeId)) return;
    byCode.set(p.code.trim(), p.nodeId);
    const d = layerSlug(p.desc);
    if (!d) return;
    const prev = descSeen.get(d);
    descSeen.set(d, prev === undefined || prev === p.nodeId ? p.nodeId : null);
  });
  const byDesc = new Map<string, string>();
  descSeen.forEach((id, d) => { if (id) byDesc.set(d, id); });
  return { byCode, byDesc, path, hasKids };
};

const idxCache = new WeakMap<MasterData, MasterIndex>();
export const masterIndex = (m: MasterData): MasterIndex => {
  let i = idxCache.get(m);
  if (!i) { i = buildMasterIndex(m); idxCache.set(m, i); }
  return i;
};

/** O nó da tabela mãe para um item de compra (pelo código; sem código, pelo nome igual), se houver. */
export const nodeForItem = (m: MasterData, code: string | undefined | null, description: string | undefined | null): string | null => {
  const ix = masterIndex(m);
  const c = String(code ?? '').trim();
  if (c && ix.byCode.has(c)) return ix.byCode.get(c)!;
  const d = layerSlug(String(description ?? ''));
  return d && ix.byDesc.has(d) ? ix.byDesc.get(d)! : null;
};

/** A chave de grupo/item que a fixação usa (categoryLayers): nulo quando o nó é só categoria ou departamento. */
const pinKeyFor = (ix: MasterIndex, nodeId: string, path: string[], category: string): string | null => {
  if (path.length < 3) return null;
  const ck = catKey(category);
  const g = layerSlug(path[2]);
  if (path.length === 3) return ix.hasKids.has(nodeId) ? `o:${ck}|${g}` : `g:${ck}|${g}`;
  return `i:${ck}|${g}|${layerSlug(path[3])}`;
};

export interface ApplyResult { receipts: Receipt[]; changed: number }

/** Põe cada item que a tabela mãe conhece na categoria dela (e fixa grupo/item). Devolve o mesmo array se nada mudou. */
export const applyMasterToReceipts = (receipts: Receipt[], m: MasterData): ApplyResult => {
  const ix = masterIndex(m);
  const pins: { category: string; description: string; nodeKey: string | null }[] = [];
  const seen = new Set<string>();
  let changed = 0;
  const next = receipts.map(r => {
    let touched = false;
    const items = (r.items || []).map(it => {
      const id = nodeForItem(m, it.code, it.description);
      if (!id) return it;
      const path = ix.path.get(id);
      if (!path || path.length === 0) return it;
      const category = path.length >= 2 ? `${path[0]} - ${path[1]}` : path[0];
      const k = `${category}\u0001${it.description}`;
      if (!seen.has(k)) { seen.add(k); pins.push({ category, description: it.description, nodeKey: pinKeyFor(ix, id, path, category) }); }
      if (it.category === category) return it;
      touched = true; changed++;
      return { ...it, category };
    });
    return touched ? { ...r, items } : r;
  });
  applyPinChanges(pins);
  return { receipts: changed > 0 ? next : receipts, changed };
};

// ---- Administração e sugestões ----

const rpcError = (e: { message?: string; code?: string } | null): string => {
  if (!e) return '';
  if (e.code === '42501') return 'Só o administrador pode fazer isso.';
  return e.message || 'Não foi possível falar com o servidor.';
};

export interface PublishPayload {
  nodes: { path: string[]; icon?: string; color?: string }[];
  products: { code: string; description: string; unit?: string; path: string[]; eans?: string[]; stores?: { key: string; name?: string; code: string }[] }[];
  /** aba "Tipos de loja" da planilha (opcional) */
  storeTypes?: string[];
}
export interface PublishResult { version: number; nodes_added: number; nodes_removed: number; products: number; unmapped: number; codes?: number }

export const publishMaster = async (payload: PublishPayload): Promise<PublishResult> => {
  const { data, error } = await supabase.rpc('publish_master', { p: payload });
  if (error) throw new Error(rpcError(error));
  return data as PublishResult;
};

export const publishStoreTypes = async (types: string[]): Promise<void> => {
  const { error } = await supabase.rpc('publish_store_types', { p: types });
  if (error) throw new Error(rpcError(error));
};

export interface TaxSuggestion {
  id: string; user_id: string; parent_path: string[]; name: string;
  product_code: string | null; product_description: string | null; note: string | null;
  status: 'pending' | 'approved' | 'rejected'; created_at: string;
}

export const submitSuggestion = async (s: { parentPath: string[]; name: string; productCode?: string; productDescription?: string }): Promise<string> => {
  const { data, error } = await supabase.from('taxonomy_suggestions').insert({
    parent_path: s.parentPath, name: s.name.trim(),
    product_code: s.productCode?.trim() || null, product_description: s.productDescription?.trim() || null,
  }).select('id').single();
  if (error) {
    if (error.code === '23505') throw new Error('Você já sugeriu essa etiqueta; ela está esperando o administrador.');
    throw new Error(rpcError(error));
  }
  return (data as any).id as string;
};

export const fetchPendingSuggestions = async (): Promise<TaxSuggestion[]> => {
  const { data, error } = await supabase.from('taxonomy_suggestions').select('*').eq('status', 'pending').order('created_at', { ascending: true }).limit(200);
  if (error) throw new Error(rpcError(error));
  return (data || []) as TaxSuggestion[];
};

export const reviewSuggestion = async (id: string, approve: boolean, name?: string): Promise<void> => {
  const { error } = await supabase.rpc('review_suggestion', { p_id: id, p_approve: approve, p_name: name?.trim() || null });
  if (error) throw new Error(rpcError(error));
};

/** Todos os produtos da tabela mãe (com ou sem caminho), para o administrador completar na planilha. */
export const fetchAllMasterProducts = (): Promise<{ code: string; description: string; unit_type: string | null; category: string | null; node_id: string | null }[]> =>
  fetchAll('master_products', 'code,description,unit_type,category,node_id', 'code');
