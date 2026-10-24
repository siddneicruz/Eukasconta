import React, { useMemo } from 'react';
import { useLayers, useTaxonomy } from './LayersContext';
import { currentPick, pathParts, pickOptions } from '../services/categoryPick';

/* O caminho completo de um item (departamento › categoria › grupo › item), para o cabeçalho de quem tem a categoria para escolher. */
const ItemPathLine: React.FC<{ category: string; description: string; className?: string; testId?: string }> = ({ category, description, className = '', testId = 'item-path' }) => {
  const layers = useLayers();
  const taxonomy = useTaxonomy();
  const parts = useMemo(() => {
    if (!category) return [];
    const options = pickOptions(taxonomy, layers);
    return pathParts(currentPick(category, description, options, layers));
  }, [category, description, taxonomy, layers]);
  if (parts.length === 0) return null;
  return (
    <p className={`text-[12px] leading-snug text-zinc-300 break-words ${className}`} data-testid={testId} aria-label={`Caminho completo: ${parts.join(', ')}`}>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-luxury-gold/70 mx-1">›</span>}
          <span className={i === parts.length - 1 ? 'font-semibold text-zinc-100' : ''}>{p}</span>
        </React.Fragment>
      ))}
    </p>
  );
};

export default ItemPathLine;
