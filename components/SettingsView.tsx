
import React, { useState, useMemo, useRef } from 'react';
import * as LucideIcons from 'lucide-react';
import { 
    Plus, Trash2, X, Search, Layers, Database, AlertTriangle, Download, 
    Upload, RefreshCw, Calculator, Eraser, History as HistoryIcon, Clock, 
    FolderOpen, HelpCircle, Save, Check, Copy, Palette, BrainCircuit, ChevronDown, ChevronRight, Store, Edit2, Sparkles, KeyRound, UserRound
} from 'lucide-react';
import { Receipt, SystemSnapshot, Establishment, TaxonomyNode, AILearningEntry } from '../types';
import { getCategoryIcon, getCategoryColor } from './Dashboard';
import TaxonomyEditor from './TaxonomyEditor';
import ProductMappingEditor from './ProductMappingEditor';
import AILearningManager from './AILearningManager';
import AISettingsPanel from './AISettingsPanel';
import CloudAccountPanel from './CloudAccountPanel';
import { isNativeApp } from '../services/platform';
import type { CloudApi } from '../services/useCloud';
import type { BackupApi } from '../services/useCloudBackup';
import { formatCNPJ } from '../services/productNormalization';
import { titleCase } from '../services/textFormat';
import { AppMark, PDLogo } from './Brand';

interface SettingsViewProps {
  taxonomy: TaxonomyNode[];
  onUpdateTaxonomy: (newTaxonomy: TaxonomyNode[]) => void;
  onBack: () => void;
  onClearData?: () => void;
  onExportData?: () => void; 
  onImportData?: (file: File) => void;
  onCleanupDuplicates?: () => void; 
  onReprocessCategories?: () => void;
  onAuditPrices?: () => void;
  onUpdateGlobalMapping?: (description: string, newCategory: string) => void;
  onUpdateBatchMapping?: (mappings: { description: string, newCategory: string }[]) => void;
  receipts?: Receipt[];
  establishments: Establishment[];
  onUpdateEstablishment: (est: Establishment) => void;
  snapshots: SystemSnapshot[];
  onCreateSnapshot: (name: string) => void;
  onRestoreSnapshot: (id: string) => void;
  onDeleteSnapshot: (id: string) => void;
  onEditIcon?: (category: string) => void;
  onUnifyEstablishments?: () => void;
  aiLearning: AILearningEntry[];
  onUpdateAiLearning: (learning: AILearningEntry[]) => void;
  cloud?: CloudApi;
  backup?: BackupApi;
  initialTab?: string;
  onOpenAlerts?: () => void;
}

const LUXURY_COLORS = [
    { name: 'Gold 1', hex: '#D4AF37' }, { name: 'Gold 2', hex: '#C5A028' }, { name: 'Gold 3', hex: '#B69119' }, 
    { name: 'Gold 4', hex: '#A7820A' }, { name: 'Bronze', hex: '#9F4D19' }, { name: 'Ocre', hex: '#B9A329' },
    { name: 'Studio', hex: '#27A46D' }, { name: 'Forest', hex: '#0D6041' }, { name: 'Emerald', hex: '#10B981' }, 
    { name: 'Jade', hex: '#059669' }, { name: 'Lime', hex: '#22C55E' }, { name: 'Neon', hex: '#17FF7C' },
    { name: 'Slate', hex: '#466C8C' }, { name: 'Ocean', hex: '#3B5B76' }, { name: 'Navy', hex: '#09398E' }, 
    { name: 'Royal', hex: '#2D5ABF' }, { name: 'Azure', hex: '#3B82F6' }, { name: 'Sky', hex: '#60A5FA' },
    { name: 'Red', hex: '#D03F33' }, { name: 'Crimson', hex: '#B8352A' }, { name: 'Wine', hex: '#2F0705' }, 
    { name: 'Coral', hex: '#FD7566' }, { name: 'Rose', hex: '#F43F5E' }, { name: 'Soft Red', hex: '#F87171' },
    { name: 'Magenta', hex: '#E6199F' }, { name: 'Purple', hex: '#8558A3' }, { name: 'Violet', hex: '#A855F7' }, 
    { name: 'Plum', hex: '#7E22CE' }, { name: 'Lavender', hex: '#C084FC' }, { name: 'Deep Purple', hex: '#581C87' },
    { name: 'Teal', hex: '#2AEBCE' }, { name: 'Cyan', hex: '#06B6D4' }, { name: 'Turquoise', hex: '#2DD4BF' }, 
    { name: 'Dark Teal', hex: '#0F766E' }, { name: 'Aqua', hex: '#22D3EE' }, { name: 'Peacock', hex: '#0891B2' },
    { name: 'Amber', hex: '#F59E0B' }, { name: 'Orange', hex: '#F97316' }, { name: 'Tangerine', hex: '#FB923C' }, 
    { name: 'Copper', hex: '#B45309' }, { name: 'Burnt', hex: '#9A3412' }, { name: 'Peach', hex: '#FDBA74' },
    { name: 'Charcoal', hex: '#18181B' }, { name: 'Iron', hex: '#3F3F46' }, { name: 'Silver', hex: '#D1D5DB' }, 
    { name: 'Stone', hex: '#78716C' }, { name: 'Coffee', hex: '#44403C' }, { name: 'Night', hex: '#020617' }
];

const PT_BR_ICON_MAP: Record<string, string[]> = {
    'comida': ['Utensils', 'Soup', 'Pizza', 'ChefHat'],
    'carne': ['Beef', 'Ham', 'Bird', 'Fish'],
    'fruta': ['Apple', 'Cherry', 'Grape', 'Citrus', 'Strawberry'],
    'legume': ['Carrot', 'Salad', 'Mushroom'],
    'doce': ['Candy', 'IceCream', 'Cookie', 'CakeSlice', 'Donut'],
    'bebida': ['Coffee', 'Milk', 'Wine', 'Beer', 'CupSoda', 'Droplets'],
    'casa': ['Home', 'Bed', 'Lamp', 'Tv', 'Armchair'],
    'limpeza': ['Waves', 'SprayCan', 'Bath', 'Brush', 'Eraser', 'WashingMachine'],
    'saude': ['HeartPulse', 'Pill', 'Stethoscope', 'Syringe'],
    'beleza': ['Sparkles', 'Shirt', 'Gem', 'Crown', 'Hanger'],
    'tecnologia': ['Smartphone', 'Laptop', 'Monitor', 'Cpu', 'Binary', 'Code', 'Wifi'],
    'dinheiro': ['Banknote', 'Coins', 'CreditCard', 'Wallet', 'Landmark', 'TrendingUp'],
    'transporte': ['Fuel', 'Car', 'Plane', 'Bike', 'Tram'],
    'pet': ['PawPrint', 'Bone', 'Cat', 'Dog'],
    'ferramenta': ['Wrench', 'Hammer', 'Scissors', 'Tool'],
    'esporte': ['Trophy', 'Medal', 'Dumbbell', 'Target'],
    'livro': ['Book', 'PenTool', 'Languages', 'GraduationCap'],
    'tempo': ['Clock', 'Calendar', 'Hourglass', 'Timer'],
    'seguranca': ['Lock', 'Key', 'Shield', 'Fingerprint']
};

const ICON_GROUPS = [
    { name: 'Gastronomia', icons: ['Croissant', 'CakeSlice', 'Cookie', 'Wheat', 'ChefHat', 'Donut', 'Pizza', 'Candy', 'IceCream', 'Coffee', 'Milk', 'Utensils', 'Soup', 'Beef', 'Bird', 'Fish', 'Ham', 'Egg', 'Apple', 'Carrot', 'Cherry', 'Grape', 'Citrus', 'Strawberry', 'Mushroom', 'Salad'] },
    { name: 'Estilo & Identidade', icons: ['Waves', 'Droplets', 'SprayCan', 'Bath', 'Baby', 'Heart', 'HeartPulse', 'Pill', 'Stethoscope', 'Smile', 'Sparkles', 'Shirt', 'Hanger', 'Gem', 'Watch', 'Crown', 'Diamond', 'ShoppingBag', 'Briefcase', 'Footprints'] },
    { name: 'Infraestrutura', icons: ['Smartphone', 'Laptop', 'Monitor', 'Tv', 'Headphones', 'Speaker', 'Camera', 'Cpu', 'Binary', 'Code', 'Keyboard', 'Mouse', 'Wifi', 'Bluetooth', 'HardDrive', 'Zap', 'Battery', 'Settings', 'Tool', 'Wrench', 'Hammer', 'Scissors', 'Brush', 'Eraser'] },
    { name: 'Wealth & Assets', icons: ['Coins', 'CreditCard', 'Wallet', 'Banknote', 'Landmark', 'PieChart', 'BarChart4', 'LineChart', 'TrendingUp', 'TrendingDown', 'Target', 'Calculator', 'Lock', 'Key', 'Shield'] }
];

const ALL_ICON_NAMES = Object.keys(LucideIcons).filter(key => 
    key !== 'createLucideIcon' && 
    /^[A-Z]/.test(key)
);

const SettingsView: React.FC<SettingsViewProps> = ({ 
  taxonomy, onUpdateTaxonomy, onClearData, onExportData, onImportData, 
  onCleanupDuplicates, onReprocessCategories, onAuditPrices, onUpdateGlobalMapping, onUpdateBatchMapping,
  receipts = [], establishments = [], onUpdateEstablishment, snapshots, onCreateSnapshot, onRestoreSnapshot, onDeleteSnapshot,
  onEditIcon, onUnifyEstablishments, aiLearning, onUpdateAiLearning, cloud, backup, initialTab, onOpenAlerts
}) => {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showSnapshotModal, setShowSnapshotModal] = useState(false);
  const [newSnapshotName, setNewSnapshotName] = useState('');
  const [iconSearch, setIconSearch] = useState('');
  const [settingsTab, setSettingsTab] = useState<'taxonomy' | 'establishments' | 'intelligence' | 'system' | 'visual_ai' | 'ai_key' | 'account'>((initialTab as any) || 'taxonomy');
  const [expandedAesthetics, setExpandedAesthetics] = useState<string[]>([]);
  const [estSearchTerm, setEstSearchTerm] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredSearchIcons = useMemo(() => {
      const search = iconSearch.toLowerCase().trim();
      if (!search) return [];
      const ptMatches = Object.entries(PT_BR_ICON_MAP)
          .filter(([key]) => key.includes(search))
          .flatMap(([, icons]) => icons);
      const directMatches = ALL_ICON_NAMES.filter(name => name.toLowerCase().includes(search));
      return Array.from(new Set([...ptMatches, ...directMatches])).slice(0, 200);
  }, [iconSearch]);

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
    return list;
  }, [taxonomy]);

  const groupedCategories = useMemo(() => {
    const groups: Record<string, string[]> = {};
    const l1s = taxonomy.filter(n => n.level === 1);
    l1s.forEach(l1 => {
        const l2s = taxonomy.filter(n => n.parentId === l1.id);
        groups[l1.name] = l2s.map(l2 => l2.name);
    });
    return groups;
  }, [taxonomy]);

  const toggleAestheticGroup = (group: string) => {
      setExpandedAesthetics(prev => prev.includes(group) ? prev.filter(g => g !== group) : [...prev, group]);
  };

  const filteredEstablishments = useMemo(() => {
      const term = estSearchTerm.toUpperCase();
      return establishments.filter(e => 
          e.originalName.toUpperCase().includes(term) || 
          (e.aliasName && e.aliasName.toUpperCase().includes(term)) ||
          e.cnpj.includes(term)
      ).sort((a,b) => a.originalName.localeCompare(b.originalName));
  }, [establishments, estSearchTerm]);

  return (
    <div className="animate-in fade-in duration-700 pb-20 max-w-5xl mx-auto md:px-4">
      <div className="mb-8 md:mb-12 text-center md:text-left flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
              <h2 className="text-3xl md:text-6xl font-serif text-white mb-2 tracking-tighter uppercase">Studio Settings</h2>
              <p className="text-zinc-400 font-sans text-sm">Estrutura, lojas, inteligência e backup do app</p>
          </div>
          
          <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5 overflow-x-auto no-scrollbar">
              <TabButton active={settingsTab === 'taxonomy'} onClick={() => setSettingsTab('taxonomy')} icon={Layers} label="Estrutura & Estilo" />
              <TabButton active={settingsTab === 'establishments'} onClick={() => setSettingsTab('establishments')} icon={Store} label="Lojas" />
              <TabButton active={settingsTab === 'intelligence'} onClick={() => setSettingsTab('intelligence')} icon={BrainCircuit} label="Inteligência" />
              <TabButton active={settingsTab === 'system'} onClick={() => setSettingsTab('system')} icon={Database} label="System" />
              <TabButton active={settingsTab === 'ai_key'} onClick={() => setSettingsTab('ai_key')} icon={KeyRound} label="Chave IA" />
              {cloud && <TabButton active={settingsTab === 'account'} onClick={() => setSettingsTab('account')} icon={UserRound} label="Conta" />}
          </div>
      </div>

      {settingsTab === 'taxonomy' && (
          <div className="animate-in slide-in-from-bottom-4 duration-500">
              <TaxonomyEditor taxonomy={taxonomy} onUpdateTaxonomy={onUpdateTaxonomy} onEditIcon={onEditIcon} />
          </div>
      )}

      {settingsTab === 'establishments' && (
          <div className="animate-in slide-in-from-bottom-4 duration-500 space-y-6">
              <div className="bg-black/40 border border-white/5 rounded-[2.5rem] p-5 sm:p-8 shadow-2xl relative">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6 mb-5 sm:mb-8">
                      <div>
                          <h3 className="text-lg sm:text-xl font-serif text-white uppercase tracking-tight flex items-center gap-3">
                              <Store className="w-5 h-5 text-luxury-gold shrink-0" /> Tabela de Estabelecimentos
                          </h3>
                          <p className="text-zinc-400 text-xs mt-1.5">Dê um apelido às lojas para reconhecer cada uma com facilidade.</p>
                      </div>
                      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 md:gap-4 w-full md:w-auto">
                          {onUnifyEstablishments && (
                              <button onClick={onUnifyEstablishments} className="flex items-center gap-3 bg-white/5 text-zinc-400 px-6 py-3 rounded-2xl font-semibold text-sm hover:bg-luxury-gold hover:text-black transition-all border border-white/5 whitespace-nowrap justify-center">
                                  <RefreshCw className="w-4 h-4" /> Unificar lojas
                              </button>
                          )}
                          <div className="relative w-full md:w-80">
                              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                              <input type="text" placeholder="Buscar loja" value={estSearchTerm} onChange={e => setEstSearchTerm(e.target.value)} className="w-full bg-black/60 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-luxury-gold/40 outline-none font-medium" />
                          </div>
                      </div>
                  </div>

                  {filteredEstablishments.length === 0 && (
                      <p className="text-sm text-zinc-500 text-center py-10">Nenhuma loja encontrada.</p>
                  )}

                  {/* Celular: um cartão por loja */}
                  <div className="md:hidden space-y-2.5">
                      {filteredEstablishments.map((est, idx) => (
                          <div key={idx} className="rounded-2xl border border-white/5 bg-zinc-900/30 p-4">
                              <p className="text-sm font-semibold text-zinc-100 leading-snug break-words">{titleCase(est.originalName)}</p>
                              <p className="text-xs text-zinc-500 mt-1 break-words">
                                  <span className="tabular-nums">{formatCNPJ(est.cnpj) || 'Pessoa física'}</span>
                                  {(est.city || est.state) && <> · {[titleCase(est.city), est.state].filter(Boolean).join(' - ')}</>}
                              </p>
                              <label className="block mt-3">
                                  <span className="block text-xs text-zinc-400 font-medium mb-1.5">Apelido</span>
                                  <input
                                    type="text"
                                    value={est.aliasName || ''}
                                    onChange={e => onUpdateEstablishment({...est, aliasName: e.target.value.toUpperCase()})}
                                    placeholder="Como você chama esta loja"
                                    className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-luxury-gold focus:border-luxury-gold/50 outline-none font-semibold placeholder:text-zinc-600 placeholder:font-normal"
                                  />
                              </label>
                          </div>
                      ))}
                  </div>

                  {/* Tela grande: tabela */}
                  <div className="hidden md:block overflow-x-auto border border-white/5 rounded-2xl bg-zinc-900/10">
                      <table className="w-full text-left border-collapse">
                          <thead className="bg-zinc-900 border-b border-white/10">
                              <tr>
                                  <th className="px-6 py-4 text-xs font-semibold text-zinc-400">CNPJ e cidade</th>
                                  <th className="px-6 py-4 text-xs font-semibold text-zinc-400">Nome no cupom</th>
                                  <th className="px-6 py-4 text-xs font-semibold text-zinc-400">Apelido</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                              {filteredEstablishments.map((est, idx) => (
                                  <tr key={idx} className="group hover:bg-white/[0.02] transition-colors">
                                      <td className="px-6 py-4">
                                          <div className="flex flex-col">
                                              <span className="text-xs font-mono font-semibold text-zinc-300 tabular-nums">{formatCNPJ(est.cnpj) || 'Pessoa física'}</span>
                                              <span className="text-xs text-zinc-500 mt-0.5">{[titleCase(est.city), est.state].filter(Boolean).join(' - ')}</span>
                                          </div>
                                      </td>
                                      <td className="px-6 py-4">
                                          <span className="text-sm font-sans font-semibold text-zinc-200 line-clamp-2">{titleCase(est.originalName)}</span>
                                      </td>
                                      <td className="px-6 py-4">
                                          <div className="relative group/edit">
                                              <input 
                                                type="text" 
                                                value={est.aliasName || ''} 
                                                onChange={e => onUpdateEstablishment({...est, aliasName: e.target.value.toUpperCase()})}
                                                placeholder="Definir apelido"
                                                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-luxury-gold focus:border-luxury-gold/50 outline-none font-semibold placeholder:text-zinc-600 placeholder:font-normal"
                                              />
                                              <Edit2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-700 opacity-0 group-hover/edit:opacity-50 transition-opacity" />
                                          </div>
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              </div>
          </div>
      )}

      {settingsTab === 'intelligence' && onUpdateBatchMapping && (
          <div className="animate-in slide-in-from-bottom-4 duration-500">
              <ProductMappingEditor 
                receipts={receipts} 
                taxonomy={taxonomy} 
                onUpdateBatchMapping={onUpdateBatchMapping} 
              />
              <AILearningManager 
                learning={aiLearning} 
                taxonomy={taxonomy} 
                onUpdate={onUpdateAiLearning} 
              />
          </div>
      )}

      {settingsTab === 'ai_key' && <AISettingsPanel />}
      {settingsTab === 'account' && cloud && <CloudAccountPanel cloud={cloud} backup={backup} onOpenAlerts={() => onOpenAlerts?.()} />}

      {settingsTab === 'system' && (
          <div className="animate-in slide-in-from-bottom-4 duration-500 space-y-12">
            <div className="p-5 sm:p-8 bg-white/[0.02] border border-white/5 rounded-[2.5rem] relative overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                    <div>
                        <h3 className="text-xl font-serif text-white uppercase tracking-tight flex items-center gap-3">
                            <HistoryIcon className="w-5 h-5 text-luxury-gold" /> Checkpoints de Auditoria
                        </h3>
                        <p className="text-zinc-500 text-[11px] uppercase font-bold mt-1 tracking-[0.08em]">Snapshots de integridade do sistema</p>
                    </div>
                    <button onClick={() => setShowSnapshotModal(true)} className="flex items-center gap-3 bg-luxury-gold text-black px-6 py-3 rounded-2xl font-bold text-[11px] uppercase tracking-[0.08em] hover:bg-white transition-all shadow-lg shadow-luxury-gold/10">
                        <Plus className="w-4 h-4" /> Criar Snapshot
                    </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {snapshots.length === 0 ? (
                        <div className="col-span-full py-12 border border-dashed border-white/10 rounded-[2rem] flex flex-col items-center justify-center text-zinc-700 gap-3">
                            <Clock className="w-8 h-8 opacity-20" />
                            <span className="text-[11px] uppercase tracking-[0.08em] font-bold">Aguardando primeiro checkpoint</span>
                        </div>
                    ) : (
                        snapshots.map(snap => (
                            <div key={snap.id} className="bg-black/40 border border-white/5 p-5 rounded-2xl flex items-center justify-between group hover:border-luxury-gold/30 transition-all">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-white/5 flex items-center justify-center font-serif text-luxury-gold font-bold text-lg">{snap.version}</div>
                                    <div>
                                        <div className="text-zinc-200 font-bold text-xs uppercase tracking-tight truncate max-w-[150px]">{snap.name}</div>
                                        <div className="text-xs text-zinc-500 mt-1 flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(snap.timestamp).toLocaleString('pt-BR')}</div>
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    <button onClick={() => onRestoreSnapshot(snap.id)} className="p-3 text-emerald-500 hover:bg-emerald-500/10 rounded-xl transition-all" title="Restaurar"><RefreshCw className="w-5 h-5" /></button>
                                    <button onClick={() => onDeleteSnapshot(snap.id)} className="p-3 text-red-500 hover:bg-red-500/10 rounded-xl transition-all" title="Deletar"><Trash2 className="w-5 h-5" /></button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ActionBlock icon={Calculator} title="Audit consistency" desc="Auditoria de portfólio" onClick={onAuditPrices} primary />
                <ActionBlock icon={Eraser} title="Cleanup Engine" desc="Deduplicação inteligente" onClick={onCleanupDuplicates} />
                <ActionBlock icon={RefreshCw} title="Sinc Cloud" desc="Taxonomia & IA" onClick={onReprocessCategories} />
            </div>

            <div className="pt-10 border-t border-white/5 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <BackupCard icon={Download} label="Exportar" sub="Backup JSON/ZIP" onClick={onExportData} />
                <BackupCard icon={Upload} label="Importar" sub="Restaurar backup" onClick={() => fileInputRef.current?.click()} />
                <input type="file" ref={fileInputRef} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if(f && onImportData) onImportData(f); }} accept={isNativeApp() ? '*/*' : '.json,.zip,application/json,application/zip'} className="hidden" />
                
                <button onClick={() => setShowResetConfirm(true)} className="p-6 bg-red-950/5 border border-red-900/10 rounded-3xl flex flex-col items-center justify-center gap-3 group hover:bg-red-900/20 transition-all">
                    <AlertTriangle className="w-6 h-6 text-red-900 group-hover:text-red-500" />
                    <div className="text-center">
                        <h4 className="text-[11px] font-bold text-red-900 uppercase group-hover:text-white">Hard Reset</h4>
                    </div>
                </button>
            </div>
          </div>
      )}

      {showSnapshotModal && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
              <div className="w-full max-w-sm bg-[#0c0c0e] border border-white/10 rounded-[2.5rem] p-6 sm:p-10 shadow-2xl">
                  <h3 className="text-2xl font-serif text-white mb-6 uppercase text-center tracking-tighter">Checkpoint</h3>
                  <input type="text" placeholder="Nome identificador..." value={newSnapshotName} onChange={e => setNewSnapshotName(e.target.value)} className="w-full bg-black border border-white/5 rounded-xl py-4 px-6 text-sm text-zinc-100 focus:border-luxury-gold outline-none mb-8 text-center" autoFocus />
                  <div className="flex flex-col gap-3">
                      <button onClick={() => {onCreateSnapshot(newSnapshotName); setNewSnapshotName(''); setShowSnapshotModal(false);}} className="w-full py-4 rounded-xl bg-luxury-gold text-black font-bold text-[11px] uppercase tracking-[0.08em] shadow-xl shadow-luxury-gold/10">Salvar Estado</button>
                      <button onClick={() => setShowSnapshotModal(false)} className="w-full py-4 rounded-xl bg-white/5 text-zinc-500 font-bold text-[11px] uppercase tracking-[0.08em]">Abortar</button>
                  </div>
              </div>
          </div>
      )}

      {showResetConfirm && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md">
              <div className="w-full max-w-sm bg-[#0c0c0e] border border-red-900/20 rounded-[2.5rem] p-6 sm:p-10 text-center shadow-2xl">
                  <h3 className="text-2xl font-serif text-red-500 mb-2 uppercase tracking-tighter">Hard Reset?</h3>
                  <p className="text-zinc-500 text-[11px] mb-10 leading-relaxed uppercase tracking-wider">Esta ação removerá permanentemente todos os registros, auditorias e snapshots do estúdio.</p>
                  <div className="flex flex-col gap-3">
                      <button onClick={() => { if(onClearData) onClearData(); setShowResetConfirm(false); }} className="w-full py-4 rounded-xl bg-red-600 text-white font-bold text-[11px] uppercase tracking-[0.08em]">Executar Limpeza Total</button>
                      <button onClick={() => setShowResetConfirm(false)} className="w-full py-4 rounded-xl bg-white/5 text-zinc-500 font-bold text-[11px] uppercase tracking-[0.08em]">Manter Dados</button>
                  </div>
              </div>
          </div>
      )}

      {/* Assinatura da criadora do app */}
      <footer className="mt-16 pt-10 border-t border-white/5 flex flex-col items-center text-center gap-4 px-4">
          <AppMark className="h-14 w-auto" title="Eu Kasconta" />
          <p className="text-xs text-zinc-500">Eu Kasconta — suas compras sob controle.</p>
          <div className="mt-2 flex flex-col items-center gap-2 text-zinc-300">
              <span className="text-[11px] font-medium text-zinc-500">Criado por</span>
              <PDLogo className="w-52 sm:w-64" />
          </div>
      </footer>
    </div>
  );
};

const TabButton = ({ active, onClick, icon: Icon, label }: any) => (
    <button onClick={onClick} className={`flex items-center gap-2 px-4 sm:px-6 py-2 rounded-xl text-[11px] font-bold uppercase tracking-[0.08em] transition-all whitespace-nowrap shrink-0 ${active ? 'bg-luxury-gold text-black shadow-lg shadow-luxury-gold/20' : 'text-zinc-500 hover:text-white'}`}>
        <Icon className="w-4 h-4" />
        <span className="hidden sm:inline">{label}</span>
    </button>
);

const IconItem = ({ name, icon: IconComp, isSelected, onClick }: any) => {
    if (!IconComp) return null;
    return (
        <button onClick={onClick} className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all ${isSelected ? 'border-luxury-gold bg-luxury-gold/10' : 'bg-black/40 border-white/5 hover:border-white/20'}`}>
            <IconComp className={`w-6 h-6 ${isSelected ? 'text-luxury-gold' : 'text-zinc-600'}`} />
            <span className="text-[11px] text-zinc-700 uppercase truncate w-full text-center font-bold tracking-tighter">{name}</span>
        </button>
    );
};

const ActionBlock = ({ icon: Icon, title, desc, onClick, primary }: any) => (
    <div className={`p-5 sm:p-8 rounded-[2.5rem] border transition-all shadow-xl flex flex-col gap-5 ${primary ? 'bg-luxury-gold/5 border-luxury-gold/20' : 'bg-white/[0.01] border-white/5'}`}>
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border ${primary ? 'bg-luxury-gold/10 border-luxury-gold/10 text-luxury-gold' : 'bg-white/5 border-white/5 text-zinc-600'}`}><Icon className="w-6 h-6" /></div>
        <div>
            <h4 className="text-sm font-bold text-white uppercase font-sans tracking-tight">{title}</h4>
            <p className="text-zinc-500 text-[11px] uppercase font-bold mt-1 tracking-[0.08em]">{desc}</p>
        </div>
        <button onClick={onClick} className={`w-full py-4 rounded-xl text-[11px] font-bold uppercase tracking-[0.08em] transition-all ${primary ? 'bg-luxury-gold text-black hover:bg-white' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}>Executar</button>
    </div>
);

const BackupCard = ({ icon: Icon, label, sub, onClick }: any) => (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-3 p-5 sm:p-8 bg-white/[0.01] border border-white/5 rounded-[2.5rem] hover:bg-zinc-900/40 transition-all group w-full">
        <Icon className="w-6 h-6 text-zinc-600 group-hover:text-white transition-colors" />
        <div className="text-center">
            <h4 className="text-[11px] font-bold text-zinc-400 uppercase tracking-[0.08em]">{label}</h4>
            <p className="text-[11px] text-zinc-500 uppercase mt-1">{sub}</p>
        </div>
    </button>
);

export default SettingsView;
