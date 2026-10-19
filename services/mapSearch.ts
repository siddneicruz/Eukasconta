// Busca de estabelecimento na tela do mapa: acha as lojas das compras da pessoa (e, se o mapa já carregou, lojas do
// OpenStreetMap) pelo que ela digitar — nome do cupom, apelido, cidade, endereço ou CNPJ — sem ligar para acento ou caixa.
// Função pura: a tela só mostra o resultado.

import { POI_KINDS, Poi } from './poiService';

const fold = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const words = (s: string): string[] => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

export interface SearchableStore {
  id: string;
  name: string;               // como a pessoa vê a loja (apelido ou nome do cupom)
  original: string;           // nome no cupom
  alias: string;
  address: string;
  city: string;
  cnpj: string;
  km: number | null;          // em linha reta, a partir de você
  spent: number;
  visits: number;
  located: boolean;           // já tem posição no mapa
}

const lev1 = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
};

export const queryTokens = (query: string): string[] => fold(query).split(/\s+/).map(t => t.replace(/[^a-z0-9]/g, '')).filter(Boolean);

/** Quanto `token` combina com o texto: início de palavra do nome (3), dentro do nome (2), nos outros dados (1), erro de uma letra (1); 0 = não combina. */
const tokenScore = (token: string, nameWords: string[], nameText: string, otherText: string, otherWords: string[]): number => {
  if (nameWords.some(w => w.startsWith(token))) return 3;
  if (nameText.includes(token)) return 2;
  if (otherText.includes(token)) return 1;
  if (token.length >= 5 && [...nameWords, ...otherWords].some(w => w.length >= 5 && lev1(token, w))) return 1;
  return 0;
};

/** Pontos da loja para a busca (0 = não combina). Todas as palavras digitadas precisam combinar com alguma coisa da loja. */
export const storeScore = (tokens: string[], s: SearchableStore): number => {
  if (tokens.length === 0) return 0;
  const nameText = fold(`${s.name} ${s.alias} ${s.original}`);
  const nameWords = words(`${s.name} ${s.alias} ${s.original}`);
  const otherText = fold(`${s.city} ${s.address}`) + ' ' + String(s.cnpj || '').replace(/\D/g, '');
  const otherWords = words(`${s.city} ${s.address}`);
  let total = 0;
  for (const t of tokens) {
    const sc = tokenScore(t, nameWords, nameText, otherText, otherWords);
    if (sc === 0) return 0;
    total += sc;
  }
  return total;
};

/** As lojas que combinam, da que melhor combina para a pior; empatando, as que já têm posição, a mais perto, a que mais gastou. */
export const searchStores = (query: string, items: SearchableStore[], limit = 30): SearchableStore[] => {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  return items
    .map(s => ({ s, sc: storeScore(tokens, s) }))
    .filter(x => x.sc > 0)
    .sort((a, b) =>
      b.sc - a.sc
      || Number(b.s.located) - Number(a.s.located)
      || (a.s.km !== null && b.s.km !== null ? a.s.km - b.s.km : 0)
      || b.s.spent - a.s.spent
      || a.s.name.localeCompare(b.s.name, 'pt-BR'))
    .slice(0, limit)
    .map(x => x.s);
};

/** Lojas do OpenStreetMap que o mapa já carregou e combinam com o que foi digitado. */
export const searchPois = (query: string, pois: Poi[], limit = 6): Poi[] => {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const seen = new Set<string>();
  return pois
    .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
    .map(p => {
      const nameWords = words(p.name), nameText = fold(p.name);
      const other = `${p.address || ''} ${POI_KINDS[p.kind]?.label || ''}`;
      let total = 0;
      for (const t of tokens) {
        const sc = tokenScore(t, nameWords, nameText, fold(other), words(other));
        if (sc === 0) return { p, sc: 0 };
        total += sc;
      }
      return { p, sc: total };
    })
    .filter(x => x.sc > 0)
    .sort((a, b) => b.sc - a.sc || a.p.name.localeCompare(b.p.name, 'pt-BR'))
    .slice(0, limit)
    .map(x => x.p);
};
