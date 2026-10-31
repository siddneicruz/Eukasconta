import React, { createContext, useContext, useMemo } from 'react';
import { Establishment } from '../types';
import { buildStoreNamer, StoreNamer } from '../services/establishmentNames';
import { useMasterInfo } from './MasterContext';
import { DEFAULT_STORE_TYPES } from '../services/storeTypes';

// Entrega a todas as telas a mesma regra de apelido de loja, sem passar a lista por cada componente.
const IDENTITY = buildStoreNamer([]);
const Ctx = createContext<StoreNamer>(IDENTITY);

export const StoreNamesProvider: React.FC<{ establishments: Establishment[]; children: React.ReactNode }> = ({ establishments, children }) => {
  const types = useMasterInfo().master?.storeTypes;
  const namer = useMemo(() => buildStoreNamer(establishments, types && types.length ? types : DEFAULT_STORE_TYPES), [establishments, types]);
  return <Ctx.Provider value={namer}>{children}</Ctx.Provider>;
};

export const useStoreNames = (): StoreNamer => useContext(Ctx);
