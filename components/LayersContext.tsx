import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { TaxonomyNode } from '../types';
import { LayerIndex, EMPTY_LAYERS, buildLayerIndex, setActiveLayers } from '../services/categoryLayers';
import { LAYER_PINS_EVENT, LAYER_PINS_KEY, loadLayerPins, retargetLayerPins } from '../services/layerPins';
import { addLayerNode } from '../services/taxonomyAdd';
import { setActiveStructure, structureKeys } from '../services/categoryAlign';

// Entrega a todas as telas as camadas 3 e 4 da estrutura de categorias, sem passar a taxonomia por cada componente.
const Ctx = createContext<LayerIndex>(EMPTY_LAYERS);
const TaxCtx = createContext<TaxonomyNode[]>([]);
const AddCtx = createContext<((parentOptionId: string, name: string) => string | null) | null>(null);

export const LayersProvider: React.FC<{ taxonomy: TaxonomyNode[]; onTaxonomyChange?: (t: TaxonomyNode[]) => void; children: React.ReactNode }> = ({ taxonomy, onTaxonomyChange, children }) => {
  // descrições que a pessoa fixou num grupo/item: recalcula as camadas assim que ela escolhe
  const [pins, setPins] = useState(loadLayerPins);
  useEffect(() => {
    const reload = () => setPins(loadLayerPins());
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key === LAYER_PINS_KEY) reload(); };
    window.addEventListener(LAYER_PINS_EVENT, reload);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(LAYER_PINS_EVENT, reload); window.removeEventListener('storage', onStorage); };
  }, []);
  const idx = useMemo(() => {
    const built = buildLayerIndex(taxonomy, pins);
    // as funções puras (filtros, recortes) usam este mesmo índice quando ninguém passa outro
    setActiveLayers(built);
    // e a Estrutura: as listas de escolha marcam o que as compras têm e ela não
    setActiveStructure(structureKeys(taxonomy));
    return built;
  }, [taxonomy, pins]);
  // criar grupo/item na hora de escolher a categoria de um item: devolve o id da etiqueta (nova ou já existente)
  const addNode = useCallback((parentOptionId: string, name: string): string | null => {
    if (!onTaxonomyChange) return null;
    const res = addLayerNode(taxonomy, parentOptionId, name);
    if (!res) return null;
    if (!res.existed) {
      if (res.retarget) retargetLayerPins(res.retarget.from, res.retarget.to);
      onTaxonomyChange(res.taxonomy);
    }
    return res.newId;
  }, [taxonomy, onTaxonomyChange]);
  return <TaxCtx.Provider value={taxonomy}><AddCtx.Provider value={onTaxonomyChange ? addNode : null}><Ctx.Provider value={idx}>{children}</Ctx.Provider></AddCtx.Provider></TaxCtx.Provider>;
};

export const useLayers = (): LayerIndex => useContext(Ctx);
/** A estrutura de categorias inteira (níveis 1 a 4), para escolher uma categoria pela árvore. */
export const useTaxonomy = (): TaxonomyNode[] => useContext(TaxCtx);
/** Cria um grupo ('c:...' como pai) ou item ('g:...' como pai) na estrutura; nulo onde não dá para editar a estrutura. */
export const useAddLayerNode = () => useContext(AddCtx);
