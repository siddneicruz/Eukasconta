import { useRef, useCallback } from 'react';
import { MonthsCfg, singleMonth, toggleMonth } from '../services/monthsSelect';

/** Toque no mês: um toque escolhe só ele; dois toques seguidos somam (ou tiram) o mês da seleção. */
export const useMonthPick = <T extends MonthsCfg>(config: T, onChange: (c: T) => void) => {
  const last = useRef<{ idx: number; t: number; base: T } | null>(null);
  return useCallback((idx: number) => {
    const now = Date.now();
    const l = last.current;
    if (l && l.idx === idx && now - l.t < 450) {
      last.current = null;
      onChange(toggleMonth(l.base, idx));
      return;
    }
    last.current = { idx, t: now, base: config };
    onChange(singleMonth(config, idx));
  }, [config, onChange]);
};
