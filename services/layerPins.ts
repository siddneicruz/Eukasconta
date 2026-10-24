// Descrições que a pessoa fixou num grupo ou item das categorias ("CARNE MOIDA(RETALHO)" → Carne Bovina › Carne Moída).
//
// O cupom só grava "Departamento - Categoria" no item; grupo e item (camadas 3 e 4) o app deduz pelo nome. Quando o nome
// não basta, a pessoa escolhe o grupo/item na edição do cupom e isso fica aqui: vale para todas as compras com a mesma
// descrição na mesma categoria (compras novas dessa descrição também). Entra no backup (chave "eukasconta_*").
import { pinKey } from './categoryLayers';

export const LAYER_PINS_KEY = 'eukasconta_layer_pins';
export const LAYER_PINS_EVENT = 'eukasconta-layer-pins';

export const loadLayerPins = (): Record<string, string> => {
  try {
    const v = JSON.parse(localStorage.getItem(LAYER_PINS_KEY) || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    Object.entries(v).forEach(([k, val]) => { if (typeof val === 'string' && val) out[k] = val; });
    return out;
  } catch { return {}; }
};

/** Fixa várias descrições de uma vez (uma gravação só). Devolve quantas foram fixadas. */
export const saveLayerPins = (list: { category: string; description: string; nodeKey: string }[]): number => {
  if (list.length === 0) return 0;
  const cur = loadLayerPins();
  list.forEach(p => { cur[pinKey(p.category, p.description)] = p.nodeKey; });
  try { localStorage.setItem(LAYER_PINS_KEY, JSON.stringify(cur)); } catch { return 0; }
  try { window.dispatchEvent(new Event(LAYER_PINS_EVENT)); } catch { /* sem janela: ignora */ }
  return list.length;
};

/** Depois de juntar categorias/grupos repetidos: a fixação passa a apontar para a categoria e o grupo/item que ficaram. */
export const remapLayerPins = (pins: Record<string, string>, rm: { key: (k: string) => string }): Record<string, string> => {
  const out: Record<string, string> = {};
  Object.entries(pins).forEach(([k, v]) => {
    const [ck, slug] = k.split('\u0001');
    const nck = ck ? rm.key(`c:${ck}`).slice(2) : ck;
    out[`${nck}\u0001${slug ?? ''}`] = rm.key(v);
  });
  return out;
};

/** Fixa (ou, com `nodeKey` nulo, solta) a descrição. Devolve se gravou. */
export const saveLayerPin = (category: string, description: string, nodeKey: string | null): boolean => {
  const k = pinKey(category, description);
  const cur = loadLayerPins();
  if (nodeKey) cur[k] = nodeKey; else delete cur[k];
  try { localStorage.setItem(LAYER_PINS_KEY, JSON.stringify(cur)); } catch { return false; }
  try { window.dispatchEvent(new Event(LAYER_PINS_EVENT)); } catch { /* sem janela: ignora */ }
  return true;
};

/** Todas as descrições fixadas em `from` passam a apontar para `to` (ex.: um grupo que ganhou itens: fixação vira o "geral" dele). */
export const retargetLayerPins = (from: string, to: string): number => {
  const cur = loadLayerPins();
  let n = 0;
  Object.keys(cur).forEach(k => { if (cur[k] === from) { cur[k] = to; n++; } });
  if (n === 0) return 0;
  try { localStorage.setItem(LAYER_PINS_KEY, JSON.stringify(cur)); } catch { return 0; }
  try { window.dispatchEvent(new Event(LAYER_PINS_EVENT)); } catch { /* sem janela: ignora */ }
  return n;
};
