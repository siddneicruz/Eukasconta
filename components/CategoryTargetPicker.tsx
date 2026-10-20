import React, { useMemo, useRef } from 'react';
import CategoryCompareBox from './CategoryCompareBox';
import { useLayers, useTaxonomy } from './LayersContext';
import { catId, deptId } from '../services/categoryCompare';
import { pickOptions, resolvePick } from '../services/categoryPick';

/** Destino da troca: o mesmo seletor das outras telas (busca por digitação + árvore Departamento › Categoria).
    Aqui só se escolhe categoria (ou departamento sem categorias); nada é fixado antes de aplicar. */
const CategoryTargetPicker: React.FC<{ value: string; categories: string[]; onPick: (category: string) => void; testId: string }> = ({ value, categories, onPick, testId }) => {
  const layers = useLayers();
  const taxonomy = useTaxonomy();
  const options = useMemo(() => pickOptions(taxonomy, layers), [taxonomy, layers]);
  const wrap = useRef<HTMLDivElement>(null);
  // sem estrutura de categorias (conta nova): lista simples, como era
  if (options.length === 0) {
    return (
      <select value={value} onChange={e => onPick(e.target.value)} data-testid={`${testId}-fallback`}
        className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-3 text-[13px] text-luxury-gold focus:border-luxury-gold/50 outline-none font-semibold">
        {(categories.includes(value) ? categories : [value, ...categories]).map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  }
  const id = value.includes(' - ') ? catId(value) : deptId(value);
  const label = (options.find(o => o.id === id)?.full || value).split(' - ').join(' › ');
  return (
    <div ref={wrap} data-testid={testId} data-value={value}
      onFocusCapture={() => { setTimeout(() => wrap.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 60); }}
      onClickCapture={e => { if ((e.target as Element).closest('[data-testid$="-toggle"]')) setTimeout(() => wrap.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 60); }}>
      <CategoryCompareBox
        options={options} selected={[id]} max={1} single
        onToggle={optId => { const r = resolvePick(optId, options, categories, layers); if (r) onPick(r.category); }}
        selectable={(o, kids) => o.kind === 'cat' || (o.kind === 'dept' && kids === 0)}
        testId={`${testId}-box`} placeholder="Buscar categoria" valueLabel={label}
        listClass="md:w-[28rem] md:right-auto"
      />
    </div>
  );
};


export default CategoryTargetPicker;
