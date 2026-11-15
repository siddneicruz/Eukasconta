import { useEffect, useState } from 'react';

/* Os ~1.500 ícones do lucide só são necessários para os ícones personalizados das categorias e para o seletor de ícones.
   Ficam num pacote à parte, carregado logo depois da primeira tela; antes disso vale o ícone padrão da categoria. */
let mod: Record<string, any> | null = null;
let pending: Promise<Record<string, any>> | null = null;
const listeners = new Set<() => void>();

export const loadAllIcons = (): Promise<Record<string, any>> => {
  if (!pending) pending = import('lucide-react').then(m => { mod = m as any; listeners.forEach(f => f()); return mod!; });
  return pending;
};
export const getIconByName = (name: string): any => (mod && name ? mod[name] : undefined);
export const allIconNames = (): string[] => mod ? Object.keys(mod).filter(k => k !== 'createLucideIcon' && /^[A-Z]/.test(k)) : [];

/** Liga o carregamento e re-renderiza quando os ícones chegam. */
export const useAllIcons = (): boolean => {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump(n => n + 1);
    listeners.add(f);
    const t = setTimeout(() => { loadAllIcons(); }, 300);
    return () => { listeners.delete(f); clearTimeout(t); };
  }, []);
  return !!mod;
};
