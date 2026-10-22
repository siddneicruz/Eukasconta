
import React, { useState, useMemo } from 'react';
import { BrainCircuit, Search, Trash2, TrendingUp, Hash, Tag, Filter, X } from 'lucide-react';
import { AILearningEntry, TaxonomyNode } from '../types';

interface AILearningManagerProps {
  learning: AILearningEntry[];
  taxonomy: TaxonomyNode[];
  onUpdate: (learning: AILearningEntry[]) => void;
}

const AILearningManager: React.FC<AILearningManagerProps> = ({ learning, taxonomy, onUpdate }) => {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredLearning = useMemo(() => {
        const fold = (t: string) => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const tokens = fold(searchTerm).split(/\s+/).filter(Boolean);
        return learning.filter(l => {
            const k = fold(l.keyword);
            return tokens.every(t => k.includes(t));
        }).sort((a, b) => b.hitCount - a.hitCount);
    }, [learning, searchTerm]);

    const getCategoryName = (nodeId: string) => {
        const node = taxonomy.find(n => n.id === nodeId);
        if (!node) return 'Categoria Desconhecida';
        
        if (node.level === 1) return node.name;
        
        const parent = taxonomy.find(n => n.id === node.parentId);
        return parent ? `${parent.name} - ${node.name}` : node.name;
    };

    const handleDelete = (keyword: string) => {
        if (window.confirm(`Remover aprendizado para "${keyword}"?`)) {
            onUpdate(learning.filter(l => l.keyword !== keyword));
        }
    };

    const handleClearAll = () => {
        if (window.confirm('Deseja limpar TODO o banco de aprendizado da IA?')) {
            onUpdate([]);
        }
    };

    return (
        <div className="bg-black/40 border border-white/5 rounded-[2.5rem] p-5 sm:p-8 shadow-2xl relative mt-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                <div>
                    <h3 className="text-xl font-serif text-white uppercase tracking-tight flex items-center gap-3">
                        <BrainCircuit className="w-5 h-5 text-luxury-gold" /> AI Learning Vault
                    </h3>
                    <p className="text-zinc-500 text-[11px] uppercase font-bold mt-1 tracking-[0.08em]">Base de conhecimento acumulada pela IA</p>
                </div>

                <div className="flex items-center gap-4">
                    <div className="relative w-full md:w-64">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                        <input 
                            type="text" 
                            placeholder="BUSCAR TERMO..." 
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full bg-black/60 border border-white/10 rounded-xl py-3 pl-12 pr-6 text-[11px] text-zinc-300 focus:border-luxury-gold/40 outline-none uppercase tracking-[0.08em] font-bold"
                        />
                    </div>
                    <button 
                        onClick={handleClearAll}
                        className="p-3 text-zinc-600 hover:text-red-500 transition-colors"
                        title="Limpar Tudo"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredLearning.length === 0 ? (
                    <div className="col-span-full py-12 border border-dashed border-white/10 rounded-[2rem] flex flex-col items-center justify-center text-zinc-700 gap-3">
                        <BrainCircuit className="w-8 h-8 opacity-20" />
                        <span className="text-[11px] uppercase tracking-[0.08em] font-bold">Nenhum aprendizado registrado</span>
                    </div>
                ) : (
                    filteredLearning.map((entry) => (
                        <div key={entry.keyword} className="bg-zinc-900/40 border border-white/5 p-5 rounded-2xl group hover:border-luxury-gold/30 transition-all flex flex-col justify-between">
                            <div>
                                <div className="flex justify-between items-start mb-3">
                                    <span className="text-xs font-bold text-zinc-200 uppercase tracking-tight font-sans">{entry.keyword}</span>
                                    <button 
                                        onClick={() => handleDelete(entry.keyword)}
                                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-600 hover:text-red-500 transition-all"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="flex items-center gap-2 mb-4">
                                    <Tag className="w-3 h-3 text-luxury-gold" />
                                    <span className="text-[11px] text-zinc-500 uppercase font-bold tracking-[0.08em] truncate">{getCategoryName(entry.targetNodeId)}</span>
                                </div>
                            </div>
                            <div className="flex items-center justify-between pt-4 border-t border-white/5">
                                <div className="flex items-center gap-2">
                                    <TrendingUp className="w-3 h-3 text-emerald-500" />
                                    <span className="text-xs font-mono font-bold text-zinc-400">{entry.hitCount} acertos</span>
                                </div>
                                <div className="w-2 h-2 rounded-full bg-luxury-gold/20 group-hover:bg-luxury-gold transition-colors" />
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default AILearningManager;
