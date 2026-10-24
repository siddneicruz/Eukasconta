import React, { createContext, useContext } from 'react';
import type { MasterData } from '../services/masterService';

/* O que as telas precisam saber da tabela mãe: se está valendo, se esta conta é a do administrador e como sincronizar. */
export interface MasterInfo {
  active: boolean;
  isAdmin: boolean;
  version: number;
  publishedAt: string | null;
  master: MasterData | null;
  /** sugestões esperando o administrador */
  pending: number;
  syncing: boolean;
  syncNow: (force?: boolean) => Promise<void>;
  refreshPending: () => Promise<void>;
  /** cria a etiqueta na tabela mãe (administrador) ou sugere ao administrador (usuário) */
  createLabel: (parentPath: string[], name: string, ctx?: { code?: string; description?: string }) => Promise<{ approved: boolean; note?: string }>;
}

export const INACTIVE_MASTER: MasterInfo = {
  active: false, isAdmin: false, version: 0, publishedAt: null, master: null, pending: 0, syncing: false,
  syncNow: async () => {}, refreshPending: async () => {},
  createLabel: async () => { throw new Error('A tabela mãe ainda não está ligada.'); },
};

const Ctx = createContext<MasterInfo>(INACTIVE_MASTER);
export const MasterProvider: React.FC<{ value: MasterInfo; children: React.ReactNode }> = ({ value, children }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const useMasterInfo = (): MasterInfo => useContext(Ctx);
