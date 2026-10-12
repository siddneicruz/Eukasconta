
import React, { useState, useMemo } from 'react';
import { 
    Search, BrainCircuit, RefreshCw, Check, ArrowRight, 
    AlertCircle, Filter, Database, Hash, ShoppingBag, 
    ChevronRight, Save, Info, Sparkles, X, CheckCircle2
} from 'lucide-react';
import { Receipt, TaxonomyNode } from '../types';

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
            <div className="bg-black/40 border border-white/5 rounded-[2.5rem] p-8 shadow-2xl relative">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 relative z-10">
                    <div>
                        <h3 className="text-xl font-serif text-white uppercase tracking-tight flex items-center gap-3">
                            <BrainCircuit className="w-5 h-5 text-luxury-gold" /> Mapping Intelligence
                        </h3>
                        <p className="text-zinc-600 text-[9px] uppercase font-bold mt-1 tracking-widest">Auditoria e Reclassificação de Fluxo</p>
                    </div>

                    <div className="relative w-full md:w-96">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                        <input 
                            type="text" 
                            placeholder="FILTRAR POR ATIVO..." 
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full bg-black/60 border border-white/10 rounded-xl py-3.5 pl-12 pr-6 text-[10px] text-zinc-300 focus:border-luxury-gold/40 outline-none uppercase tracking-widest font-bold"
                        />
                    </div>
                </div>

                <div className="overflow-hidden border border-white/5 rounded-2xl bg-zinc-900/10">
                    <div className="max-h-[600px] overflow-y-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 z-20 bg-zinc-900 border-b border-white/10">
                                <tr>
                                    <th className="px-6 py-4 text-[9px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Ativo Bruto</th>
                                    <th className="px-6 py-4 text-[9px] font-bold text-zinc-500 uppercase tracking-[0.2em] text-center">Auditorias</th>
                                    <th className="px-6 py-4 text-[9px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Classificação Sugerida</th>
                                    <th className="px-6 py-4 text-[9px] font-bold text-zinc-500 uppercase tracking-[0.2em] text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {mappingTable.map((item) => (
                                    <tr key={item.desc} className="group hover:bg-white/[0.02] transition-colors">
                                        <td className="px-6 py-5">
                                            <div className="flex flex-col">
                                                <span className="text-xs font-bold text-zinc-200 uppercase tracking-tight font-serif">{item.desc}</span>
                                                <span className="text-[8px] text-zinc-600 font-bold uppercase tracking-widest mt-1">Acúmulo: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.totalValue)}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5 text-center">
                                            <span className="text-[10px] font-bold text-zinc-500">#{item.count}</span>
                                        </td>
                                        <td className="px-6 py-5">
                                            <select 
                                                value={item.category}
                                                onChange={(e) => handleInitiateChange(item.desc, e.target.value)}
                                                className="bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-[10px] text-zinc-300 focus:border-luxury-gold/50 outline-none w-full max-w-[280px] appearance-none cursor-pointer uppercase font-bold tracking-tighter"
                                            >
                                                {categoriesList.map(cat => (
                                                    <option key={cat} value={cat}>{cat}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="px-6 py-5 text-right">
                                            <CheckCircle2 className="w-4 h-4 text-zinc-800 ml-auto group-hover:text-luxury-gold transition-all" />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* MODAL DE REVISÃO SEMÂNTICA */}
            {reviewModal && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
                    <div className="w-full max-w-2xl bg-[#0c0c0e] border border-luxury-gold/20 rounded-[3rem] overflow-hidden shadow-3xl shadow-luxury-gold/5">
                        <div className="p-8 border-b border-white/5 bg-luxury-gold/5 flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-luxury-gold text-black rounded-2xl"><Sparkles className="w-6 h-6" /></div>
                                <div>
                                    <h3 className="text-xl font-serif text-white uppercase tracking-tighter">Propagação Inteligente</h3>
                                    <p className="text-[9px] text-luxury-gold uppercase font-bold tracking-widest mt-1">Motor de Correspondência Semântica</p>
                                </div>
                            </div>
                            <button onClick={() => setReviewModal(null)} className="p-2 text-zinc-500 hover:text-white"><X className="w-6 h-6" /></button>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="flex items-center gap-4 p-5 bg-white/[0.02] border border-white/5 rounded-2xl">
                                <div className="flex-1">
                                    <span className="text-[9px] text-zinc-600 uppercase font-bold block mb-1">Mudar de:</span>
                                    <span className="text-xs text-zinc-400 font-bold uppercase">{reviewModal.targetItem}</span>
                                </div>
                                <ArrowRight className="w-5 h-5 text-luxury-gold" />
                                <div className="flex-1 text-right">
                                    <span className="text-[9px] text-zinc-600 uppercase font-bold block mb-1">Para:</span>
                                    <span className="text-xs text-luxury-gold font-bold uppercase">{reviewModal.newCategory}</span>
                                </div>
                            </div>

                            <div>
                                <h4 className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-4 px-2">Itens similares detectados no histórico:</h4>
                                <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                                    {reviewModal.suggestions.map(s => (
                                        <div 
                                            key={s.description}
                                            onClick={() => toggleSuggestion(s.description)}
                                            className={`flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer ${s.selected ? 'bg-luxury-gold/10 border-luxury-gold/30 text-white' : 'bg-black/40 border-white/5 text-zinc-600 opacity-60'}`}
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${s.selected ? 'bg-luxury-gold border-luxury-gold text-black' : 'border-zinc-800'}`}>
                                                    {s.selected && <Check className="w-3.5 h-3.5" />}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[11px] font-bold uppercase font-serif tracking-tight">{s.description}</span>
                                                    <span className="text-[8px] uppercase tracking-widest mt-0.5 opacity-60">Atual: {s.currentCategory} • #{s.count} vezes</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button 
                                onClick={handleApplyBatch}
                                disabled={isProcessing}
                                className="w-full py-5 bg-luxury-gold text-black rounded-2xl font-bold text-[11px] uppercase tracking-[0.3em] hover:bg-white transition-all shadow-xl shadow-luxury-gold/10 flex items-center justify-center gap-3"
                            >
                                {isProcessing ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" /> SINCRONIZANDO ESTÚDIO...
                                    </>
                                ) : (
                                    <>APLICAR ALTERAÇÕES EM MASSA ({reviewModal.suggestions.filter(s => s.selected).length + 1})</>
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
