
import React, { useState, useMemo, useEffect } from 'react';
import {
    Search, BrainCircuit, RefreshCw, Check, ArrowRight,
    Sparkles, X, Merge, ChevronDown, Scissors, Tags, Barcode
} from 'lucide-react';
import { Receipt, TaxonomyNode, MasterProduct } from '../types';
import { titleCase } from '../services/textFormat';
import { fold, queryTokens } from '../services/itemSearch';
import { buildProductGroups, suggestClusters, ProductGroup, DupCluster } from '../services/productUnify';
import { ProductUnifySheet, ProductDupSheet, UnifyPlan } from './ProductUnifySheet';
import CategoryFixSheet from './CategoryFixSheet';
import { suggestCategoryFixes } from '../services/categoryRules';
import ProductCodesPanel, { StoreOption } from './ProductCodesPanel';
import { CodeOp, codesOf } from '../services/productCodes';

interface ProductMappingEditorProps {
  receipts: Receipt[];
  taxonomy: TaxonomyNode[];
  masterProducts?: MasterProduct[];
  onUpdateBatchMapping: (mappings: { description: string, newCategory: string }[]) => void;
  // Junta os produtos escolhidos num só (nome e categoria já definidos pela pessoa)
  onUnifyProducts?: (plan: UnifyPlan) => void;
  // Tira um nome de cupom de um produto unificado e faz dele um produto à parte
  onSplitProduct?: (desc: string, group: ProductGroup) => void;
  // Lojas para escolher ao acrescentar o código que uma loja usa para o produto
  stores?: StoreOption[];
  // Acrescenta ou tira um código (de barras ou de loja) do produto; devolve o texto do erro, ou null quando gravou
  onEditCodes?: (masterCode: string, op: CodeOp) => string | null;
}

interface Suggestion {
    key: string;
    name: string;
    currentCategory: string;
    count: number;
    descs: string[];
    selected: boolean;
}

const IGNORED_KEY = 'eukasconta_dup_ignored';
const loadIgnored = (): Set<string> => {
    try {
        const raw = localStorage.getItem(IGNORED_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(list) ? list.filter((x: unknown) => typeof x === 'string') : []);
    } catch { return new Set(); }
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const STOP_WORDS = ['UN', 'KG', 'L', 'ML', 'DE', 'COM', 'PARA'];

const ProductMappingEditor: React.FC<ProductMappingEditorProps> = ({ receipts, taxonomy, masterProducts = [], onUpdateBatchMapping, onUnifyProducts, onSplitProduct, stores = [], onEditCodes }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [reviewModal, setReviewModal] = useState<{
        group: ProductGroup;
        newCategory: string;
        suggestions: Suggestion[];
    } | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [limit, setLimit] = useState(60);

    const [selectMode, setSelectMode] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [codesOpen, setCodesOpen] = useState<Set<string>>(new Set());
    const [unifyWith, setUnifyWith] = useState<ProductGroup[] | null>(null);
    const [dupOpen, setDupOpen] = useState(false);
    const [fixOpen, setFixOpen] = useState(false);
    const [ignored, setIgnored] = useState<Set<string>>(loadIgnored);

    const categoriesList = useMemo(() => {
        const list: string[] = [];
        const l1s = taxonomy.filter(n => n.level === 1);
        l1s.forEach(l1 => {
            const l2s = taxonomy.filter(n => n.parentId === l1.id);
            if (l2s.length === 0) {
                list.push(l1.name);
            } else {
                l2s.forEach(l2 => {
                    list.push(`${l1.name} - ${l2.name}`);
                });
            }
        });
        return list.sort();
    }, [taxonomy]);

    // Cada produto com os nomes de cupom que ele reúne
    const groups = useMemo(() => buildProductGroups(receipts, masterProducts), [receipts, masterProducts]);
    const masterByCode = useMemo(() => new Map(masterProducts.map(m => [m.code, m] as const)), [masterProducts]);
    const codeCountOf = (code: string): number => {
        const m = masterByCode.get(code);
        return m ? (m.eans?.length || 0) + Object.values((m.establishmentCodes || {}) as Record<string, string | string[]>).reduce((n, v) => n + codesOf(v).length, 0) : 0;
    };
    // A busca acha o produto também pelo código: o nosso (MAE…), o de barras ou o de qualquer loja
    const indexed = useMemo(() => groups.map(g => {
        const m = g.code ? masterByCode.get(g.code) : undefined;
        const codes = m ? [m.code, ...(m.eans || []), ...Object.values((m.establishmentCodes || {}) as Record<string, string | string[]>).flatMap(v => codesOf(v))] : [];
        return { g, hay: [fold(g.name), ...g.descs.map(d => fold(d.desc)), ...codes.map(c => fold(c))].join('|') };
    }), [groups, masterByCode]);

    const filtered = useMemo(() => {
        const tokens = queryTokens(searchTerm);
        if (!tokens.length) return groups;
        return indexed.filter(x => tokens.every(t => x.hay.includes(t))).map(x => x.g);
    }, [indexed, groups, searchTerm]);

    // Itens que parecem estar na categoria errada (ex.: linguiça e bacon em Carne Suína)
    const fixes = useMemo(() => suggestCategoryFixes(receipts, categoriesList), [receipts, categoriesList]);
    const fixCount = useMemo(() => fixes.reduce((n, f) => n + f.items.length, 0), [fixes]);

    const clusters = useMemo(() => suggestClusters(groups).filter(c => !ignored.has(c.id)), [groups, ignored]);

    // Marcação que sobrou de um produto que já não existe (foi unificado) sai sozinha
    useEffect(() => {
        setSelected(prev => {
            const alive = new Set(groups.map(g => g.key));
            const next = new Set(Array.from(prev).filter(k => alive.has(k)));
            return next.size === prev.size ? prev : next;
        });
    }, [groups]);

    const visible = filtered.slice(0, limit);
    const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
    const canUnify = !!onUnifyProducts;

    // Algoritmo de busca de itens relacionados
    const findRelatedItems = (target: ProductGroup, newCategory: string): Suggestion[] => {
        const tokens = target.name.split(' ').filter(t => t.length > 2 && !STOP_WORDS.includes(t));
        return groups
            .filter(o => {
                if (o.key === target.key) return false;
                // Critério: contém pelo menos um token importante e ainda não está na categoria nova
                const matchesTokens = tokens.some(t => o.name.includes(t) || o.descs.some(d => d.desc.includes(t)));
                return matchesTokens && o.category !== newCategory;
            })
            .map(o => ({
                key: o.key,
                name: o.name,
                currentCategory: o.category,
                count: o.count,
                descs: o.descs.map(d => d.desc),
                selected: true // Por padrão, sugerimos aplicar a todos os similares
            }));
    };

    const handleInitiateChange = (group: ProductGroup, newCategory: string) => {
        const uniform = group.descs.every(d => d.cats.length === 1 && d.cats[0] === newCategory);
        if (uniform) return;

        const related = findRelatedItems(group, newCategory);

        if (related.length > 0) {
            setReviewModal({ group, newCategory, suggestions: related });
        } else {
            // Se não houver relacionados, aplica apenas ao produto atual
            onUpdateBatchMapping(group.descs.map(d => ({ description: d.desc, newCategory })));
        }
    };

    const handleApplyBatch = () => {
        if (!reviewModal) return;
        setIsProcessing(true);

        const updates = [
            ...reviewModal.group.descs.map(d => ({ description: d.desc, newCategory: reviewModal.newCategory })),
            ...reviewModal.suggestions
                .filter(s => s.selected)
                .flatMap(s => s.descs.map(desc => ({ description: desc, newCategory: reviewModal.newCategory })))
        ];

        setTimeout(() => {
            onUpdateBatchMapping(updates);
            setIsProcessing(false);
            setReviewModal(null);
        }, 800);
    };

    const toggleSuggestion = (key: string) => {
        if (!reviewModal) return;
        setReviewModal({
            ...reviewModal,
            suggestions: reviewModal.suggestions.map(s =>
                s.key === key ? { ...s, selected: !s.selected } : s
            )
        });
    };

    const toggleSelect = (key: string) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    const toggleCodes = (key: string) => setCodesOpen(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    const toggleOpen = (key: string) => setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    const leaveSelectMode = () => { setSelectMode(false); setSelected(new Set()); };

    const searching = queryTokens(searchTerm).length > 0;
    const pickedGroups = groups.filter(g => selected.has(g.key));
    const markShown = () => setSelected(prev => { const next = new Set(prev); filtered.forEach(g => next.add(g.key)); return next; });

    const confirmUnify = (plan: UnifyPlan) => {
        onUnifyProducts?.(plan);
        setUnifyWith(null);
        leaveSelectMode();
    };

    const ignoreCluster = (c: DupCluster) => {
        setIgnored(prev => {
            const next = new Set(prev);
            next.add(c.id);
            try { localStorage.setItem(IGNORED_KEY, JSON.stringify(Array.from(next))); } catch { /* sem armazenamento: vale só nesta sessão */ }
            return next;
        });
    };

    const categorySelect = (g: ProductGroup) => (
        <label className="block mt-3">
            <span className="sr-only">Categoria de {titleCase(g.name)}</span>
            <select
                value={g.category}
                onChange={(e) => handleInitiateChange(g, e.target.value)}
                className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2.5 text-[13px] text-zinc-200 focus:border-luxury-gold/50 outline-none cursor-pointer font-medium truncate"
            >
                {!categoriesList.includes(g.category) && <option value={g.category}>{g.category} (fora da Estrutura)</option>}
                {categoriesList.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                ))}
            </select>
        </label>
    );

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="bg-black/40 border border-white/5 rounded-[2.5rem] p-5 sm:p-8 shadow-2xl relative">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6 mb-4 relative z-10">
                    <div>
                        <h3 className="text-lg sm:text-xl font-serif text-white uppercase tracking-tight flex items-center gap-3">
                            <BrainCircuit className="w-5 h-5 text-luxury-gold shrink-0" /> Mapping Intelligence
                        </h3>
                        <p className="text-zinc-400 text-xs mt-1.5">Confira a categoria de cada produto e junte os que têm nomes diferentes no cupom mas são o mesmo item.</p>
                    </div>

                    <div className="relative w-full md:w-96">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input
                            type="text"
                            placeholder="Buscar produto"
                            value={searchTerm}
                            onChange={e => { setSearchTerm(e.target.value); setLimit(60); }}
                            data-testid="prod-search"
                            className="w-full bg-black/60 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-luxury-gold/40 outline-none font-medium"
                        />
                    </div>
                </div>

                {fixes.length > 0 && (
                    <div className="mb-4 rounded-2xl border border-luxury-gold/30 bg-luxury-gold/[0.05] p-4 relative z-10" data-testid="fix-card">
                        <div className="flex items-start gap-3">
                            <Tags className="w-5 h-5 text-luxury-gold shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-zinc-100 leading-snug">
                                    {plural(fixCount, 'item parece estar', 'itens parecem estar')} na categoria errada
                                </p>
                                <p className="text-xs text-zinc-400 mt-1">{fixes.map(f => f.short).join(', ').replace(/^./, c => c.toUpperCase())}: carne trabalhada, não corte de porco, boi ou ave.</p>
                            </div>
                        </div>
                        <button type="button" onClick={() => setFixOpen(true)} data-testid="fix-open"
                            className="mt-3 w-full py-3 rounded-xl bg-luxury-gold text-black font-bold text-[11px] uppercase tracking-[0.08em] hover:bg-white transition-colors">
                            Revisar
                        </button>
                    </div>
                )}

                {canUnify && groups.length > 1 && (
                    <div className="flex gap-2 mb-4 relative z-10">
                        <button type="button" onClick={() => (selectMode ? leaveSelectMode() : setSelectMode(true))} data-testid="prod-select-toggle" aria-pressed={selectMode}
                            className={`flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl border text-[13px] font-semibold transition-colors ${selectMode ? 'bg-luxury-gold/10 border-luxury-gold/40 text-luxury-gold' : 'bg-white/5 border-white/10 text-zinc-200 hover:border-luxury-gold/40'}`}>
                            {selectMode ? <><X className="w-4 h-4" /> Cancelar</> : <><Merge className="w-4 h-4" /> Unificar itens</>}
                        </button>
                        <button type="button" onClick={() => setDupOpen(true)} data-testid="prod-dups-open"
                            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/10 text-zinc-200 text-[13px] font-semibold hover:border-luxury-gold/40 transition-colors">
                            <Sparkles className="w-4 h-4 text-luxury-gold" /> Sugestões{clusters.length > 0 && <span className="min-w-[1.4rem] px-1.5 py-0.5 rounded-full bg-luxury-gold text-black text-[11px] font-bold leading-none text-center" data-testid="prod-dups-count">{clusters.length}</span>}
                        </button>
                    </div>
                )}

                {selectMode && (
                    <p className="text-xs text-zinc-400 mb-3 px-1" data-testid="prod-select-hint">
                        Toque nos produtos que são o mesmo item.
                        {searching && filtered.length > 1 && filtered.length <= 40 && (
                            <button type="button" onClick={markShown} data-testid="prod-mark-shown" className="block mt-1 font-bold text-luxury-gold">Marcar os {filtered.length} da busca</button>
                        )}
                    </p>
                )}

                {groups.length > 0 && (
                    <p className="text-xs text-zinc-500 mb-3 px-1" data-testid="prod-count">
                        {searching ? `${filtered.length} de ${plural(groups.length, 'produto', 'produtos')}` : plural(groups.length, 'produto', 'produtos')}
                    </p>
                )}

                {filtered.length === 0 && (
                    <p className="text-sm text-zinc-500 text-center py-10">Nenhum produto encontrado.</p>
                )}

                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5" data-testid="prod-list">
                    {visible.map(g => {
                        const isOn = selected.has(g.key);
                        const isOpen = expanded.has(g.key);
                        const many = g.descs.length > 1;
                        const body = (
                            <>
                                <div className="flex items-start justify-between gap-3">
                                    <p className="text-sm font-semibold text-zinc-100 leading-snug min-w-0 break-words">{titleCase(g.name)}</p>
                                    <span className="shrink-0 text-xs font-semibold text-zinc-400 tabular-nums">{fmtBRL(g.total)}</span>
                                </div>
                                <p className="text-xs text-zinc-500 mt-1">
                                    {plural(g.count, 'compra', 'compras')}
                                    {many && ` · ${plural(g.descs.length, 'nome', 'nomes')} no cupom`}
                                    {g.curated && <span className="ml-2 inline-flex items-center gap-1 text-luxury-gold"><Check className="w-3 h-3" /> unificado</span>}
                                </p>
                            </>
                        );

                        return (
                            <li key={g.key} data-testid="prod-row" data-key={g.key} data-names={g.descs.length}
                                className={`rounded-2xl border p-4 transition-colors ${selectMode && isOn ? 'border-luxury-gold/40 bg-luxury-gold/[0.05]' : 'border-white/5 bg-zinc-900/30'}`}>
                                {selectMode ? (
                                    <label className="flex items-start gap-3 cursor-pointer">
                                        <input type="checkbox" checked={isOn} onChange={() => toggleSelect(g.key)} aria-label={`Marcar ${titleCase(g.name)}`}
                                            data-testid="prod-check" className="mt-0.5 w-5 h-5 shrink-0 accent-[#D4AF37]" />
                                        <span className="min-w-0 flex-1 block">{body}</span>
                                    </label>
                                ) : (
                                    <>
                                        {body}
                                        {categorySelect(g)}
                                        <div className="mt-2.5 flex flex-wrap items-center gap-x-5">
                                            {many && (
                                                <button type="button" onClick={() => toggleOpen(g.key)} aria-expanded={isOpen} data-testid="prod-names-toggle"
                                                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-luxury-gold transition-colors min-h-[36px]">
                                                    <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                                    {isOpen ? 'Esconder os nomes' : `Ver os ${g.descs.length} nomes`}
                                                </button>
                                            )}
                                            {g.code && masterByCode.has(g.code) && (
                                                <button type="button" onClick={() => toggleCodes(g.key)} aria-expanded={codesOpen.has(g.key)} data-testid="prod-codes-toggle"
                                                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-luxury-gold transition-colors min-h-[36px]">
                                                    <Barcode className="w-4 h-4" />
                                                    {codesOpen.has(g.key) ? 'Esconder os códigos' : codeCountOf(g.code) > 0 ? `Códigos (${codeCountOf(g.code)})` : 'Códigos'}
                                                </button>
                                            )}
                                        </div>
                                        {codesOpen.has(g.key) && g.code && masterByCode.get(g.code) && (
                                            <ProductCodesPanel master={masterByCode.get(g.code)!} stores={stores} onEdit={onEditCodes ? op => onEditCodes(g.code, op) : undefined} />
                                        )}
                                        {many && isOpen && (
                                            <ul className="mt-1 divide-y divide-white/5 border-t border-white/5" data-testid="prod-names">
                                                {g.code && <li className="py-2 text-xs text-zinc-500 tabular-nums">Código {g.code}</li>}
                                                {g.descs.map(d => (
                                                    <li key={d.desc} className="flex items-center gap-3 py-2" data-testid="prod-name">
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block text-[13px] text-zinc-200 break-words">{titleCase(d.desc)}</span>
                                                            <span className="block text-xs text-zinc-500">{plural(d.count, 'compra', 'compras')}</span>
                                                        </span>
                                                        {onSplitProduct && (
                                                            <button type="button" onClick={() => onSplitProduct(d.desc, g)} data-testid="prod-split"
                                                                className="shrink-0 inline-flex items-center gap-1.5 px-3 min-h-[36px] rounded-lg bg-white/5 border border-white/10 text-xs font-semibold text-zinc-300 hover:border-luxury-gold/40 transition-colors">
                                                                <Scissors className="w-3.5 h-3.5" /> Separar
                                                            </button>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </>
                                )}
                            </li>
                        );
                    })}
                </ul>

                {filtered.length > limit && (
                    <button
                        onClick={() => setLimit(l => l + 60)}
                        className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.03] py-3 text-sm font-semibold text-zinc-300 hover:bg-white/[0.06] transition-colors"
                    >
                        Mostrar mais ({filtered.length - limit} restantes)
                    </button>
                )}
            </div>

            {/* Barra de seleção: fica acima das abas do celular */}
            {selectMode && (
                <div className="fixed inset-x-4 bottom-[calc(6rem+env(safe-area-inset-bottom,0px))] md:bottom-6 md:left-auto md:right-8 md:w-96 z-40 flex items-center gap-3 rounded-2xl border border-luxury-gold/30 bg-[#0c0c0e]/95 backdrop-blur-xl shadow-2xl p-3" data-testid="prod-select-bar">
                    <span className="flex-1 pl-2 text-sm text-zinc-200" data-testid="prod-select-count">
                        {selected.size === 0 ? 'Nenhum marcado' : plural(selected.size, 'marcado', 'marcados')}
                    </span>
                    <button type="button" disabled={selected.size < 2} onClick={() => setUnifyWith(pickedGroups)} data-testid="prod-unify-open"
                        className="px-5 py-3 rounded-xl bg-luxury-gold text-black font-bold text-[11px] uppercase tracking-[0.08em] hover:bg-white transition-colors disabled:opacity-40 disabled:hover:bg-luxury-gold">
                        Unificar
                    </button>
                </div>
            )}

            {fixOpen && (
                <CategoryFixSheet sections={fixes} categories={categoriesList} onApply={onUpdateBatchMapping} onClose={() => setFixOpen(false)} />
            )}

            {unifyWith && (
                <ProductUnifySheet groups={unifyWith} categories={categoriesList} onConfirm={confirmUnify} onClose={() => setUnifyWith(null)} />
            )}

            {dupOpen && (
                <ProductDupSheet
                    clusters={clusters}
                    covered={!!unifyWith}
                    onPick={c => setUnifyWith(c.groups)}
                    onIgnore={ignoreCluster}
                    onClose={() => setDupOpen(false)}
                />
            )}

            {/* MODAL DE REVISÃO SEMÂNTICA */}
            {reviewModal && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
                    <div className="w-full max-w-2xl bg-[#0c0c0e] border border-luxury-gold/20 rounded-[2rem] sm:rounded-[3rem] overflow-hidden shadow-3xl shadow-luxury-gold/5">
                        <div className="p-5 sm:p-8 border-b border-white/5 bg-luxury-gold/5 flex justify-between items-center gap-3">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-luxury-gold text-black rounded-2xl"><Sparkles className="w-6 h-6" /></div>
                                <div>
                                    <h3 className="text-lg sm:text-xl font-serif text-white uppercase tracking-tight">Propagação Inteligente</h3>
                                    <p className="text-xs text-luxury-gold font-medium mt-1">Aplica a mesma categoria a produtos parecidos</p>
                                </div>
                            </div>
                            <button onClick={() => setReviewModal(null)} className="p-2 text-zinc-500 hover:text-white"><X className="w-6 h-6" /></button>
                        </div>

                        <div className="p-5 sm:p-8 space-y-5 sm:space-y-6">
                            <div className="flex items-center gap-3 sm:gap-4 p-4 sm:p-5 bg-white/[0.02] border border-white/5 rounded-2xl">
                                <div className="flex-1 min-w-0">
                                    <span className="text-xs text-zinc-500 font-medium block mb-1">Produto</span>
                                    <span className="text-sm text-zinc-200 font-semibold break-words">{titleCase(reviewModal.group.name)}</span>
                                </div>
                                <ArrowRight className="w-5 h-5 text-luxury-gold shrink-0" />
                                <div className="flex-1 min-w-0 text-right">
                                    <span className="text-xs text-zinc-500 font-medium block mb-1">Nova categoria</span>
                                    <span className="text-sm text-luxury-gold font-semibold break-words">{reviewModal.newCategory}</span>
                                </div>
                            </div>

                            <div>
                                <h4 className="text-xs text-zinc-400 font-semibold mb-3 px-1">Produtos parecidos encontrados no histórico</h4>
                                <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                                    {reviewModal.suggestions.map(s => (
                                        <div
                                            key={s.key}
                                            onClick={() => toggleSuggestion(s.key)}
                                            className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${s.selected ? 'bg-luxury-gold/10 border-luxury-gold/30 text-white' : 'bg-black/40 border-white/5 text-zinc-400 opacity-70'}`}
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-all ${s.selected ? 'bg-luxury-gold border-luxury-gold text-black' : 'border-zinc-800'}`}>
                                                    {s.selected && <Check className="w-3.5 h-3.5" />}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <span className="text-[13px] font-semibold font-sans break-words">{titleCase(s.name)}</span>
                                                    <span className="text-xs mt-0.5 opacity-70">Hoje em {s.currentCategory} · {s.count} {s.count === 1 ? 'compra' : 'compras'}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button
                                onClick={handleApplyBatch}
                                disabled={isProcessing}
                                className="w-full py-4 bg-luxury-gold text-black rounded-2xl font-bold text-sm tracking-wide hover:bg-white transition-all shadow-xl shadow-luxury-gold/10 flex items-center justify-center gap-3"
                            >
                                {isProcessing ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" /> Aplicando...
                                    </>
                                ) : (
                                    <>Aplicar em {reviewModal.suggestions.filter(s => s.selected).length + 1} {reviewModal.suggestions.filter(s => s.selected).length + 1 === 1 ? 'produto' : 'produtos'}</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProductMappingEditor;
