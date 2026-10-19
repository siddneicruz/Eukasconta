import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { TaxonomyNode } from '../types';
import { LayerIndex, EMPTY_LAYERS, buildLayerIndex, setActiveLayers } from '../services/categoryLayers';
import { LAYER_PINS_EVENT, LAYER_PINS_KEY, loadLayerPins } from '../services/layerPins';
import { setActiveStructure, structureKeys } from '../services/categoryAlign';

// Entrega a todas as telas as camadas 3 e 4 da estrutura de categorias, sem passar a taxonomia por cada componente.
const Ctx = createContext<LayerIndex>(EMPTY_LAYERS);
const TaxCtx = createContext<TaxonomyNode[]>([]);

export const LayersProvider: React.FC<{ taxonomy: TaxonomyNode[]; children: React.ReactNode }> = ({ taxonomy, children }) => {
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
  return <TaxCtx.Provider value={taxonomy}><Ctx.Provider value={idx}>{children}</Ctx.Provider></TaxCtx.Provider>;
};

export const useLayers = (): LayerIndex => useContext(Ctx);
/** A estrutura de categorias inteira (níveis 1 a 4), para escolher uma categoria pela árvore. */
export const useTaxonomy = (): TaxonomyNode[] => useContext(TaxCtx);
