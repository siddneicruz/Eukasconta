// Ovos: o cupom quase sempre diz só "BANDEJA OVOS BRANCOS", sem contar quantos vêm. A bandeja pode ter 12, 20, 30...,
// então o preço de uma bandeja não se compara com o de outra. Aqui o app descobre a quantidade de ovos (pelo nome,
// pela unidade "dúzia", pelo que a IA leu, ou pelo que a pessoa escolheu) e passa a comparar tudo pelo preço da DÚZIA.

export const EGGS_PER_DOZEN = 12;

// Tamanhos de bandeja mais comuns, para a escolha rápida na tela
export const EGG_SIZES = [6, 10, 12, 18, 20, 30] as const;

// Quantidades que valem ao ler um número solto do nome (evita confundir com "tipo 3", "grande 60g"...)
const READABLE_SIZES = new Set([6, 10, 12, 15, 18, 20, 24, 30, 36, 40, 45, 48, 50, 60, 90, 100, 120, 150, 180]);

export const MAX_EGGS = 360;

export interface EggLike {
  description?: string;
  category?: string;
  unitType?: string;
  quantity?: number;
  unitPrice?: number;
  eggCount?: number;
}

const fold = (s: string | undefined | null): string =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// Parece ovo mas não é ovo de comer (ou não é o ovo em si)
const NOT_EGG = /\b(PASCOA|CHOCOLATE|CHOC|KINDER|SURPRESA|OVOMALTINE|MACARRAO|MASSA|TALHARIM|NHOQUE|PANETONE|BOLO|BISCOITO|BOLACHA|MAIONESE|SORVETE|LICOR|FERMENTO|MOLHO|PAO|COLHER|CORACAO)\b|\bEM PO\b|\bDE PO\b/;
const EGG_WORD = /\bOVOS?\b|\bOV\.?\s+(BRANCOS?|VERM\w*|CAIPIRA|GRANDES?|EXTRA|JUMBO|MEDIOS?|TIPO)\b/;
// Categorias da taxonomia do app que são ovos (sem a de Páscoa nem a de massa com ovos)
const EGG_CATEGORY = /^OVOS? (BRANCO|VERMELHO|CAIPIRA|ORGANICO|ENRIQUECIDO|LIVRE)|\bOVOS? DE (GALINHA|CODORNA|PATA)\b|\bOUTROS OVOS\b|\bHORTIFRUTI - OVOS\b/;

export const isEggItem = (item: Pick<EggLike, 'description' | 'category'>): boolean => {
  const d = fold(item.description);
  const c = fold(item.category);
  if (NOT_EGG.test(d) || /PASCOA|MASSA COM OVOS/.test(c)) return false;
  return EGG_WORD.test(d) || EGG_CATEGORY.test(c);
};

const unitKey = (u?: string): string => fold(u).replace(/[^A-Z0-9]/g, '');
const isDozenUnit = (u?: string) => /^(DZ|DZA|DUZIA|DUZIAS)$/.test(unitKey(u));
// Vendido por peso ou volume: não é "quantidade de ovos por embalagem"
const isWeightUnit = (u?: string) => /^(KG|KGS|KILO|KILOS|QUILO|QUILOS|G|GR|GRS|L|LT|LTS|ML)$/.test(unitKey(u));

/** Lê no nome do item quantos ovos vêm: "30 OVOS", "OVOS C/12", "OVOS BRANCOS 20UN", "1 DUZIA"... Devolve null se não disser. */
export const parseEggCount = (description: string | undefined | null): number | null => {
  const d = fold(description).replace(/[(),;:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!d) return null;

  // "30 OVOS", "20 OV", "12UN OVOS"
  const before = d.match(/\b(\d{1,3})\s*(?:UN|UND|UNID|UNIDADES)?\s*OVOS?\b/);
  if (before) {
    const n = Number(before[1]);
    if (n >= 4 && n <= MAX_EGGS) return n;
  }

  // dúzia: "MEIA DUZIA", "2 DUZIAS", "1 DZ", "DUZIA"
  if (/\bMEIA DUZIA\b|\b1\/2 (?:DUZIA|DZ)\b/.test(d)) return 6;
  const dz = d.match(/\b(\d{1,2})\s*(?:DUZIAS?|DZA?)\b/);
  if (dz) {
    const n = Number(dz[1]) * EGGS_PER_DOZEN;
    if (n >= 12 && n <= MAX_EGGS) return n;
  }
  if (/\b(?:DUZIA|DUZIAS|DZ|DZA)\b/.test(d)) return EGGS_PER_DOZEN;

  // número solto depois da palavra ovo: "OVOS C/30", "OVO CAIPIRA 20", "OVOS BRANCOS 30UN", "BANDEJA 30"
  const re = /\b(\d{1,3})(?:\s*(UN|UND|UNID|UNIDADES|PCS|PECAS))?\b(?!\s*(?:G|GR|GRS|KG|ML|L|LT|%))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const n = Number(m[1]);
    if (!READABLE_SIZES.has(n)) continue;
    const prev = d.slice(0, m.index).trim().split(' ').pop() || '';
    if (/^(TIPO|T|N|NO|NUM|COD|LOTE|CLASSE)$/.test(prev)) continue;   // "tipo 3", "lote 12"
    return n;
  }
  return null;
};

export type EggSource = 'manual' | 'unit' | 'name';
export interface EggCount { count: number; source: EggSource }

/** Quantos ovos tem cada unidade vendida deste item. null = não dá para saber (a tela pergunta). */
export const eggCountOf = (item: EggLike): EggCount | null => {
  if (!isEggItem(item)) return null;
  const set = Math.round(Number(item.eggCount));
  if (set > 0 && set <= MAX_EGGS) return { count: set, source: 'manual' };
  if (isWeightUnit(item.unitType)) return null;
  if (isDozenUnit(item.unitType)) return { count: EGGS_PER_DOZEN, source: 'unit' };
  const read = parseEggCount(item.description);
  return read ? { count: read, source: 'name' } : null;
};

/** Ovo sem quantidade conhecida: falta a pessoa dizer. */
export const eggNeedsCount = (item: EggLike): boolean => isEggItem(item) && !isWeightUnit(item.unitType) && eggCountOf(item) === null;

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Preço da dúzia a partir do preço de uma unidade (bandeja) com `count` ovos. */
export const dozenPrice = (unitPrice: number, count: number): number =>
  count > 0 ? round4((Number(unitPrice) * EGGS_PER_DOZEN) / count) : 0;

export interface PriceBasis {
  unitPrice: number;
  quantity: number;
  unitType: string | undefined;
  eggs: number | null;     // ovos por unidade vendida, quando o preço foi levado para a dúzia
}

/**
 * Preço, quantidade e unidade para COMPARAR. Ovo com quantidade conhecida vira "DZ" (preço da dúzia, quantidade em dúzias);
 * todo o resto sai igual ao cupom. O cupom salvo nunca muda.
 */
export const priceBasis = (item: EggLike): PriceBasis => {
  const unitPrice = Number(item.unitPrice) || 0;
  const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
  const raw: PriceBasis = { unitPrice, quantity, unitType: item.unitType, eggs: null };
  const e = eggCountOf(item);
  if (!e || !(unitPrice > 0)) return raw;
  return {
    unitPrice: dozenPrice(unitPrice, e.count),
    quantity: round4((quantity * e.count) / EGGS_PER_DOZEN),
    unitType: 'DZ',
    eggs: e.count,
  };
};

/** Número lido pela IA (ou digitado): inteiro entre 1 e 360, senão nada. */
export const cleanEggCount = (v: unknown): number | undefined => {
  const n = Math.round(Number(v));
  return n >= 1 && n <= MAX_EGGS ? n : undefined;
};

/** "12 ovos (dúzia)" · "30 ovos" */
export const eggsText = (count: number): string =>
  count === EGGS_PER_DOZEN ? '12 ovos (dúzia)' : `${count} ovos`;
