import React, { useMemo } from 'react';
import { Receipt } from '../types';
import {
  DeptFilter, NO_DEPT_FILTER, buildDeptOptions, deptState, includedLeaves, indexOptions, isDeptFilterActive, toggleNodeSel,
} from '../services/deptFilter';

/* Retângulos de departamento logo abaixo do período: um toque mostra só aquele departamento (vários podem ficar ligados).
   É o mesmo filtro de categorias do Início, então o que se escolhe aqui vale lá e vice-versa. "Todos" limpa. */

const DeptChipsBar: React.FC<{ receipts: Receipt[]; filter: DeptFilter; onChange: (f: DeptFilter) => void }> = ({ receipts, filter, onChange }) => {
  const options = useMemo(() => buildDeptOptions(receipts, receipts), [receipts]);
  const idx = useMemo(() => indexOptions(options), [options]);
  const depts = useMemo(() => options.filter(o => o.kind === 'dept').sort((a, b) => b.total - a.total), [options]);
  const inc = useMemo(() => includedLeaves(filter, idx), [filter, idx]);
  const active = isDeptFilterActive(filter);
  if (depts.length < 2) return null;

  const tap = (key: string) => {
    if (!active) onChange({ mode: 'only', keys: [key] });
    else if (filter.mode === 'only' && filter.keys.length === 1 && filter.keys[0] === key) onChange(NO_DEPT_FILTER); // desligou o último: volta para "Todos"
    else onChange(toggleNodeSel(filter, idx, key));
  };
  const base = 'shrink-0 h-8 px-3 rounded-lg border text-[12px] font-semibold whitespace-nowrap transition-colors';
  return (
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1" role="group" aria-label="Filtrar por departamento" data-testid="dept-chips">
      <button type="button" onClick={() => onChange(NO_DEPT_FILTER)} aria-pressed={!active} data-testid="dept-chip-todos"
        className={`${base} ${!active ? 'bg-luxury-gold text-black border-luxury-gold' : 'bg-zinc-900/60 border-white/10 text-zinc-400'}`}>Todos</button>
      {depts.map(d => {
        const on = active && deptState(idx, inc, d.key) !== 'none';
        return (
          <button key={d.key} type="button" onClick={() => tap(d.key)} aria-pressed={on} data-testid={`dept-chip-${d.key}`}
            className={`${base} ${on ? 'bg-luxury-gold text-black border-luxury-gold' : 'bg-zinc-900/60 border-white/10 text-zinc-400'}`}>{d.label}</button>
        );
      })}
    </div>
  );
};

export default DeptChipsBar;
