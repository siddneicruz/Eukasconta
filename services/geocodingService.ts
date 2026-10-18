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
  /** true = só achou a cidade (centro dela), não o endereço da loja */
  approx?: boolean;
}

type GeoInput = Pick<Establishment, 'address' | 'city' | 'state'> & Partial<Pick<Establishment, 'originalName'>>;

// Cupom fiscal costuma trazer o endereço "solto" (rua, número e bairro na mesma linha), que a busca estruturada
// nem sempre entende. Por isso a primeira tentativa é estruturada (rua/cidade/estado) e, se não achar nada, as
// seguintes vão afrouxando: texto livre com o endereço inteiro, endereço limpo (sem "S/N"), nome da loja na cidade
// e, por último, o centro da cidade (a loja aparece no mapa, marcada como posição aproximada).
// Todas passam pela mesma fila de 1 por segundo.
const pickFirst = (data: any): GeocodeResult | null => {
  if (!Array.isArray(data) || data.length === 0) return null;
  const latitude = parseFloat(data[0].lat);
  const longitude = parseFloat(data[0].lon);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
  return { latitude, longitude };
};

const query = async (params: URLSearchParams): Promise<GeocodeResult | null> => {
  const res = await throttledFetch(`${NOMINATIM_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`geocodificação indisponível (${res.status})`); // 429/5xx: não é "endereço não encontrado"
  return pickFirst(await res.json());
};

const freeText = (q: string) => query(new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br', q }));

const NO_NUMBER = /^(?:S\s*\/\s*N|S\.\s*N\.?|SN|SEM\s+N[UÚ]MERO)$/i;

/** "AVENIDA SANTA CATARINA, SN, CENTRO" -> rua, número (se houver) e bairro */
export const splitAddress = (address: string | undefined): { street: string; number: string; district: string } => {
  const parts = String(address || '').replace(/\s+/g, ' ').split(/\s*,\s*/).map(p => p.trim()).filter(Boolean);
  const street = (parts[0] || '').replace(/\s*-\s*(?:CENTRO|CEP.*)$/i, '').trim();
  const rest = parts.slice(1);
  const number = rest.find(p => /^\d{1,6}[A-Za-z]?$/.test(p)) || '';
  const district = rest.find(p => p !== number && !NO_NUMBER.test(p) && !/^CEP\b/i.test(p)) || '';
  return { street, number, district };
};

// Tira "LTDA", "EIRELI"... e o sufixo de filial ("- F01") do nome, para procurar a loja pelo nome.
const shortName = (name: string | undefined): string =>
  String(name || '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\b(LTDA|EIRELI|EPP|MEI|ME|S\/?A|CIA)\b\.?/gi, ' ')
    .replace(/\s+/g, ' ').trim();

// Consulta um único estabelecimento. Retorna null quando nada é encontrado (nem a cidade) — nesse caso o
// chamador ainda deve marcar geocodeStatus: 'not_found' para não tentar de novo a cada visita à tela do mapa.
// Falha de rede lança erro (a versão sem "Strict" engole e devolve null).
const geocodeStrict = async (est: GeoInput): Promise<GeocodeResult | null> => {
  if (!est.address && !est.city) return null;

  if (est.address) {
    const structured = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br' });
    structured.set('street', est.address);
    if (est.city) structured.set('city', est.city);
    if (est.state) structured.set('state', est.state);
    const first = await query(structured);
    if (first) return first;
  }

  const tried = new Set<string>();
  const attempt = async (q: string): Promise<GeocodeResult | null> => {
    const key = q.toLowerCase();
    if (!q.trim() || tried.has(key)) return null;
    tried.add(key);
    return freeText(q);
  };

  const text = [est.address, est.city, est.state, 'Brasil'].filter(Boolean).join(', ');
  let hit = await attempt(text);
  if (hit) return hit;

  const { street, number, district } = splitAddress(est.address);
  if (street) {
    hit = await attempt([[street, number].filter(Boolean).join(' '), district, est.city, est.state, 'Brasil'].filter(Boolean).join(', '));
    if (hit) return hit;
  }

  const name = shortName(est.originalName);
  if (name && est.city) {
    hit = await attempt([name, est.city, est.state, 'Brasil'].filter(Boolean).join(', '));
    if (hit) return hit;
  }

  if (est.city) {
    hit = await attempt([est.city, est.state, 'Brasil'].filter(Boolean).join(', '));
    if (hit) return { ...hit, approx: true };
  }
  return null;
};

export const geocodeEstablishment = async (est: GeoInput): Promise<GeocodeResult | null> => {
  try { return await geocodeStrict(est); }
  catch { return null; } // sem rede, CORS, etc. — trata como "não encontrado" desta vez
};

// Lojas que ficaram "não encontradas" antes das buscas mais flexíveis (endereço limpo, nome da loja, centro da cidade) existirem ganham mais uma chance (uma só).
const RETRY_NOT_FOUND_BEFORE = Date.parse('2026-10-19T00:00:00Z');

/** Precisa (ou merece nova) consulta de endereço? */
export const needsGeocoding = (e: Establishment): boolean =>
  !!(e.address || e.city) &&
  (!e.geocodeStatus || (e.geocodeStatus === 'not_found' && (e.geocodedAt ?? 0) < RETRY_NOT_FOUND_BEFORE));

// Geocodifica em lote só quem ainda não tem geocodeStatus definido,
// chamando onUpdate a cada resultado (para a tela ir atualizando os pinos
// progressivamente, em vez de esperar todo mundo terminar).
export const geocodeMissingEstablishments = async (
  establishments: Establishment[],
  onUpdate: (est: Establishment, patch: Partial<Establishment>) => void
): Promise<void> => {
  const pending = establishments.filter(needsGeocoding);
  for (const est of pending) {
    let result: GeocodeResult | null;
    // Sem internet não é "endereço não encontrado": para por aqui e deixa para a próxima vez, sem marcar ninguém.
    try { result = await geocodeStrict(est); } catch { return; }
    if (result) {
      onUpdate(est, { latitude: result.latitude, longitude: result.longitude, geocodeStatus: 'found', geocodedAt: Date.now(), geocodeApprox: result.approx ? true : undefined });
    } else {
      onUpdate(est, { geocodeStatus: 'not_found', geocodedAt: Date.now() });
    }
  }
};
