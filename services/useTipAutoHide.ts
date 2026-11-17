import { useCallback, useEffect, useRef, useState } from 'react';

/** Rótulo (tooltip) de gráfico que some sozinho: no celular o rótulo do Recharts fica preso na tela até outro toque.
 *  Cada toque/movimento no gráfico reinicia o relógio; parado por `ms`, o rótulo é escondido na hora (sem animação). */
export const useTipAutoHide = (ms = 1500) => {
  const [off, setOff] = useState(false);
  const t = useRef<number | undefined>(undefined);
  const wake = useCallback(() => {
    setOff(o => (o ? false : o));
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setOff(true), ms);
  }, [ms]);
  useEffect(() => () => window.clearTimeout(t.current), []);
  return {
    /** passe em <Tooltip active={...}> */
    active: off ? false : undefined,
    /** espalhe no div que envolve o gráfico */
    bind: { onPointerDown: wake, onPointerMove: wake, onTouchStart: wake, onTouchMove: wake } as const,
  };
};
