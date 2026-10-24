import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Tags, FolderTree } from 'lucide-react';
import CategoryTagPicker from './CategoryTagPicker';
import CategoryCompareBox from './CategoryCompareBox';
import { useAddLayerNode, useLayers, useTaxonomy } from './LayersContext';
import { useMasterInfo } from './MasterContext';
import { nodeForItem } from '../services/masterService';
import { currentPick, isSelectable, pathParts, pickOptions, resolvePick, restText } from '../services/categoryPick';
import { saveLayerPin } from '../services/layerPins';
import { buildAlignIndex, inStructure, resolveCategory, structureKeys } from '../services/categoryAlign';
import { leafFor } from '../services/categoryLayers';
import { nodePath, suggestFromPatterns } from '../services/layerLearning';

/* Como a pessoa escolhe: por etiquetas (camada a camada) ou pela árvore de pastas com busca. Vale para todos os itens e fica guardado. */
export const PICKER_MODE_KEY = 'eukasconta_picker_mode';
export type PickerMode = 'tags' | 'tree';
const readMode = (): PickerMode => { try { return localStorage.getItem(PICKER_MODE_KEY) === 'tree' ? 'tree' : 'tags'; } catch { return 'tags'; } };
const MODE_EVENT = 'eukasconta-picker-mode';

/* Categoria de um item de compra, escolhida pela árvore (departamento › categoria › grupo › item) com busca por digitação.
   Escolher um grupo ou item troca a categoria para a dele e fixa a descrição nele: vale para todas as compras com a mesma
   descrição (layerPins.ts). Escolher uma categoria deixa o app deduzir o grupo/item pelo nome, como antes. */
const ItemCategoryPicker: React.FC<{
  category: string;
  description: string;
  /** todas as descrições a que a escolha vale (um produto reúne vários nomes do cupom); sem isto, só `description` */
  descriptions?: string[];
  /** nomes de categoria que o app usa ("Departamento - Categoria") */
  categories: string[];
  /** a categoria do item mudou (ou foi escolhida de novo) */
  onPick: (category: string) => void;
  testId?: string;
  autoFocus?: boolean;
  /** lista de muitos itens: não repete a frase "Agora: ..." em cada um (o aviso de fixação continua) */
  compact?: boolean;
  /** mostra o caminho completo em cima da escolha (some quando a tela já o mostra no cabeçalho) */
  showPath?: boolean;
  /** código do produto (liga o item à tabela mãe) */
  code?: string;
}> = ({ category, description, descriptions, categories, onPick, testId = 'item-cat', autoFocus = false, compact = false, showPath = true, code }) => {
  const masterInfo = useMasterInfo();
  const layers = useLayers();
  const addNode = useAddLayerNode();
  const taxonomy = useTaxonomy();
  const options = useMemo(() => pickOptions(taxonomy, layers), [taxonomy, layers]);
  const cur = useMemo(() => currentPick(category, description, options, layers), [category, description, options, layers]);
  const wrap = useRef<HTMLDivElement>(null);
  const [mode, setModeState] = useState<PickerMode>(readMode);
  useEffect(() => {
    const sync = () => setModeState(readMode());
    window.addEventListener(MODE_EVENT, sync);
    return () => window.removeEventListener(MODE_EVENT, sync);
  }, []);
  const setMode = (m: PickerMode) => {
    try { localStorage.setItem(PICKER_MODE_KEY, m); } catch { /* sem armazenamento: vale só nesta tela */ }
    setModeState(m);
    try { window.dispatchEvent(new Event(MODE_EVENT)); } catch { /* sem janela */ }
  };
  // item ainda sem grupo/item: se o que a pessoa já fixou aponta um lugar, sugere (um toque para usar)
  const suggestion2 = useMemo(() => {
    if (!category || !description.trim()) return null;
    const leaf = leafFor(layers, category, description);
    if (leaf && !leaf.rest) return null;
    const hit = suggestFromPatterns(layers, category, description);
    return hit && !hit.node.rest ? { id: hit.node.key, path: nodePath(hit.node), via: hit.via } : null;
  }, [layers, category, description]);
  // categoria do item que não está na Estrutura de Taxonomia: avisa e, se der, sugere a certa
  const outside = useMemo(() => !inStructure(category, structureKeys(taxonomy)), [category, taxonomy]);
  const suggestion = useMemo(() => {
    if (!outside) return null;
    const r = resolveCategory(category, buildAlignIndex(taxonomy));
    return r.target && (r.conf === 'alta' || r.conf === 'media') ? r.target.path : null;
  }, [outside, category, taxonomy]);

  // cadeia completa (departamento › categoria › grupo › item), em linhas que quebram em vez de cortar
  const chain = useMemo(() => pathParts(cur), [cur]);

  // produto que a tabela mãe conhece: a categoria vem do administrador (muda pela planilha), aqui só se confere
  const fromMaster = !!(masterInfo.master && nodeForItem(masterInfo.master, code, description));
  if (fromMaster) {
    return (
      <div data-testid={`${testId}-master`}>
        {chain.length > 0 && showPath && (
          <p className="text-[12.5px] leading-snug text-zinc-300 break-words">{chain.map((p, i) => (
            <React.Fragment key={i}>{i > 0 && <span className="text-luxury-gold/70 mx-1">›</span>}<span className={i === chain.length - 1 ? 'font-semibold text-zinc-100' : ''}>{p}</span></React.Fragment>
          ))}</p>
        )}
        <p className="mt-1 text-[11.5px] text-zinc-500 leading-snug">Categoria definida pela tabela mãe{masterInfo.isAdmin ? '. Para mudar, edite a planilha e publique em Config › Tabela mãe.' : '. Se estiver errada, avise o administrador.'}</p>
      </div>
    );
  }

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
    const all = descriptions && descriptions.length ? descriptions : [description];
    all.forEach(d => { if (d.trim()) saveLayerPin(r.category, d, r.pin); });
    onPick(r.category);
  };

  const many = !!descriptions && descriptions.length > 1;
  const hint = cur.pinned
    ? `Fixado em ${cur.now ?? restText()}, para ${many ? 'todas as compras deste produto' : `todas as compras de “${description.trim()}”`}.`
    : cur.now && !compact ? `Agora: ${cur.now}. Escolha um grupo ou item para fixar ${many ? 'este produto' : 'esta descrição'}.` : '';

  return (
    <div ref={wrap} data-testid={testId}
      onFocusCapture={() => { setTimeout(() => wrap.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 60); }}>
      <div className="flex items-center justify-between mb-1.5" role="group" aria-label="Jeito de escolher">
        <span className="text-[11px] text-zinc-500">Escolher por</span>
        <div className="flex rounded-full bg-white/5 border border-white/10 p-0.5">
          {([['tags', 'Etiquetas', Tags], ['tree', 'Pastas', FolderTree]] as const).map(([k, label, Ic]) => (
            <button key={k} type="button" onClick={() => setMode(k)} data-testid={`${testId}-mode-${k}`} aria-pressed={mode === k}
              className={`px-2.5 h-7 rounded-full text-[11.5px] font-semibold flex items-center gap-1 ${mode === k ? 'bg-luxury-gold text-black' : 'text-zinc-400'}`}>
              <Ic className="w-3 h-3" /> {label}
            </button>
          ))}
        </div>
      </div>
      {showPath && chain.length > 0 && (
        <p className="mb-2.5 text-[12.5px] leading-snug text-zinc-300 break-words" data-testid={`${testId}-chain`} aria-label={`Caminho completo: ${chain.join(', ')}`}>
          {chain.map((p, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-luxury-gold/70 mx-1">›</span>}
              <span className={i === chain.length - 1 ? 'font-semibold text-zinc-100' : ''}>{p}</span>
            </React.Fragment>
          ))}
        </p>
      )}
      {mode === 'tags' ? (
        <CategoryTagPicker options={options} selectedId={cur.id} onChoose={choose} onCreate={addNode ? (parent, name) => addNode(parent, name, { code, description }) : undefined}
          createLabel={masterInfo.active && !masterInfo.isAdmin ? 'Sugerir etiqueta' : 'Nova etiqueta'} testId={`${testId}-tags`} />
      ) : (
        <CategoryCompareBox
          options={options} selected={[cur.id]} max={1} single
          onToggle={choose} selectable={isSelectable} autoFocus={autoFocus}
          testId={`${testId}-box`} placeholder="Buscar categoria" valueLabel={cur.label}
          listClass="md:w-[28rem] md:right-auto"
        />
      )}
      {suggestion2 && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-luxury-gold/30 bg-luxury-gold/[0.06] px-3 py-2" data-testid={`${testId}-suggest-layer`}>
          <Sparkles className="w-3.5 h-3.5 text-luxury-gold shrink-0" />
          <p className="min-w-0 flex-1 text-[12px] leading-snug text-zinc-300">Pelo que você já fixou (como “{suggestion2.via}”): <span className="text-zinc-100 font-semibold">{suggestion2.path.split(' › ').slice(2).join(' › ') || suggestion2.path}</span></p>
          <button type="button" onClick={() => choose(suggestion2.id)} data-testid={`${testId}-suggest-layer-use`}
            className="shrink-0 h-8 px-3 rounded-lg bg-luxury-gold text-black text-[12px] font-bold active:opacity-80">Usar</button>
        </div>
      )}
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
