import React, { createContext, useContext, useMemo } from 'react';
import { TaxonomyNode } from '../types';
import { LayerIndex, EMPTY_LAYERS, buildLayerIndex, setActiveLayers } from '../services/categoryLayers';

// Entrega a todas as telas as camadas 3 e 4 da estrutura de categorias, sem passar a taxonomia por cada componente.
const Ctx = createContext<LayerIndex>(EMPTY_LAYERS);

export const LayersProvider: React.FC<{ taxonomy: TaxonomyNode[]; children: React.ReactNode }> = ({ taxonomy, children }) => {
  const idx = useMemo(() => {
    const built = buildLayerIndex(taxonomy);
    // as funções puras (filtros, recortes) usam este mesmo índice quando ninguém passa outro
    setActiveLayers(built);
    return built;
  }, [taxonomy]);
  return <Ctx.Provider value={idx}>{children}</Ctx.Provider>;
};

export const useLayers = (): LayerIndex => useContext(Ctx);
