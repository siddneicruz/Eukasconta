// Paleta única dos gráficos: dourado como cor-guia e tons "joia" contidos, bem separados entre si
// (nenhum par vizinho se confunde, nem em daltonismo comum). Todo gráfico novo importa daqui.
export const CHART_COLORS = [
  '#DDB94B', // ouro (marca)
  '#3FB68B', // esmeralda
  '#5B8DEF', // azul
  '#E0719A', // rosa
  '#9B7BE8', // violeta
  '#38BDD0', // turquesa
  '#E58A57', // terracota
  '#A3C65A', // oliva
  '#E5675F', // coral
  '#8E9AB8', // ardósia
] as const;

// Cor fixa por categoria mestra (a categoria mantém a mesma cor em todas as telas).
export const CATEGORY_COLORS: Record<string, string> = {
  'Hortifruti': '#3FB68B',
  'Laticínios e Frios': '#38BDD0',
  'Carne Bovina': '#E5675F',
  'Carne Suína': '#E58A57',
  'Padaria e Confeitaria': '#C9955B',
  'Despensa e Grãos': '#DDB94B',
  'Despensa': '#DDB94B',
  'Adega e Bebidas': '#9B7BE8',
  'Bomboniere e Snacks': '#E0719A',
  'Higiene e Beleza': '#D87FB5',
  'Limpeza e Casa': '#5B8DEF',
  'Pet Shop': '#A3C65A',
  'Transporte': '#6F8DAF',
  'Moda': '#C65FA6',
  'Bazar e Outros': '#8E9AB8',
};

export const GOAL_PALETTE = ['#DDB94B', '#3FB68B', '#5B8DEF', '#9B7BE8', '#E0719A', '#E58A57', '#38BDD0', '#E5675F'] as const;
