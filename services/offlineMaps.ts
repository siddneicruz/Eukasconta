// Mapa salvo no aparelho (para usar sem internet e sem baixar tudo de novo a cada abertura).
//
// Por que não baixar as imagens do OpenStreetMap: o servidor de imagens deles (tile.openstreetmap.org) proíbe
// expressamente "baixar para uso offline" e pré-carregar regiões. Os DADOS do OpenStreetMap, porém, são livres
// (licença ODbL, com atribuição). Então usamos um mapa vetorial feito a partir desses dados (Protomaps, em arquivos
// .pmtiles) e hospedado pelo próprio projeto, em "células" de 1° x 1° (~110 km), cada uma num arquivo só.
//
//   catálogo  = manifest.json (quais células existem, tamanho, data)
//   download  = a pessoa baixa só as células que cobrem as suas lojas; cada uma vira um arquivo guardado no
//               IndexedDB do aparelho (não entra no backup da conta)
//   leitura   = o mapa lê direto desses arquivos, sem rede
import { PMTiles, FileSource } from 'pmtiles';

export type Bbox = [number, number, number, number]; // oeste, sul, leste, norte

export interface MapCell { id: string; file: string; bbox: Bbox; bytes: number }
export interface MapManifest { version: number; built: string; maxzoom: number; cells: MapCell[] }
export interface SavedCell { id: string; bbox: Bbox; bytes: number; built: string; maxzoom: number; savedAt: number; file: File }

const DEFAULT_BASE = 'https://raw.githubusercontent.com/siddneicruz/Eukasconta/mapas';
const KEY_BASE = 'eukasconta_maps_base';           // só para testes: aponta para outro servidor
const KEY_MANIFEST = 'eukasconta_maps_manifest';    // última lista de células vista (para a tela abrir sem internet)
const KEY_SOURCE = 'eukasconta_maps_source';        // 'auto' (padrão: online com internet, salvo sem) | 'saved' | 'online'

const ls = {
  get: (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem espaço: ignora */ } },
};

export const mapsBase = (): string => (ls.get(KEY_BASE) || DEFAULT_BASE).replace(/\/+$/, '');

export type MapSource = 'auto' | 'saved' | 'online';
export const getMapSource = (): MapSource => { const v = ls.get(KEY_SOURCE); return v === 'saved' || v === 'online' ? v : 'auto'; };
export const setMapSource = (v: MapSource) => ls.set(KEY_SOURCE, v);

/* ───────────── catálogo ───────────── */

const validManifest = (m: any): m is MapManifest =>
  m && typeof m === 'object' && Array.isArray(m.cells) &&
  m.cells.every((c: any) => c && typeof c.id === 'string' && typeof c.file === 'string' && Array.isArray(c.bbox) && c.bbox.length === 4 && Number(c.bytes) > 0);

export const cachedManifest = (): MapManifest | null => {
  const raw = ls.get(KEY_MANIFEST);
  if (!raw) return null;
  try { const m = JSON.parse(raw); return validManifest(m) ? m : null; } catch { return null; }
};

/** Lista de células disponíveis. Sem internet, devolve a última que foi vista (ou lança erro se nunca viu). */
export const fetchManifest = async (signal?: AbortSignal): Promise<MapManifest> => {
  try {
    const res = await fetch(`${mapsBase()}/manifest.json`, { signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`catálogo indisponível (${res.status})`);
    const m = await res.json();
    if (!validManifest(m)) throw new Error('catálogo inválido');
    ls.set(KEY_MANIFEST, JSON.stringify(m));
    return m;
  } catch (e) {
    const old = cachedManifest();
    if (old && !(e instanceof DOMException && e.name === 'AbortError')) return old;
    throw e;
  }
};

const intersects = (a: Bbox, b: Bbox) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** Células do catálogo que cobrem os pontos [lat, lng] (com uma folga em volta de cada ponto, em graus). */
export const cellsForPoints = (manifest: MapManifest, points: [number, number][], marginDeg = 0.08): MapCell[] => {
  const hit = new Map<string, MapCell>();
  points.forEach(([lat, lng]) => {
    const box: Bbox = [lng - marginDeg, lat - marginDeg, lng + marginDeg, lat + marginDeg];
    manifest.cells.forEach(c => { if (intersects(c.bbox, box)) hit.set(c.id, c); });
  });
  return Array.from(hit.values());
};

/* ───────────── armazenamento (IndexedDB) ───────────── */

const DB_NAME = 'eukasconta-maps';
const STORE = 'cells';

const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') { reject(new Error('Este aparelho não permite guardar o mapa.')); return; }
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error || new Error('Não consegui abrir o armazenamento do mapa.'));
});

const tx = async <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(r.result);
      t.onerror = () => reject(t.error || r.error);
      t.onabort = () => reject(t.error || r.error || new Error('gravação cancelada'));
    });
  } finally { db.close(); }
};

export const listSaved = async (): Promise<SavedCell[]> => {
  try { return ((await tx('readonly', s => s.getAll())) as SavedCell[]).filter(c => c && c.file); }
  catch { return []; }
};

export const deleteSaved = async (ids?: string[]): Promise<void> => {
  if (!ids) { await tx('readwrite', s => s.clear()); return; }
  for (const id of ids) await tx('readwrite', s => s.delete(id));
};

const putSaved = (c: SavedCell) => tx('readwrite', s => s.put(c));

export const askPersistentStorage = async (): Promise<void> => {
  try { await navigator.storage?.persist?.(); } catch { /* sem efeito: tudo bem */ }
};

/* ───────────── download ───────────── */

export interface DownloadProgress {
  /** bytes já baixados de todas as células desta rodada */
  done: number;
  total: number;
  /** célula em andamento (1..n) */
  index: number;
  count: number;
}

const CHUNK = 4 * 1024 * 1024;

const readHeaderOk = async (file: File): Promise<boolean> => {
  try { return (await file.slice(0, 7).text()) === 'PMTiles'; } catch { return false; }
};

/** Baixa uma célula, em pedaços de 4 MB que vão direto para o armazenamento do navegador (nada fica na memória do app). */
const downloadCell = async (
  cell: MapCell, built: string, maxzoom: number, base: string, signal: AbortSignal, onBytes: (n: number) => void
): Promise<SavedCell> => {
  const res = await fetch(`${base}/${cell.file}`, { signal });
  if (!res.ok || !res.body) throw new Error(`o servidor do mapa respondeu ${res.status}`);
  const reader = res.body.getReader();
  const parts: Blob[] = [];
  let buf = new Uint8Array(CHUNK), used = 0, got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let off = 0;
    while (off < value.length) {
      const n = Math.min(CHUNK - used, value.length - off);
      buf.set(value.subarray(off, off + n), used);
      used += n; off += n;
      if (used === CHUNK) { parts.push(new Blob([buf])); buf = new Uint8Array(CHUNK); used = 0; }
    }
    got += value.length;
    onBytes(value.length);
  }
  if (used) parts.push(new Blob([buf.subarray(0, used)]));
  if (got !== cell.bytes) throw new Error(`arquivo incompleto (${got} de ${cell.bytes} bytes)`);
  const file = new File(parts, `${cell.id}.pmtiles`, { type: 'application/octet-stream' });
  if (!(await readHeaderOk(file))) throw new Error('arquivo de mapa inválido');
  return { id: cell.id, bbox: cell.bbox, bytes: cell.bytes, built, maxzoom, savedAt: Date.now(), file };
};

/** Baixa e guarda as células pedidas, uma por vez. Cada uma que termina já fica salva. */
export const downloadCells = async (
  manifest: MapManifest, cells: MapCell[], onProgress: (p: DownloadProgress) => void, signal: AbortSignal
): Promise<SavedCell[]> => {
  await askPersistentStorage();
  const base = mapsBase();
  const total = cells.reduce((a, c) => a + c.bytes, 0);
  let done = 0;
  const saved: SavedCell[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const startDone = done;
    const s = await downloadCell(c, manifest.built, manifest.maxzoom, base, signal, n => {
      done += n;
      onProgress({ done: Math.min(done, total), total, index: i + 1, count: cells.length });
    });
    done = startDone + c.bytes;
    try { await putSaved(s); }
    catch (e: any) {
      throw new Error(e?.name === 'QuotaExceededError' ? 'Sem espaço no celular para guardar o mapa.' : (e?.message || 'Não consegui guardar o mapa.'));
    }
    saved.push(s);
    onProgress({ done, total, index: i + 1, count: cells.length });
  }
  return saved;
};

/* ───────────── leitura ───────────── */

// O que a camada do mapa precisa: só o getZxy. Junta as células salvas como se fossem um arquivo só.
export interface TileArchive {
  getZxy: (z: number, x: number, y: number, signal?: AbortSignal) => Promise<{ data: ArrayBuffer } | undefined>;
}

const tileBbox = (z: number, x: number, y: number): Bbox => {
  const n = 2 ** z;
  const lon = (xx: number) => (xx / n) * 360 - 180;
  const lat = (yy: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
};

export interface OpenedMaps {
  archive: TileArchive;
  maxzoom: number;
  bounds: Bbox;
  /** o ponto [lat, lng] está dentro de alguma célula salva? */
  covers: (lat: number, lng: number) => boolean;
}

export const openSaved = (saved: SavedCell[]): OpenedMaps | null => {
  if (saved.length === 0) return null;
  const items = saved.map(s => ({ bbox: s.bbox, pm: new PMTiles(new FileSource(s.file)) }));
  const archive: TileArchive = {
    async getZxy(z, x, y, signal) {
      const tb = tileBbox(z, x, y);
      for (const it of items) {
        if (!intersects(it.bbox, tb)) continue;
        const r = await it.pm.getZxy(z, x, y, signal);
        if (r) return r;
      }
      return undefined;
    },
  };
  const bounds: Bbox = [
    Math.min(...saved.map(s => s.bbox[0])), Math.min(...saved.map(s => s.bbox[1])),
    Math.max(...saved.map(s => s.bbox[2])), Math.max(...saved.map(s => s.bbox[3])),
  ];
  return {
    archive,
    maxzoom: Math.max(...saved.map(s => s.maxzoom || 14)),
    bounds,
    covers: (lat, lng) => saved.some(s => lng >= s.bbox[0] && lng <= s.bbox[2] && lat >= s.bbox[1] && lat <= s.bbox[3]),
  };
};

export const formatMB = (bytes: number): string => {
  const mb = bytes / 1e6;
  return mb < 10 ? `${mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.round(mb).toLocaleString('pt-BR')} MB`;
};
