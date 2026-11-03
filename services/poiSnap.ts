// Ajusta a posição das lojas para o lugar que o mapa (OpenStreetMap) conhece pelo nome.
// O endereço do cupom vira um ponto aproximado (às vezes cai no centro da cidade ou em outra rua); o cadastro do mapa sabe
// onde a loja de verdade está. Cada loja é conferida uma vez; a posição digitada à mão nunca é mexida.
import { Establishment } from '../types';
import { searchPlacesByName } from './geocodingService';
import { boxAround, distanceM, nameMatch, poisFromOverpass, suggestPoi } from './poiService';

const RETRY_MS = 30 * 24 * 3600 * 1000;
export const SNAP_V = 2; // v1 = fila antiga (parava na primeira loja e marcava lojas sem ter achado nada)
export const snapDone = (e: Establishment): boolean => !!e.poiSnapAt && (e.poiSnapV ?? 1) >= SNAP_V;

export const snapCandidates = (ests: Establishment[]): Establishment[] =>
  ests.filter(e => !e.geocodeManual && e.geocodeStatus === 'found' && typeof e.latitude === 'number' && typeof e.longitude === 'number'
    && (!snapDone(e) || Date.now() - (e.poiSnapAt as number) > RETRY_MS));

/** Pontos iguais (ou quase) para lojas diferentes: sinal de que caíram todas no centro da cidade. */
const clustered = (e: Establishment, all: Establishment[]): boolean =>
  all.some(o => o !== e && typeof o.latitude === 'number' && distanceM(e.latitude!, e.longitude!, o.latitude!, o.longitude!) < 40);

export const snapToPois = async (
  all: Establishment[],
  names: (e: Establishment) => string[],
  onUpdate: (e: Establishment, patch: Partial<Establishment>) => void,
  onStep?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<boolean> => {
  const list = snapCandidates(all);
  let done = 0;
  for (const e of list) {
    if (signal?.aborted) return false;
    const wide = !!e.geocodeApprox || clustered(e, all);
    const radius = wide ? 6000 : 1500;
    const pin = { lat: e.latitude as number, lng: e.longitude as number };
    const n = names(e);
    let target: { lat: number; lng: number } | null = null;
    let failed = false;
    try {
      const pois = await poisFromOverpass(boxAround(pin.lat, pin.lng, radius), signal);
      const hit = suggestPoi(n, pin, pois, radius);
      if (hit && hit.score >= 0.6) target = { lat: hit.poi.lat, lng: hit.poi.lng };
    } catch (err: any) {
      if (err?.name === 'AbortError') return false;
      failed = true; // cadastro do mapa fora do ar: ainda tenta a busca por nome
    }
    if (!target) {
      try {
        const q = n.find(x => /[a-z]/i.test(x)) || e.originalName;
        const found = await searchPlacesByName(q.replace(/\s+(ltda|eireli|epp|me|s\/?a)\b\.?/gi, '').slice(0, 60), e.city, e.state, pin, wide ? 15 : 6);
        let best: { lat: number; lng: number; score: number; m: number } | null = null;
        for (const f of found) {
          const score = nameMatch(n, f.name);
          if (score < 0.6) continue;
          const m = distanceM(pin.lat, pin.lng, f.lat, f.lng);
          if (!best || score > best.score + 0.01 || (Math.abs(score - best.score) <= 0.01 && m < best.m)) best = { lat: f.lat, lng: f.lng, score, m };
        }
        if (best) { target = { lat: best.lat, lng: best.lng }; failed = false; }
      } catch (err: any) {
        if (err?.name === 'AbortError') return false;
        if (failed) return false; // sem internet nas duas buscas: tenta de novo na próxima vez
      }
    }
    if (target) {
      const moved = distanceM(pin.lat, pin.lng, target.lat, target.lng);
      onUpdate(e, moved > 25
        ? { latitude: target.lat, longitude: target.lng, geocodeApprox: undefined, geocodedAt: Date.now(), poiSnapAt: Date.now(), poiSnapV: SNAP_V }
        : { poiSnapAt: Date.now(), poiSnapV: SNAP_V });
    } else {
      onUpdate(e, { poiSnapAt: Date.now(), poiSnapV: SNAP_V });
    }
    done += 1; onStep?.(done, list.length);
    await new Promise(r => setTimeout(r, 1200)); // gentileza com o serviço público
  }
  return true;
};

export { nameMatch };
