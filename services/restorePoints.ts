// Pontos de restauração: cópias completas dos dados do app neste aparelho, cada uma podendo ser restaurada ou exportada.
//
// - Ficam no IndexedDB (o localStorage tem cota pequena e cada ponto é uma cópia inteira dos dados).
// - Nunca entram no backup da conta (as chaves de controle começam com "eukasconta_restore_", ver DEVICE_ONLY).
// - Tipos: manual (a pessoa criou), auto (um por dia, só se algo mudou), before (antes de uma ação arriscada ou de
//   restaurar), import (veio de um arquivo) e legacy (os "snapshots" da versão antiga).
// - A foto dos dados é tirada de forma síncrona, no instante do pedido, antes de qualquer espera: assim o ponto
//   "antes de X" guarda mesmo o estado de antes de X.
// - Restaurar troca TUDO pelo ponto (o que o ponto não tem é apagado), sempre depois de guardar o estado de agora.
import JSZip from 'jszip';
import type { SystemSnapshot } from '../types';
import { collectLocal, fingerprint, isDataKey, replaceData, safeGet } from './localData';

export type PointKind = 'manual' | 'auto' | 'before' | 'import' | 'legacy';

export interface PointMeta {
  id: string;
  createdAt: number;          // ms
  name: string;
  kind: PointKind;
  reason?: string;
  receipts: number;
  stores: number;
  products: number;
  keys: number;
  bytes: number;              // tamanho aproximado (caracteres guardados)
  fp: string;                 // impressão digital dos dados: dois pontos iguais têm a mesma
  partial?: boolean;          // ponto antigo, que só guardava parte dos dados: restaurar sobrepõe e não apaga o resto
}

export const POINTS_EVENT = 'eukasconta:restore-points';
export const AUTO_FLAG_KEY = 'eukasconta_restore_auto';
const MIGRATED_KEY = 'eukasconta_restore_migrated';
const RESTORED_FLAG = 'eukasconta_backup_restored';   // o mesmo aviso que o backup da conta usa: não trazer a conta por cima

export const FILE_FORMAT = 'eukasconta-restore-point';
export const KEEP_AUTO = 7;
export const KEEP_BEFORE = 8;

/* ───────────────────────── funções puras ───────────────────────── */

const jsonArrayLength = (raw: string | undefined): number => {
  if (!raw) return 0;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.length : 0; } catch { return 0; }
};

const pad = (n: number) => String(n).padStart(2, '0');

export const defaultName = (kind: PointKind, createdAt: number, reason?: string): string => {
  const d = new Date(createdAt);
  const when = `${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (kind === 'auto') return 'Automático do dia';
  if (kind === 'before') return reason ? `Antes de ${reason}` : `Antes de uma ação (${when})`;
  if (kind === 'import') return `Importado (${when})`;
  return `Ponto de ${when}`;
};

export const buildMeta = (
  data: Record<string, string>,
  o: { id: string; kind: PointKind; createdAt: number; name?: string; reason?: string; partial?: boolean },
): PointMeta => {
  let bytes = 0;
  Object.entries(data).forEach(([k, v]) => { bytes += k.length + v.length; });
  const name = (o.name || '').trim().slice(0, 80) || defaultName(o.kind, o.createdAt, o.reason);
  return {
    id: o.id, createdAt: o.createdAt, name, kind: o.kind,
    ...(o.reason ? { reason: o.reason } : {}),
    receipts: jsonArrayLength(data['eukasconta_data']),
    stores: jsonArrayLength(data['eukasconta_establishments']),
    products: jsonArrayLength(data['eukasconta_master_products']),
    keys: Object.keys(data).length,
    bytes,
    fp: fingerprint({ data, secrets: {} }),
    ...(o.partial ? { partial: true } : {}),
  };
};

/** Quais pontos apagar para respeitar os limites: só os automáticos e os "antes de", os mais antigos primeiro. */
export const pickPrune = (list: PointMeta[]): string[] => {
  const drop: string[] = [];
  const trim = (kind: PointKind, keep: number) => {
    list.filter(p => p.kind === kind).sort((a, b) => b.createdAt - a.createdAt).slice(keep).forEach(p => drop.push(p.id));
  };
  trim('auto', KEEP_AUTO);
  trim('before', KEEP_BEFORE);
  return drop;
};

export const fmtSize = (chars: number): string => {
  if (chars >= 1_000_000) return `${(chars / 1_000_000).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(chars / 1000))} KB`;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const pointSummary = (m: Pick<PointMeta, 'receipts' | 'stores' | 'products'>): string =>
  [plural(m.receipts, 'cupom', 'cupons'), plural(m.stores, 'loja', 'lojas'), plural(m.products, 'produto', 'produtos')].join(' · ');

export const KIND_LABEL: Record<PointKind, string> = {
  manual: 'Criado por você',
  auto: 'Automático',
  before: 'Antes de uma ação',
  import: 'Importado de arquivo',
  legacy: 'Da versão antiga',
};

/** Ponto antigo (snapshot) vira ponto novo. Os antigos só guardavam parte dos dados, por isso `partial`. */
export const legacyToPoint = (snap: Partial<SystemSnapshot> | null | undefined):
  { id: string; name: string; createdAt: number; data: Record<string, string> } | null => {
  if (!snap || typeof snap !== 'object' || !snap.data || typeof snap.data !== 'object') return null;
  const d: any = snap.data;
  const data: Record<string, string> = {};
  const put = (key: string, value: unknown) => { if (value !== undefined && value !== null) data[key] = JSON.stringify(value); };
  put('eukasconta_data', Array.isArray(d.receipts) ? d.receipts : []);
  put('eukasconta_taxonomy', d.taxonomy);
  put('eukasconta_ai_learning', d.aiLearning);
  put('eukasconta_category_meta', d.categoryMeta);
  put('eukasconta_category_goals', d.categoryGoals);
  put('eukasconta_establishments', d.establishments);
  put('eukasconta_master_products', d.masterProducts);
  const createdAt = Number(snap.timestamp) > 0 ? Number(snap.timestamp) : Date.now();
  return { id: `legacy-${String(snap.id || createdAt)}`, name: String(snap.name || 'Ponto antigo').slice(0, 80), createdAt, data };
};

/* ───────────────────────── arquivo de ponto ───────────────────────── */

export type ParsedPoint =
  | { ok: true; name: string; createdAt: number; reason?: string; partial: boolean; data: Record<string, string> }
  | { ok: false; error: string };

const MUST_BE_ARRAYS = ['eukasconta_data', 'eukasconta_establishments', 'eukasconta_master_products', 'eukasconta_taxonomy'];

export const parsePointFile = (text: string): ParsedPoint => {
  let v: any;
  try { v = JSON.parse(text); } catch { return { ok: false, error: 'O arquivo não é um ponto de restauração válido.' }; }
  if (!v || typeof v !== 'object' || v.format !== FILE_FORMAT) return { ok: false, error: 'Este arquivo não é um ponto de restauração do Eu Kasconta.' };
  if (!v.data || typeof v.data !== 'object') return { ok: false, error: 'O ponto não tem dados dentro.' };
  const data: Record<string, string> = {};
  Object.entries(v.data as Record<string, unknown>).forEach(([k, val]) => { if (typeof val === 'string' && isDataKey(k)) data[k] = val; });
  if (!Object.keys(data).length) return { ok: false, error: 'O ponto está vazio.' };
  for (const k of MUST_BE_ARRAYS) {
    if (data[k] === undefined) continue;
    let ok = false;
    try { ok = Array.isArray(JSON.parse(data[k])); } catch { ok = false; }
    if (!ok) return { ok: false, error: 'Os dados deste ponto estão danificados; ele não foi importado.' };
  }
  const p = v.point || {};
  const createdAt = Number(p.createdAt) > 0 ? Number(p.createdAt) : Date.now();
  return {
    ok: true,
    name: String(p.name || '').trim().slice(0, 80) || defaultName('import', createdAt),
    createdAt,
    ...(p.reason ? { reason: String(p.reason).slice(0, 120) } : {}),
    partial: Boolean(p.partial),
    data,
  };
};

export const pointFileName = (createdAt: number): string => {
  const d = new Date(createdAt);
  return `Eukasconta_Ponto_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
};

export const buildPointFile = async (meta: PointMeta, data: Record<string, string>): Promise<Blob> => {
  const payload = {
    format: FILE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    point: {
      name: meta.name, createdAt: meta.createdAt, kind: meta.kind, reason: meta.reason,
      receipts: meta.receipts, stores: meta.stores, products: meta.products, partial: meta.partial || false,
    },
    data,
  };
  const Zip = (JSZip as any).default || JSZip;
  const zip = new Zip();
  zip.file('restore_point.json', JSON.stringify(payload));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
};

/** Lê o texto do ponto de dentro de um arquivo (zip ou json). null = o arquivo não é um ponto de restauração. */
export const readPointText = async (file: Blob): Promise<string | null> => {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b;
  if (isZip) {
    const Zip = (JSZip as any).default || JSZip;
    let zip: any;
    try { zip = await Zip.loadAsync(await file.arrayBuffer()); } catch { return null; }
    const entry = zip.file('restore_point.json');
    return entry ? await entry.async('string') : null;
  }
  const text = await file.text();
  return text.includes(`"${FILE_FORMAT}"`) ? text : null;
};

/* ───────────────────────── IndexedDB ───────────────────────── */

const DB_NAME = 'eukasconta-restore';
const META = 'meta';
const DATA = 'data';

let dbPromise: Promise<IDBDatabase> | null = null;
const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Este aparelho não deixa o app guardar pontos de restauração.')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Não consegui abrir o armazenamento dos pontos.'));
    req.onblocked = () => reject(new Error('O armazenamento dos pontos está bloqueado por outra janela do app.'));
  }).catch(e => { dbPromise = null; throw e; });
  return dbPromise;
};

const reqP = <T>(r: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const txDone = (t: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  t.oncomplete = () => resolve();
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error || new Error('A gravação do ponto foi cancelada (falta de espaço?).'));
});

const emit = () => { try { window.dispatchEvent(new Event(POINTS_EVENT)); } catch { /* sem janela (testes) */ } };

/** Dá para guardar pontos neste aparelho? */
export const pointsSupported = async (): Promise<boolean> => { try { await openDb(); return true; } catch { return false; } };

export const listPoints = async (): Promise<PointMeta[]> => {
  const db = await openDb();
  const all = await reqP(db.transaction(META, 'readonly').objectStore(META).getAll()) as PointMeta[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
};

export const getPointData = async (id: string): Promise<Record<string, string> | null> => {
  const db = await openDb();
  const rec = await reqP(db.transaction(DATA, 'readonly').objectStore(DATA).get(id)) as { id: string; data: Record<string, string> } | undefined;
  return rec ? rec.data : null;
};

const removeIds = async (ids: string[]): Promise<void> => {
  if (!ids.length) return;
  const db = await openDb();
  const t = db.transaction([META, DATA], 'readwrite');
  ids.forEach(id => { t.objectStore(META).delete(id); t.objectStore(DATA).delete(id); });
  await txDone(t);
};

export const deletePoint = async (id: string): Promise<void> => { await removeIds([id]); emit(); };

export interface CreateOptions {
  kind: PointKind;
  name?: string;
  reason?: string;
  /** Não cria se o estado é igual ao do ponto mais recente (já está guardado), ou se não há nada a proteger. */
  skipIfSame?: boolean;
  /** Dados já em mãos (importação, migração); sem isto tira a foto do que está no aparelho agora. */
  data?: Record<string, string>;
  createdAt?: number;
  id?: string;
  partial?: boolean;
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const createPoint = async (o: CreateOptions): Promise<PointMeta | null> => {
  // a foto é tirada já, antes de qualquer espera
  const data = o.data ?? collectLocal().data;
  const meta = buildMeta(data, { id: o.id || newId(), kind: o.kind, createdAt: o.createdAt ?? Date.now(), name: o.name, reason: o.reason, partial: o.partial });
  if (o.skipIfSame && meta.receipts === 0 && meta.stores === 0 && meta.products === 0) return null;
  const db = await openDb();
  if (o.skipIfSame) {
    const latest = (await listPoints())[0];
    if (latest && latest.fp === meta.fp) return null;
  }
  const t = db.transaction([META, DATA], 'readwrite');
  t.objectStore(DATA).put({ id: meta.id, data });
  t.objectStore(META).put(meta);
  await txDone(t);
  try { await removeIds(pickPrune(await listPoints())); } catch { /* poda é só limpeza */ }
  emit();
  return meta;
};

/** Ponto de segurança antes de uma ação arriscada. Nunca falha para quem chama: sem ponto, a ação segue. */
export const safetyPoint = (reason: string): Promise<PointMeta | null> =>
  createPoint({ kind: 'before', reason, skipIfSame: true }).catch(() => null);

/* ───────────────────────── automático (um por dia) ───────────────────────── */

export const autoEnabled = (): boolean => safeGet(AUTO_FLAG_KEY) !== '0';
export const setAutoEnabled = (v: boolean): void => { try { localStorage.setItem(AUTO_FLAG_KEY, v ? '1' : '0'); } catch { /* ignora */ } };

const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

export const ensureDailyPoint = async (): Promise<PointMeta | null> => {
  if (!autoEnabled()) return null;
  const list = await listPoints();
  const today = dayKey(Date.now());
  if (list.some(p => p.kind === 'auto' && dayKey(p.createdAt) === today)) return null;
  return createPoint({ kind: 'auto', skipIfSame: true });
};

/* ───────────────────────── restaurar, exportar, importar ───────────────────────── */

export type RestoreResult =
  | { ok: true; safety: PointMeta | null; written: number; removed: number }
  | { ok: false; error: string };

export const restorePoint = async (id: string): Promise<RestoreResult> => {
  try {
    const meta = (await listPoints()).find(p => p.id === id);
    if (!meta) return { ok: false, error: 'Esse ponto não existe mais.' };
    const data = await getPointData(id);
    if (!data) return { ok: false, error: 'Os dados deste ponto não foram encontrados.' };
    // antes de trocar, guarda o estado de agora: assim dá para desfazer a restauração
    let safety: PointMeta | null = null;
    try {
      // se o ponto restaurado já é um "Antes de restaurar «X»", usa só o X (senão o nome vai aninhando a cada desfazer)
      const base = meta.name.replace(/^Antes de restaurar «(.*)»$/, '$1');
      safety = await createPoint({ kind: 'before', reason: `restaurar «${base}»`, name: `Antes de restaurar «${base}»`, skipIfSame: true });
    } catch {
      return { ok: false, error: 'Não consegui guardar o estado de agora antes de restaurar. Nada foi mudado.' };
    }
    const r = replaceData(data, Boolean(meta.partial));
    if (!r.ok) return { ok: false, error: r.error || 'Não deu para gravar os dados deste ponto. Nada foi mudado.' };
    // a conta não deve trazer o backup dela por cima, mesmo se o ponto tem zero cupons
    try { sessionStorage.setItem(RESTORED_FLAG, '1'); } catch { /* ignora */ }
    emit();
    return { ok: true, safety, written: r.written, removed: r.removed };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
};

export const exportPoint = async (id: string): Promise<{ blob: Blob; fileName: string; meta: PointMeta } | { error: string }> => {
  try {
    const meta = (await listPoints()).find(p => p.id === id);
    const data = await getPointData(id);
    if (!meta || !data) return { error: 'Esse ponto não existe mais.' };
    return { blob: await buildPointFile(meta, data), fileName: pointFileName(meta.createdAt), meta };
  } catch (e: any) {
    return { error: String(e?.message || e) };
  }
};

export type ImportResult =
  | { ok: true; meta: PointMeta; duplicate: boolean }
  | { ok: false; error: string };

export const importPointText = async (text: string): Promise<ImportResult> => {
  const p = parsePointFile(text);
  if ('error' in p) return { ok: false, error: p.error };
  try {
    const meta = buildMeta(p.data, { id: 'x', kind: 'import', createdAt: p.createdAt });
    const same = (await listPoints()).find(x => x.fp === meta.fp);
    if (same) return { ok: true, meta: same, duplicate: true };
    const made = await createPoint({ kind: 'import', name: p.name, reason: p.reason, data: p.data, createdAt: p.createdAt, partial: p.partial });
    return made ? { ok: true, meta: made, duplicate: false } : { ok: false, error: 'Não consegui guardar o ponto importado.' };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
};

export const importPointFile = async (file: Blob): Promise<ImportResult> => {
  const text = await readPointText(file);
  if (text === null) return { ok: false, error: 'Este arquivo não é um ponto de restauração do Eu Kasconta.' };
  return importPointText(text);
};

/* ───────────────────────── migração dos pontos antigos ───────────────────────── */

/** Passa os "snapshots" da versão antiga (que ocupavam o localStorage) para os pontos novos. Devolve quantos passaram. */
export const migrateLegacySnapshots = async (): Promise<number> => {
  if (safeGet(MIGRATED_KEY) === '1') return 0;
  const raw = safeGet('eukasconta_snapshots');
  const done = () => { try { localStorage.setItem(MIGRATED_KEY, '1'); } catch { /* ignora */ } };
  if (!raw) { done(); return 0; }
  let list: unknown;
  try { list = JSON.parse(raw); } catch { return 0; }   // ilegível: deixa como está, nada é apagado
  if (!Array.isArray(list) || list.length === 0) { try { localStorage.removeItem('eukasconta_snapshots'); } catch { /* ignora */ } done(); return 0; }
  const have = new Set((await listPoints()).map(p => p.id));
  let moved = 0, failed = 0;
  for (const snap of list as Partial<SystemSnapshot>[]) {
    const p = legacyToPoint(snap);
    if (!p) { failed++; continue; }
    if (have.has(p.id)) { moved++; continue; }
    try {
      await createPoint({ kind: 'legacy', id: p.id, name: p.name, data: p.data, createdAt: p.createdAt, partial: true });
      moved++;
    } catch { failed++; }
  }
  if (failed === 0) {
    try { localStorage.removeItem('eukasconta_snapshots'); } catch { /* ignora */ }
    done();
  }
  return moved;
};
