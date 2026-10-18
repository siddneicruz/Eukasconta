// Chão firme para endereços do Brasil: nome dos estados e de qual estado é um CEP.
// Funções puras, sem rede. Serve para conferir o que veio no cupom (cidade/UF que não combinam com o CEP) e para o mapa
// não aceitar um resultado de outro estado ("São Carlos" de SC é bem diferente de "São Carlos" de SP).

export const UF_NAMES: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

/** Sem acento, minúsculo, só letras e números separados por espaço. */
export const plainText = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** "SC" ou "Santa Catarina" (com ou sem acento) → "SC". Vazio se não é um estado. */
export const ufOf = (raw: unknown): string => {
  const s = String(raw ?? '').trim();
  if (/^[A-Za-z]{2}$/.test(s) && UF_NAMES[s.toUpperCase()]) return s.toUpperCase();
  const p = plainText(s);
  const hit = Object.entries(UF_NAMES).find(([, n]) => plainText(n) === p);
  return hit ? hit[0] : '';
};

// Faixas de CEP dos Correios (5 primeiros dígitos, de/até)
const CEP_RANGES: [number, number, string][] = [
  [1000, 19999, 'SP'], [20000, 28999, 'RJ'], [29000, 29999, 'ES'], [30000, 39999, 'MG'], [40000, 48999, 'BA'],
  [49000, 49999, 'SE'], [50000, 56999, 'PE'], [57000, 57999, 'AL'], [58000, 58999, 'PB'], [59000, 59999, 'RN'],
  [60000, 63999, 'CE'], [64000, 64999, 'PI'], [65000, 65999, 'MA'], [66000, 68899, 'PA'], [68900, 68999, 'AP'],
  [69000, 69299, 'AM'], [69300, 69399, 'RR'], [69400, 69899, 'AM'], [69900, 69999, 'AC'],
  [70000, 72799, 'DF'], [72800, 72999, 'GO'], [73000, 73699, 'DF'], [73700, 76799, 'GO'], [76800, 76999, 'RO'],
  [77000, 77999, 'TO'], [78000, 78899, 'MT'], [79000, 79999, 'MS'], [80000, 87999, 'PR'], [88000, 89999, 'SC'], [90000, 99999, 'RS'],
];

/** Estado de um CEP ("89885-000" ou "89885000"). Vazio se o CEP não tem 8 números ou está fora das faixas. */
export const ufFromCep = (cep: unknown): string => {
  const d = String(cep ?? '').replace(/\D/g, '');
  if (d.length !== 8) return '';
  const n = Number(d.slice(0, 5));
  const hit = CEP_RANGES.find(([a, b]) => n >= a && n <= b);
  return hit ? hit[2] : '';
};
