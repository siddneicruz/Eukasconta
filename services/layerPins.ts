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

/** Fixa (ou, com `nodeKey` nulo, solta) a descrição. Devolve se gravou. */
export const saveLayerPin = (category: string, description: string, nodeKey: string | null): boolean => {
  const k = pinKey(category, description);
  const cur = loadLayerPins();
  if (nodeKey) cur[k] = nodeKey; else delete cur[k];
  try { localStorage.setItem(LAYER_PINS_KEY, JSON.stringify(cur)); } catch { return false; }
  try { window.dispatchEvent(new Event(LAYER_PINS_EVENT)); } catch { /* sem janela: ignora */ }
  return true;
};
