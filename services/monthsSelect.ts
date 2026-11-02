/* Seleção de vários meses no filtro de período.
   Um toque escolhe só aquele mês (como sempre). Dois toques seguidos no mesmo mês o ADICIONAM à seleção e ele fica marcado;
   mais dois toques seguidos o tiram. Com 2 ou mais meses, `month` fica nulo e a lista vai em `months`. */

export interface MonthsCfg { month: number | null; quickFilter?: string | null; months?: number[] }

export const isMultiMonths = (c: { months?: number[] }): boolean => (c.months?.length || 0) > 1;

/** O mês (0-11) entra no período escolhido? Considera um mês só, vários meses ou o ano todo. */
export const monthInPeriod = (c: { month: number | null; months?: number[] }, m: number): boolean =>
  isMultiMonths(c) ? c.months!.includes(m) : c.month === null || c.month === m;

/** O botão do mês aparece marcado? */
export const monthOn = (c: MonthsCfg, idx: number): boolean =>
  !c.quickFilter && (isMultiMonths(c) ? c.months!.includes(idx) : c.month === idx);

/** O "Anual" aparece marcado? */
export const yearOn = (c: MonthsCfg): boolean => !c.quickFilter && c.month === null && !isMultiMonths(c);

/** Meses já escolhidos (para somar ou tirar um). */
const currentSet = (c: MonthsCfg): number[] => (c.quickFilter ? [] : isMultiMonths(c) ? [...c.months!] : c.month !== null ? [c.month] : []);

/** Aplica um toque duplo no mês `idx` sobre a seleção `base`. */
export const toggleMonth = <T extends MonthsCfg>(base: T, idx: number): T => {
  const cur = currentSet(base);
  const next = cur.includes(idx) ? cur.filter(m => m !== idx) : [...cur, idx].sort((a, b) => a - b);
  if (next.length === 0) return { ...base, month: idx, months: undefined, quickFilter: null };
  if (next.length === 1) return { ...base, month: next[0], months: undefined, quickFilter: null };
  return { ...base, month: null, months: next, quickFilter: null };
};

/** Um toque: só aquele mês. */
export const singleMonth = <T extends MonthsCfg>(base: T, idx: number): T => ({ ...base, month: idx, months: undefined, quickFilter: null });
