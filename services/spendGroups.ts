import { deptKey } from './textFormat';

/* Tipo de gasto: agrupa os departamentos da tabela mãe em poucas visões (mercado, casa, saúde, lazer, educação…).
   O grupo vem do departamento do item, não da loja: a farmácia também vende xampu e o mercado vende detergente. */
export interface SpendGroup { id: string; name: string; color: string; depts: string[] }

export const SPEND_GROUPS: SpendGroup[] = [
  { id: 'mercado', name: 'Mercado e Alimentação', color: '#22c55e', depts: ['Açougue', 'Bebidas', 'Congelados', 'Frios e Laticínios', 'Hortifruti', 'Mercearia Básica', 'Mercearia Doce e Matinais', 'Mercearia Salgada e Conservas', 'Padaria e Confeitaria', 'Peixaria', 'Saudáveis e Especiais', 'Rotisseria e Comida Pronta'] },
  { id: 'fora', name: 'Comer Fora', color: '#f97316', depts: ['Comer Fora e Delivery'] },
  { id: 'casa', name: 'Casa', color: '#38bdf8', depts: ['Limpeza', 'Bazar e Utilidades Domésticas', 'Casa e Construção'] },
  { id: 'saude', name: 'Saúde e Cuidados', color: '#ef4444', depts: ['Higiene e Perfumaria', 'Farmácia e Saúde'] },
  { id: 'transporte', name: 'Transporte', color: '#eab308', depts: ['Transporte'] },
  { id: 'vestuario', name: 'Vestuário', color: '#a855f7', depts: ['Vestuário'] },
  { id: 'lazer', name: 'Lazer', color: '#ec4899', depts: ['Lazer e Entretenimento'] },
  { id: 'educacao', name: 'Educação', color: '#14b8a6', depts: ['Educação'] },
  { id: 'pets', name: 'Pets', color: '#fb923c', depts: ['Pet Shop'] },
  { id: 'filhos', name: 'Filhos', color: '#f472b6', depts: ['Mundo Infantil'] },
  { id: 'tecnologia', name: 'Eletrônicos', color: '#6366f1', depts: ['Eletrônicos'] },
  { id: 'servicos', name: 'Serviços', color: '#94a3b8', depts: ['Serviços'] },
];
export const OTHER_GROUP: SpendGroup = { id: 'outros', name: 'Outros', color: '#71717a', depts: [] };

const byKey = new Map<string, SpendGroup>();
SPEND_GROUPS.forEach(g => g.depts.forEach(d => byKey.set(deptKey(d), g)));

/** Grupo de gasto de um departamento (ou de uma categoria "Departamento - Categoria"). */
export const spendGroupOf = (category: string | null | undefined): SpendGroup => byKey.get(deptKey(category)) || OTHER_GROUP;

export interface GroupRow { id: string; name: string; color: string; value: number; pct: number }
export const groupTotals = (rows: { name: string; value: number }[]): GroupRow[] => {
  const m = new Map<string, GroupRow>();
  let total = 0;
  rows.forEach(r => {
    const g = spendGroupOf(r.name);
    const cur = m.get(g.id) || { id: g.id, name: g.name, color: g.color, value: 0, pct: 0 };
    cur.value += r.value; total += r.value; m.set(g.id, cur);
  });
  return [...m.values()].filter(g => g.value > 0).map(g => ({ ...g, pct: total > 0 ? (g.value / total) * 100 : 0 })).sort((a, b) => b.value - a.value);
};
