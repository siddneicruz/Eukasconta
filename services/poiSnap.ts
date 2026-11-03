// Ajusta a posição das lojas para o lugar que o mapa (OpenStreetMap) conhece pelo nome.
// O endereço do cupom vira um ponto aproximado (às vezes cai no centro da cidade ou em outra rua); o cadastro do mapa sabe
// onde a loja de verdade está. Cada loja é conferida uma vez; a posição digitada à mão nunca é mexida.
import { Establishment } from '../types';
import { boxAround, distanceM, nameMatch, poisFromOverpass, suggestPoi } from './poiService';

const RETRY_MS = 30 * 24 * 3600 * 1000;

export const snapCandidates = (ests: Establishment[]): Establishment[] =>
  ests.filter(e => !e.geocodeManual && e.geocodeStatus === 'found' && typeof e.latitude === 'number' && typeof e.longitude === 'number'
    && (!e.poiSnapAt || Date.now() - e.poiSnapAt > RETRY_MS));

/** Pontos iguais (ou quase) para lojas diferentes: sinal de que caíram todas no centro da cidade. */
const clustered = (e: Establishment, all: Establishment[]): boolean =>
  all.some(o => o !== e && typeof o.latitude === 'number' && distanceM(e.latitude!, e.longitude!, o.latitude!, o.longitude!) < 40);

export const snapToPois = async (
  all: Establishment[],
  names: (e: Establishment) => string[],
  onUpdate: (e: Establishment, patch: Partial<Establishment>) => void,
  onStep?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> => {
  const list = snapCandidates(all);
  let done = 0;
  for (const e of list) {
    if (signal?.aborted) return;
    const wide = !!e.geocodeApprox || clustered(e, all);
    const radius = wide ? 6000 : 1500;
    const pin = { lat: e.latitude as number, lng: e.longitude as number };
    try {
      const pois = await poisFromOverpass(boxAround(pin.lat, pin.lng, radius), signal);
      const n = names(e);
      const hit = suggestPoi(n, pin, pois, radius);
      if (hit && hit.score >= 0.6) {
        const moved = distanceM(pin.lat, pin.lng, hit.poi.lat, hit.poi.lng);
        onUpdate(e, moved > 25
          ? { latitude: hit.poi.lat, longitude: hit.poi.lng, geocodeApprox: undefined, geocodedAt: Date.now(), poiSnapAt: Date.now() }
          : { poiSnapAt: Date.now() });
      } else {
        onUpdate(e, { poiSnapAt: Date.now() });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      return; // sem internet ou mapa fora do ar: tenta de novo na próxima vez, sem marcar ninguém
    }
    done += 1; onStep?.(done, list.length);
    await new Promise(r => setTimeout(r, 1200)); // gentileza com o serviço público
  }
};

export { nameMatch };
