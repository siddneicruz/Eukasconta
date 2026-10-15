/* Período padrão do app: sempre o mês atual (do dia 1 até hoje). Ele acompanha o calendário:
   a cada dia que passa o período cresce um dia, até fechar o mês; no mês seguinte começa de novo. */

export const currentYearMonth = (now: Date = new Date()): { year: number; month: number } => ({ year: now.getFullYear(), month: now.getMonth() });

/** true quando o filtro de período é o padrão (o mês atual, sem 7/30 dias nem datas escolhidas). */
export const isCurrentMonthPeriod = (c: { year: number; month: number | null; quickFilter?: string | null }, now: Date = new Date()): boolean =>
  !c.quickFilter && c.month === now.getMonth() && c.year === now.getFullYear();
