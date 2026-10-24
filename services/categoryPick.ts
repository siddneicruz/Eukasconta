// Escolher a categoria de um item de compra pela árvore completa (departamento › categoria › grupo › item).
//
// O item grava só "Departamento - Categoria"; grupo e item (camadas 3 e 4) o app deduz pelo nome, e quando o nome não basta
// a pessoa "fixa" a descrição num grupo ou item (layerPins.ts). Aqui ficam as contas dessa escolha, sem tela.
import { TaxonomyNode } from '../types';
import { CompareOption, buildCompareOptions, catId, deptId } from './categoryCompare';
import { LayerIndex, REST_LABEL, leafFor, pinKey } from './categoryLayers';
import { catKey, deptKey } from './textFormat';

const cache = new WeakMap<LayerIndex, { tax: TaxonomyNode[]; options: CompareOption[] }>();

/** Toda a estrutura de categorias da pessoa como opções de busca (sem gasto), em ordem alfabética. */
export const pickOptions = (taxonomy: TaxonomyNode[], layers: LayerIndex): CompareOption[] => {
  const hit = cache.get(layers);
  if (hit && hit.tax === taxonomy) return hit.options;
  const options = buildCompareOptions([], [], { layers, taxonomy, includeUnused: true })
    .sort((a, b) => a.full.localeCompare(b.full, 'pt-BR'));
  cache.set(layers, { tax: taxonomy, options });
  return options;
};

/** Departamento só pode ser escolhido quando não tem categorias dentro (aí ele é a própria categoria). */
export const isSelectable = (opt: CompareOption, kids: number): boolean => !(opt.kind === 'dept' && kids > 0);

export interface PickResult {
  /** o que o item grava: "Departamento - Categoria" (ou só o departamento) */
  category: string;
  /** grupo/item fixado para a descrição; nulo = deixar o app deduzir pelo nome */
  pin: string | null;
}

/** O que a escolha de uma opção vira no item. `categories` são os nomes que o app usa nas compras. */
export const resolvePick = (optionId: string, options: CompareOption[], categories: string[], layers: LayerIndex): PickResult | null => {
  const opt = options.find(o => o.id === optionId);
  if (!opt) return null;
  if (opt.kind === 'dept') {
    const own = categories.find(c => !c.includes(' - ') && deptKey(c) === optionId.slice(2));
    return { category: own || opt.label, pin: null };
  }
  if (opt.kind === 'cat') {
    const name = categories.find(c => catKey(c) === optionId.slice(2));
    return { category: name || opt.full, pin: null };
  }
  const node = layers.byKey.get(optionId);
  if (!node) return null;
  const name = categories.find(c => catKey(c) === node.catKey) || node.cat;
  if (optionId.startsWith('g:') && !node.leaf) return { category: name, pin: `o:${optionId.slice(2)}` };   // grupo com itens: "geral" dele
  return { category: name, pin: optionId };
};

export interface CurrentPick {
  /** id da opção que está valendo (para marcar na lista) */
  id: string;
  /** caminho para mostrar no campo: "Açougue e Peixaria › Carne Bovina › Carne Moída" */
  label: string;
  /** o grupo/item foi fixado pela pessoa? */
  pinned: boolean;
  /** onde o app põe a descrição hoje, por nome ou por fixação (nulo = "outros itens" da categoria) */
  now: string | null;
}

/** A escolha de agora para um item: categoria e, se houver, grupo/item (fixado, ou o que o nome indica). */
export const currentPick = (category: string, description: string, options: CompareOption[], layers: LayerIndex): CurrentPick => {
  const ck = catKey(category);
  const hasSub = category.includes(' - ');
  const baseId = hasSub ? catId(category) : deptId(category);
  const pinnedKey = layers.pins.get(pinKey(category, description));
  const pinnedNode = pinnedKey ? layers.byKey.get(pinnedKey) : undefined;
  const pinned = !!pinnedNode && pinnedNode.leaf && pinnedNode.catKey === ck;
  const leaf = leafFor(layers, category, description);
  const nowText = leaf ? (leaf.rest ? `${leaf.group} (geral)` : leaf.level === 4 ? `${leaf.group} › ${leaf.label}` : leaf.label) : null;
  const byId = new Map(options.map(o => [o.id, o] as const));
  const fullOf = (id: string, fallback: string) => (byId.get(id)?.full || fallback).split(' - ').join(' › ');
  const catLabel = fullOf(baseId, category.split(' - ').join(' › '));
  if (pinned && pinnedNode) {
    const id = pinnedNode.rest ? pinnedNode.groupKey : pinnedNode.key;
    const tail = pinnedNode.rest ? pinnedNode.group : pinnedNode.level === 4 ? `${pinnedNode.group} › ${pinnedNode.label}` : pinnedNode.label;
    return { id, label: `${catLabel} › ${tail}`, pinned: true, now: nowText };
  }
  return { id: baseId, label: catLabel, pinned: false, now: nowText };
};

export const restText = (): string => `${REST_LABEL} da categoria`;

/** O caminho completo de uma escolha como lista: ["Despensa e Grãos", "Mercearia Salgada", "Molhos"]. */
export const pathParts = (cur: CurrentPick): string[] => {
  const parts = (cur.label || '').split(' › ').filter(Boolean);
  if (!cur.pinned && cur.now) cur.now.split(' › ').forEach(p => { if (!parts.includes(p)) parts.push(p); });
  return parts;
};
