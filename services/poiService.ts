// Lojas e outros lugares que o próprio mapa conhece (supermercado, padaria, farmácia, posto...).
//
// De onde vêm:
//   • sem internet: da camada "pois" dos arquivos de mapa salvos no aparelho (Protomaps, dados do OpenStreetMap);
//   • com internet: da API Overpass (também OpenStreetMap), que traz o cadastro mais novo; se ela falhar, vale o arquivo salvo.
//
// Para que serve: o endereço do cupom vira um ponto aproximado (às vezes 100-200 m fora), mas o mapa sabe onde o mercado
// de verdade está. Com isso dá para sugerir "mover o pino para a loja do mapa", mostrar as lojas no mapa e ligar uma delas a
// uma das lojas da pessoa.
import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
import type { TileArchive } from './offlineMaps';
import { plainText } from './brGeo';

export type PoiGroup = 'mercado' | 'saude' | 'posto' | 'comer' | 'outras';

export interface Poi {
  id: string;
  name: string;
  /** tipo no OpenStreetMap: supermarket, bakery, pharmacy, fuel... */
  kind: string;
  lat: number;
  lng: number;
  origin: 'salvo' | 'online';
  /** rua e número, quando o cadastro online tem */
  address?: string;
}

/** Tipos que viram "loja" para a pessoa, com o nome em português e o grupo (cor/ícone). */
export const POI_KINDS: Record<string, { label: string; group: PoiGroup }> = {
  supermarket: { label: 'Supermercado', group: 'mercado' },
  convenience: { label: 'Conveniência', group: 'mercado' },
  grocery: { label: 'Mercearia', group: 'mercado' },
  bakery: { label: 'Padaria', group: 'mercado' },
  butcher: { label: 'Açougue', group: 'mercado' },
  greengrocer: { label: 'Hortifruti', group: 'mercado' },
  marketplace: { label: 'Feira / mercado público', group: 'mercado' },
  alcohol: { label: 'Bebidas', group: 'mercado' },
  beverages: { label: 'Bebidas', group: 'mercado' },
  deli: { label: 'Frios e delicatessen', group: 'mercado' },
  retail: { label: 'Atacado / varejo', group: 'mercado' },
  wholesale: { label: 'Atacado', group: 'mercado' },
  department_store: { label: 'Loja de departamentos', group: 'mercado' },
  variety_store: { label: 'Loja de variedades', group: 'mercado' },
  mall: { label: 'Shopping', group: 'mercado' },
  pharmacy: { label: 'Farmácia', group: 'saude' },
  chemist: { label: 'Farmácia / perfumaria', group: 'saude' },
  fuel: { label: 'Posto de combustível', group: 'posto' },
  restaurant: { label: 'Restaurante', group: 'comer' },
  fast_food: { label: 'Lanchonete', group: 'comer' },
  cafe: { label: 'Café', group: 'comer' },
  bar: { label: 'Bar', group: 'comer' },
  pub: { label: 'Bar', group: 'comer' },
  ice_cream: { label: 'Sorveteria', group: 'comer' },
  hardware: { label: 'Material de construção', group: 'outras' },
  furniture: { label: 'Móveis', group: 'outras' },
  clothes: { label: 'Roupas', group: 'outras' },
  shoes: { label: 'Calçados', group: 'outras' },
  electronics: { label: 'Eletrônicos', group: 'outras' },
  car_parts: { label: 'Peças de carro', group: 'outras' },
  tyres: { label: 'Pneus', group: 'outras' },
};

export const isShopKind = (kind: string) => Object.prototype.hasOwnProperty.call(POI_KINDS, kind);
export const kindLabel = (kind: string) => POI_KINDS[kind]?.label || 'Estabelecimento';
export const kindGroup = (kind: string): PoiGroup => POI_KINDS[kind]?.group || 'outras';

/* ───────────── geometria ───────────── */

export type Bbox = [number, number, number, number]; // oeste, sul, leste, norte

export const distanceM = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Caixa de `radiusM` metros ao redor de um ponto. */
export const boxAround = (lat: number, lng: number, radiusM: number): Bbox => {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
};

const tileOf = (lat: number, lng: number, z: number): [number, number] => {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const s = Math.sin((lat * Math.PI) / 180);
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
};

/* ───────────── arquivo de mapa salvo ───────────── */

const tileCache = new Map<string, Poi[]>();
const TILE_CACHE_MAX = 200;
const MAX_TILES_PER_CALL = 16;

export const decodePoiTile = (data: ArrayBuffer, z: number, x: number, y: number): Poi[] => {
  const out: Poi[] = [];
  let layer;
  try { layer = new VectorTile(new Protobuf(new Uint8Array(data))).layers.pois; } catch { return out; }
  if (!layer) return out;
  const n = 2 ** z;
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const kind = String(f.properties.kind || '');
    if (!isShopKind(kind) || f.type !== 1) continue;
    const g = f.loadGeometry()[0]?.[0];
    if (!g) continue;
    const px = x + g.x / layer.extent, py = y + g.y / layer.extent;
    const lng = (px / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / n))) * 180) / Math.PI;
    const name = String(f.properties.name || '').trim();
    out.push({ id: `t:${z}/${x}/${y}/${i}`, name: name || kindLabel(kind), kind, lat, lng, origin: 'salvo' });
  }
  return out;
};

/** Lugares do arquivo salvo dentro da caixa. Lê só os blocos do mapa que a caixa toca (poucos). */
export const poisFromArchive = async (archive: TileArchive, bbox: Bbox, zoom: number, signal?: AbortSignal): Promise<Poi[]> => {
  const [x0, y1] = tileOf(bbox[1], bbox[0], zoom);
  const [x1, y0] = tileOf(bbox[3], bbox[2], zoom);
  const tiles: [number, number][] = [];
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) tiles.push([x, y]);
  if (tiles.length > MAX_TILES_PER_CALL) return [];
  const all: Poi[] = [];
  for (const [x, y] of tiles) {
    const key = `${zoom}/${x}/${y}`;
    let list = tileCache.get(key);
    if (!list) {
      try {
        const r = await archive.getZxy(zoom, x, y, signal);
        list = r ? decodePoiTile(r.data, zoom, x, y) : [];
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
        list = [];
      }
      if (tileCache.size >= TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value as string);
      tileCache.set(key, list);
    }
    all.push(...list);
  }
  return dedupe(all.filter(p => p.lng >= bbox[0] && p.lng <= bbox[2] && p.lat >= bbox[1] && p.lat <= bbox[3]));
};

/** O mesmo lugar aparece em dois blocos vizinhos do mapa (a borda se repete): fica um só. */
export const dedupe = (list: Poi[]): Poi[] => {
  const seen = new Set<string>();
  return list.filter(p => {
    const k = `${p.kind}|${plainText(p.name)}|${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/* ───────────── Overpass (com internet) ───────────── */

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const SHOPS = 'supermarket|convenience|grocery|bakery|butcher|greengrocer|alcohol|beverages|deli|wholesale|department_store|variety_store|mall|chemist|hardware|furniture|clothes|shoes|electronics|car_parts|tyres';
const AMENITIES = 'pharmacy|fuel|marketplace|restaurant|fast_food|cafe|bar|pub|ice_cream';

export const overpassQuery = (bbox: Bbox): string => {
  const b = `${bbox[1].toFixed(5)},${bbox[0].toFixed(5)},${bbox[3].toFixed(5)},${bbox[2].toFixed(5)}`;
  return `[out:json][timeout:20];(nwr["shop"~"^(${SHOPS})$"](${b});nwr["amenity"~"^(${AMENITIES})$"](${b}););out center tags 400;`;
};

export const poiFromOverpassElement = (el: any): Poi | null => {
  const tags = el?.tags || {};
  const lat = Number(el?.lat ?? el?.center?.lat), lng = Number(el?.lon ?? el?.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const kind = String(tags.shop || tags.amenity || '');
  if (!isShopKind(kind)) return null;
  const name = String(tags.name || tags.brand || tags.operator || '').trim();
  const street = String(tags['addr:street'] || '').trim(), num = String(tags['addr:housenumber'] || '').trim();
  const address = street ? [street, num].filter(Boolean).join(', ') : undefined;
  return { id: `o:${el.type || 'n'}${el.id}`, name: name || kindLabel(kind), kind, lat, lng, origin: 'online', address };
};

const onlineCache = new Map<string, { at: number; list: Poi[] }>();
const ONLINE_TTL_MS = 10 * 60 * 1000;
const snap = (v: number) => (Math.round(v * 200) / 200).toFixed(3); // grade de ~550 m: movimentos pequenos reaproveitam a resposta

export const poisFromOverpass = async (bbox: Bbox, signal?: AbortSignal): Promise<Poi[]> => {
  // pede uma caixa um pouco maior e alinhada à grade, para o cache servir também quando a pessoa arrasta o mapa um pouco
  const grid: Bbox = [Math.floor(bbox[0] * 200) / 200, Math.floor(bbox[1] * 200) / 200, Math.ceil(bbox[2] * 200) / 200, Math.ceil(bbox[3] * 200) / 200];
  const key = grid.map(snap).join(',');
  const hit = onlineCache.get(key);
  if (hit && Date.now() - hit.at < ONLINE_TTL_MS) return hit.list.filter(p => inside(p, bbox));
  let lastError: unknown = null;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: 'data=' + encodeURIComponent(overpassQuery(grid)),
      });
      if (!res.ok) throw new Error(`overpass ${res.status}`);
      const json = await res.json();
      const list = dedupe((Array.isArray(json?.elements) ? json.elements : []).map(poiFromOverpassElement).filter(Boolean) as Poi[]);
      onlineCache.set(key, { at: Date.now(), list });
      return list.filter(p => inside(p, bbox));
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('lojas do mapa indisponíveis');
};

const inside = (p: Poi, b: Bbox) => p.lng >= b[0] && p.lng <= b[2] && p.lat >= b[1] && p.lat <= b[3];

/** Com internet vale o cadastro online; se falhar (ou sem internet), o arquivo salvo, se houver. */
export const loadPois = async (
  bbox: Bbox,
  opts: { archive?: TileArchive | null; archiveZoom?: number; online?: boolean; signal?: AbortSignal },
): Promise<{ pois: Poi[]; origin: 'salvo' | 'online' | 'nenhum' }> => {
  const online = opts.online ?? (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  if (online) {
    try { return { pois: await poisFromOverpass(bbox, opts.signal), origin: 'online' }; }
    catch (e: any) { if (e?.name === 'AbortError') throw e; }
  }
  if (opts.archive) return { pois: await poisFromArchive(opts.archive, bbox, opts.archiveZoom || 14, opts.signal), origin: 'salvo' };
  return { pois: [], origin: 'nenhum' };
};

/* ───────────── ligar o lugar do mapa à loja da pessoa ───────────── */

// palavras que não distinguem uma loja da outra
const GENERIC = new Set([
  'ltda', 'sa', 'eireli', 'epp', 'me', 'mei', 'cia', 'comercio', 'comercial', 'industria', 'industrial', 'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em',
  'supermercado', 'supermercados', 'super', 'mercado', 'mercados', 'mercearia', 'atacado', 'atacadista', 'varejo', 'loja', 'lojas', 'distribuidora',
  'filial', 'matriz', 'padaria', 'panificadora', 'farmacia', 'drogaria', 'posto', 'restaurante', 'lanchonete', 'hortifruti', 'acougue',
  'cooperativa', 'regional', 'central', 'centro', 'nova', 'novo', 'sao', 'santa', 'santo', 'bom', 'boa', 'rio', 'rede', 'grupo', 'brasil', 'brasileira',
  'servicos', 'comercio', 'alimentos', 'alimenticios', 'produtos', 'unidade', 'fil', 'cnpj',
]);

const tokensOf = (s: string): string[] =>
  plainText(s).split(' ').filter(t => t.length >= 3 && !GENERIC.has(t) && !/^\d+$/.test(t) && !/^f\d+$/.test(t));

/** Quanto o nome do lugar do mapa lembra o nome da loja (0 = nada, 1 = igual). Só palavras que distinguem contam. */
export const nameMatch = (storeNames: string[], poiName: string): number => {
  const pt = tokensOf(poiName);
  if (pt.length === 0) return 0;
  let best = 0;
  for (const sn of storeNames) {
    const st = tokensOf(sn);
    if (st.length === 0) continue;
    let hits = 0;
    for (const a of st) {
      if (pt.some(b => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a))))) hits++;
    }
    if (hits > 0) best = Math.max(best, hits / Math.min(st.length, pt.length));
    // "COMPRETUDO" no cupom e "Compre Tudo" no mapa: palavras coladas ou separadas de outro jeito
    const sj = st.join(''), pj = pt.join('');
    if ((st.length > 1 || pt.length > 1) && Math.min(sj.length, pj.length) >= 6 && (sj === pj || sj.startsWith(pj) || pj.startsWith(sj))) best = Math.max(best, 1);
  }
  return best;
};

export interface PoiSuggestion { poi: Poi; meters: number; score: number }

/**
 * O lugar do mapa que parece ser a loja: nome parecido e perto do pino. Sem nome parecido não sugere nada.
 * `maxM` é a distância máxima entre o pino e o lugar do mapa.
 */
export const suggestPoi = (storeNames: string[], pin: { lat: number; lng: number }, pois: Poi[], maxM = 600): PoiSuggestion | null => {
  let best: PoiSuggestion | null = null;
  for (const poi of pois) {
    const score = nameMatch(storeNames, poi.name);
    if (score < 0.5) continue;
    const meters = distanceM(pin.lat, pin.lng, poi.lat, poi.lng);
    if (meters > maxM) continue;
    if (!best || score > best.score + 0.01 || (Math.abs(score - best.score) <= 0.01 && meters < best.meters)) best = { poi, meters, score };
  }
  return best;
};

/** Lugares perto do pino, do mais perto para o mais longe (para a pessoa escolher qual é a loja). */
export const poisNear = (pin: { lat: number; lng: number }, pois: Poi[], maxM = 400, limit = 8): { poi: Poi; meters: number }[] =>
  pois
    .map(poi => ({ poi, meters: distanceM(pin.lat, pin.lng, poi.lat, poi.lng) }))
    .filter(x => x.meters <= maxM)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit);
