// Criar uma etiqueta (grupo ou item) direto de quem está escolhendo a categoria de um item de compra.
// Segue o padrão da Estrutura de Taxonomia: grupo (camada 3) fica dentro de uma categoria, item (camada 4) dentro de um grupo.
import { TaxonomyNode, TaxonomySource } from '../types';
import { generateId } from './idUtils';
import { slugify } from './taxonomyService';
import { layerSlug } from './categoryLayers';
import { catKey } from './textFormat';

export interface AddLayerResult {
  taxonomy: TaxonomyNode[];
  /** id da opção nova na lista de escolha (g:... ou i:...) */
  newId: string;
  /** já existia um irmão com esse nome: nada foi criado, o id é o dele */
  existed: boolean;
  /** o grupo era folha e passou a ter itens: quem estava fixado nele passa para o "geral" dele */
  retarget?: { from: string; to: string };
}

/** `parentOptionId`: 'c:<categoria>' (cria um grupo nela) ou 'g:<categoria>|<grupo>' (cria um item nele). */
export const addLayerNode = (taxonomy: TaxonomyNode[], parentOptionId: string, rawName: string): AddLayerResult | null => {
  const name = rawName.replace(/\s+/g, ' ').trim();
  if (!name || !layerSlug(name)) return null;
  const byId = new Map(taxonomy.map(n => [n.id, n] as const));
  const catOf = (l2: TaxonomyNode) => {
    const l1 = l2.parentId ? byId.get(l2.parentId) : undefined;
    return l1 && l1.level === 1 && l2.level === 2 ? catKey(`${l1.name.trim()} - ${l2.name.trim()}`) : null;
  };
  const make = (parentId: string, level: 3 | 4): TaxonomyNode => ({
    id: generateId(), parentId, level, name, slug: slugify(name),
    sourceType: TaxonomySource.USER_CUSTOMIZED, isCustomized: true, lastUpdated: Date.now(),
  });
  const wanted = layerSlug(name);

  if (parentOptionId.startsWith('c:')) {
    const ck = parentOptionId.slice(2);
    const l2 = taxonomy.find(n => n.level === 2 && catOf(n) === ck);
    if (!l2) return null;
    const same = taxonomy.find(n => n.level === 3 && n.parentId === l2.id && layerSlug(n.name) === wanted);
    if (same) return { taxonomy, newId: `g:${ck}|${wanted}`, existed: true };
    return { taxonomy: [...taxonomy, make(l2.id, 3)], newId: `g:${ck}|${wanted}`, existed: false };
  }

  if (parentOptionId.startsWith('g:')) {
    const rest = parentOptionId.slice(2);
    const bar = rest.lastIndexOf('|');
    if (bar < 0) return null;
    const ck = rest.slice(0, bar);
    const g = rest.slice(bar + 1);
    const l3 = taxonomy.find(n => {
      if (n.level !== 3 || layerSlug(n.name) !== g) return false;
      const l2 = n.parentId ? byId.get(n.parentId) : undefined;
      return !!l2 && catOf(l2) === ck;
    });
    if (!l3) return null;
    const siblings = taxonomy.filter(n => n.level === 4 && n.parentId === l3.id);
    const same = siblings.find(n => layerSlug(n.name) === wanted);
    const newId = `i:${ck}|${g}|${wanted}`;
    if (same) return { taxonomy, newId, existed: true };
    return {
      taxonomy: [...taxonomy, make(l3.id, 4)], newId, existed: false,
      retarget: siblings.length === 0 ? { from: parentOptionId, to: `o:${ck}|${g}` } : undefined,
    };
  }
  return null;
};
