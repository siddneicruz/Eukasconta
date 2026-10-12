// Nomes de loja e de produto vêm do cupom em CAIXA ALTA ("COMPRETUDO SUPERMERCADO LTDA-F01").
// Em lista, caixa alta ocupa muito mais largura e cansa a leitura; aqui viram "Compretudo Supermercado Ltda-F01".

const KEEP_UPPER = new Set(['LTDA', 'S/A', 'SA', 'ME', 'EPP', 'EIRELI', 'CIA', 'KG', 'ML', 'UN', 'G', 'L', 'MG', 'II', 'III', 'IV', 'ST', 'PET', 'TV', 'PC', 'USB', 'LED', 'RJ', 'SP', 'SC', 'PR', 'RS', 'MG', 'BA', 'GO', 'DF']);
const UNIT_TOKEN = /^\d+([.,]\d+)?(kg|g|mg|ml|l|un|und|m|cm|mm|pct|cx)$/i;

const fixWord = (w: string): string => {
  if (!w) return w;
  const up = w.toUpperCase();
  if (KEEP_UPPER.has(up) || UNIT_TOKEN.test(w)) return up;
  const lower = w.toLowerCase();
  // primeira letra de cada pedaço separado por hífen, barra ou ponto ("LTDA-F01" -> "Ltda-F01")
  return lower.replace(/(^|[-/.])([a-zà-ú])/g, (_m, sep, ch) => sep + ch.toUpperCase());
};

// Só mexe em texto todo em maiúsculas; se a pessoa já escreveu "Mercado do Zé", mantém como está.
export const titleCase = (s: string | undefined | null): string => {
  const text = (s ?? '').trim();
  if (!text) return '';
  const letters = text.replace(/[^A-Za-zÀ-ú]/g, '');
  if (letters && letters !== letters.toUpperCase()) return text;
  return text.split(/\s+/).map(fixWord).join(' ');
};
