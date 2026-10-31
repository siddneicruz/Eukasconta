// Tipo de estabelecimento (Mercado, Restaurante, Farmácia, Academia...): uma lista simples que o administrador edita na
// planilha da tabela mãe (aba "Tipos de loja"). Cada loja guarda o seu tipo; sem tipo escolhido, o app deduz pelo nome.
import { useCallback, useEffect, useState } from 'react';
import { Receipt } from '../types';

export const NO_STORE_TYPE = 'Sem tipo';
export const DEFAULT_STORE_TYPES = [
  'Mercado', 'Padaria', 'Açougue e Peixaria', 'Hortifruti', 'Restaurante e Lanchonete', 'Farmácia', 'Academia',
  'Posto de Combustível', 'Loja de Roupas e Calçados', 'Casa e Construção', 'Pet Shop', 'Eletrônicos', 'Serviços', 'Outros',
];

const plain = (s: string): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// palavras do nome da loja que indicam o tipo (o primeiro que casar vale); só vale se o tipo existir na lista
const HINTS: { type: string; words: RegExp }[] = [
  { type: 'Farmácia', words: /\b(farmac|drogar|drogaria|droga\b|pague menos|raia|panvel|ultrafarma)/ },
  { type: 'Academia', words: /\b(academia|fitness|crossfit|smart fit|gym|pilates|musculacao)/ },
  { type: 'Posto de Combustível', words: /\b(posto|combustive|petrobras|shell|ipiranga|auto posto)/ },
  { type: 'Padaria', words: /\b(padaria|panificadora|confeitaria|doceria)/ },
  { type: 'Açougue e Peixaria', words: /\b(acougue|peixaria|frigorifico|casa de carnes)/ },
  { type: 'Hortifruti', words: /\b(hortifruti|sacolao|quitanda|verdurao|frutaria)/ },
  { type: 'Pet Shop', words: /\b(pet|veterinari|agropecuaria|racao)/ },
  { type: 'Restaurante e Lanchonete', words: /\b(restaurante|lanchonete|pizzaria|churrascaria|pastelaria|hamburgueria|sorveteria|cafeteria|bar\b|lancheria|sushi|cantina|bistro|marmitaria|food)/ },
  { type: 'Loja de Roupas e Calçados', words: /\b(roupas|moda|calcados|boutique|vestuario|confeccoes|lingerie|renner|riachuelo|c&a)/ },
  { type: 'Casa e Construção', words: /\b(construcao|material de const|ferragens|tintas|madeireira|leroy|moveis|colchoes|decoracao)/ },
  { type: 'Eletrônicos', words: /\b(eletro|informatica|celular|magazine|casas bahia|ponto frio|fast shop|kabum)/ },
  { type: 'Mercado', words: /\b(mercado|supermercado|atacado|atacadao|hipermercado|mercearia|emporio|minimercado|comercio de alimentos|angeloni|giassi|bistek|fort atacadista|assai|carrefour|big\b)/ },
];

/** Tipo que o nome da loja sugere, ou nulo. Só devolve tipos que existem na lista atual. */
export const suggestStoreType = (name: string, types: string[] = DEFAULT_STORE_TYPES): string | null => {
  const n = plain(name);
  if (!n) return null;
  const has = new Set(types);
  for (const h of HINTS) if (has.has(h.type) && h.words.test(n)) return h.type;
  return null;
};

/* ─────────── filtro por tipo (guardado no aparelho; vale no início e nos relatórios) ─────────── */
export const STORE_TYPE_FILTER_KEY = 'eukasconta_store_type_filter';
const EVENT = 'eukasconta-store-type-filter';

export const loadStoreTypeFilter = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_TYPE_FILTER_KEY) || '[]');
    return Array.isArray(v) ? Array.from(new Set(v.filter((x): x is string => typeof x === 'string'))) : [];
  } catch { return []; }
};

/** Lista de tipos escolhidos (vazia = todos). */
export const useStoreTypeFilter = (): [string[], (t: string[]) => void] => {
  const [sel, setSel] = useState<string[]>(loadStoreTypeFilter);
  useEffect(() => {
    const sync = () => setSel(loadStoreTypeFilter());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  const update = useCallback((next: string[]) => {
    setSel(next);
    try { localStorage.setItem(STORE_TYPE_FILTER_KEY, JSON.stringify(next)); } catch { /* sem armazenamento: vale só agora */ }
    try { window.dispatchEvent(new Event(EVENT)); } catch { /* sem janela */ }
  }, []);
  return [sel, update];
};

export const storeTypeLabel = (sel: string[]): string =>
  sel.length === 0 ? 'Todos os tipos' : sel.length === 1 ? sel[0] : `${sel[0]} +${sel.length - 1}`;

/** Só os cupons de lojas dos tipos escolhidos (lista vazia = todos). */
export const applyStoreTypeFilter = (receipts: Receipt[], sel: string[], typeOf: (name: string, cnpj?: string) => string): Receipt[] => {
  if (sel.length === 0) return receipts;
  const want = new Set(sel);
  return receipts.filter(r => want.has(typeOf(r.establishmentName, r.cnpj)));
};

/** Quanto cada tipo gastou (para mostrar ao lado de cada opção do filtro). */
export const storeTypeTotals = (receipts: Receipt[], typeOf: (name: string, cnpj?: string) => string): Map<string, number> => {
  const m = new Map<string, number>();
  receipts.forEach(r => { const t = typeOf(r.establishmentName, r.cnpj); m.set(t, (m.get(t) || 0) + (Number(r.totalAmount) || 0)); });
  return m;
};
