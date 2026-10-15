// Rotas e distâncias do mapa.
//
// Sem chave de API e sem cadastro: a rota vem do OSRM público (dados do OpenStreetMap), a distância em linha reta
// é calculada aqui mesmo. O OSRM público é "melhor esforço" (sem garantia de disponibilidade e com uso moderado),
// por isso:
//   • pedimos UMA rota por vez, só quando a pessoa escolhe uma loja (nunca em lote);
//   • guardamos o resultado na memória para a mesma rota não ser pedida de novo;
//   • se o serviço falhar ou demorar, a tela continua útil: mostra a distância em linha reta e os botões
//     "Google Maps" / "Waze", que traçam a rota no app de navegação.
// O servidor público só calcula rotas de carro.

export interface LatLng { lat: number; lng: number }

export interface RouteResult {
  /** pontos do traçado, [lat, lng] */
  path: [number, number][];
  distanceM: number;
  durationS: number;
}

const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
const TIMEOUT_MS = 12000;

const EARTH_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distância em linha reta (km) entre dois pontos. */
export const haversineKm = (a: LatLng, b: LatLng): number => {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** "850 m" · "4,2 km" · "18 km" */
export const formatDistance = (km: number): string => {
  if (!isFinite(km)) return '';
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km.toLocaleString('pt-BR', { minimumFractionDigits: km < 10 ? 1 : 0, maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
};

/** "9 min" · "1 h 05" */
export const formatDuration = (seconds: number): string => {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return `${h} h ${String(m).padStart(2, '0')}`;
};

const cache = new Map<string, RouteResult>();
const keyOf = (a: LatLng, b: LatLng) => [a.lat, a.lng, b.lat, b.lng].map(n => n.toFixed(4)).join(',');

/** Rota de carro entre dois pontos. Lança erro se o serviço não responder. */
export const fetchRoute = async (from: LatLng, to: LatLng, signal?: AbortSignal): Promise<RouteResult> => {
  const key = keyOf(from, to);
  const hit = cache.get(key);
  if (hit) return hit;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const url = `${OSRM_URL}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`rota indisponível (${res.status})`);
    const json = await res.json();
    const r = json?.routes?.[0];
    const coords: [number, number][] | undefined = r?.geometry?.coordinates;
    if (json?.code !== 'Ok' || !r || !Array.isArray(coords) || coords.length < 2) throw new Error('sem rota para este trajeto');
    const out: RouteResult = {
      path: coords.map(([lng, lat]) => [lat, lng] as [number, number]),
      distanceM: Number(r.distance) || 0,
      durationS: Number(r.duration) || 0,
    };
    cache.set(key, out);
    return out;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
};

/** Links que abrem a rota no app de navegação (sem chave de API). */
export const navigationLinks = (to: LatLng) => ({
  google: `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=driving`,
  waze: `https://waze.com/ul?ll=${to.lat},${to.lng}&navigate=yes`,
});
