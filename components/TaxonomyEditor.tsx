
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
    Plus, Trash2, Edit3, ChevronDown, ChevronRight, 
    Layers, Save, X, AlertCircle,
    PlusCircle, Check, Palette, Info, GitMerge, FileSpreadsheet, Download, Loader2, Copy
} from 'lucide-react';
import { getCategoryIcon, getCategoryColor, getCustomMeta, matchIconByKeyword } from './Dashboard';
import * as LucideIcons from 'lucide-react';
import { ShoppingBag } from 'lucide-react';
import { TaxonomyNode, TaxonomySource, DEFAULT_TAXONOMY_STRING, Receipt } from '../types';
import { resolveNodeStyle, slugify, migrateLegacyTaxonomy, levelTaxonomy } from '../services/taxonomyService';
import { parseTaxonomyWorkbook, downloadTaxonomyTemplate, TaxonomyImportError } from '../services/taxonomyImportService';
import { generateId } from '../services/idUtils';
import { titleCase } from '../services/textFormat';
import { MergeResult, addHiddenDefaults, detectDuplicates, loadHiddenDefaults, visibleDuplicates } from '../services/taxonomyDedupe';
import { DuplicateCategoriesSheet, MergeWithSheet } from './DuplicateCategoriesSheet';

// Classes estáticas (o Tailwind só gera classes que aparecem por completo no
// código-fonte; \`ml-${depth * 4}\` nunca funcionaria, pois é montada em tempo
// de execução — por isso a árvore não tinha recuo visual nenhum antes).
const DEPTH_INDENT = ['ml-0', 'ml-4', 'ml-8', 'ml-12', 'ml-16', 'ml-20'];

// Ícone com herança de verdade: tenta o próprio nó (personalizado ou por
// palavra-chave) e, se nada bater, sobe para o pai — assim um rótulo
// genérico de agrupamento ("Cortes Nobres") herda o ícone do ramo
// ("Carne Bovina") em vez de cair no ícone padrão de sacola.
const resolveEditorIcon = (node: TaxonomyNode, taxonomy: TaxonomyNode[]) => {
    let current: TaxonomyNode | undefined = node;
    while (current) {
        const custom = getCustomMeta(current.name);
        if (custom?.icon) {
            if (custom.icon.startsWith('data:image/')) {
                return (props: any) => <img src={custom.icon} className={props.className} style={{ width: '1em', height: '1em', objectFit: 'contain', mixBlendMode: 'screen', ...props.style }} alt={current!.name} />;
            }
            // @ts-ignore
            const IconComp = LucideIcons[custom.icon];
            if (IconComp) return IconComp;
        }
        const matched = matchIconByKeyword(current.name);
        if (matched) return matched;
        current = current.parentId ? taxonomy.find(n => n.id === current!.parentId) : undefined;
    }
    return ShoppingBag;
};

interface TaxonomyEditorProps {
  taxonomy: TaxonomyNode[];
  onUpdateTaxonomy: (newTaxonomy: TaxonomyNode[]) => void;
  onEditIcon?: (category: string) => void;
  // Compras (para mostrar quanto cada categoria tem) e o que fazer depois de juntar categorias repetidas
  receipts?: Receipt[];
  onMergeCategories?: (res: MergeResult, oldTaxonomy: TaxonomyNode[], summary: string) => void;
}

const TaxonomyEditor: React.FC<TaxonomyEditorProps> = ({ taxonomy, onUpdateTaxonomy, onEditIcon, receipts = [], onMergeCategories }) => {
    const [dupOpen, setDupOpen] = useState(false);
    const [mergeWithId, setMergeWithId] = useState<string | null>(null);
    const [ignoredTick, setIgnoredTick] = useState(0);
    const dupInfo = useMemo(() => {
        const { shown } = visibleDuplicates(detectDuplicates(taxonomy));
        let ignored: string[] = [];
        try { const a = JSON.parse(localStorage.getItem('eukasconta_dup_cat_ignored') || '[]'); if (Array.isArray(a)) ignored = a; } catch { /* sem armazenamento */ }
        const open = shown.filter(g => !ignored.includes(g.id));
        return { total: open.length, equal: open.filter(g => g.kind === 'igual').length };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [taxonomy, dupOpen, ignoredTick]);
    // Da lista de repetidas a folha continua aberta (dá para seguir juntando); do "Juntar com…" ela fecha.
    const applyMerge = (res: MergeResult, summary: string) => {
        setMergeWithId(null); setIgnoredTick(t => t + 1);
        if (onMergeCategories) onMergeCategories(res, taxonomy, summary);
        else onUpdateTaxonomy(res.taxonomy);
    };

    const [expandedNodes, setExpandedNodes] = useState<string[]>([]);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    
    // Novos estados para criação de Mestre sem prompt
    const [isAddingMaster, setIsAddingMaster] = useState(false);
    const [newMasterName, setNewMasterName] = useState('');
    const masterInputRef = useRef<HTMLInputElement>(null);

    const [addingToParentId, setAddingToParentId] = useState<string | null>(null);
    const [newNodeName, setNewNodeName] = useState('');

    const [isLeveling, setIsLeveling] = useState(false);
    const [levelFeedback, setLevelFeedback] = useState<string | null>(null);
    const importInputRef = useRef<HTMLInputElement>(null);

    const handleLevelWithDefault = () => {
        setIsLeveling(true);
        try {
            const referenceNodes = migrateLegacyTaxonomy(DEFAULT_TAXONOMY_STRING);
            const { merged, addedCount } = levelTaxonomy(taxonomy, referenceNodes, loadHiddenDefaults());
            onUpdateTaxonomy(merged);
            setLevelFeedback(addedCount > 0
                ? `Nivelado: ${addedCount} categoria(s)/item(ns) novo(s) adicionado(s). Nada existente foi alterado.`
                : 'Sua taxonomia já está nivelada com o padrão — nada para adicionar.');
        } finally {
            setIsLeveling(false);
            setTimeout(() => setLevelFeedback(null), 6000);
        }
    };

    const handleImportFile = async (file: File) => {
        setIsLeveling(true);
        try {
            const referenceNodes = await parseTaxonomyWorkbook(file);
            const { merged, addedCount } = levelTaxonomy(taxonomy, referenceNodes, loadHiddenDefaults());
            onUpdateTaxonomy(merged);
            setLevelFeedback(addedCount > 0
                ? `Planilha nivelada: ${addedCount} categoria(s)/item(ns) novo(s) adicionado(s).`
                : 'Nada de novo nessa planilha — sua taxonomia já cobre tudo isso.');
        } catch (err) {
            setLevelFeedback(err instanceof TaxonomyImportError ? err.message : 'Não consegui ler essa planilha. Confira o formato do modelo.');
        } finally {
            setIsLeveling(false);
            if (importInputRef.current) importInputRef.current.value = '';
            setTimeout(() => setLevelFeedback(null), 8000);
        }
    };

    useEffect(() => {
        if (isAddingMaster && masterInputRef.current) {
            masterInputRef.current.focus();
        }
    }, [isAddingMaster]);

    const toggleNode = (id: string) => {
        setExpandedNodes(prev => 
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleSaveEdit = () => {
        if (!editingNodeId || !editValue.trim()) return;

        const newTaxonomy = taxonomy.map(node => {
            if (node.id === editingNodeId) {
                return {
                    ...node,
                    name: editValue.trim(),
                    slug: slugify(editValue.trim()),
                    sourceType: TaxonomySource.USER_CUSTOMIZED,
                    isCustomized: true,
                    lastUpdated: Date.now()
                };
            }
            return node;
        });

        onUpdateTaxonomy(newTaxonomy);
        setEditingNodeId(null);
    };

    const handleAddNode = (parentId: string | null, level: 1 | 2 | 3 | 4) => {
        const name = parentId ? newNodeName.trim() : newMasterName.trim();
        if (!name) return;

        const newNode: TaxonomyNode = {
            id: generateId(),
            parentId,
            level,
            name,
            slug: slugify(name),
            sourceType: TaxonomySource.USER_CUSTOMIZED,
            isCustomized: true,
            lastUpdated: Date.now()
        };

        onUpdateTaxonomy([...taxonomy, newNode]);
        setNewNodeName('');
        setNewMasterName('');
        setIsAddingMaster(false);
        setAddingToParentId(null);
    };

    const handleDelete = (id: string) => {
        if (!window.confirm(`Deseja remover este item e todos os seus descendentes?`)) return;

        const idsToDelete = new Set<string>([id]);
        const findDescendants = (parentId: string) => {
            taxonomy.forEach(node => {
                if (node.parentId === parentId) {
                    idsToDelete.add(node.id);
                    findDescendants(node.id);
                }
            });
        };
        findDescendants(id);

        // departamento de fábrica apagado de propósito não volta sozinho na próxima abertura
        const gone = taxonomy.find(n => n.id === id);
        if (gone && gone.level === 1 && gone.sourceType === TaxonomySource.SYSTEM) {
            const isDefault = migrateLegacyTaxonomy(DEFAULT_TAXONOMY_STRING).some(d => d.level === 1 && d.slug === gone.slug);
            if (isDefault && !taxonomy.some(n => n.level === 1 && n.id !== id && n.slug === gone.slug)) addHiddenDefaults([gone.slug]);
        }
        onUpdateTaxonomy(taxonomy.filter(node => !idsToDelete.has(node.id)));
    };

    const renderNode = (node: TaxonomyNode, depth: number = 0) => {
        const isExpanded = expandedNodes.includes(node.id);
        const isEditing = editingNodeId === node.id;
        const children = taxonomy.filter(n => n.parentId === node.id);
        const style = resolveNodeStyle(node.id, taxonomy);
        const Icon = resolveEditorIcon(node, taxonomy);
        const custom = getCustomMeta(node.name);
        const isInherited = !custom || (!custom.icon && !custom.color);

        // Só o nível 1 (departamento) recebe o tratamento de "cartão". Do nível
        // 2 em diante é uma lista contínua, com um traço fino separando os
        // irmãos — sem caixa dentro de caixa, o que dava a sensação de
        // "cortado" quando a árvore tinha vários níveis abertos ao mesmo tempo.
        const isRoot = depth === 0;

        return (
            <div key={node.id} className={depth > 0 ? `${DEPTH_INDENT[Math.min(depth, DEPTH_INDENT.length - 1)]} border-l border-white/[0.06]` : ''}>
                <div className={`flex items-center justify-between gap-2 group transition-colors ${
                    isRoot
                        ? 'p-2.5 md:p-3 mb-1.5 bg-white/[0.02] hover:bg-white/[0.05] rounded-xl'
                        : 'py-2 md:py-2.5 pl-3 md:pl-4 pr-1 border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.02]'
                }`}>
                    <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
                        <button
                            onClick={() => children.length > 0 && toggleNode(node.id)}
                            className={`shrink-0 text-zinc-600 ${children.length > 0 ? 'hover:text-luxury-gold cursor-pointer' : 'opacity-0 pointer-events-none'}`}
                        >
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <div 
                            onClick={() => onEditIcon && onEditIcon(node.name)}
                            className={`${isRoot ? 'w-7 h-7 md:w-8 md:h-8' : 'w-6 h-6'} shrink-0 rounded-lg bg-black border flex items-center justify-center cursor-pointer transition-all hover:scale-105 ${isInherited ? 'border-white/5 opacity-50' : 'border-luxury-gold/30'}`}
                            style={{ color: style.color }}
                        >
                            <Icon className={isRoot ? 'w-3.5 h-3.5 md:w-4 md:h-4' : 'w-3 h-3'} />
                        </div>
                        
                        {isEditing ? (
                            <div className="flex items-center gap-2 flex-1 max-w-xs">
                                <input 
                                    autoFocus
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleSaveEdit()}
                                    className="bg-zinc-900 border border-luxury-gold/50 rounded px-2 py-1 text-xs text-white focus:outline-none w-full"
                                />
                                <button onClick={handleSaveEdit} className="text-emerald-500"><Save className="w-3.5 h-3.5" /></button>
                                <button onClick={() => setEditingNodeId(null)} className="text-zinc-500"><X className="w-3.5 h-3.5" /></button>
                            </div>
                        ) : (
                            <div className="flex flex-col min-w-0 flex-1">
                                <span className={`${isRoot ? 'text-sm' : 'text-[13px]'} font-semibold text-zinc-100 leading-snug line-clamp-2 break-words`} title={node.name}>{titleCase(node.name)}</span>
                                {isRoot && (
                                    <span className="text-xs text-zinc-500 font-medium">
                                        Nível {node.level} {isInherited && '· herdado'}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all shrink-0">
                        {node.level < 4 && (
                            <button onClick={() => setAddingToParentId(node.id)} className="p-1 md:p-1.5 text-zinc-500 hover:text-luxury-gold">
                                <PlusCircle className="w-3 h-3 md:w-3.5 md:h-3.5" />
                            </button>
                        )}
                        <button onClick={() => { setEditingNodeId(node.id); setEditValue(node.name); }} className="p-1 md:p-1.5 text-zinc-500 hover:text-luxury-gold">
                            <Edit3 className="w-3 h-3 md:w-3.5 md:h-3.5" />
                        </button>
                        <button onClick={() => setMergeWithId(node.id)} title="Juntar com outra" aria-label={`Juntar ${node.name} com outra`} data-testid="tax-merge-with" className="p-1 md:p-1.5 text-zinc-500 hover:text-luxury-gold">
                            <GitMerge className="w-3 h-3 md:w-3.5 md:h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(node.id)} className="p-1 md:p-1.5 text-zinc-500 hover:text-red-500">
                            <Trash2 className="w-3 h-3 md:w-3.5 md:h-3.5" />
                        </button>
                    </div>
                </div>

                {addingToParentId === node.id && (
                    <div className="mt-2 ml-8 flex items-center gap-2 animate-in slide-in-from-left-2">
                        <input 
                            autoFocus
                            value={newNodeName}
                            onChange={e => setNewNodeName(e.target.value.toUpperCase())}
                            onKeyDown={e => e.key === 'Enter' && handleAddNode(node.id, (node.level + 1) as any)}
                            placeholder={`Novo Nível ${node.level + 1}...`}
                            className="bg-black border-b border-luxury-gold text-white px-2 py-1 text-xs focus:outline-none w-48"
                        />
                        <button onClick={() => handleAddNode(node.id, (node.level + 1) as any)} className="text-emerald-500"><Check className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setAddingToParentId(null)} className="text-zinc-500"><X className="w-3.5 h-3.5" /></button>
                    </div>
                )}

                {isExpanded && children.map(child => renderNode(child, depth + 1))}
            </div>
        );
    };

    const handleCreateMaster = () => {
        const name = newMasterName.trim();
        if (!name) return;

        const newNode: TaxonomyNode = {
            id: generateId(),
            parentId: null,
            level: 1,
            name,
            slug: slugify(name),
            sourceType: TaxonomySource.USER_CUSTOMIZED,
            isCustomized: true,
            lastUpdated: Date.now()
        };

        onUpdateTaxonomy([...taxonomy, newNode]);
        setNewMasterName('');
        setIsAddingMaster(false);
    };

    const l1Nodes = taxonomy.filter(n => n.level === 1).sort((a, b) => a.name.localeCompare(b.name));

    return (
        <div className="bg-black/40 border border-white/5 rounded-[2.5rem] overflow-hidden shadow-2xl">
            <div className="p-8 border-b border-white/5 flex flex-col sm:flex-row justify-between items-center bg-zinc-900/20 gap-4">
                <div className="flex-1 w-full">
                    {isAddingMaster ? (
                        <div className="flex items-center gap-3 animate-in slide-in-from-left-4 duration-300">
                            <Layers className="w-5 h-5 text-luxury-gold shrink-0" />
                            <div className="flex-1 relative">
                                <input 
                                    ref={masterInputRef}
                                    value={newMasterName}
                                    onChange={e => setNewMasterName(e.target.value.toUpperCase())}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') handleCreateMaster();
                                        if (e.key === 'Escape') setIsAddingMaster(false);
                                    }}
                                    placeholder="NOME DA NOVA CATEGORIA MESTRE..."
                                    className="w-full bg-black border-b-2 border-luxury-gold text-white px-0 py-2 text-sm font-sans focus:outline-none placeholder:text-zinc-700 tracking-tighter"
                                />
                                <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                    <button onClick={handleCreateMaster} className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-full transition-all">
                                        <Check className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => setIsAddingMaster(false)} className="p-2 text-zinc-500 hover:bg-white/5 rounded-full transition-all">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <h3 className="text-xl font-serif text-white uppercase tracking-tight flex items-center gap-3">
                                <Layers className="w-5 h-5 text-luxury-gold" /> Estrutura de Taxonomia
                            </h3>
                            <div className="flex items-center gap-4 mt-1">
                                <p className="text-zinc-500 text-[11px] uppercase font-bold tracking-[0.08em]">Gestão de Níveis e Relacionamentos Financeiros</p>
                            </div>
                        </div>
                    )}
                </div>

                {!isAddingMaster && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                            onClick={handleLevelWithDefault}
                            disabled={isLeveling}
                            title="Adiciona o que falta do padrão de fábrica, sem tocar no que você já tem"
                            className="flex items-center gap-2 px-4 py-2.5 bg-white/5 border border-white/10 text-zinc-300 rounded-xl text-[11px] font-bold uppercase tracking-[0.08em] hover:border-luxury-gold/40 transition-all disabled:opacity-50"
                        >
                            {isLeveling ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4 text-luxury-gold" />} Nivelar Padrão
                        </button>
                        <button
                            onClick={() => importInputRef.current?.click()}
                            disabled={isLeveling}
                            title="Importar uma planilha .xlsx e nivelar com o que você já tem"
                            className="flex items-center gap-2 px-4 py-2.5 bg-white/5 border border-white/10 text-zinc-300 rounded-xl text-[11px] font-bold uppercase tracking-[0.08em] hover:border-luxury-gold/40 transition-all disabled:opacity-50"
                        >
                            <FileSpreadsheet className="w-4 h-4 text-luxury-gold" /> Importar Planilha
                        </button>
                        <button
                            onClick={downloadTaxonomyTemplate}
                            title="Baixar modelo .xlsx em branco"
                            className="p-2.5 text-zinc-500 hover:text-luxury-gold transition-all"
                        >
                            <Download className="w-4 h-4" />
                        </button>
                        <input
                            ref={importInputRef}
                            type="file"
                            accept=".xlsx,.xls"
                            className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); }}
                        />
                        <button 
                            onClick={() => setIsAddingMaster(true)}
                            className="flex items-center gap-2 px-6 py-2.5 bg-luxury-gold text-black rounded-xl text-[11px] font-bold uppercase tracking-[0.08em] hover:bg-white transition-all shadow-lg shadow-luxury-gold/10"
                        >
                            <Plus className="w-4 h-4" /> Nova Mestre
                        </button>
                    </div>
                )}
            </div>

            {levelFeedback && (
                <div className="mx-8 mb-4 px-5 py-3 rounded-xl bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold text-xs font-bold animate-in fade-in slide-in-from-top-2">
                    {levelFeedback}
                </div>
            )}

            {dupInfo.total > 0 && (
                <div className="mx-6 mt-5 flex items-center gap-3 rounded-2xl border border-luxury-gold/30 bg-luxury-gold/10 px-4 py-3" data-testid="tax-dup-banner">
                    <Copy className="w-4 h-4 text-luxury-gold shrink-0" />
                    <p className="flex-1 min-w-0 text-[12.5px] leading-snug text-zinc-200">
                        <span className="font-bold text-luxury-gold">{dupInfo.total} {dupInfo.total === 1 ? 'grupo de categorias repetidas' : 'grupos de categorias repetidas'}</span>
                        {dupInfo.equal > 0 ? <span className="text-zinc-400"> · {dupInfo.equal} {dupInfo.equal === 1 ? 'idêntico' : 'idênticos'}</span> : null}
                    </p>
                    <button onClick={() => setDupOpen(true)} data-testid="tax-dup-review" className="shrink-0 h-9 px-4 rounded-xl bg-luxury-gold text-black text-xs font-bold">Revisar</button>
                </div>
            )}

            <div className="p-6 space-y-4">
                {l1Nodes.map(node => renderNode(node))}

                {l1Nodes.length === 0 && (
                    <div className="py-20 text-center flex flex-col items-center gap-4 opacity-30">
                        <Layers className="w-12 h-12" />
                        <span className="text-xs font-sans uppercase tracking-[0.1em]">Taxonomia Vazia</span>
                    </div>
                )}
            </div>

            <div className="p-6 bg-zinc-900/10 border-t border-white/5 flex items-center gap-3">
                <Info className="w-4 h-4 text-zinc-600" />
                <span className="text-[11px] text-zinc-500 uppercase font-bold tracking-[0.08em] leading-relaxed">
                    A taxonomia inteligente usa herança visual. Se um nível inferior não tem ícone/cor, ele herda do pai.
                </span>
            </div>

            {dupOpen && <DuplicateCategoriesSheet taxonomy={taxonomy} receipts={receipts} onApply={applyMerge} onClose={() => { setDupOpen(false); setIgnoredTick(t => t + 1); }} />}
            {mergeWithId && <MergeWithSheet taxonomy={taxonomy} receipts={receipts} sourceId={mergeWithId} onApply={applyMerge} onClose={() => setMergeWithId(null)} />}
        </div>
    );
};

export default TaxonomyEditor;
