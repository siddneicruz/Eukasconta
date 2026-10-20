import React, { useEffect, useRef, useState } from 'react';
import { Calendar, CalendarDays, ChevronDown, RotateCcw } from 'lucide-react';
import { DashboardConfig } from '../types';
import PeriodPicker from './PeriodPicker';
import { isCurrentMonthPeriod } from '../services/currentMonth';
import { MONTHS_SHORT, resetPeriod, shortPeriod } from '../services/periodFilter';

/* Filtro de período do Histórico, igual ao do Início: fechado é só um botão com o período ("01/10 a 20/10");
   ao tocar abre o ano, os meses, 7 dias e o calendário de período. A escolha é a mesma do Início (a config é compartilhada). */

interface Props {
  config: DashboardConfig;
  onConfigChange: (config: DashboardConfig) => void;
  testId?: string;
}

const PeriodFilterBar: React.FC<Props> = ({ config, onConfigChange, testId = 'hist-period' }) => {
  const [open, setOpen] = useState(false);
  const monthsRef = useRef<HTMLDivElement>(null);
  const changed = !isCurrentMonthPeriod(config);
  const custom = config.quickFilter === 'custom';
  const years = Array.from(new Set([2024, 2025, 2026, new Date().getFullYear(), config.year])).sort((a, b) => a - b);
  const set = (p: Partial<DashboardConfig>) => onConfigChange({ ...config, ...p });

  // ao abrir, o mês escolhido aparece na fileira (ela rola para o lado)
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      try { monthsRef.current?.querySelector<HTMLElement>('[data-on="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch { /* sem scrollIntoView */ }
    }, 30);
    return () => clearTimeout(t);
  }, [open, custom]);

  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-1 overflow-hidden" data-testid={testId} data-open={open ? 'true' : 'false'}>
      <div className="flex items-center gap-1.5 pl-3 pr-1 min-h-[40px]">
        <CalendarDays className="w-4 h-4 text-zinc-500 shrink-0" />
        <span className="flex-1 min-w-0 truncate text-xs font-bold uppercase tracking-[0.08em] text-zinc-400">Período</span>
        {!open && changed && (
          <button type="button" onClick={() => onConfigChange(resetPeriod(config))} title="Voltar ao mês atual" aria-label="Voltar ao mês atual" data-testid={`${testId}-reset`}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl border border-white/5 text-zinc-500 active:text-luxury-gold">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid={`${testId}-toggle`}
          className={`shrink-0 h-9 pl-2.5 pr-2 rounded-xl flex items-center gap-1.5 text-xs font-bold border transition-colors ${open ? 'bg-luxury-gold text-black border-luxury-gold' : 'filter-chip bg-luxury-gold/10 text-luxury-gold border-luxury-gold/25'}`}>
          <CalendarDays className="w-3.5 h-3.5" />
          <span className="whitespace-nowrap" data-testid={`${testId}-summary`}>{shortPeriod(config)}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-1 px-1 pb-1" data-testid={`${testId}-body`}>
          <div className="flex items-center gap-1.5">
            {!custom && (
              <div className="flex-1 min-w-0 flex items-center gap-2 px-3">
                <CalendarDays className="w-4 h-4 text-zinc-500 shrink-0" />
                <select value={config.year} onChange={e => set({ year: Number(e.target.value) })} aria-label="Ano" data-testid={`${testId}-year`}
                  className="bg-transparent text-xs font-bold text-zinc-300 focus:outline-none cursor-pointer uppercase tracking-[0.08em] min-h-[36px]">
                  {years.map(y => <option key={y} value={y} className="bg-black text-white">{y}</option>)}
                </select>
              </div>
            )}
            {custom && <div className="flex-1" />}
            <button type="button" onClick={() => set({ quickFilter: config.quickFilter === '7d' ? null : '7d', month: null })} aria-pressed={config.quickFilter === '7d'} data-testid={`${testId}-7d`}
              className={`h-9 px-3 rounded-xl text-xs font-bold border transition-all ${config.quickFilter === '7d' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'border-white/5 text-zinc-500'}`}>7 DIAS</button>
            <button type="button" onClick={() => set({ quickFilter: custom ? null : 'custom', month: null })} aria-pressed={custom} aria-label="Escolher um período" data-testid={`${testId}-custom`}
              className={`h-9 px-3 rounded-xl text-xs font-bold border transition-all flex items-center gap-2 ${custom ? 'bg-luxury-gold text-black border-luxury-gold' : 'border-white/5 text-zinc-500'}`}><Calendar className="w-3.5 h-3.5" /> <span>PERÍODO</span></button>
          </div>

          {custom ? (
            <div className="px-1 pt-0.5">
              <PeriodPicker
                start={config.customStartDate}
                end={config.customEndDate}
                onChange={(from, to) => set({ customStartDate: from, customEndDate: to })}
                placeholder="Escolher período"
                size="compact"
                openOnMount={!config.customStartDate && !config.customEndDate}
              />
            </div>
          ) : (
            <div ref={monthsRef} className="flex items-center justify-start gap-0.5 px-1 overflow-x-auto no-scrollbar" data-testid={`${testId}-months`}>
              <button type="button" onClick={() => set({ month: null, quickFilter: null })} data-on={config.month === null && !config.quickFilter ? 'true' : 'false'} data-testid={`${testId}-year-all`}
                className={`px-3 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${config.month === null && !config.quickFilter ? 'bg-luxury-gold text-black shadow-lg shadow-luxury-gold/20' : 'text-zinc-500 hover:text-white'}`}>
                ANUAL
              </button>
              {MONTHS_SHORT.map((m, idx) => (
                <button key={m} type="button" onClick={() => set({ month: idx, quickFilter: null })} data-on={config.month === idx && !config.quickFilter ? 'true' : 'false'} data-testid={`${testId}-month-${idx}`}
                  className={`px-2.5 py-2 rounded-full text-xs font-bold transition-all ${config.month === idx && !config.quickFilter ? 'bg-luxury-gold/15 text-luxury-gold' : 'text-zinc-500 hover:text-zinc-300'}`}>
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PeriodFilterBar;
