import { DashboardConfig } from '../types';
import { isCurrentMonthPeriod } from './currentMonth';

/* Filtro de período compartilhado: o texto curto do botão fechado e a lista de meses. O Início e o Histórico usam o mesmo. */

export const MONTHS_SHORT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

/** Período em poucas letras para a barra de filtros fechada ("Mai 2026", "Ano 2026", "7 dias", "01/05 a 15/05"). */
export const shortPeriod = (c: Pick<DashboardConfig, 'year' | 'month' | 'quickFilter' | 'customStartDate' | 'customEndDate'>): string => {
  if (c.quickFilter === '7d') return '7 dias';
  if (c.quickFilter === '30d') return '30 dias';
  if (c.quickFilter === 'custom') {
    const dm = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');
    if (c.customStartDate && c.customEndDate) return `${dm(c.customStartDate)} a ${dm(c.customEndDate)}`;
    return 'Período';
  }
  // mês atual: do dia 1 até hoje ("01/10 a 15/10"); cresce um dia a cada dia até fechar o mês
  if (isCurrentMonthPeriod(c)) {
    const t = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `01/${p2(t.getMonth() + 1)} a ${p2(t.getDate())}/${p2(t.getMonth() + 1)}`;
  }
  if (c.month !== null && c.month !== undefined) return `${MONTHS_SHORT[c.month].charAt(0)}${MONTHS_SHORT[c.month].slice(1).toLowerCase()} ${c.year}`;
  return `Ano ${c.year}`;
};

/** Volta só o período para o mês atual (mantém item, loja e categoria escolhidos). */
export const resetPeriod = (c: DashboardConfig, now: Date = new Date()): DashboardConfig =>
  ({ ...c, year: now.getFullYear(), month: now.getMonth(), quickFilter: null, customStartDate: '', customEndDate: '' });
