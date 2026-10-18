
import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import { LayoutDashboard, History, ScanLine, Settings, BarChart3, Loader2, CheckCircle2, Map as MapIcon, X, Search, Palette, Sun, Moon, Smartphone, Menu, Bell } from 'lucide-react';
import PhoneFrame from './components/PhoneFrame';
import SideDrawer from './components/SideDrawer';
import * as LucideIcons from 'lucide-react';

import Dashboard, { getCategoryIcon } from './components/Dashboard';
import Scanner from './components/Scanner';
import ScanProgressChip from './components/ScanProgressChip';
import { buildReceiptsTxtZip } from './services/receiptText';
import { currentYearMonth } from './services/currentMonth';
import { setScanHandlers, ScanSummary } from './services/scanQueue';
import TransactionList from './components/TransactionList';
import ReceiptDetail from './components/ReceiptDetail';
import CategoryDetailView from './components/CategoryDetailView';
import Reports from './components/Reports';
import ProductHistoryView from './components/ProductHistoryView';
import ProductVariantDetailView from './components/ProductVariantDetailView';
import EstablishmentDetailView from './components/EstablishmentDetailView';
import EstablishmentEditSheet from './components/EstablishmentEditSheet';
import { applyStoreEdit, StoreDraft } from './services/establishmentEdit';
import { rekeyStoreCodes, applyCodeEdit, CodeOp, normStoreKey, codeKind } from './services/productCodes';
import SettingsView from './components/SettingsView';
import DiagnosticPanel from './components/DiagnosticPanel';
import ManualEntryForm from './components/ManualEntryForm';
import ImportLogViewer, { ImportLogEntry } from './components/ImportLogViewer';
import AlertsView, { AlertDraft } from './components/AlertsView';
import ScanSuggestionsSheet from './components/ScanSuggestionsSheet';
import { useCloud } from './services/useCloud';
import { useCloudBackup } from './services/useCloudBackup';
import { useRestorePoints } from './services/useRestorePoints';
import { readPointText } from './services/restorePoints';
import { readTxtReceipts, parseReceiptTexts, applyTxtImport, TxtFile } from './services/receiptTextImport';
import { deleteCloudReceipt } from './services/cloudService';
import ConfirmDialog from './components/ConfirmDialog';
// O mapa traz a biblioteca de mapas junto; só é baixado quando a pessoa abre a tela.
const EstablishmentsMapView = lazy(() => import('./components/EstablishmentsMapView'));
import { titleCase } from './services/textFormat';
import { StoreNamesProvider } from './components/StoreNamesContext';
import { LayersProvider } from './components/LayersContext';

import { Receipt, ViewState, DEFAULT_CATEGORIES, DEFAULT_TAXONOMY_STRING, DashboardConfig, UnifiedVault, Establishment, TaxonomyNode, TaxonomySource, AILearningEntry, CategoryMeta, MasterProduct } from './types';
import { diagnostics } from './services/diagnosticService';
import { auditAndRepairReceipt, cleanCNPJ, formatCNPJ } from './services/productNormalization';
import { resolveNodeStyle, migrateLegacyTaxonomy, findBestMatch, syncMissingDefaultTaxonomy } from './services/taxonomyService';
import { auditCategoriesWithAI } from './services/geminiService';
import { buildAndSyncMasterProducts } from './services/productMasterService';
import { unifyGroups, splitDesc, ProductGroup } from './services/productUnify';
import type { UnifyPlan } from './components/ProductUnifySheet';

import { GoogleGenAI } from '@google/genai';
import JSZip from 'jszip';
import { downloadFile } from './services/nativeFiles';
import { markFileBackup } from './services/lastWhen';
import { App as CapApp } from '@capacitor/app';
import { isNativeApp } from './services/platform';
import { STORAGE_FULL_EVENT } from './services/storageGuard';
import { AppMark } from './components/Brand';

const LUXURY_COLORS = [
    // Golds & Bronzes
    { name: 'Gold 1', hex: '#D4AF37' }, { name: 'Gold 2', hex: '#C5A028' }, { name: 'Gold 3', hex: '#B69119' }, 
    { name: 'Gold 4', hex: '#A7820A' }, { name: 'Bronze', hex: '#9F4D19' }, { name: 'Ocre', hex: '#B9A329' },
    // Greens & Emeralds
    { name: 'Studio', hex: '#27A46D' }, { name: 'Forest', hex: '#0D6041' }, { name: 'Emerald', hex: '#10B981' }, 
    { name: 'Jade', hex: '#059669' }, { name: 'Lime', hex: '#22C55E' }, { name: 'Neon', hex: '#17FF7C' },
    // Blues & Navies
    { name: 'Slate', hex: '#466C8C' }, { name: 'Ocean', hex: '#3B5B76' }, { name: 'Navy', hex: '#09398E' }, 
    { name: 'Royal', hex: '#2D5ABF' }, { name: 'Azure', hex: '#3B82F6' }, { name: 'Sky', hex: '#60A5FA' },
    // Reds & Corals
    { name: 'Red', hex: '#D03F33' }, { name: 'Crimson', hex: '#B8352A' }, { name: 'Wine', hex: '#2F0705' }, 
    { name: 'Coral', hex: '#FD7566' }, { name: 'Rose', hex: '#F43F5E' }, { name: 'Soft Red', hex: '#F87171' },
    // Purples & Magentas
    { name: 'Magenta', hex: '#E6199F' }, { name: 'Purple', hex: '#8558A3' }, { name: 'Violet', hex: '#A855F7' }, 
    { name: 'Plum', hex: '#7E22CE' }, { name: 'Lavender', hex: '#C084FC' }, { name: 'Deep Purple', hex: '#581C87' },
    // Teals & Cyans
    { name: 'Teal', hex: '#2AEBCE' }, { name: 'Cyan', hex: '#06B6D4' }, { name: 'Turquoise', hex: '#2DD4BF' }, 
    { name: 'Dark Teal', hex: '#0F766E' }, { name: 'Aqua', hex: '#22D3EE' }, { name: 'Peacock', hex: '#0891B2' },
    // Oranges & Ambers
    { name: 'Amber', hex: '#F59E0B' }, { name: 'Orange', hex: '#F97316' }, { name: 'Tangerine', hex: '#FB923C' }, 
    { name: 'Copper', hex: '#B45309' }, { name: 'Burnt', hex: '#9A3412' }, { name: 'Peach', hex: '#FDBA74' },
    // Neutrals & Slates
    { name: 'Charcoal', hex: '#18181B' }, { name: 'Iron', hex: '#3F3F46' }, { name: 'Silver', hex: '#D1D5DB' }, 
    { name: 'Stone', hex: '#78716C' }, { name: 'Coffee', hex: '#44403C' }, { name: 'Night', hex: '#020617' }
];

const PT_BR_ICON_MAP: Record<string, string[]> = {
    'comida': ['Utensils', 'Soup', 'Pizza', 'ChefHat', 'Sandwich', 'Salad', 'Popcorn', 'Package', 'Box', 'Croissant', 'Beef', 'Ham', 'Fish', 'Egg', 'EggFried'],
    'carne': ['Beef', 'Ham', 'Bird', 'Fish', 'Shrimp', 'Drumstick', 'Meat'],
    'embutidos': ['Package', 'Beef', 'Ham', 'Box', 'Archive'],
    'fruta': ['Apple', 'Cherry', 'Grape', 'Citrus', 'Strawberry', 'Banana', 'NutOff'],
    'frutas tropicais': ['Citrus', 'Banana', 'PalmTree', 'Sun', 'Waves'],
    'manga': ['Citrus', 'Apple', 'Leaf'],
    'mamao': ['Citrus', 'Apple', 'Leaf'],
    'abacate': ['Citrus', 'Apple', 'Leaf'],
    'abacaxi': ['Citrus', 'Crown', 'PalmTree'],
    'legume': ['Carrot', 'Salad', 'Mushroom', 'LeafyGreen', 'Leaf', 'Sprout', 'Cabbage'],
    'salada': ['Salad', 'LeafyGreen', 'Leaf', 'Sprout', 'Flower2', 'Cabbage'],
    'alface': ['LeafyGreen', 'Leaf', 'Sprout', 'Cabbage'],
    'tempero': ['Leaf', 'Sprout', 'Flower2', 'Wind'],
    'cheiro verde': ['Leaf', 'Sprout', 'Wind'],
    'doce': ['Candy', 'IceCream', 'Cookie', 'CakeSlice', 'Donut', 'Lollipop'],
    'bebida': ['Coffee', 'Milk', 'Wine', 'Beer', 'CupSoda', 'Droplets', 'GlassWater', 'Martini'],
    'casa': ['Home', 'Bed', 'Lamp', 'Tv', 'Armchair', 'DoorOpen', 'Fan', 'Refrigerator'],
    'limpeza': ['Waves', 'SprayCan', 'Bath', 'Brush', 'Eraser', 'WashingMachine', 'Trash2', 'Wind'],
    'saude': ['HeartPulse', 'Pill', 'Stethoscope', 'Syringe', 'Activity', 'Bandage', 'Thermometer', 'FirstAidKit', 'Hospital'],
    'beleza': ['Sparkles', 'Shirt', 'Gem', 'Crown', 'Hanger', 'Scissors', 'Flower2', 'Sun', 'Moon', 'Smile'],
    'cuidados': ['Bath', 'ShowerHead', 'SprayCan', 'Brush', 'Scissors', 'Sparkles', 'Heart', 'Pill', 'Smile'],
    'tecnologia': ['Smartphone', 'Laptop', 'Monitor', 'Cpu', 'Binary', 'Code', 'Wifi', 'HardDrive', 'Mouse', 'Keyboard'],
    'dinheiro': ['Banknote', 'Coins', 'CreditCard', 'Wallet', 'Landmark', 'TrendingUp', 'PiggyBank', 'Receipt'],
    'transporte': ['Fuel', 'Car', 'Plane', 'Bike', 'Tram', 'Bus', 'Truck', 'Ship', 'Container'],
    'combustivel': ['Fuel', 'Droplets', 'Zap', 'Container'],
    'pet': ['PawPrint', 'Bone', 'Cat', 'Dog', 'Bird', 'Fish', 'Rabbit', 'Turtle', 'Rat', 'Squirrel', 'Snail', 'Bug'],
    'gato': ['Cat'],
    'poodle': ['Dog'],
    'cachorro': ['Dog', 'PawPrint'],
    'animal': ['Cat', 'Dog', 'Bird', 'Fish', 'Rabbit', 'Turtle', 'Rat', 'Squirrel', 'Snail', 'Bug', 'PawPrint'],
    'ferramenta': ['Wrench', 'Hammer', 'Scissors', 'Tool', 'Nut', 'Drill'],
    'esporte': ['Trophy', 'Medal', 'Dumbbell', 'Target', 'Bike', 'Timer', 'Activity'],
    'livro': ['Book', 'PenTool', 'Languages', 'GraduationCap', 'Library', 'Notebook'],
    'folha': ['Leaf', 'LeafyGreen', 'Sprout', 'Clover'],
    'planta': ['Plant', 'TreeDeciduous', 'TreePine', 'PalmTree', 'Cactus', 'Flower2', 'Sprout', 'Leaf'],
    'urbano': ['Building', 'Building2', 'Castle', 'Church', 'Factory', 'Hospital', 'Hotel', 'Landmark', 'School', 'Store', 'MapPin', 'Navigation'],
    'comer fora': ['Store', 'Utensils', 'Pizza', 'Coffee', 'Beer', 'Wine', 'Martini', 'MapPin'],
    'lazer': ['Ticket', 'Popcorn', 'Clapperboard', 'Gamepad', 'Gamepad2', 'Dices', 'Puzzle', 'Music', 'Tv', 'Camera', 'Film', 'Tent']
};

const ALL_ICON_NAMES = Object.keys(LucideIcons).filter(key => key !== 'createLucideIcon' && /^[A-Z]/.test(key));

const ICON_GROUPS = [
    { name: 'Gastronomia & Embutidos', icons: ['Croissant', 'CakeSlice', 'Cookie', 'Wheat', 'ChefHat', 'Donut', 'Pizza', 'Candy', 'IceCream', 'Coffee', 'Milk', 'Utensils', 'Soup', 'Beef', 'Bird', 'Fish', 'Ham', 'Egg', 'EggFried', 'Apple', 'Carrot', 'Cherry', 'Grape', 'Citrus', 'Strawberry', 'Banana', 'NutOff', 'Mushroom', 'Salad', 'Sandwich', 'Popcorn', 'Lollipop', 'GlassWater', 'Beer', 'Wine', 'Martini', 'LeafyGreen', 'Leaf', 'Sprout', 'Cabbage', 'Package', 'Box', 'Drumstick', 'Meat'] },
    { name: 'Natureza & Plantas', icons: ['Leaf', 'LeafyGreen', 'Sprout', 'Flower2', 'TreeDeciduous', 'TreePine', 'Clover', 'Plant', 'Cactus', 'PalmTree', 'Sun', 'Moon', 'Cloud', 'CloudRain', 'Snowflake', 'Flame', 'Waves', 'Wind'] },
    { name: 'Mundo Pet & Animais', icons: ['PawPrint', 'Bone', 'Cat', 'Dog', 'Bird', 'Fish', 'Rabbit', 'Turtle', 'Snail', 'Bug', 'Rat', 'Squirrel', 'Worm'] },
    { name: 'Cuidados Pessoais & Beleza', icons: ['Bath', 'ShowerHead', 'SprayCan', 'Brush', 'Scissors', 'Sparkles', 'Heart', 'HeartPulse', 'Pill', 'Stethoscope', 'Activity', 'Bandage', 'Thermometer', 'FirstAidKit', 'Smile', 'Baby', 'Flower2', 'Sun', 'Moon', 'Wind', 'Waves'] },
    { name: 'Estilo & Identidade', icons: ['Shirt', 'Hanger', 'Gem', 'Watch', 'Crown', 'Diamond', 'ShoppingBag', 'Briefcase', 'Footprints', 'Glasses', 'Umbrella', 'Wallet', 'Backpack'] },
    { name: 'Urbano & Lazer', icons: ['Building', 'Building2', 'Castle', 'Church', 'Factory', 'Hospital', 'Hotel', 'Landmark', 'School', 'Store', 'Tent', 'Ticket', 'Popcorn', 'Clapperboard', 'Gamepad', 'Gamepad2', 'Dices', 'Puzzle', 'Music', 'Mic', 'Radio', 'Tv', 'Camera', 'Image', 'Video', 'Film', 'MapPin', 'Navigation', 'Compass', 'Map'] },
    { name: 'Infraestrutura & Tech', icons: ['Smartphone', 'Laptop', 'Monitor', 'Tv', 'Headphones', 'Speaker', 'Camera', 'Cpu', 'Binary', 'Code', 'Keyboard', 'Mouse', 'Wifi', 'Bluetooth', 'HardDrive', 'Zap', 'Battery', 'Settings', 'Tool', 'Wrench', 'Hammer', 'Scissors', 'Brush', 'Eraser', 'Home', 'Bed', 'Lamp', 'Refrigerator', 'Fan'] },
    { name: 'Wealth & Assets', icons: ['Coins', 'CreditCard', 'Wallet', 'Banknote', 'Landmark', 'PieChart', 'BarChart4', 'LineChart', 'TrendingUp', 'TrendingDown', 'Target', 'Calculator', 'Lock', 'Key', 'Shield', 'Receipt', 'PiggyBank'] },
    { name: 'Transporte & Mobilidade', icons: ['Car', 'Fuel', 'Plane', 'Bike', 'Bus', 'Truck', 'Ship', 'Tram', 'MapPin', 'Navigation', 'Container', 'Droplets'] }
];

const App: React.FC = () => {
  const [view, setView] = useState<ViewState | 'manual_entry'>('dashboard');
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("SISTEMA");
  const [selectedCategoryForIcon, setSelectedCategoryForIcon] = useState<string | null>(null);
  const [iconSearch, setIconSearch] = useState('');

  // Import Logs State
  const [importLogs, setImportLogs] = useState<ImportLogEntry[]>([]);
  const [isImportLogOpen, setIsImportLogOpen] = useState(false);

  const addImportLog = (level: ImportLogEntry['level'], message: string, details?: any) => {
      const entry: ImportLogEntry = {
          timestamp: new Date().toLocaleTimeString(),
          level,
          message,
          details
      };
      setImportLogs(prev => [...prev, entry]);
      console.log(`[Import ${level.toUpperCase()}] ${message}`, details || '');
  };

  const [receipts, setReceipts] = useState<Receipt[]>(() => {
      try {
          const stored = localStorage.getItem('eukasconta_data');
          return stored ? JSON.parse(stored) : [];
      } catch (e) { return []; }
  });

  const [masterProducts, setMasterProducts] = useState<MasterProduct[]>(() => {
      try {
          const stored = localStorage.getItem('eukasconta_master_products');
          return stored ? JSON.parse(stored) : [];
      } catch (e) { return []; }
  });

  const [taxonomy, setTaxonomy] = useState<TaxonomyNode[]>(() => {
      try {
          const stored = localStorage.getItem('eukasconta_taxonomy');
          if (stored) {
              const parsed = JSON.parse(stored);
              // Forçar upgrade se não houver nível 4 (Tabela Mestre IA)
              const hasLevel4 = parsed.some((n: any) => n.level === 4);
              if (!hasLevel4) {
                  return migrateLegacyTaxonomy(DEFAULT_TAXONOMY_STRING);
              }
              return syncMissingDefaultTaxonomy(parsed, DEFAULT_TAXONOMY_STRING);
          }
          
          return migrateLegacyTaxonomy(DEFAULT_TAXONOMY_STRING);
      } catch (e) { return migrateLegacyTaxonomy(DEFAULT_TAXONOMY_STRING); }
  });

  const [aiLearning, setAiLearning] = useState<AILearningEntry[]>(() => {
      try {
          const stored = localStorage.getItem('eukasconta_ai_learning');
          return stored ? JSON.parse(stored) : [];
      } catch (e) { return []; }
  });

  const categories = useMemo(() => {
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

  useEffect(() => {
    localStorage.setItem('eukasconta_taxonomy', JSON.stringify(taxonomy));
  }, [taxonomy]);

  useEffect(() => {
    localStorage.setItem('eukasconta_ai_learning', JSON.stringify(aiLearning));
  }, [aiLearning]);

  const [establishments, setEstablishments] = useState<Establishment[]>(() => {
      try {
          const stored = localStorage.getItem('eukasconta_establishments');
          return stored ? JSON.parse(stored) : [];
      } catch (e) { return []; }
  });

  // Padrão: sempre o mês atual (do dia 1 até hoje); a pessoa pode trocar no filtro (7 dias, 30 dias, ano, período...).
  const [dashboardConfig, setDashboardConfig] = useState<DashboardConfig>({
      year: currentYearMonth().year,
      month: currentYearMonth().month,
      category: null,
      quickFilter: null,
      customStartDate: '',
      customEndDate: '',
      establishment: null,
      item: null
  });

  // Se o app ficar aberto na virada do mês (ou voltar do segundo plano num mês novo) e o filtro ainda for o
  // mês padrão, acompanha o calendário. Quem escolheu outro período não é mexido.
  const autoMonthRef = useRef(`${currentYearMonth().year}-${currentYearMonth().month}`);
  useEffect(() => {
      const sync = () => {
          const { year, month } = currentYearMonth();
          const key = `${year}-${month}`;
          if (key === autoMonthRef.current) return;
          const prev = autoMonthRef.current;
          autoMonthRef.current = key;
          setDashboardConfig(c => (!c.quickFilter && c.month !== null && `${c.year}-${c.month}` === prev ? { ...c, year, month } : c));
      };
      const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', sync);
      const t = setInterval(sync, 60_000);
      return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', sync); clearInterval(t); };
  }, []);

  const [isMobilePreview, setIsMobilePreview] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
      try {
          return localStorage.getItem('eukasconta_theme') as 'dark' | 'light' || 'dark';
      } catch (e) { return 'dark'; }
  });

  useEffect(() => {
      localStorage.setItem('eukasconta_theme', theme);
      if (theme === 'light') {
          document.documentElement.classList.add('light-theme');
      } else {
          document.documentElement.classList.remove('light-theme');
      }
  }, [theme]);

  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubCategory, setSelectedSubCategory] = useState<string | null>(null);
  const [selectedProductGeneric, setSelectedProductGeneric] = useState<string | null>(null);
  const [selectedEstablishment, setSelectedEstablishment] = useState<string | null>(null);
  // Loja aberta para editar todos os dados (Config > Lojas e Mapa)
  const [editingStore, setEditingStore] = useState<Establishment | null>(null);

  useEffect(() => {
      localStorage.setItem('eukasconta_data', JSON.stringify(receipts));
      // Sincronizar tabela de estabelecimentos automaticamente ao adicionar novos recibos
      updateEstablishmentTableFromReceipts();
  }, [receipts]);

  useEffect(() => {
      localStorage.setItem('eukasconta_master_products', JSON.stringify(masterProducts));
  }, [masterProducts]);

  useEffect(() => {
      if (receipts.length > 0) {
          const synced = buildAndSyncMasterProducts(receipts, masterProducts);
          if (JSON.stringify(synced) !== JSON.stringify(masterProducts)) {
              setMasterProducts(synced);
          }
      }
  }, [receipts]);

  useEffect(() => {
      localStorage.setItem('eukasconta_taxonomy', JSON.stringify(taxonomy));
  }, [taxonomy]);

  useEffect(() => {
      localStorage.setItem('eukasconta_categories', JSON.stringify(categories));
  }, [categories]);

  useEffect(() => {
      localStorage.setItem('eukasconta_establishments', JSON.stringify(establishments));
  }, [establishments]);


  const updateEstablishmentTableFromReceipts = () => {
      setEstablishments(prev => {
          const currentTable = [...prev];
          let changed = false;

          receipts.forEach(r => {
              const cleanedRCNPJ = cleanCNPJ(r.cnpj);
              const exists = currentTable.find(e => {
                  const cleanedEstCNPJ = cleanCNPJ(e.cnpj);
                  return (cleanedEstCNPJ && cleanedEstCNPJ === cleanedRCNPJ) || 
                         (e.originalName === r.establishmentName && !cleanedRCNPJ);
              });

              if (!exists) {
                  currentTable.push({
                      cnpj: cleanedRCNPJ,
                      originalName: r.establishmentName,
                      address: r.address,
                      city: r.city,
                      state: r.state
                  });
                  changed = true;
              }
          });

          return changed ? currentTable : prev;
      });
  };

  // O apelido é gravado a cada letra digitada: sem aviso a cada toque (o campo já mostra o que ficou).
  const handleUpdateEstablishment = (updated: Establishment) => {
      setEstablishments(prev => prev.map(e => {
          const isMatch = (cleanCNPJ(e.cnpj) === cleanCNPJ(updated.cnpj) && e.originalName === updated.originalName);
          return isMatch ? { ...updated, cnpj: cleanCNPJ(updated.cnpj) } : e;
      }));
  };

  // Todos os dados da loja de uma vez (folha "Dados da loja"). Devolve o texto do erro, ou null quando gravou.
  const handleSaveStore = (prev: Establishment, draft: StoreDraft): string | null => {
      const res = applyStoreEdit(prev, draft, establishments, receipts);
      if ('error' in res) return res.error;
      // mudar o nome ou o CNPJ da loja reescreve os cupons dela: guarda um ponto antes
      if (res.identityChanged) restore.before('mudar o nome ou o CNPJ de uma loja');
      setEstablishments(res.establishments);
      if (res.identityChanged) {
          // O cupom guarda o nome e o CNPJ da loja: corrige junto, senão o histórico perde a ligação com o cadastro.
          setReceipts(res.receipts);
          setMasterProducts(prevMasters => rekeyStoreCodes(prevMasters, [prev.cnpj, prev.originalName], res.next.cnpj || res.next.originalName));
      }
      showNotification(res.changedReceipts > 0
          ? `Loja salva. ${res.changedReceipts === 1 ? '1 cupom corrigido' : `${res.changedReceipts} cupons corrigidos`}.`
          : "Dados da loja salvos.");
      return null;
  };

  // Vários apelidos de uma vez (sugestões da IA já revisadas pela pessoa)
  const handleApplyAliases = (list: { cnpj: string; originalName: string; aliasName: string }[]) => {
      const byKey = new Map(list.map(a => [`${cleanCNPJ(a.cnpj)}|${a.originalName}`, a.aliasName] as [string, string]));
      setEstablishments(prev => prev.map(e => {
          const alias = byKey.get(`${cleanCNPJ(e.cnpj)}|${e.originalName}`);
          return alias === undefined ? e : { ...e, cnpj: cleanCNPJ(e.cnpj), aliasName: alias };
      }));
      showNotification(list.length === 1 ? "1 apelido atualizado." : `${list.length} apelidos atualizados.`);
  };

  const handleUnifyEstablishments = () => {
      restore.before('unificar estabelecimentos');
      setGlobalLoading(true);
      setLoadingText("UNIFICANDO ESTABELECIMENTOS...");
      
      setTimeout(() => {
          setEstablishments(prev => {
              const unified: Record<string, Establishment> = {};
              
              prev.forEach(est => {
                  const cleaned = cleanCNPJ(est.cnpj);
                  const key = cleaned || est.originalName.toUpperCase();
                  if (!unified[key]) {
                      unified[key] = { ...est, cnpj: cleaned };
                  } else {
                      if (!unified[key].aliasName && est.aliasName) unified[key].aliasName = est.aliasName;
                      if (!unified[key].city && est.city) unified[key].city = est.city;
                      if (!unified[key].state && est.state) unified[key].state = est.state;
                      if (!unified[key].address && est.address) unified[key].address = est.address;
                  }
              });
              
              return Object.values(unified);
          });

          setReceipts(prev => prev.map(r => ({ ...r, cnpj: cleanCNPJ(r.cnpj) })));
          setGlobalLoading(false);
          showNotification("Estabelecimentos unificados e CNPJs padronizados.");
      }, 800);
  };

  const filteredSearchIcons = useMemo(() => {
      const search = iconSearch.toLowerCase().trim();
      if (!search) return [];
      const ptMatches = Object.entries(PT_BR_ICON_MAP)
          .filter(([key]) => key.includes(search))
          .flatMap(([, icons]) => icons);
      const directMatches = ALL_ICON_NAMES.filter(name => name.toLowerCase().includes(search));
      return Array.from(new Set([...ptMatches, ...directMatches])).slice(0, 150);
  }, [iconSearch]);

  const [metaVersion, setMetaVersion] = useState(0);

  const handleUpdateMeta = (category: string, updates: { icon?: string, color?: string }) => {
      // Update Taxonomy Node if exists
      const nodeIndex = taxonomy.findIndex(n => n.name === category || n.slug === category.toLowerCase());
      if (nodeIndex !== -1) {
          const newTaxonomy = [...taxonomy];
          newTaxonomy[nodeIndex] = {
              ...newTaxonomy[nodeIndex],
              icon: updates.icon || newTaxonomy[nodeIndex].icon,
              color: updates.color || newTaxonomy[nodeIndex].color,
              sourceType: TaxonomySource.USER_CUSTOMIZED,
              isCustomized: true,
              lastUpdated: Date.now()
          };
          setTaxonomy(newTaxonomy);
      }

      const stored = localStorage.getItem('eukasconta_category_meta') || '{}';
      const meta = JSON.parse(stored);
      meta[category] = { ...meta[category], ...updates };
      localStorage.setItem('eukasconta_category_meta', JSON.stringify(meta));
      window.dispatchEvent(new Event('storage'));
      setMetaVersion(v => v + 1);
      if (updates.icon) {
          setSelectedCategoryForIcon(null);
          showNotification("Ícone atualizado.");
      } else if (updates.color) {
          showNotification("Cor atualizada.");
      }
  };

  const getActiveMeta = (category: string): CategoryMeta => {
      // Find node by name or slug
      const node = taxonomy.find(n => n.name === category || n.slug === category.toLowerCase());
      if (node) {
          const style = resolveNodeStyle(node.id, taxonomy);
          return {
              icon: style.icon,
              color: style.color
          };
      }

      const stored = localStorage.getItem('eukasconta_category_meta');
      if (stored) {
          const meta = JSON.parse(stored);
          if (meta[category]) return meta[category];
          if (category.includes(' - ')) {
              const master = category.split(' - ')[0];
              if (meta[master]) return meta[master];
          }
      }
      return { icon: 'FolderOpen', color: '#D4AF37' };
  };

  // um aviso novo cancela o timer do anterior (senão o timer velho apagava o aviso novo antes da hora)
  const notificationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotification = (msg: string, ms = 4000) => {
    if (notificationTimer.current) clearTimeout(notificationTimer.current);
    setNotification(msg);
    notificationTimer.current = setTimeout(() => { notificationTimer.current = null; setNotification(null); }, ms);
  };

  // Nuvem (Supabase): conta, avisos, alertas e preços compartilhados. Só age com a pessoa logada.
  const cloud = useCloud({
      receipts,
      establishments,
      onGeocoded: (cnpj, patch) => setEstablishments(prev => prev.map(e => cleanCNPJ(e.cnpj) === cnpj ? { ...e, ...patch } : e)),
      onToast: (msg) => showNotification(msg),
  });
  // Backup automático na conta: dados e chave de IA voltam sozinhos ao entrar depois de reinstalar o app.
  const backupTrigger = useMemo(() => ({}), [receipts, taxonomy, establishments, masterProducts, aiLearning, categories]);
  const backup = useCloudBackup({ userId: cloud.user?.id ?? null, trigger: backupTrigger, onToast: (msg) => showNotification(msg, 6000) });
  // Pontos de restauração: cópias completas dos dados, no aparelho (manual, um por dia e antes de ações arriscadas)
  const restore = useRestorePoints({ onToast: (msg) => showNotification(msg, 7000) });
  const [alertDraft, setAlertDraft] = useState<AlertDraft | null>(null);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);
  const openAlertDraft = (d: AlertDraft) => { cloud.dismissSuggestions(); setAlertDraft(d); setView('alerts'); };
  const goToAccount = () => { setSettingsInitialTab('account'); setView('settings'); };
  useEffect(() => { if (view !== 'settings') setSettingsInitialTab(undefined); }, [view]);

  /* ── Android: botão voltar fecha o que estiver aberto e só então sai do app ── */
  const backHandlerRef = useRef<() => boolean>(() => false);
  backHandlerRef.current = () => {
    if (pendingDeleteId) { setPendingDeleteId(null); return true; }
    if (isDiagnosticOpen) { setIsDiagnosticOpen(false); return true; }
    if (isImportLogOpen) { setIsImportLogOpen(false); return true; }
    if (selectedCategoryForIcon) { setSelectedCategoryForIcon(null); return true; }
    if (selectedReceiptId) { setSelectedReceiptId(null); return true; }
    if (isDrawerOpen) { setIsDrawerOpen(false); return true; }
    if (cloud.suggestions.length > 0) { cloud.dismissSuggestions(); return true; }
    if (view === 'product_variant_detail') { setView('subcategory_detail'); return true; }
    if (view === 'subcategory_detail') { setView('category_detail'); return true; }
    if (view === 'establishment_detail') { setView('reports'); return true; }
    if (view !== 'dashboard') { setView('dashboard'); return true; }
    return false;
  };
  useEffect(() => {
    if (!isNativeApp()) return;
    let alive = true;
    let remove: (() => void) | undefined;
    CapApp.addListener('backButton', () => { if (!backHandlerRef.current()) CapApp.minimizeApp().catch(() => {}); })
      .then(h => { if (alive) remove = () => h.remove(); else h.remove(); })
      .catch(() => {});
    return () => { alive = false; remove?.(); };
  }, []);

  /* ── memória do aparelho cheia: avisa em vez de quebrar a tela ── */
  const lastFullWarn = useRef(0);
  useEffect(() => {
    const onFull = () => {
      if (Date.now() - lastFullWarn.current < 15000) return;
      lastFullWarn.current = Date.now();
      showNotification("Memória do app cheia: os dados mais novos não foram gravados. Exporte um backup e limpe cupons antigos.", 12000);
    };
    window.addEventListener(STORAGE_FULL_EVENT, onFull);
    return () => window.removeEventListener(STORAGE_FULL_EVENT, onFull);
  }, []);


  const handleUpdateReceipt = (updatedReceipt: Receipt) => {
      setReceipts(prev => prev.map(r => r.id === updatedReceipt.id ? updatedReceipt : r));
  };

  // Ovos: as outras compras do mesmo item (mesmo nome, mesma loja) que ainda não têm a quantidade de ovos escolhida
  const sameEggTargets = (src: Receipt, index: number): { rid: string; idx: number }[] => {
      const it = src.items[index];
      if (!it) return [];
      const store = normStoreKey(src.cnpj || src.establishmentName);
      const desc = (it.description || '').trim().toUpperCase();
      const out: { rid: string; idx: number }[] = [];
      receipts.forEach(r => {
          if (normStoreKey(r.cnpj || r.establishmentName) !== store) return;
          (r.items || []).forEach((x, i) => {
              if (r.id === src.id && i === index) return;
              if ((x.description || '').trim().toUpperCase() !== desc) return;
              if (Number(x.eggCount) > 0) return;
              out.push({ rid: r.id, idx: i });
          });
      });
      return out;
  };
  const handleApplyEggSame = (src: Receipt, index: number): number => {
      const count = Number(src.items[index]?.eggCount);
      if (!(count > 0)) return 0;
      const targets = sameEggTargets(src, index);
      if (!targets.length) return 0;
      const byReceipt = new Map<string, Set<number>>();
      targets.forEach(t => { const set = byReceipt.get(t.rid) || new Set<number>(); set.add(t.idx); byReceipt.set(t.rid, set); });
      setReceipts(prev => prev.map(r => {
          const idxs = byReceipt.get(r.id);
          return idxs ? { ...r, items: r.items.map((x, i) => (idxs.has(i) ? { ...x, eggCount: count } : x)) } : r;
      }));
      showNotification(`${count} ovos aplicados em ${targets.length} ${targets.length === 1 ? 'compra' : 'compras'}.`);
      return targets.length;
  };

  // Excluir lançamento: sempre pergunta antes; só apaga no "Excluir" da mensagem de confirmação.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const requestDeleteReceipt = (id: string) => setPendingDeleteId(id);
  const pendingDelete = useMemo(() => receipts.find(r => r.id === pendingDeleteId) || null, [receipts, pendingDeleteId]);
  const confirmDeleteReceipt = () => {
      const target = pendingDelete;
      setPendingDeleteId(null);
      if (!target) return;
      setReceipts(prev => prev.filter(r => r.id !== target.id));
      setSelectedReceiptId(prev => (prev === target.id ? null : prev));
      showNotification('Lançamento excluído.');
      const uid = cloud.user?.id;
      if (uid) deleteCloudReceipt(uid, target.id).catch(() => { /* a cópia na nuvem some no próximo envio; o app segue */ });
  };

  // Leitura de cupons em segundo plano (services/scanQueue): cada cupom lido é gravado na hora, mesmo que a
  // pessoa esteja em outra aba, e o aviso de fim sai de qualquer tela.
  const receiptsRef = useRef(receipts);
  receiptsRef.current = receipts;
  const viewRef = useRef(view);
  viewRef.current = view;
  const commitScanned = (r: Receipt): boolean => {
      const a = auditAndRepairReceipt(r);
      const isDup = (ex: Receipt) => a.id === ex.id || (a.date === ex.date && Math.abs(a.totalAmount - ex.totalAmount) < 0.01 && a.establishmentName === ex.establishmentName);
      if (receiptsRef.current.some(isDup)) return false;
      receiptsRef.current = [a, ...receiptsRef.current];   // o próximo cupom do lote já enxerga este
      setReceipts(prev => prev.some(isDup) ? prev : [a, ...prev]);
      return true;
  };
  const finishScan = (s: ScanSummary) => {
      const n = s.added.length;
      if (n > 0) cloud.contribute(s.added.map(auditAndRepairReceipt));
      const saved = `${n} ${n === 1 ? 'cupom salvo' : 'cupons salvos'}`;
      const dupNote = s.duplicates > 0 ? `; ${s.duplicates} já ${s.duplicates === 1 ? 'existia' : 'existiam'}` : '';
      const onScanner = viewRef.current === 'scanner';
      let msg: string;
      // Com falhas e em outra aba, o aviso flutuante da leitura já diz tudo (e fica até a pessoa ver): sem segundo aviso por cima dele.
      if (s.failed > 0 && !onScanner) return;
      if (s.failed > 0) msg = `Leitura terminou: ${saved}${dupNote}, ${s.failed} não ${s.failed === 1 ? 'importado' : 'importados'}.`;
      else if (s.interrupted) msg = n > 0 || s.duplicates > 0 ? `Leitura interrompida: ${saved}${dupNote}.` : 'Leitura interrompida.';
      else if (n === 0) msg = s.duplicates === 1 ? 'Esse cupom já estava no histórico, nada novo foi salvo.' : `Esses ${s.duplicates} cupons já estavam no histórico, nada novo foi salvo.`;
      else msg = `${saved}${dupNote}.`;
      // Sem falhas e com a tela do Scanner aberta, leva ao histórico. Em outra aba, não puxa a pessoa de lá.
      if (s.failed === 0 && onScanner && (n > 0 || s.duplicates > 0)) setView('history');
      showNotification(msg, 6000);
  };
  useEffect(() => { setScanHandlers({ commit: commitScanned, onFinish: finishScan }); });
  useEffect(() => () => setScanHandlers(null), []);

  const handleScanComplete = (newReceipts: Receipt[]) => {
    let added = 0;
    setReceipts(prev => {
        const uniqueList = [...prev];
        newReceipts.forEach(newR => {
            const auditedR = auditAndRepairReceipt(newR);
            const isDup = uniqueList.some(ex => (auditedR.id === ex.id) || (auditedR.date === ex.date && Math.abs(auditedR.totalAmount - ex.totalAmount) < 0.01 && auditedR.establishmentName === ex.establishmentName));
            if (!isDup) { uniqueList.unshift(auditedR); added++; }
        });
        return uniqueList;
    });
    return added;
  };

  // Um arquivo .txt por cupom, todos dentro de um .zip. Sem lista, leva todos os cupons do app.
  const handleExportTxtZip = async (list?: Receipt[]) => {
      const source = list && list.length > 0 ? list : receipts;
      if (source.length === 0) { showNotification('Não há cupons para exportar.'); return; }
      setGlobalLoading(true); setLoadingText('GERANDO OS ARQUIVOS TXT...');
      try {
          const { blob, count, skipped } = await buildReceiptsTxtZip(source);
          if (count === 0) { alert('Não consegui gerar nenhum arquivo: os cupons estão com dados incompletos.'); return; }
          const outcome = await downloadFile(blob, `Cupons_TXT_${new Date().toISOString().split('T')[0]}.zip`);
          if (outcome === 'saved') showNotification(`${count} ${count === 1 ? 'cupom exportado' : 'cupons exportados'} em TXT${skipped > 0 ? `; ${skipped} com dados incompletos ficaram de fora` : ''}.`, 6000);
      } catch (err: any) { alert('Erro ao gerar o .zip: ' + err.message); } finally { setGlobalLoading(false); }
  };

  const handleExportData = async (filenamePrefix = "Eukasconta_Studio_Vault") => {
      setGlobalLoading(true); setLoadingText("ESTRUTURANDO VAULT...");
      try {
          const categoryMeta = JSON.parse(localStorage.getItem('eukasconta_category_meta') || '{}');
          const categoryGoals = JSON.parse(localStorage.getItem('eukasconta_category_goals') || '{}');
          const vaultData: UnifiedVault = { 
              version: "3.0", 
              exportedAt: new Date().toISOString(), 
              receipts, 
              taxonomy,
              aiLearning,
              categoryMeta, 
              categoryGoals,
              establishments
          };
          const ZipModule = (JSZip as any).default || JSZip;
          const zip = new ZipModule(); zip.file("studio_vault.json", JSON.stringify(vaultData, null, 2));
          const content = await zip.generateAsync({ type: "blob" });
          const outcome = await downloadFile(content, `${filenamePrefix}_${new Date().toISOString().split('T')[0]}.zip`);
          if (outcome === 'saved') { markFileBackup(); showNotification("Studio Vault exportado com sucesso."); }
      } catch (err: any) { alert("Erro ao exportar vault: " + err.message); } finally { setGlobalLoading(false); }
  };

  // Cupons em texto (um .txt, ou um .zip só de .txt): entram no histórico sem mexer no resto dos dados.
  // O código de cada item (código de barras do fabricante ou da loja) vem junto e o catálogo aprende com ele.
  const importTxtReceipts = async (files: TxtFile[]) => {
      restore.before('importar cupons em texto');
      setGlobalLoading(true);
      setLoadingText('LENDO CUPONS...');
      try {
          const batch = parseReceiptTexts(files, c => codeKind(c) === 'ean');
          if (batch.receipts.length === 0) {
              showNotification(batch.empty > 0
                  ? `Nenhum cupom importado: ${batch.empty === 1 ? 'o cupom não tem' : `os ${batch.empty} cupons não têm`} itens.`
                  : 'Esse arquivo não parece um cupom em texto. Nada foi importado.', 8000);
              return;
          }
          const out = await applyTxtImport(
              batch.receipts,
              { establishments, masterProducts, categories, existing: receiptsRef.current },
              (d, t) => setLoadingText(`LENDO CUPONS... ${d} DE ${t}`),
          );
          if (out.added.length > 0) {
              receiptsRef.current = [...out.added, ...receiptsRef.current];
              setReceipts(prev => [...out.added.filter(a => !prev.some(ex => ex.id === a.id)), ...prev]);
          }
          const n = out.added.length;
          const parts: string[] = [n === 0
              ? (out.duplicates === 1 ? 'Esse cupom já estava no histórico' : `Esses ${out.duplicates} cupons já estavam no histórico`)
              : `${n} ${n === 1 ? 'cupom importado' : 'cupons importados'} (${out.items} itens)`];
          if (n > 0 && out.withEan + out.withStoreCode + out.withSuspectCode > 0) {
              const c: string[] = [];
              if (out.withEan) c.push(`${out.withEan} com código de barras do fabricante`);
              if (out.withStoreCode) c.push(`${out.withStoreCode} com código da loja`);
              if (out.withSuspectCode) c.push(`${out.withSuspectCode} com código de barras de dígito errado`);
              parts.push(c.join(', '));
          }
          if (n > 0 && out.duplicates > 0) parts.push(`${out.duplicates} já existiam`);
          if (batch.empty > 0) parts.push(`${batch.empty} sem itens, ignorados`);
          if (batch.invalid > 0) parts.push(`${batch.invalid} não eram cupom`);
          if (n > 0 && out.uncategorized > 0) parts.push(`${out.uncategorized} itens ficaram em "Outros" (sem categoria no catálogo)`);
          showNotification(`${parts.join('; ')}.`, 14000);
          if (n > 0) setView('history');
      } catch (e: any) {
          console.error('Erro ao importar cupons em texto:', e);
          showNotification(`Não consegui importar os cupons: ${String(e?.message || e)}`, 8000);
      } finally {
          setGlobalLoading(false);
      }
  };

  const handleImportData = async (file: File) => {
      // Arquivo de ponto de restauração: entra na lista de pontos e não mexe nos dados de agora
      try {
          if ((await readPointText(file)) !== null) { await restore.importFile(file); return; }
      } catch { /* não deu para ler como ponto: segue como backup comum */ }
      // Cupons em texto
      let txts: TxtFile[] | null = null;
      try { txts = await readTxtReceipts(file); } catch { /* não deu para ler como texto: segue como backup comum */ }
      if (txts) { await importTxtReceipts(txts); return; }
      restore.before('importar um arquivo');
      setGlobalLoading(true); 
      setLoadingText("RESTAURANDO ESTÚDIO...");
      setImportLogs([]);
      setIsImportLogOpen(true);
      
      addImportLog('info', `Iniciando importação do arquivo: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);

      try {
          let loaded: any = null;
          // Pelo conteúdo, não pelo nome: o seletor de arquivos do Android às vezes entrega o backup
          // sem extensão (Drive, WhatsApp, "Baixados"). ZIP sempre começa com "PK".
          const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
          const isZip = head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b;

          if (!isZip) { 
              addImportLog('info', 'Detectado arquivo JSON direto.');
              const text = await file.text();
              addImportLog('info', 'Arquivo lido com sucesso.', { length: text.length });
              try {
                  loaded = JSON.parse(text);
                  addImportLog('success', 'JSON parseado com sucesso.');
              } catch (e: any) {
                  addImportLog('error', 'Falha ao parsear JSON.', e.message);
                  throw e;
              }
          }
          else {
              addImportLog('info', 'Detectado arquivo ZIP.');
              const ZipModule = (JSZip as any).default || JSZip;
              try {
                  const zip = await ZipModule.loadAsync(file);
                  addImportLog('info', 'ZIP carregado.', { files: Object.keys(zip.files) });
                  
                  // Tenta nomes conhecidos primeiro
                  let jsonFile = zip.file("studio_vault.json") || zip.file("backup_data.json") || zip.file("data.json");
                  
                  // Se não encontrar, procura por qualquer arquivo .json no ZIP
                  if (!jsonFile) {
                      const allFiles = Object.keys(zip.files);
                      const firstJson = allFiles.find(name => name.toLowerCase().endsWith('.json'));
                      if (firstJson) {
                          jsonFile = zip.file(firstJson);
                          addImportLog('warning', `Arquivo padrão não encontrado. Usando: ${firstJson}`);
                      }
                  } else {
                      addImportLog('success', `Arquivo de dados encontrado: ${jsonFile.name}`);
                  }

                  if (jsonFile) {
                      const text = await jsonFile.async("string");
                      loaded = JSON.parse(text);
                      addImportLog('success', 'JSON extraído e parseado do ZIP.');
                  } else {
                      throw new Error("Nenhum arquivo JSON encontrado dentro do ZIP.");
                  }
              } catch (e: any) {
                  addImportLog('error', 'Falha ao processar ZIP.', e.message);
                  throw e;
              }
          }
          
          if (loaded) {
              addImportLog('info', 'Iniciando processamento dos dados carregados...', { keys: Object.keys(loaded) });

              // Suporte para formato legado (array direto de recibos)
              if (Array.isArray(loaded)) {
                  addImportLog('warning', 'Detectado formato legado (Array de Recibos).');
                  setReceipts(loaded);
                  addImportLog('success', `Importado ${loaded.length} recibos.`);
                  showNotification(`Importado ${loaded.length} recibos do formato legado.`);
              } else {
                  // Formato UnifiedVault
                  addImportLog('info', 'Detectado formato UnifiedVault.');
                  
                  if (loaded.taxonomy) {
                      setTaxonomy(loaded.taxonomy);
                      addImportLog('success', `Taxonomia atualizada: ${loaded.taxonomy.length} nós.`);
                  } else if (loaded.categories) {
                      // Se vier formato antigo, migra
                      addImportLog('warning', 'Migrando categorias legadas para taxonomia.');
                      const migrated = migrateLegacyTaxonomy(loaded.categories);
                      setTaxonomy(migrated);
                      addImportLog('success', `Migração concluída: ${migrated.length} nós.`);
                  }
                  
                  if (loaded.aiLearning) {
                      setAiLearning(loaded.aiLearning);
                      addImportLog('success', `Aprendizado de IA atualizado: ${loaded.aiLearning.length} entradas.`);
                  }
                  
                  if (loaded.categoryMeta) {
                      localStorage.setItem('eukasconta_category_meta', JSON.stringify(loaded.categoryMeta));
                      addImportLog('success', 'Metadados de categoria atualizados.');
                  }
                  
                  if (loaded.categoryGoals) {
                      localStorage.setItem('eukasconta_category_goals', JSON.stringify(loaded.categoryGoals));
                      addImportLog('success', 'Metas de categoria atualizadas.');
                  }
                  
                  if (loaded.establishments) {
                      setEstablishments(loaded.establishments);
                      addImportLog('success', `Estabelecimentos atualizados: ${loaded.establishments.length}.`);
                  }
                  
                  if (loaded.receipts) {
                      setReceipts(loaded.receipts);
                      addImportLog('success', `Recibos atualizados: ${loaded.receipts.length}.`);
                  } else {
                      addImportLog('warning', 'Nenhum recibo encontrado no payload.');
                  }
                  
                  showNotification(`Estúdio restaurado com integridade total.`);
              }
              setView('dashboard');
          } else {
              throw new Error("Dados inválidos ou vazios.");
          }
      } catch (err: any) { 
          console.error("Erro na importação:", err);
          addImportLog('error', 'Falha crítica na importação.', err.message);
          alert("Falha na restauração. Verifique o relatório de log."); 
      } finally { 
          setGlobalLoading(false); 
          addImportLog('info', 'Processo finalizado.');
      }
  };

  const handleUpdateBatchMapping = (mappings: { description: string, newCategory: string }[], opts: { silent?: boolean } = {}) => {
      if (!opts.silent) restore.before('trocar categorias em lote');
      // 1. Instantly update receipts state
      setReceipts(prev => {
          return prev.map(receipt => {
              let changed = false;
              const newItems = receipt.items.map(item => {
                  const match = mappings.find(m => m.description.trim().toUpperCase() === item.description.trim().toUpperCase());
                  if (match) {
                      changed = true;
                      return { ...item, category: match.newCategory };
                  }
                  return item;
              });
              if (!changed) return receipt;
              return { ...receipt, items: newItems };
          });
      });

      // 2. Instantly update master products categories
      setMasterProducts(prev => {
          return prev.map(master => {
              const match = mappings.find(m => master.aliases.some(alias => alias.trim().toUpperCase() === m.description.trim().toUpperCase()));
              if (match) {
                  return { ...master, category: match.newCategory };
              }
              return master;
          });
      });

      // 3. Train the AI learning vault
      setAiLearning(prev => {
          const updated = [...prev];
          mappings.forEach(m => {
              const keyword = m.description.trim().toUpperCase();
              const node = taxonomy.find(n => {
                  if (n.level === 1) return n.name === m.newCategory;
                  const parent = taxonomy.find(p => p.id === n.parentId);
                  return parent ? `${parent.name} - ${n.name}` === m.newCategory : n.name === m.newCategory;
              });
              
              if (node) {
                  const existingIdx = updated.findIndex(e => e.keyword === keyword);
                  if (existingIdx >= 0) {
                      updated[existingIdx] = {
                          ...updated[existingIdx],
                          targetNodeId: node.id,
                          hitCount: updated[existingIdx].hitCount + 1
                      };
                  } else {
                      updated.push({
                          keyword,
                          targetNodeId: node.id,
                          hitCount: 1
                      });
                  }
              }
          });
          return updated;
      });

      if (!opts.silent) showNotification(`${mappings.length} ativos remapeados e aprendidos pela IA.`);
  };

  // Junta produtos escolhidos pela pessoa num só: os cupons ficam como estão, o catálogo passa a tratar todos os nomes como um item
  const handleUnifyProducts = (plan: UnifyPlan) => {
      restore.before('unificar produtos');
      setMasterProducts(prev => unifyGroups(prev, plan.groups, { name: plan.name, category: plan.category }).masters);
      // A categoria escolhida vale para todas as compras desses itens (e a IA aprende com ela)
      const mappings = plan.groups
          .flatMap(g => g.descs)
          .filter(d => d.cats.length !== 1 || d.cats[0] !== plan.category)
          .map(d => ({ description: d.desc, newCategory: plan.category }));
      if (mappings.length) handleUpdateBatchMapping(mappings, { silent: true });
      showNotification(`${plan.groups.length} produtos unificados em ${titleCase(plan.name)}.`);
  };

  // Desfaz uma unificação para um nome de cupom: ele volta a ser um produto à parte
  // Acrescenta ou tira um código (de barras ou de loja) de um produto. Devolve o texto do erro, ou null quando gravou.
  const handleEditCodes = (masterCode: string, op: CodeOp): string | null => {
      const r = applyCodeEdit(masterProducts, masterCode, op);
      if ('error' in r) return r.error;
      setMasterProducts(r.masters);
      return null;
  };

  const handleSplitProduct = (desc: string, group: ProductGroup) => {
      setMasterProducts(prev => splitDesc(prev, desc, { category: group.category, unit: group.unit }).masters);
      showNotification(`${titleCase(desc)} agora é um produto à parte.`);
  };

  const handleCleanupDuplicates = () => {
      const initialCount = receipts.length;
      const seen = new Set();
      const clean = receipts.filter(r => {
          const key = `${r.establishmentName}-${r.date}-${r.totalAmount.toFixed(2)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
      });
      if (clean.length < initialCount) restore.before('limpar duplicatas');
      setReceipts(clean);
      showNotification(`Cleanup concluído. ${initialCount - clean.length} duplicatas removidas.`);
  };

  const handleAuditPrices = async () => {
      restore.before('auditar preços com IA');
      setGlobalLoading(true);
      setLoadingText("AUDITANDO CONSISTÊNCIA COM IA...");
      
      try {
          // 1. Extract unique items for audit
          const uniqueItemsMap = new Map<string, string>();
          receipts.forEach(r => {
              r.items.forEach(i => {
                  if (i.description && i.category) {
                      uniqueItemsMap.set(i.description, i.category);
                  }
              });
          });
          
          const itemsToAudit = Array.from(uniqueItemsMap.entries())
              .map(([description, category]) => ({ description, category }));

          if (itemsToAudit.length === 0) {
              showNotification("Nenhum item para auditar.");
              setGlobalLoading(false);
              return;
          }

          // 2. Call AI with Master Taxonomy (categories)
          const corrections = await auditCategoriesWithAI(itemsToAudit, categories);

          // 3. Apply corrections
          if (corrections && corrections.length > 0) {
              setReceipts(prev => prev.map(r => {
                  let changed = false;
                  const newItems = r.items.map(i => {
                      const correction = corrections.find(c => c.description.trim().toUpperCase() === i.description.trim().toUpperCase());
                      if (correction && correction.newCategory !== i.category) {
                          changed = true;
                          return { ...i, category: correction.newCategory };
                      }
                      return i;
                  });
                  return changed ? { ...r, items: newItems } : r;
              }));
              showNotification(`Auditoria IA: ${corrections.length} itens corrigidos.`);
          } else {
              showNotification("Auditoria IA: Nenhuma inconsistência encontrada.");
          }
      } catch (error) {
          console.error("Erro na auditoria:", error);
          showNotification("Falha na auditoria de IA.");
      } finally {
          setGlobalLoading(false);
      }
  };

  const handleReprocessCategories = () => {
      showNotification("IA Sincronizada com a nova taxonomia.");
  };

  const selectedReceipt = useMemo(() => receipts.find(r => r.id === selectedReceiptId), [receipts, selectedReceiptId]);

  // Emulador: renderiza o app de verdade dentro de um iframe de 390x844,
  // para o layout responder à largura do "celular" e não à do monitor.
  if (isMobilePreview) {
    return <PhoneFrame onExit={() => setIsMobilePreview(false)} />;
  }

  const isInsideEmulator = new URLSearchParams(window.location.search).has('frame');

  return (
    <StoreNamesProvider establishments={establishments}>
    <LayersProvider taxonomy={taxonomy}>
    <div className="flex flex-col h-[100dvh] bg-black text-zinc-100 font-sans overflow-hidden">
      {globalLoading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md">
            <div className="flex flex-col items-center">
                <Loader2 className="w-12 h-12 text-luxury-gold animate-spin mb-4" />
                <span className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-bold">{loadingText}</span>
            </div>
        </div>
      )}

      {isDiagnosticOpen && <DiagnosticPanel onClose={() => setIsDiagnosticOpen(false)} />}

      <header className="app-header fixed top-0 inset-x-0 z-50 bg-black/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 md:h-20 flex items-center justify-between">
            <button onClick={() => setIsDrawerOpen(true)} className="p-2 -ml-2 mr-1 text-zinc-500 hover:text-luxury-gold transition-colors" aria-label="Abrir menu">
                <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-4 cursor-pointer" onClick={() => setView('dashboard')}>
                <AppMark className="h-9 md:h-11 w-auto shrink-0 drop-shadow-[0_2px_8px_rgba(212,175,55,0.25)]" />
                <div className="flex flex-col">
                    <h1 className="font-serif text-base md:text-lg font-bold tracking-tight">Eukasconta</h1>
                    <span className="text-[11px] text-luxury-gold font-semibold tracking-wide">Projeto Design</span>
                </div>
            </div>
            <nav className="hidden md:flex gap-2 items-center">
                <NavItem id="dashboard" label="Início" icon={LayoutDashboard} view={view} setView={setView} />
                <NavItem id="scanner" label="Escanear" icon={ScanLine} view={view} setView={setView} />
                <NavItem id="history" label="Histórico" icon={History} view={view} setView={setView} />
                <NavItem id="reports" label="Relatórios" icon={BarChart3} view={view} setView={setView} />
                <NavItem id="settings" label="Config" icon={Settings} view={view} setView={setView} />
                <div className="h-4 w-px bg-white/10 mx-2"></div>
                <BellButton count={cloud.unread} active={view === 'alerts'} onClick={() => setView('alerts')} className="p-2" />
                <button onClick={() => setIsMobilePreview(true)} style={{ display: isInsideEmulator ? 'none' : undefined }} className="p-2 text-zinc-600 hover:text-luxury-gold transition-colors" title="Emular visualização mobile">
                    <Smartphone className="w-4 h-4" />
                </button>
                <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-2 text-zinc-600 hover:text-luxury-gold transition-colors" title="Alternar Tema">
                    {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
                <button onClick={() => setView('map')} className={`p-2 transition-colors ${view === 'map' ? 'text-luxury-gold' : 'text-zinc-600 hover:text-luxury-gold'}`} title="Mapa" aria-label="Mapa" data-testid="header-map"><MapIcon className="w-4 h-4" /></button>
            </nav>
            <div className="flex md:hidden items-center gap-1">
                <BellButton count={cloud.unread} active={view === 'alerts'} onClick={() => setView('alerts')} className="p-3" />
                <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-3 text-zinc-500 active:text-luxury-gold" aria-label="Alternar tema">
                    {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
                <button onClick={() => setView('map')} className={`p-3 ${view === 'map' ? 'text-luxury-gold' : 'text-zinc-500 active:text-luxury-gold'}`} aria-label="Mapa" data-testid="header-map-m"><MapIcon className="w-5 h-5" /></button>
            </div>
        </div>
      </header>

      <SideDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        view={view}
        setView={setView}
        onOpenDiagnostics={() => setIsDiagnosticOpen(true)}
      />

      <main className="app-main flex-1 overflow-y-auto custom-scrollbar">
          <div className="max-w-7xl mx-auto p-4 md:p-12 w-full">
                {/* App aberto sem nenhum cupom: se é uma reinstalação, os dados estão na conta */}
                {view === 'dashboard' && backup.conflict && (
                    <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-luxury-gold/30 bg-luxury-gold/10 pl-4 pr-2 py-2.5" data-testid="conflict-banner">
                        <span className="text-[13px] text-zinc-200 min-w-0">A sua conta já tem um backup com {backup.conflict.remoteCount} cupons. Escolha como juntar com os {backup.conflict.localCount} deste aparelho.</span>
                        <button onClick={goToAccount} className="shrink-0 px-3.5 py-2 rounded-full border border-luxury-gold/40 text-xs font-bold text-luxury-gold hover:bg-luxury-gold/15 transition-all">Escolher</button>
                    </div>
                )}
                {view === 'dashboard' && receipts.length === 0 && cloud.available && cloud.ready && (
                    cloud.user ? (
                        (backup.status === 'checking' || backup.status === 'restoring') && (
                            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-luxury-gold/30 bg-luxury-gold/10 px-4 py-3 text-[13px] text-zinc-200" data-testid="restore-banner" role="status">
                                <Loader2 className="w-4 h-4 text-luxury-gold animate-spin shrink-0" />
                                {backup.status === 'restoring' ? 'Trazendo seus dados da conta…' : 'Procurando o backup da sua conta…'}
                            </div>
                        )
                    ) : (
                        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-luxury-gold/30 bg-luxury-gold/10 pl-4 pr-2 py-2.5" data-testid="restore-hint">
                            <span className="text-[13px] text-zinc-200 min-w-0">Reinstalou o app? Entre na sua conta e seus cupons e sua chave de IA voltam sozinhos.</span>
                            <button onClick={goToAccount} className="shrink-0 px-3.5 py-2 rounded-full border border-luxury-gold/40 text-xs font-bold text-luxury-gold hover:bg-luxury-gold/15 transition-all">Entrar</button>
                        </div>
                    )
                )}
                {view === 'dashboard' && (
                    <Dashboard 
                      receipts={receipts} 
                      taxonomy={taxonomy}
                      config={dashboardConfig} 
                      onConfigChange={setDashboardConfig} 
                      onScanClick={() => setView('scanner')} 
                      onHistoryClick={() => setView('history')} 
                      onReportsClick={() => setView('reports')} 
                      onSettingsClick={() => setView('settings')} 
                      onCategoryClick={(cat) => { setSelectedCategory(cat); setView('category_detail'); }} 
                      onEditIcon={setSelectedCategoryForIcon} 
                      onSelectReceipt={(r) => setSelectedReceiptId(r.id)}
                      masterProducts={masterProducts}
                    />
                )}
                {view === 'category_detail' && selectedCategory && (
                    <CategoryDetailView 
                      categoryName={selectedCategory} 
                      receipts={receipts} 
                      config={dashboardConfig} 
                      onBack={() => setView('dashboard')} 
                      onSelectSubCategory={(sub) => { setSelectedSubCategory(sub); setView('subcategory_detail'); }} 
                      onEditIcon={setSelectedCategoryForIcon} 
                      onSelectReceipt={(r) => setSelectedReceiptId(r.id)}
                    />
                )}
                {view === 'subcategory_detail' && selectedSubCategory && (
                    <ProductHistoryView 
                      subCategoryName={selectedSubCategory} 
                      receipts={receipts} 
                      config={dashboardConfig} 
                      onBack={() => setView('category_detail')} 
                      onSelectVariant={(prod) => { setSelectedProductGeneric(prod); setView('product_variant_detail'); }} 
                      onSelectReceipt={(r) => setSelectedReceiptId(r.id)}
                      onEditIcon={setSelectedCategoryForIcon}
                    />
                )}
                {view === 'product_variant_detail' && selectedProductGeneric && (
                    <ProductVariantDetailView 
                        genericName={selectedProductGeneric} 
                        subCategoryName={selectedSubCategory || ''} 
                        receipts={receipts} 
                        config={dashboardConfig} 
                        onBack={() => setView('subcategory_detail')} 
                        onSelectReceipt={(r) => setSelectedReceiptId(r.id)} 
                        onEditIcon={setSelectedCategoryForIcon}
                        cloud={cloud}
                        onCreateAlert={openAlertDraft}
                        onGoToAccount={goToAccount}
                    />
                )}
                {view === 'establishment_detail' && selectedEstablishment && (
                    <EstablishmentDetailView establishmentName={selectedEstablishment} receipts={receipts} onBack={() => setView('reports')} onSelectReceipt={(r) => setSelectedReceiptId(r.id)} />
                )}
                {view === 'history' && <TransactionList receipts={receipts} config={dashboardConfig} onConfigChange={setDashboardConfig} masterProducts={masterProducts} onSelectReceipt={(r) => setSelectedReceiptId(r.id)} onDeleteReceipt={requestDeleteReceipt} onAddManual={() => setView('manual_entry')} onExportTxtZip={handleExportTxtZip} />}
                {view === 'reports' && (
                    <Reports 
                        receipts={receipts} 
                        config={dashboardConfig} 
                        onConfigChange={setDashboardConfig} 
                        onBack={() => setView('dashboard')} 
                        onAddManual={() => setView('manual_entry')} 
                        onSelectEstablishment={(name) => { setSelectedEstablishment(name); setView('establishment_detail'); }} 
                        establishments={establishments} 
                        masterProducts={masterProducts}
                        onUpdateMasterProducts={setMasterProducts}
                        taxonomy={taxonomy}
                    />
                )}
                {view === 'scanner' && <Scanner onFinish={() => setView('history')} onCancel={() => setView('dashboard')} onManualEntry={() => setView('manual_entry')} knownEstablishments={[]} categories={categories} establishments={establishments} masterProducts={masterProducts} />}
                {view === 'manual_entry' && <ManualEntryForm onSave={(r) => { handleScanComplete([r]); setView('history'); showNotification("Lançamento salvo com sucesso."); }} onCancel={() => setView('dashboard')} categories={categories} knownEstablishments={Array.from(new Set(receipts.map(r => r.establishmentName)))} knownProducts={[]} allReceipts={receipts} />}
                {view === 'map' && (
                    <Suspense fallback={<div className="flex items-center justify-center py-24 text-zinc-500"><Loader2 className="w-6 h-6 animate-spin" /></div>}>
                        <EstablishmentsMapView
                            receipts={receipts}
                            establishments={establishments}
                            onPatchEstablishment={(est, patch) => setEstablishments(prev => prev.map(e => (e.cnpj === est.cnpj && e.originalName === est.originalName ? { ...e, ...patch } : e)))}
                            onEditEstablishment={setEditingStore}
                            onBack={() => setView('dashboard')}
                        />
                    </Suspense>
                )}
                {view === 'alerts' && (
                    <AlertsView cloud={cloud} draft={alertDraft} onDraftConsumed={() => setAlertDraft(null)} onGoToAccount={goToAccount} onBack={() => setView('dashboard')} />
                )}
                {view === 'settings' && (
                    <SettingsView 
                        cloud={cloud}
                        backup={backup}
                        initialTab={settingsInitialTab}
                        onOpenAlerts={() => setView('alerts')}
                        taxonomy={taxonomy}
                        onUpdateTaxonomy={setTaxonomy}
                        onBack={() => setView('dashboard')} 
                        receipts={receipts} 
                        restore={restore}
                        establishments={establishments}
                        onUpdateEstablishment={handleUpdateEstablishment}
                        onEditEstablishment={setEditingStore}
                        onApplyAliases={handleApplyAliases}
                        onClearData={() => {
                            // Antes de apagar tudo, guarda um ponto de restauração (os pontos não são apagados pelo Hard Reset)
                            restore.before('apagar tudo');
                            // Hard Reset também apaga a cópia da conta; senão ela voltaria no próximo login
                            const wipe = () => { localStorage.clear(); setReceipts([]); setTaxonomy([]); setEstablishments([]); showNotification("Hard Reset concluído."); };
                            if (cloud.user) backup.deleteRemote().catch(() => { /* sem rede: a cópia fica e pode ser apagada depois em Conta */ }).finally(wipe);
                            else wipe();
                        }} 
                        onExportData={() => handleExportData()}
                        onExportTxtZip={() => handleExportTxtZip()} 
                        onImportData={handleImportData} 
                        onUpdateBatchMapping={handleUpdateBatchMapping}
                        masterProducts={masterProducts}
                        onUnifyProducts={handleUnifyProducts}
                        onSplitProduct={handleSplitProduct}
                        onEditCodes={handleEditCodes}
                        onCleanupDuplicates={handleCleanupDuplicates}
                        onAuditPrices={handleAuditPrices}
                        onReprocessCategories={handleReprocessCategories}
                        onUnifyEstablishments={handleUnifyEstablishments}
                        onEditIcon={setSelectedCategoryForIcon}
                        aiLearning={aiLearning}
                        onUpdateAiLearning={setAiLearning}
                    />
                )}
          </div>
      </main>

      <ScanProgressChip hidden={view === 'scanner'} onOpen={() => setView('scanner')} />

      {/* Barra de abas do celular (some em telas médias/grandes, onde o menu do topo aparece) */}
      <nav className="app-tabbar md:hidden fixed bottom-0 inset-x-0 z-50 bg-black/90 backdrop-blur-xl border-t border-white/10">
          <div className="tabbar-grid grid grid-cols-5 items-end h-16 px-2">
              <MobileTab id="dashboard" label="Início" icon={LayoutDashboard} view={view} setView={setView} />
              <MobileTab id="history" label="Histórico" icon={History} view={view} setView={setView} />
              <button onClick={() => setView('scanner')} className="tab-scan flex flex-col items-center justify-end pb-2 -mt-6" aria-label="Escanear cupom">
                  <span className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg shadow-luxury-gold/20 border-4 border-black ${view === 'scanner' ? 'bg-white' : 'bg-luxury-gold'}`}>
                      <ScanLine className="w-6 h-6 text-black" />
                  </span>
                  <span className={`text-[11px] font-semibold mt-1 ${view === 'scanner' ? 'text-luxury-gold' : 'text-zinc-400'}`}>Escanear</span>
              </button>
              <MobileTab id="reports" label="Relatórios" icon={BarChart3} view={view} setView={setView} />
              <MobileTab id="settings" label="Config" icon={Settings} view={view} setView={setView} />
          </div>
      </nav>

      {/* ICON PICKER GLOBAL MODAL */}
      {selectedCategoryForIcon && (
          <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/95 backdrop-blur-3xl animate-in fade-in">
              <div className="w-full max-w-5xl bg-[#08080a] border border-white/10 rounded-[2.5rem] shadow-2xl flex flex-col h-[85vh] overflow-hidden">
                  <div className="p-8 border-b border-white/5 flex flex-col md:flex-row gap-8 justify-between items-center bg-black/40">
                      <div>
                          <h3 className="text-2xl font-serif text-white uppercase tracking-tighter truncate max-w-[300px]">{selectedCategoryForIcon}</h3>
                          <p className="text-luxury-gold text-[11px] font-bold uppercase tracking-[0.1em] mt-2">Personalização Expressa • Studio Audit</p>
                      </div>
                      <div className="flex gap-4 items-center w-full md:w-auto">
                          <div className="relative flex-1 md:w-96">
                              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                              <input type="text" placeholder="Ex: carne, comida, carro, banco..." value={iconSearch} onChange={e => setIconSearch(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl py-4 pl-12 pr-6 text-xs text-zinc-200 outline-none focus:border-luxury-gold/40 uppercase tracking-[0.08em] font-bold" />
                          </div>
                          <button onClick={() => { setSelectedCategoryForIcon(null); setIconSearch(''); }} className="p-4 bg-white/5 rounded-full text-zinc-400 hover:text-white transition-all"><X className="w-6 h-6" /></button>
                      </div>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-10 custom-scrollbar space-y-12">
                      <section>
                          <h4 className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold mb-6 border-b border-white/5 pb-3">Cores de Acabamento</h4>
                          <div className="flex flex-wrap gap-3">
                              {LUXURY_COLORS.map(color => (
                                  <button key={color.hex} onClick={() => handleUpdateMeta(selectedCategoryForIcon, { color: color.hex })} className={`w-10 h-10 rounded-xl border-2 transition-all hover:scale-110 shadow-lg ${getActiveMeta(selectedCategoryForIcon).color === color.hex ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: color.hex }} />
                              ))}
                          </div>
                      </section>
                      
                      {iconSearch ? (
                          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
                              {filteredSearchIcons.map(name => {
                                  const IconComp = (LucideIcons as any)[name];
                                  if (!IconComp) return null;
                                  return (
                                    <button key={name} onClick={() => handleUpdateMeta(selectedCategoryForIcon, { icon: name })} className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all ${getActiveMeta(selectedCategoryForIcon).icon === name ? 'border-luxury-gold bg-luxury-gold/10' : 'bg-black/40 border-white/5 hover:border-white/20'}`}>
                                        <IconComp className={`w-6 h-6 ${getActiveMeta(selectedCategoryForIcon).icon === name ? 'text-luxury-gold' : 'text-zinc-600'}`} />
                                        <span className="text-[11px] text-zinc-700 uppercase truncate w-full text-center font-bold tracking-tighter">{name}</span>
                                    </button>
                                  );
                              })}
                          </div>
                      ) : (
                          <div className="space-y-10">
                              {ICON_GROUPS.map(group => (
                                  <div key={group.name}>
                                      <h5 className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold mb-4 flex items-center gap-2">
                                          <div className="w-1 h-1 rounded-full bg-luxury-gold" /> {group.name}
                                      </h5>
                                      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
                                          {group.icons.map(name => {
                                              const IconComp = (LucideIcons as any)[name];
                                              if (!IconComp) return null;
                                              return (
                                                <button key={name} onClick={() => handleUpdateMeta(selectedCategoryForIcon, { icon: name })} className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all ${getActiveMeta(selectedCategoryForIcon).icon === name ? 'border-luxury-gold bg-luxury-gold/10' : 'bg-black/40 border-white/5 hover:border-white/20'}`}>
                                                    <IconComp className={`w-6 h-6 ${getActiveMeta(selectedCategoryForIcon).icon === name ? 'text-luxury-gold' : 'text-zinc-600'}`} />
                                                    <span className="text-[11px] text-zinc-700 uppercase truncate w-full text-center font-bold tracking-tighter">{name}</span>
                                                </button>
                                              );
                                          })}
                                      </div>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {editingStore && <EstablishmentEditSheet est={editingStore} receipts={receipts} onSave={handleSaveStore} onClose={() => setEditingStore(null)} />}
      {selectedReceipt && <ReceiptDetail receipt={selectedReceipt} onClose={() => setSelectedReceiptId(null)} onUpdateReceipt={handleUpdateReceipt} onDelete={() => requestDeleteReceipt(selectedReceipt.id)} categories={categories} eggSameCount={(r, i) => sameEggTargets(r, i).length} onApplyEggSame={handleApplyEggSame} />}
      {pendingDelete && (
        <ConfirmDialog
          title="Excluir este lançamento?"
          message={<>
            <span className="block text-zinc-200 font-semibold">{titleCase(pendingDelete.establishmentName) || 'Sem nome'}</span>
            <span className="block mt-1 tabular-nums">{pendingDelete.date.split('-').reverse().join('/')} · {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(pendingDelete.totalAmount) || 0)} · {pendingDelete.items.length} {pendingDelete.items.length === 1 ? 'item' : 'itens'}</span>
            <span className="block mt-3">Isso não pode ser desfeito.</span>
          </>}
          confirmLabel="Excluir"
          cancelLabel="Cancelar"
          onConfirm={confirmDeleteReceipt}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
      {cloud.suggestions.length > 0 && <ScanSuggestionsSheet groups={cloud.suggestions} onClose={cloud.dismissSuggestions} onCreateAlert={openAlertDraft} />}
      {notification && <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] bg-zinc-900 border border-luxury-gold/30 text-white px-6 py-3 rounded-3xl w-max max-w-[90vw] text-sm animate-in slide-in-from-bottom-5 flex items-center gap-2 shadow-2xl"><CheckCircle2 className="w-5 h-5 text-luxury-gold shrink-0" /> <span>{notification}</span></div>}
      
      <ImportLogViewer 
          isOpen={isImportLogOpen} 
          onClose={() => setIsImportLogOpen(false)} 
          logs={importLogs} 
      />
    </div>
    </LayersProvider>
    </StoreNamesProvider>
  );
};

const BellButton = ({ count, active, onClick, className }: { count: number; active: boolean; onClick: () => void; className: string }) => (
    <button onClick={onClick} className={`relative ${className} transition-colors ${active ? 'text-luxury-gold' : 'text-zinc-500 active:text-luxury-gold hover:text-luxury-gold'}`} aria-label={count > 0 ? `Avisos (${count} novos)` : 'Avisos'} data-testid="bell">
        <Bell className="w-5 h-5 md:w-4 md:h-4" />
        {count > 0 && <span className="absolute top-1.5 right-1.5 md:top-0.5 md:right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-luxury-gold text-black text-xs font-bold flex items-center justify-center leading-none" data-testid="bell-count">{count > 9 ? '9+' : count}</span>}
    </button>
);

const MobileTab = ({ id, label, icon: Icon, view, setView }: any) => (
    <button onClick={() => setView(id)} className="flex flex-col items-center justify-center gap-1 h-full active:scale-95 transition-transform" aria-label={label}>
        <Icon className={`w-[22px] h-[22px] ${view === id ? 'text-luxury-gold' : 'text-zinc-400'}`} />
        <span className={`text-[11px] font-semibold leading-none ${view === id ? 'text-luxury-gold' : 'text-zinc-400'}`}>{label}</span>
    </button>
);

const NavItem = ({ id, label, icon: Icon, view, setView }: any) => (
    <button onClick={() => setView(id)} className={`flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold transition-all ${view === id ? 'text-luxury-gold bg-luxury-gold/10 border border-luxury-gold/20' : 'text-zinc-400 hover:text-white'}`}><Icon className="w-4 h-4" /> {label}</button>
);

export default App;
