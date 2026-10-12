// Geocodificação de estabelecimentos via Nominatim (OpenStreetMap) — gratuito,
// sem chave de API. A política de uso do Nominatim exige, em troca:
//   1. No máximo 1 requisição por segundo (a fila abaixo garante isso).
//   2. Identificar o app nas requisições. Navegadores bloqueiam a definição
//      manual do cabeçalho User-Agent por JS (por segurança), então quem
//      identifica a origem aqui é o cabeçalho Referer, que o próprio
//      navegador já envia sozinho — é assim que a maioria dos apps
//      client-side atende essa exigência.
//   3. Nunca repetir a mesma consulta — por isso todo resultado (positivo OU
//      negativo) é gravado no cadastro do estabelecimento e nunca mais
//      consultado de novo.
//   4. Atribuir os dados ao OpenStreetMap sempre que o mapa for exibido
//      (isso é feito no componente do mapa, não aqui).
import { Establishment } from '../types';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1100; // um pouco acima de 1s por segurança

let queueTail: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

// Serializa todas as chamadas (mesmo vindas de componentes diferentes) numa
// fila única, garantindo o intervalo mínimo entre requisições de verdade.
const throttledFetch = (url: string): Promise<Response> => {
  const run = async (): Promise<Response> => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise(res => setTimeout(res, wait));
    lastRequestAt = Date.now();
    return fetch(url);
  };
  const result = queueTail.then(run);
  // Mantém a fila viva independentemente de sucesso/erro da chamada atual.
  queueTail = result.then(() => undefined, () => undefined);
  return result;
};

export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

// Consulta um único estabelecimento. Retorna null quando o endereço não é
// encontrado (endereço incompleto é comum em cupom fiscal) — nesse caso o
// chamador ainda deve marcar geocodeStatus: 'not_found' para não tentar de
// novo a cada visita à tela do mapa.
export const geocodeEstablishment = async (est: Pick<Establishment, 'address' | 'city' | 'state'>): Promise<GeocodeResult | null> => {
  if (!est.address && !est.city) return null;

  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'br',
  });
  if (est.address) params.set('street', est.address);
  if (est.city) params.set('city', est.city);
  if (est.state) params.set('state', est.state);

  try {
    const res = await throttledFetch(`${NOMINATIM_URL}?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const { lat, lon } = data[0];
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
    return { latitude, longitude };
  } catch {
    return null; // sem rede, CORS, etc. — trata como "não encontrado" desta vez
  }
};

// Geocodifica em lote só quem ainda não tem geocodeStatus definido,
// chamando onUpdate a cada resultado (para a tela ir atualizando os pinos
// progressivamente, em vez de esperar todo mundo terminar).
export const geocodeMissingEstablishments = async (
  establishments: Establishment[],
  onUpdate: (cnpj: string, patch: Partial<Establishment>) => void
): Promise<void> => {
  const pending = establishments.filter(e => !e.geocodeStatus && (e.address || e.city));
  for (const est of pending) {
    const result = await geocodeEstablishment(est);
    if (result) {
      onUpdate(est.cnpj, { ...result, geocodeStatus: 'found', geocodedAt: Date.now() });
    } else {
      onUpdate(est.cnpj, { geocodeStatus: 'not_found', geocodedAt: Date.now() });
    }
  }
};
