import React, { useMemo, useRef } from 'react';
import CategoryCompareBox from './CategoryCompareBox';
import { useLayers, useTaxonomy } from './LayersContext';
import { currentPick, isSelectable, pickOptions, resolvePick, restText } from '../services/categoryPick';
import { saveLayerPin } from '../services/layerPins';
import { buildAlignIndex, inStructure, resolveCategory, structureKeys } from '../services/categoryAlign';

/* Categoria de um item de compra, escolhida pela árvore (departamento › categoria › grupo › item) com busca por digitação.
   Escolher um grupo ou item troca a categoria para a dele e fixa a descrição nele: vale para todas as compras com a mesma
   descrição (layerPins.ts). Escolher uma categoria deixa o app deduzir o grupo/item pelo nome, como antes. */
const ItemCategoryPicker: React.FC<{
  category: string;
  description: string;
  /** nomes de categoria que o app usa ("Departamento - Categoria") */
  categories: string[];
  /** a categoria do item mudou (ou foi escolhida de novo) */
  onPick: (category: string) => void;
  testId?: string;
  autoFocus?: boolean;
}> = ({ category, description, categories, onPick, testId = 'item-cat', autoFocus = false }) => {
  const layers = useLayers();
  const taxonomy = useTaxonomy();
  const options = useMemo(() => pickOptions(taxonomy, layers), [taxonomy, layers]);
  const cur = useMemo(() => currentPick(category, description, options, layers), [category, description, options, layers]);
  const wrap = useRef<HTMLDivElement>(null);
  // categoria do item que não está na Estrutura de Taxonomia: avisa e, se der, sugere a certa
  const outside = useMemo(() => !inStructure(category, structureKeys(taxonomy)), [category, taxonomy]);
  const suggestion = useMemo(() => {
    if (!outside) return null;
    const r = resolveCategory(category, buildAlignIndex(taxonomy));
    return r.target && (r.conf === 'alta' || r.conf === 'media') ? r.target.path : null;
  }, [outside, category, taxonomy]);

  // sem estrutura de categorias (conta nova): lista simples, como era
  if (options.length === 0) {
    return (
      <select value={category} onChange={e => onPick(e.target.value)} data-testid={`${testId}-fallback`}
        className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-xs text-zinc-300">
        {(categories.includes(category) ? categories : [category, ...categories]).map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  }

  const choose = (id: string) => {
    const r = resolvePick(id, options, categories, layers);
    if (!r) return;
    if (description.trim()) saveLayerPin(r.category, description, r.pin);
    onPick(r.category);
  };

  const hint = cur.pinned
    ? `Fixado em ${cur.now ?? restText()}, para todas as compras de “${description.trim()}”.`
    : cur.now ? `Agora: ${cur.now}. Escolha um grupo ou item para fixar esta descrição.` : '';

  return (
    <div ref={wrap} data-testid={testId}
      onFocusCapture={() => { setTimeout(() => wrap.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 60); }}>
      <CategoryCompareBox
        options={options} selected={[cur.id]} max={1} single
        onToggle={choose} selectable={isSelectable} autoFocus={autoFocus}
        testId={`${testId}-box`} placeholder="Buscar categoria" valueLabel={cur.label}
        listClass="md:w-[28rem] md:right-auto"
      />
      {outside && (
        <div className="mt-1 flex items-center gap-2" data-testid={`${testId}-outside`}>
          <p className="min-w-0 flex-1 text-[11px] text-zinc-500 leading-snug">Esta categoria não está na Estrutura de Taxonomia.</p>
          {suggestion && (
            <button type="button" onClick={() => onPick(suggestion)} data-testid={`${testId}-suggest`}
              className="shrink-0 max-w-[60%] truncate h-8 px-3 rounded-lg border border-luxury-gold/50 text-[11.5px] font-bold text-zinc-100">Usar {suggestion.split(' - ').join(' › ')}</button>
          )}
        </div>
      )}
      {hint && <p className="mt-1 text-[11px] text-zinc-500 leading-snug" data-testid={`${testId}-hint`}>{hint}</p>}
    </div>
  );
};

export default ItemCategoryPicker;
