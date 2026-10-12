
import React, { useState, useMemo } from 'react';
import { 
    Search, BrainCircuit, RefreshCw, Check, ArrowRight, 
    AlertCircle, Filter, Database, Hash, ShoppingBag, 
    ChevronRight, Save, Info, Sparkles, X, CheckCircle2
} from 'lucide-react';
import { Receipt, TaxonomyNode } from '../types';
import { titleCase } from '../services/textFormat';

interface ProductMappingEditorProps {
  receipts: Receipt[];
  taxonomy: TaxonomyNode[];
  onUpdateBatchMapping: (mappings: { description: string, newCategory: string }[]) => void;
}

interface Suggestion {
    description: string;
    currentCategory: string;
    count: number;
    selected: boolean;
}

const ProductMappingEditor: React.FC<ProductMappingEditorProps> = ({ receipts, taxonomy, onUpdateBatchMapping }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [reviewModal, setReviewModal] = useState<{
        targetItem: string;
        newCategory: string;
        suggestions: Suggestion[];
    } | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [limit, setLimit] = useState(60);

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

    // Tabela base de mapeamento
    const mappingTable = useMemo(() => {
        const table: Record<string, { category: string, count: number, totalValue: number }> = {};
        receipts.forEach(r => {
            r.items.forEach(item => {
                const desc = item.description.trim().toUpperCase();
                if (!table[desc]) {
                    table[desc] = { category: item.category, count: 0, totalValue: 0 };
                }
                table[desc].count += 1;
                table[desc].totalValue += (item.totalPrice || 0);
            });
        });

        return Object.entries(table)
            .map(([desc, data]) => ({ desc, ...data }))
            .filter(item => item.desc.includes(searchTerm.toUpperCase()))
            .sort((a, b) => b.count - a.count);
    }, [receipts, searchTerm]);

    const visible = mappingTable.slice(0, limit);
    const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

    // Algoritmo de busca de itens relacionados
    const findRelatedItems = (targetDesc: string, targetCategory: string, newCategory: string) => {
        const tokens = targetDesc.split(' ').filter(t => t.length > 2 && !['UN', 'KG', 'L', 'ML', 'DE', 'COM', 'PARA'].includes(t));
        
        const suggestions: Suggestion[] = mappingTable
            .filter(item => {
                if (item.desc === targetDesc) return false;
                // Critério: Mesma categoria atual E contém pelo menos um token importante
                const matchesTokens = tokens.some(t => item.desc.includes(t));
                return matchesTokens && item.category !== newCategory;
            })
            .map(item => ({
                description: item.desc,
                currentCategory: item.category,
                count: item.count,
                selected: true // Por padrão, sugerimos aplicar a todos os similares
            }));

        return suggestions;
    };

    const handleInitiateChange = (description: string, newCategory: string) => {
        const currentData = mappingTable.find(m => m.desc === description);
        if (!currentData || currentData.category === newCategory) return;

        const related = findRelatedItems(description, currentData.category, newCategory);
        
        if (related.length > 0) {
            setReviewModal({
                targetItem: description,
                newCategory: newCategory,
                suggestions: related
            });
        } else {
            // Se não houver relacionados, aplica apenas ao item atual
            onUpdateBatchMapping([{ description, newCategory }]);
        }
    };

    const handleApplyBatch = () => {
        if (!reviewModal) return;
        setIsProcessing(true);

        const updates = [
            { description: reviewModal.targetItem, newCategory: reviewModal.newCategory },
            ...reviewModal.suggestions
                .filter(s => s.selected)
                .map(s => ({ description: s.description, newCategory: reviewModal.newCategory }))
        ];

        setTimeout(() => {
            onUpdateBatchMapping(updates);
            setIsProcessing(false);
            setReviewModal(null);
        }, 800);
    };

    const toggleSuggestion = (desc: string) => {
        if (!reviewModal) return;
        setReviewModal({
            ...reviewModal,
            suggestions: reviewModal.suggestions.map(s => 
                s.description === desc ? { ...s, selected: !s.selected } : s
            )
        });
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="bg-black/40 border border-white/5 rounded-[2.5rem] p-5 sm:p-8 shadow-2xl relative">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6 mb-5 sm:mb-8 relative z-10">
                    <div>
                        <h3 className="text-lg sm:text-xl font-serif text-white uppercase tracking-tight flex items-center gap-3">
                            <BrainCircuit className="w-5 h-5 text-luxury-gold shrink-0" /> Mapping Intelligence
                        </h3>
                        <p className="text-zinc-400 text-xs mt-1.5">Confira em que categoria cada produto está e corrija quando precisar.</p>
                    </div>

                    <div className="relative w-full md:w-96">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input 
                            type="text" 
                            placeholder="Buscar produto" 
                            value={searchTerm}
                            onChange={e => { setSearchTerm(e.target.value); setLimit(60); }}
                            className="w-full bg-black/60 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-luxury-gold/40 outline-none font-medium"
                        />
                    </div>
                </div>

                {mappingTable.length === 0 && (
                    <p className="text-sm text-zinc-500 text-center py-10">Nenhum produto encontrado.</p>
                )}

                {/* Celular: um cartão por produto, sem rolagem lateral */}
                <div className="md:hidden space-y-2.5">
                    {visible.map(item => (
                        <div key={item.desc} className="rounded-2xl border border-white/5 bg-zinc-900/30 p-4">
                            <div className="flex items-start justify-between gap-3">
                                <p className="text-sm font-semibold text-zinc-100 leading-snug min-w-0 break-words">{titleCase(item.desc)}</p>
                                <span className="shrink-0 text-xs font-semibold text-zinc-400 tabular-nums">{fmtBRL(item.totalValue)}</span>
                            </div>
                            <p className="text-xs text-zinc-500 mt-1">{item.count} {item.count === 1 ? 'compra' : 'compras'}</p>
                            <label className="block mt-3">
                                <span className="sr-only">Categoria de {titleCase(item.desc)}</span>
                                <select
                                    value={item.category}
                                    onChange={(e) => handleInitiateChange(item.desc, e.target.value)}
                                    className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2.5 text-[13px] text-zinc-200 focus:border-luxury-gold/50 outline-none cursor-pointer font-medium truncate"
                                >
                                    {!categoriesList.includes(item.category) && <option value={item.category}>{item.category}</option>}
                                    {categoriesList.map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    ))}
                </div>

                {/* Tela grande: tabela */}
                <div className="hidden md:block overflow-hidden border border-white/5 rounded-2xl bg-zinc-900/10">
                    <div className="max-h-[600px] overflow-y-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 z-20 bg-zinc-900 border-b border-white/10">
                                <tr>
                                    <th className="px-6 py-4 text-xs font-semibold text-zinc-400">Produto</th>
                                    <th className="px-6 py-4 text-xs font-semibold text-zinc-400 text-center">Compras</th>
                                    <th className="px-6 py-4 text-xs font-semibold text-zinc-400">Categoria</th>
                                    <th className="px-6 py-4 text-xs font-semibold text-zinc-400 text-right"><span className="sr-only">Status</span></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {visible.map((item) => (
                                    <tr key={item.desc} className="group hover:bg-white/[0.02] transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-semibold text-zinc-100 font-sans">{titleCase(item.desc)}</span>
                                                <span className="text-xs text-zinc-500 mt-0.5">Total gasto: {fmtBRL(item.totalValue)}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className="text-sm font-semibold text-zinc-400 tabular-nums">{item.count}</span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <select 
                                                value={item.category}
                                                onChange={(e) => handleInitiateChange(item.desc, e.target.value)}
                                                className="bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-[13px] text-zinc-200 focus:border-luxury-gold/50 outline-none w-full max-w-[320px] cursor-pointer font-medium"
                                            >
                                                {!categoriesList.includes(item.category) && <option value={item.category}>{item.category}</option>}
                                                {categoriesList.map(cat => (
                                                    <option key={cat} value={cat}>{cat}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <CheckCircle2 className="w-4 h-4 text-zinc-700 ml-auto group-hover:text-luxury-gold transition-all" />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {mappingTable.length > limit && (
                    <button
                        onClick={() => setLimit(l => l + 60)}
                        className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.03] py-3 text-sm font-semibold text-zinc-300 hover:bg-white/[0.06] transition-colors"
                    >
                        Mostrar mais ({mappingTable.length - limit} restantes)
                    </button>
                )}
            </div>

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
                                    <span className="text-sm text-zinc-200 font-semibold break-words">{titleCase(reviewModal.targetItem)}</span>
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
                                            key={s.description}
                                            onClick={() => toggleSuggestion(s.description)}
                                            className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${s.selected ? 'bg-luxury-gold/10 border-luxury-gold/30 text-white' : 'bg-black/40 border-white/5 text-zinc-400 opacity-70'}`}
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-all ${s.selected ? 'bg-luxury-gold border-luxury-gold text-black' : 'border-zinc-800'}`}>
                                                    {s.selected && <Check className="w-3.5 h-3.5" />}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <span className="text-[13px] font-semibold font-sans break-words">{titleCase(s.description)}</span>
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
