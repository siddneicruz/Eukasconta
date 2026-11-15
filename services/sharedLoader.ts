import * as cloud from './cloudService';

/** Leituras de preço de todos os usuários num raio, com cache de 5 min (compartilhado pelo comparativo e pela cotação do Início). */
let cache: { key: string; at: number; rows: cloud.SharedRow[] } | null = null;

export const loadShared = async (center: { lat: number; lng: number } | null, km: number): Promise<cloud.SharedRow[] | null> => {
  if (!cloud.cloudAvailable()) return null;
  let c = center;
  try {   // com permissão de localização já concedida, usa a posição atual; senão o centro das lojas mais frequentes
    const perm = await (navigator as any).permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'granted') c = await cloud.getCurrentPosition();
  } catch { /* fica com o centro das lojas */ }
  if (!c) return null;
  const key = `${km}|${c.lat.toFixed(2)},${c.lng.toFixed(2)}`;
  if (cache && cache.key === key && Date.now() - cache.at < 5 * 60000) return cache.rows;
  const rows = await cloud.sharedObservations(c, km, 400);
  cache = { key, at: Date.now(), rows };
  return rows;
};

/** centro de busca quando o aparelho não dá a posição: a loja mais frequentada que tem coordenadas */
export const homeCenterOf = (receipts: { cnpj?: string }[], establishments: { cnpj?: string; latitude?: number; longitude?: number }[]): { lat: number; lng: number } | null => {
  const cnt = new Map<string, number>();
  receipts.forEach(r => { const k = String(r.cnpj || '').replace(/\D/g, ''); if (k) cnt.set(k, (cnt.get(k) || 0) + 1); });
  let best: { lat: number; lng: number } | null = null; let bestN = 0;
  establishments.forEach(e => {
    const n = cnt.get(String(e.cnpj || '').replace(/\D/g, '')) || 0;
    if (n > bestN && typeof e.latitude === 'number' && typeof e.longitude === 'number') { bestN = n; best = { lat: e.latitude, lng: e.longitude }; }
  });
  return best;
};
