// Gastos fora do mercado (restaurante, posto, farmácia, pet shop, loja de roupas, serviços...).
// A tabela mãe é de supermercado e só o administrador mexe nela. O que não é de mercado entra "sugerido" pela IA, a pessoa
// confirma (ou troca) e o app aprende: a mesma descrição cai direto na categoria escolhida nas leituras seguintes.
// As categorias criadas pela pessoa ficam só neste aparelho (e no backup dela); nunca vão para a tabela mãe.
import { ReceiptItem } from '../types';
import { deptKey } from './textFormat';

export const CUSTOM_DEPT = 'Meus gastos';
const PINS_KEY = 'eukasconta_off_pins';
const CUSTOM_KEY = 'eukasconta_off_custom';

export interface OffOption { id: string; name: string; label: string; custom?: boolean }

// As 10 categorias base. O "label" é o nome que o cupom guarda; onde a tabela mãe já tem a área, usa o nome dela.
export const BASE_OFF: OffOption[] = [
  { id: 'combustivel', name: 'Combustível', label: 'Transporte - Combustíveis Automotivos' },
  { id: 'comerfora', name: 'Alimentação fora', label: 'Comer Fora e Delivery' },
  { id: 'saude', name: 'Saúde e farmácia', label: 'Saúde e Farmácia' },
  { id: 'casa', name: 'Casa e construção', label: 'Bazar e Utilidades Domésticas - Ferramentas e Construção' },
  { id: 'pet', name: 'Pet', label: 'Pet Shop' },
  { id: 'lazer', name: 'Lazer e cultura', label: 'Lazer e Entretenimento' },
  { id: 'vestuario', name: 'Vestuário e calçados', label: 'Vestuário' },
  { id: 'transporte', name: 'Transporte (exceto combustível)', label: 'Transporte - Passagens e Tarifas' },
  { id: 'servicos', name: 'Serviços', label: 'Bazar e Utilidades Domésticas - Serviços' },
  { id: 'outros', name: 'Outros', label: 'Outros' },
];

// Departamentos que, num item sem cadastro na tabela mãe, indicam gasto fora do mercado e pedem confirmação.
// "Comer Fora e Delivery" não entra: o app já separa pelo tipo da loja.
const OFF_DEPTS = new Set(['transporte', 'pet shop', 'saude e farmacia', 'vestuario', 'lazer e entretenimento', 'casa e construcao', 'servicos', 'outros', 'tabacaria e conveniencia', deptKey(CUSTOM_DEPT)]);
export const isOffDept = (category: string | null | undefined): boolean => !!category && OFF_DEPTS.has(deptKey(category));

export const isCustomCategory = (category: string | null | undefined): boolean => !!category && deptKey(category) === deptKey(CUSTOM_DEPT);
export const customLabel = (name: string): string => `${CUSTOM_DEPT} - ${name.trim()}`;

const readJson = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } };
const writeJson = (key: string, v: unknown): void => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sem armazenamento */ } };

export const loadCustomCategories = (): string[] => {
  const v = readJson<unknown>(CUSTOM_KEY, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
};
export const addCustomCategory = (name: string): string => {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!clean) return '';
  const list = loadCustomCategories();
  if (!list.some(n => n.toLowerCase() === clean.toLowerCase())) writeJson(CUSTOM_KEY, [...list, clean]);
  return customLabel(list.find(n => n.toLowerCase() === clean.toLowerCase()) || clean);
};

export const offOptions = (): OffOption[] => [
  ...BASE_OFF,
  ...loadCustomCategories().map(n => ({ id: `c:${n}`, name: n, label: customLabel(n), custom: true })),
];

/* Aprendizado: descrição (sem acento, caixa nem números soltos) → categoria que a pessoa escolheu. */
const normDesc = (d: string): string => String(d || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const loadOffPins = (): Record<string, string> => {
  const v = readJson<unknown>(PINS_KEY, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {};
};
export const pinOff = (description: string, category: string): void => {
  const k = normDesc(description);
  if (!k || !category) return;
  const pins = loadOffPins();
  if (pins[k] === category) return;
  pins[k] = category;
  writeJson(PINS_KEY, pins);
};
export const pinnedOff = (description: string, pins: Record<string, string> = loadOffPins()): string => pins[normDesc(description)] || '';

/** Itens que ainda esperam a confirmação da pessoa. */
export const pendingOffItems = (items: ReceiptItem[] | undefined): number => (items || []).filter(i => i.offState === 'sugerido').length;

/** Trecho da instrução da IA: para loja que não é de mercado, que categorias usar. */
export const offPromptBlock = (): string => {
  const customs = loadCustomCategories();
  return `
LOJA QUE NÃO É DE MERCADO (restaurante, posto de combustível, farmácia, pet shop, loja de roupas, serviços etc.):
- Escolha para 'category' a opção da TAXONOMIA OBRIGATÓRIA que melhor descreve o item (combustível = "Transporte - Combustíveis Automotivos"). Se nenhuma servir, use uma destas: ${BASE_OFF.map(o => `"${o.label}"`).join(', ')}.${customs.length ? `\n- Categorias pessoais de quem está lendo (use quando o item combinar claramente): ${customs.map(n => `"${customLabel(n)}"`).join(', ')}.` : ''}
- Nesses casos NÃO invente categoria de mercado só para encaixar; na dúvida use "Outros".`;
};
