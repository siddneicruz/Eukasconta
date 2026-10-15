import React from 'react';
import PeriodPicker from './PeriodPicker';
import type { PeriodConfig } from '../services/productPriceStats';

/* Seleção rápida de período do histórico de um item: 7 dias · 30 dias · Este mês · Este ano · Tudo,
   e um campo para escolher um período qualquer no calendário.
   Vale só para a tela do item: ao abrir outro item volta ao filtro do Início. */

export interface ItemPeriod {
  all: boolean;          // true = todo o histórico
  cfg: PeriodConfig;
}

const blank = { customStartDate: '', customEndDate: '' };

export const periodFromConfig = (c: PeriodConfig): ItemPeriod => ({
  all: false,
  cfg: { year: c.year, month: c.month, quickFilter: c.quickFilter, customStartDate: c.customStartDate || '', customEndDate: c.customEndDate || '' },
});

type ChipId = 'd7' | 'd30' | 'month' | 'year' | 'all';

interface Props {
  value: ItemPeriod;
  onChange: (next: ItemPeriod) => void;
  /** para onde volta ao limpar o período escolhido no calendário (o filtro do Início) */
  fallback: ItemPeriod;
}

const ItemPeriodBar: React.FC<Props> = ({ value, onChange, fallback }) => {
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth();
  const { all, cfg } = value;

  const active: Record<ChipId, boolean> = {
    d7: !all && cfg.quickFilter === '7d',
    d30: !all && cfg.quickFilter === '30d',
    month: !all && !cfg.quickFilter && cfg.month === cm && cfg.year === cy,
    year: !all && !cfg.quickFilter && cfg.month === null && cfg.year === cy,
    all,
  };

  const chips: { id: ChipId; label: string; go: () => void }[] = [
    { id: 'd7', label: '7 dias', go: () => onChange({ all: false, cfg: { year: cy, month: null, quickFilter: '7d', ...blank } }) },
    { id: 'd30', label: '30 dias', go: () => onChange({ all: false, cfg: { year: cy, month: null, quickFilter: '30d', ...blank } }) },
    { id: 'month', label: 'Este mês', go: () => onChange({ all: false, cfg: { year: cy, month: cm, quickFilter: null, ...blank } }) },
    { id: 'year', label: 'Este ano', go: () => onChange({ all: false, cfg: { year: cy, month: null, quickFilter: null, ...blank } }) },
    { id: 'all', label: 'Tudo', go: () => onChange({ all: true, cfg }) },
  ];

  const custom = !all && cfg.quickFilter === 'custom';
  const pickRange = (from: string, to: string) => {
    if (from || to) onChange({ all: false, cfg: { year: cy, month: null, quickFilter: 'custom', customStartDate: from, customEndDate: to } });
    else onChange(fallback);
  };

  return (
    <div className="space-y-2" data-testid="item-period-bar">
      <div className="grid grid-cols-5 gap-1.5 sm:flex sm:items-center sm:gap-2" role="group" aria-label="Período do histórico">
        {chips.map(c => (
          <button
            key={c.id} type="button" onClick={c.go} aria-pressed={active[c.id]} data-testid={`item-period-${c.id}`}
            className={`px-0.5 sm:px-4 py-2.5 sm:py-2 rounded-full text-[11px] min-[380px]:text-xs font-semibold whitespace-nowrap border transition-colors ${active[c.id] ? 'bg-luxury-gold text-black border-luxury-gold shadow-lg shadow-luxury-gold/10' : 'bg-white/[0.03] border-white/5 text-zinc-400 hover:text-white hover:bg-white/5'}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="sm:max-w-xs" data-testid="item-period-picker">
        <PeriodPicker start={custom ? cfg.customStartDate : ''} end={custom ? cfg.customEndDate : ''} onChange={pickRange}
          placeholder="Escolher outro período" size="compact" />
      </div>
    </div>
  );
};

export default ItemPeriodBar;
