import { isMealCategory } from './readyMeals';
// Tabela mãe: a estrutura de categorias e os produtos que valem para todos os usuários (Supabase).
// O administrador publica pela planilha; todo app baixa, troca a estrutura local e reclassifica os itens pelo código do produto.
import { supabase } from './supabaseClient';
import { Receipt, TaxonomyNode, TaxonomySource } from '../types';
import { slugify } from './taxonomyService';
import { standardizeTaxonomy } from './taxonomyCase';
import { layerSlug } from './categoryLayers';
import { catKey } from './textFormat';
import { applyPinChanges } from './layerPins';

export interface MasterProductRef { code: string; desc: string; nodeId: string | null; brand?: string; manufacturer?: string }
export interface MasterData {
  version: number;
  publishedAt: string | null;
  nodes: TaxonomyNode[];
  products: MasterProductRef[];
  /** códigos nativos: código de barras (todas as lojas) e código de cada loja, ligados ao produto da tabela mãe */
  codes?: MasterCodeRef[];
  /** tipos de estabelecimento (Mercado, Restaurante...), na ordem da planilha */
  storeTypes?: string[];
  /** apelido e tipo de cada loja (por CNPJ), editados na aba "Lojas" da planilha */
  stores?: MasterStore[];
}
export interface MasterStore { cnpj: string; name: string; type: string; address?: string; number?: string; neighborhood?: string; city?: string; state?: string; cep?: string; legalName?: string }
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

/** Quantas categorias a tabela mãe tem na nuvem (consulta leve): se difere da cópia do aparelho, a estrutura mudou. */
export const fetchNodeCount = async (): Promise<number | null> => {
  const { count, error } = await supabase.from('taxonomy_master').select('id', { count: 'exact', head: true });
  return error || count === null ? null : count;
};
export const fetchCodeCount = async (): Promise<number | null> => {
  const { count, error } = await supabase.from('master_product_codes').select('id', { count: 'exact', head: true });
  return error || count === null ? null : count;
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
  const [rows, prods, codeRows, typeRows, storeRows] = await Promise.all([
    fetchAll<NodeRow>('taxonomy_master', 'id,parent_id,level,name,sort,icon,color,updated_at', 'sort'),
    fetchAll<{ code: string; description: string; node_id: string | null; brand?: string; manufacturer?: string }>('master_products', 'code,description,node_id,brand,manufacturer', 'code', q => q.not('node_id', 'is', null)),
    fetchAll<any>('master_product_codes', 'kind,store_key,store_name,code,master_products(code,description,unit_type,category)', 'id').catch(() => [] as any[]),
    fetchAll<{ name: string }>('store_types', 'name,sort', 'sort').catch(() => [] as { name: string }[]),
    fetchAll<any>('master_stores', 'cnpj,name,type,address,number,neighborhood,city,state,cep,legal_name', 'cnpj').catch(() => [] as MasterStore[]),
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
  return { version, publishedAt, nodes, products: prods.map(p => ({ code: p.code, desc: p.description, nodeId: p.node_id, brand: p.brand || '', manufacturer: p.manufacturer || '' })), codes, storeTypes: typeRows.map(t => t.name), stores: storeRows.map((r: any) => ({ cnpj: r.cnpj, name: r.name || '', type: r.type || '', address: r.address || '', number: r.number || '', neighborhood: r.neighborhood || '', city: r.city || '', state: r.state || '', cep: r.cep || '', legalName: r.legal_name || '' })) };
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

/** Marca e fabricante do produto da tabela mãe que corresponde ao item (pelo código ou pelo nome igual), se a tabela souber. */
const brandCache = new WeakMap<MasterData, { byCode: Map<string, MasterProductRef>; byDesc: Map<string, MasterProductRef | null> }>();
export const brandForItem = (m: MasterData, code: string | undefined | null, description: string | undefined | null): { brand: string; manufacturer: string } | null => {
  let c = brandCache.get(m);
  if (!c) {
    c = { byCode: new Map(), byDesc: new Map() };
    m.products.forEach(p => {
      c!.byCode.set(p.code.trim(), p);
      const d = layerSlug(p.desc);
      if (d) c!.byDesc.set(d, c!.byDesc.has(d) ? null : p);
    });
    brandCache.set(m, c);
  }
  const k = String(code ?? '').trim();
  const p = (k && c.byCode.get(k)) || c.byDesc.get(layerSlug(String(description ?? ''))) || null;
  return p && p.brand ? { brand: p.brand, manufacturer: p.manufacturer || '' } : null;
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
      if (isMealCategory(it.category)) return it;   // prato de restaurante: a tabela mãe não devolve ao mercado
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
  products: { code: string; description: string; unit?: string; idType?: string; brand?: string; manufacturer?: string; path: string[]; eans?: string[]; stores?: { key: string; name?: string; code: string }[] }[];
  /** aba "Tipos de loja" da planilha (opcional) */
  storeTypes?: string[];
  /** aba "Lojas" da planilha (opcional) */
  stores?: MasterStore[];
}
export interface PublishResult { version: number; nodes_added: number; nodes_removed: number; products: number; unmapped: number; codes?: number }

const chunked = <T,>(arr: T[], size: number): T[][] => { const out: T[][] = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; };
export const callRpc = async (fn: string, args: Record<string, unknown>): Promise<any> => {
  // uma nova tentativa para falha de rede passageira; erro do servidor vale na primeira
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.rpc(fn, args);
    if (!error) return data;
    const transient = /fetch|network|failed to|timeout|timed out/i.test(error.message || '');
    if (attempt >= 1 || !transient) throw new Error(rpcError(error));
  }
};

/** Publica em pedaços pequenos (o servidor corta cada pedido em 8 s): categorias, produtos e, no fim, o fechamento que apaga o que saiu e avisa os aparelhos. */
export const publishMaster = async (payload: PublishPayload, onProgress?: (msg: string) => void, opts: { structure?: boolean } = {}): Promise<PublishResult> => {
  const withStructure = opts.structure !== false;
  const batch = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now().toString(16).padStart(8, '0')}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;
  const nodes = payload.nodes.map((n, i) => ({ ...n, ord: i + 1 })).sort((a, b) => a.path.length - b.path.length || a.ord - b.ord);
  if (withStructure && nodes.length === 0) throw new Error('A planilha não tem nenhuma categoria; nada foi publicado');
  let added = 0;
  const nodeChunks = withStructure ? chunked(nodes, 300) : [];
  for (let i = 0; i < nodeChunks.length; i++) {
    onProgress?.(`Categorias ${i + 1} de ${nodeChunks.length}…`);
    const r = await callRpc('publish_master_nodes', { p: nodeChunks[i], batch });
    added += Number(r?.added || 0);
  }
  let prods = 0, unmapped = 0, codes = 0;
  // códigos antigos já unificados (planilha velha): não recriar duplicados
  const redir = new Set((await fetchAll<{ old_code: string }>('master_code_redirects', 'old_code', 'old_code').catch(() => [] as { old_code: string }[])).map(r => r.old_code));
  const prodChunks = chunked((payload.products || []).filter((p: any) => !redir.has(p.code)), 150);
  for (let i = 0; i < prodChunks.length; i++) {
    onProgress?.(`Produtos ${i + 1} de ${prodChunks.length}…`);
    const r = await callRpc('publish_master_products', { p: prodChunks[i] });
    prods += Number(r?.products || 0); unmapped += Number(r?.unmapped || 0); codes += Number(r?.codes || 0);
  }
  onProgress?.('Concluindo…');
  // sem estrutura na publicação: só avisa os aparelhos, sem apagar nenhuma categoria
  const fin = withStructure ? await callRpc('publish_master_finish', { batch }) : await callRpc('publish_master_touch', {});
  return { version: Number(fin?.version || 0), nodes_added: added, nodes_removed: Number(fin?.nodes_removed || 0), products: prods, unmapped, codes };
};

export const publishStoreTypes = async (types: string[]): Promise<void> => { await callRpc('publish_store_types', { p: types }); };

export const publishMasterStores = async (stores: MasterStore[]): Promise<void> => { await callRpc('publish_master_stores', { p: stores }); };

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

/** Códigos antigos unificados: antigo → vigente (13 dígitos). */
export const fetchCodeRedirects = async (): Promise<Map<string, string>> => {
  const rows = await fetchAll<{ old_code: string; new_code: string }>('master_code_redirects', 'old_code,new_code', 'old_code').catch(() => [] as { old_code: string; new_code: string }[]);
  return new Map(rows.map(r => [r.old_code, r.new_code]));
};

/** Todos os produtos da tabela mãe (com ou sem caminho), para o administrador completar na planilha. */
export const fetchAllMasterProducts = (): Promise<{ code: string; description: string; unit_type: string | null; category: string | null; node_id: string | null; brand?: string; manufacturer?: string; brand_suggestion?: string; id_type?: string }[]> =>
  fetchAll('master_products', 'code,description,unit_type,category,node_id,brand,manufacturer,brand_suggestion,id_type', 'code');

/* ---- Fila de aprovação do administrador (lojas repetidas, cadastros de produto, correções) ---- */

export interface AuditFinding {
  id: number; kind: 'store_dup' | 'store_cnpj_invalid'; subject_a: string; subject_b: string | null;
  strength: 'alta' | 'media'; reason: string; details: Record<string, any>; created_at: string;
}
export interface ProductSubmission {
  id: number; user_id: string; ean: string | null; brand: string | null; name: string | null; variant: string | null;
  size_value: number | null; size_unit: string | null; packaging: string | null; units: number | null; created_at: string;
}
export interface AdminQueue { findings: AuditFinding[]; submissions: ProductSubmission[]; corrections: { id: string; suggested_description: string | null; reason: string | null; created_at: string }[] }

export const fetchAdminQueue = async (): Promise<AdminQueue> => {
  const q = await callRpc('admin_pending_queue', {});
  return { findings: q?.findings || [], submissions: q?.submissions || [], corrections: q?.corrections || [] };
};
export const reviewFinding = async (id: number, approve: boolean): Promise<void> => { await callRpc('admin_review_finding', { p_id: id, p_approve: approve }); };
/** Aprovar cadastro de produto: o usuário ganha `credits` leituras de cupom. */
export const reviewSubmission = async (id: number, approve: boolean, credits = 1): Promise<number> => {
  const r = await callRpc('admin_review_submission', { p_id: id, p_approve: approve, p_credits: credits });
  return Number(r?.credits || 0);
};
/** Saldo de leituras de cupom do usuário logado. */
export const fetchMyReadCredits = async (): Promise<number> => Number(await callRpc('my_read_credits', {})) || 0;
