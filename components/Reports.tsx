
import React, { useState, useMemo, useEffect } from 'react';
import { Receipt, DashboardConfig, DEFAULT_CATEGORIES, Establishment, MasterProduct } from '../types';
import { 
  TrendingUp, Store, PieChart as PieChartIcon, ChevronLeft, ChevronRight,
  DollarSign, ShoppingBag, BarChart3, Calendar, Search, Download, Package,
  Target, LineChart as LineChartIcon, Filter, CalendarDays, Plus, Award, MousePointer2, Goal, Calculator, Save, TrendingDown, ArrowUpRight, ArrowDownRight, Repeat, Clock, Check, LineChart as LucideLineChart, RotateCcw, Zap, Edit3, GitMerge, Trash2, Split, HelpCircle, Eye, RefreshCw, X, Tag, Loader2, Sparkles
} from 'lucide-react';
import * as Recharts from 'recharts';
import { calculateSimilarity, cleanDescriptionForMatching } from '../services/productMasterService';
import ReportsPanorama from './ReportsPanorama';
import { downloadFile } from '../services/nativeFiles';
import { renderYTick, axisTickX, AXIS_Y_WIDTH } from '../services/chartFormat';

const { 
  XAxis, YAxis, Tooltip, ResponsiveContainer, 
  CartesianGrid, LineChart, Line, Legend, BarChart, Bar, Cell, AreaChart, Area, ReferenceLine, Label 
} = Recharts;

interface ReportsProps {
  receipts: Receipt[];
  establishments?: Establishment[];
  config: DashboardConfig;
  onConfigChange: (config: DashboardConfig) => void;
  onBack: () => void;
  onAddManual?: () => void;
  onSelectEstablishment?: (name: string) => void;
  masterProducts?: MasterProduct[];
  onUpdateMasterProducts?: (masters: MasterProduct[]) => void;
}

const CHART_COLORS = ['#D4AF37', '#27A46D', '#3B82F6', '#EC4899', '#F59E0B', '#8B5CF6', '#10B981', '#EF4444', '#06B6D4', '#6366F1'];
const MONTHS_SHORT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

const getEstablishmentDisplayName = (originalName: string, cnpj: string, establishments: Establishment[] = []) => {
    const match = establishments.find(e => (cnpj && e.cnpj === cnpj) || (e.originalName === originalName));
    if (match?.aliasName) return match.aliasName;
    
    // Abreviação básica se não houver alias
    let name = originalName.toUpperCase();
    name = name.replace(/LTDA|S\.A\.|CIA|CORP|EIRELI|IMPORTADORA|EXPORTADORA|COMERCIO|SERVICOS|INDUSTRIA/g, '').trim();
    if (name.length > 20) name = name.substring(0, 18) + '..';
    return name;
};

const Reports: React.FC<ReportsProps> = ({ 
  receipts = [], 
  establishments = [], 
  config, 
  onConfigChange, 
  onBack, 
  onAddManual, 
  onSelectEstablishment,
  masterProducts = [],
  onUpdateMasterProducts
}) => {
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [rankingCat, setRankingCat] = useState<string | null>(null);
  const [goalItem, setGoalItem] = useState<string>(''); 
  const [activeSection, setActiveSection] = useState<'panorama' | 'overview' | 'goals' | 'catalog'>('panorama');
  const [tempGoalValue, setTempGoalValue] = useState<string>('');
  const [goals, setGoals] = useState<Record<string, number>>(() => {
      try {
          const stored = localStorage.getItem('eukasconta_category_goals');
          return stored ? JSON.parse(stored) : {};
      } catch (e) { return {}; }
  });

  const [productSearch, setProductSearch] = useState('');
  const [productPage, setProductPage] = useState(1);
  const itemsPerPage = 10;

  const [activeCatalogTab, setActiveCatalogTab] = useState<'catalog' | 'duplicates'>('catalog');

  // Edit/Manage Master Product Modal state
  const [editingMaster, setEditingMaster] = useState<MasterProduct | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [editCat, setEditCat] = useState('');

  // Local Notification & Custom Confirmation states
  const [localNotification, setLocalNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void; type: 'info' | 'danger' | 'warning' | 'success' } | null>(null);

  // Raw Product Edit states
  const [editingRawProduct, setEditingRawProduct] = useState<any | null>(null);
  const [parentSelectionType, setParentSelectionType] = useState<'existing' | 'new'>('existing');
  const [selectedExistingMasterCode, setSelectedExistingMasterCode] = useState<string>('');
  const [newMasterDesc, setNewMasterDesc] = useState('');
  const [newMasterCategory, setNewMasterCategory] = useState('');
  const [newMasterUnit, setNewMasterUnit] = useState('');

  // Merge/Unify Modal state
  const [mergeSource, setMergeSource] = useState<any | null>(null);
  const [mergeTargetCode, setMergeTargetCode] = useState('');

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
      setLocalNotification({ message, type });
      setTimeout(() => {
          setLocalNotification(null);
      }, 3500);
  };

  const showConfirmModal = (title: string, message: string, onConfirm: () => void, type: 'info' | 'danger' | 'warning' | 'success' = 'info') => {
      setConfirmModal({ title, message, onConfirm, type });
  };

  // Build the list of distinct original products from receipts and enrich them with mapped master product linkage (código mãe)
  const productsList = useMemo(() => {
    const productsMap = new Map<string, { description: string; unitType: string; code: string; lastPrice: number; category: string }>();
    
    // Sort receipts by date ascending so that the last price is the most recent
    const sortedReceipts = [...receipts].sort((a, b) => a.date.localeCompare(b.date));
    
    sortedReceipts.forEach(receipt => {
        (receipt.items || []).forEach(item => {
            const desc = (item.description || '').trim();
            if (!desc) return;
            
            const unit = (item.unitType || 'UN').trim().toUpperCase();
            const key = `${desc.toUpperCase()}||${unit}`;
            
            const matchCode = desc.match(/^(\d{3,14})\b/);
            let code = '';
            if (matchCode) {
                code = matchCode[1];
            }
            
            productsMap.set(key, {
                description: desc,
                unitType: unit,
                code: code,
                lastPrice: item.unitPrice || 0,
                category: item.category || 'Outros'
            });
        });
    });
    
    const array = Array.from(productsMap.values());
    array.sort((a, b) => a.description.localeCompare(b.description, 'pt-BR'));
    
    array.forEach((item, index) => {
        const leadingCodeRegex = /^\d{3,14}\b\s*/;
        if (item.code) {
            if (leadingCodeRegex.test(item.description)) {
                item.description = item.description.replace(leadingCodeRegex, '');
            }
        } else {
            item.code = `PRD${String(index + 1).padStart(4, '0')}`;
        }
    });
    
    return array.map(p => {
        const descUpper = p.description.trim().toUpperCase();
        // Find master product containing this description in its aliases
        const master = (masterProducts || []).find(m => 
            m.aliases.some(alias => alias.trim().toUpperCase() === descUpper)
        );
        
        return {
            ...p,
            parentCode: master ? master.code : 'SEM_VINCULO',
            parentDescription: master ? master.description : p.description.toUpperCase(),
            parentCategory: master ? master.category : p.category,
            parentAliases: master ? master.aliases : [descUpper],
            masterProduct: master || null
        };
    }).sort((a, b) => a.description.localeCompare(b.description, 'pt-BR'));
  }, [receipts, masterProducts]);

  const filteredProducts = useMemo(() => {
    if (!productSearch) return productsList;
    const searchLower = productSearch.toLowerCase().trim();
    return productsList.filter(p => 
      p.description.toLowerCase().includes(searchLower) ||
      p.code.toLowerCase().includes(searchLower) ||
      p.unitType.toLowerCase().includes(searchLower) ||
      p.parentCode.toLowerCase().includes(searchLower) ||
      p.parentDescription.toLowerCase().includes(searchLower) ||
      p.parentCategory.toLowerCase().includes(searchLower)
    );
  }, [productsList, productSearch]);

  const paginatedProducts = useMemo(() => {
    const startIndex = (productPage - 1) * itemsPerPage;
    return filteredProducts.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredProducts, productPage]);

  const totalProductPages = Math.ceil(filteredProducts.length / itemsPerPage);

  // Detecção de duplicidades: sob demanda (não roda mais sozinha a cada
  // render) e em baldes por categoria, não mais comparando cada produto do
  // catálogo com TODOS os outros. Com um catálogo grande (a Reports real do
  // usuário tinha ~1200 produtos), a comparação completa (1200² ≈ 1,4
  // milhão de pares) travava a aba por dezenas de segundos. Agrupar por
  // categoria primeiro (só faz sentido comparar "Arroz" com "Arroz", não
  // com "Sabão em Pó") reduz isso a poucos milhares de pares, e mesmo assim
  // roda em fatias (setTimeout 0) para nunca bloquear a tela por muito tempo.
  const [duplicatesState, setDuplicatesState] = useState<{
    status: 'idle' | 'running' | 'done';
    pairs: { master1: MasterProduct; master2: MasterProduct; similarity: number }[];
    progress: number;
  }>({ status: 'idle', pairs: [], progress: 0 });

  const runDuplicateDetection = async () => {
    const list = masterProducts || [];
    setDuplicatesState({ status: 'running', pairs: [], progress: 0 });

    const buckets = new Map<string, MasterProduct[]>();
    list.forEach(m => {
      const key = m.category || '—';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(m);
    });

    const dups: { master1: MasterProduct; master2: MasterProduct; similarity: number }[] = [];
    const bucketList = Array.from(buckets.values());
    let processed = 0;

    for (const bucket of bucketList) {
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const sim = calculateSimilarity(bucket[i].description, bucket[j].description);
          if (sim >= 0.60 && sim < 1.0) {
            dups.push({ master1: bucket[i], master2: bucket[j], similarity: sim });
          }
        }
      }
      processed++;
      // Cede o controle pro navegador a cada balde, pra tela nunca travar —
      // mesmo catálogos grandes ficam responsivos durante a varredura.
      setDuplicatesState(s => ({ ...s, progress: Math.round((processed / bucketList.length) * 100) }));
      await new Promise(res => setTimeout(res, 0));
    }

    dups.sort((a, b) => b.similarity - a.similarity);
    setDuplicatesState({ status: 'done', pairs: dups, progress: 100 });
  };

  const handleUnifyAllDuplicates = () => {
      if (!onUpdateMasterProducts || duplicatesState.pairs.length === 0) return;
      const total = duplicatesState.pairs.length;
      showConfirmModal(
          "Unificar Todas as Duplicidades",
          `Isso vai unificar automaticamente ${total} par(es) de produtos com alta similaridade. Nenhum dado de compra é perdido — os itens são apenas remapeados para o cadastro sobrevivente de cada par.`,
          () => {
              let working = [...masterProducts];
              // Resolve cadeias: se A já foi unificado em B, e um par mais
              // adiante ainda referencia A, seguimos até o código atual de B.
              const redirectedTo = new Map<string, string>();
              const resolve = (code: string): string => {
                  let c = code;
                  while (redirectedTo.has(c)) c = redirectedTo.get(c)!;
                  return c;
              };

              duplicatesState.pairs.forEach(({ master1, master2 }) => {
                  const c1 = resolve(master1.code);
                  const c2 = resolve(master2.code);
                  if (c1 === c2) return;
                  const m1 = working.find(m => m.code === c1);
                  const m2 = working.find(m => m.code === c2);
                  if (!m1 || !m2) return;
                  working = working.filter(m => m.code !== c1).map(m => (
                      m.code === c2
                          ? { ...m, aliases: Array.from(new Set([...m.aliases, ...m1.aliases])), establishmentCodes: { ...m.establishmentCodes, ...m1.establishmentCodes } }
                          : m
                  ));
                  redirectedTo.set(c1, c2);
              });

              onUpdateMasterProducts(working);
              setDuplicatesState({ status: 'idle', pairs: [], progress: 0 });
              showNotification(`${total} par(es) unificado(s) com sucesso!`);
          },
          'warning'
      );
  };

  // Saves manual edit/re-routing of an original product to a Parent Code
  const handleSaveRawProductLinkage = () => {
      if (!editingRawProduct || !onUpdateMasterProducts) return;
      const rawDescUpper = editingRawProduct.description.toUpperCase().trim();

      let updatedMasters = [...masterProducts];

      // Remove the raw description from its current master product's aliases
      updatedMasters = updatedMasters.map(m => {
          return {
              ...m,
              aliases: m.aliases.filter(a => a.toUpperCase().trim() !== rawDescUpper)
          };
      });

      if (parentSelectionType === 'existing') {
          const targetMaster = updatedMasters.find(m => m.code === selectedExistingMasterCode);
          if (targetMaster) {
              if (!targetMaster.aliases.some(a => a.toUpperCase().trim() === rawDescUpper)) {
                  targetMaster.aliases.push(rawDescUpper);
              }
          } else {
              showNotification("Produto mestre de destino não encontrado.", "error");
              return;
          }
      } else {
          const nextNum = Math.max(...updatedMasters.map(m => {
              const num = parseInt(m.code.replace('MAE', ''), 10);
              return isNaN(num) ? 0 : num;
          })) + 1;
          const newCode = `MAE${String(nextNum).padStart(4, '0')}`;
          
          const newMaster: MasterProduct = {
              code: newCode,
              description: newMasterDesc.toUpperCase().trim(),
              unitType: newMasterUnit.toUpperCase().trim() || editingRawProduct.unitType,
              category: newMasterCategory || editingRawProduct.parentCategory || editingRawProduct.category,
              aliases: [rawDescUpper],
              establishmentCodes: {}
          };
          updatedMasters.push(newMaster);
      }

      // Clean up empty master products
      updatedMasters = updatedMasters.filter(m => m.aliases.length > 0);

      onUpdateMasterProducts(updatedMasters.sort((a, b) => a.description.localeCompare(b.description, 'pt-BR')));
      setEditingRawProduct(null);
      showNotification("Vínculo do item atualizado com sucesso!");
  };

  // Merge manual original item into a specific mother product
  const handleMergeRawProductToMaster = (rawProdDesc: string, targetMasterCode: string) => {
      if (!onUpdateMasterProducts) return;
      const descUpper = rawProdDesc.toUpperCase().trim();

      const targetMaster = masterProducts.find(m => m.code === targetMasterCode);
      if (!targetMaster) return;

      const confirmMsg = `Deseja unificar o item original "${rawProdDesc}" sob o cadastro mãe "${targetMaster.description}" (${targetMaster.code})?\n\nOs dados de compras originais continuarão intactos, mas todos serão consolidados sob este código.`;
      
      showConfirmModal(
          "Confirmar Unificação",
          confirmMsg,
          () => {
              let updated = masterProducts.map(m => {
                  const cleanedAliases = m.aliases.filter(a => a.toUpperCase().trim() !== descUpper);
                  
                  if (m.code === targetMasterCode) {
                      return {
                          ...m,
                          aliases: Array.from(new Set([...m.aliases, descUpper]))
                      };
                  }
                  return {
                      ...m,
                      aliases: cleanedAliases
                  };
              }).filter(m => m.aliases.length > 0);

              onUpdateMasterProducts(updated.sort((a, b) => a.description.localeCompare(b.description, 'pt-BR')));
              setMergeSource(null);
              setMergeTargetCode('');
              showNotification("Unificação realizada com sucesso!");
          },
          'info'
      );
  };

  // Suggestive merge for duplicates
  const handleMergeMastersCustom = (code1: string, code2: string) => {
      if (!onUpdateMasterProducts) return;
      const m1 = masterProducts.find(m => m.code === code1);
      const m2 = masterProducts.find(m => m.code === code2);
      if (!m1 || !m2) return;

      const confirmMsg = `Deseja unificar o cadastro mãe "${m1.description}" e todas as suas variações sob o cadastro mãe "${m2.description}" (${m2.code})?\n\nOs dados originais de compras não serão perdidos de forma alguma, todos os itens serão apenas remapeados para este novo código.`;

      showConfirmModal(
          "Unificar Cadastros Mãe",
          confirmMsg,
          () => {
              const updated = masterProducts.filter(m => m.code !== code1).map(m => {
                  if (m.code === code2) {
                      return {
                          ...m,
                          aliases: Array.from(new Set([...m.aliases, ...m1.aliases])),
                          establishmentCodes: { ...m.establishmentCodes, ...m1.establishmentCodes }
                      };
                  }
                  return m;
              });

              onUpdateMasterProducts(updated);
              setMergeSource(null);
              setMergeTargetCode('');
              showNotification("Cadastros unificados com sucesso!");
          },
          'warning'
      );
  };

  const handleSaveMasterCuration = () => {
      if (!editingMaster || !onUpdateMasterProducts) return;

      const updated = masterProducts.map(m => {
          if (m.code === editingMaster.code) {
              return {
                  ...m,
                  description: editDesc.toUpperCase().trim(),
                  unitType: editUnit.toUpperCase().trim(),
                  category: editCat
              };
          }
          return m;
      });

      onUpdateMasterProducts(updated);
      setEditingMaster(null);
      showNotification("Cadastro mãe atualizado!");
  };

  const handleUnlinkAlias = (masterCode: string, aliasToUnlink: string) => {
      if (!onUpdateMasterProducts) return;
      const master = masterProducts.find(m => m.code === masterCode);
      if (!master || master.aliases.length <= 1) {
          showNotification("Não é possível desvincular o único termo deste produto.", "error");
          return;
      }

      showConfirmModal(
          "Desvincular Variação",
          `Deseja desvincular a variação "${aliasToUnlink}" de "${master.description}"? Ela se tornará um novo produto mãe independente.`,
          () => {
              const nextNum = Math.max(...masterProducts.map(m => {
                  const num = parseInt(m.code.replace('MAE', ''), 10);
                  return isNaN(num) ? 0 : num;
              })) + 1;
              const newCode = `MAE${String(nextNum).padStart(4, '0')}`;
              
              const newMaster: MasterProduct = {
                  code: newCode,
                  description: aliasToUnlink,
                  unitType: master.unitType,
                  category: master.category,
                  aliases: [aliasToUnlink],
                  establishmentCodes: {}
              };

              const updated = masterProducts.map(m => {
                  if (m.code === masterCode) {
                      return {
                          ...m,
                          aliases: m.aliases.filter(a => a !== aliasToUnlink)
                      };
                  }
                  return m;
              });

              updated.push(newMaster);
              onUpdateMasterProducts(updated.sort((a, b) => a.description.localeCompare(b.description, 'pt-BR')));
              
              setEditingMaster(prev => prev ? { ...prev, aliases: prev.aliases.filter(a => a !== aliasToUnlink) } : null);
              showNotification("Variação desvinculada com sucesso!");
          }
      );
  };

  // Reset page when search query changes
  useEffect(() => {
    setProductPage(1);
  }, [productSearch]);

  const handleExportProductsCSV = () => {
    if (productsList.length === 0) return;
    
    // UTF-8 BOM to ensure accents are correctly displayed in Excel
    let csvContent = "\uFEFF";
    csvContent += "Código;Descrição;Unidade\n";
    
    productsList.forEach(p => {
        const cleanDesc = p.description.replace(/"/g, '""');
        csvContent += `"${p.code}";"${cleanDesc}";"${p.unitType}"\n`;
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const now = new Date();
    const fileDate = now.toISOString().split('T')[0].replace(/-/g, '');
    const fileTime = now.toTimeString().split(' ')[0].replace(/:/g, '');
    downloadFile(blob, `cadastro_produtos_${fileDate}_${fileTime}.csv`).catch(() => { /* sem permissão para compartilhar */ });
  };

  const allCategories = useMemo(() => {
      const masters = new Set<string>();
      (DEFAULT_CATEGORIES || []).forEach(cat => masters.add(cat.split(' - ')[0]));
      return Array.from(masters).sort();
  }, []);

  const taxonomyOptions = useMemo(() => {
      const options: string[] = [];
      const masters = new Set<string>();
      DEFAULT_CATEGORIES.forEach(cat => {
          masters.add(cat.split(' - ')[0]);
          options.push(cat);
      });
      return [...Array.from(masters).sort(), ...options.sort()];
  }, []);

  useEffect(() => {
    if (selectedCats.length === 0 && allCategories.length > 0) {
        setSelectedCats(allCategories.slice(0, 3));
    }
  }, [allCategories]);

  useEffect(() => {
    if (!rankingCat && selectedCats.length > 0) {
        setRankingCat(selectedCats[0]);
    }
  }, [selectedCats, rankingCat]);

  const handleSaveGoal = () => {
      const val = parseFloat(tempGoalValue);
      if (!isNaN(val) && goalItem) {
          const newGoals = { ...goals, [goalItem]: val };
          setGoals(newGoals);
          localStorage.setItem('eukasconta_category_goals', JSON.stringify(newGoals));
          window.dispatchEvent(new Event('storage'));
      }
  };

  const toggleCategory = (name: string) => {
      if (selectedCats.includes(name)) {
          setSelectedCats(prev => prev.filter(c => c !== name));
      } else if (selectedCats.length < 5) {
          setSelectedCats(prev => [...prev, name]);
      }
  };

  const setQuickRange = (range: '7d' | '30d' | 'thisMonth' | 'thisYear') => {
      const today = new Date();
      if (range === '7d' || range === '30d') {
          onConfigChange({ ...config, quickFilter: range, month: null });
      } else if (range === 'thisMonth') {
          onConfigChange({ ...config, month: today.getMonth(), year: today.getFullYear(), quickFilter: null });
      } else if (range === 'thisYear') {
          onConfigChange({ ...config, month: null, year: today.getFullYear(), quickFilter: null });
      }
  };

  const filteredReceipts = useMemo(() => {
    return receipts.filter(r => {
        let rDate = new Date(r.date + 'T12:00:00');
        if (isNaN(rDate.getTime())) rDate = new Date();

        if (config.quickFilter === 'custom') {
            if (config.customStartDate && r.date < config.customStartDate) return false;
            if (config.customEndDate && r.date > config.customEndDate) return false;
            return true;
        }

        if (config.quickFilter === '7d' || config.quickFilter === '30d') {
            const days = config.quickFilter === '7d' ? 7 : 30;
            const limit = new Date();
            limit.setDate(limit.getDate() - days);
            return rDate >= limit;
        }
        
        if (rDate.getFullYear() !== config.year) return false;
        if (config.month !== null && rDate.getMonth() !== config.month) return false;
        return true;
    });
  }, [receipts, config]);

  const stats = useMemo(() => {
    let total = 0;
    let itemsCount = 0;
    filteredReceipts.forEach(r => {
        (r.items || []).forEach(i => {
            const masterCat = i.category.split(' - ')[0];
            if (selectedCats.includes(masterCat)) {
                total += i.totalPrice || 0;
                itemsCount++;
            }
        });
    });
    return { total, itemsCount, avg: filteredReceipts.length > 0 ? total / filteredReceipts.length : 0 };
  }, [filteredReceipts, selectedCats]);

  const getTimelineData = (targetCategories: string[], isSingleItem: boolean = false) => {
      const dataPoints: any[] = [];
      const metaValue = isSingleItem ? (goals[targetCategories[0]] || 0) : 0;
      
      const start = config.quickFilter === 'custom' && config.customStartDate ? new Date(config.customStartDate + 'T12:00:00') : null;
      const end = config.quickFilter === 'custom' && config.customEndDate ? new Date(config.customEndDate + 'T12:00:00') : null;

      if ((config.quickFilter === 'custom' && start && end) || config.quickFilter === '7d' || config.quickFilter === '30d') {
          let startDate = start;
          let endDate = end || new Date();
          
          if (config.quickFilter === '7d') {
              startDate = new Date();
              startDate.setDate(startDate.getDate() - 7);
          } else if (config.quickFilter === '30d') {
              startDate = new Date();
              startDate.setDate(startDate.getDate() - 30);
          }

          if (!startDate) return [];

          const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays <= 45) {
              const dayMap: Record<string, any> = {};
              const curr = new Date(startDate);
              while (curr <= endDate) {
                  const label = curr.getDate().toString().padStart(2, '0');
                  const key = curr.toISOString().split('T')[0];
                  dayMap[key] = { name: label, fullDate: key };
                  targetCategories.forEach(c => dayMap[key][isSingleItem ? 'value' : c] = 0);
                  if (isSingleItem) {
                      dayMap[key].meta = metaValue;
                      // Diferença proporcional à meta não faz sentido diário sem escala, 
                      // mas calculamos o acumulado se necessário.
                  }
                  curr.setDate(curr.getDate() + 1);
              }

              filteredReceipts.forEach(r => {
                  if (dayMap[r.date]) {
                      r.items.forEach(i => {
                          const sub = i.category;
                          const master = sub.split(' - ')[0];
                          if (isSingleItem) {
                              if (sub === targetCategories[0] || sub.startsWith(targetCategories[0] + ' - ')) {
                                  dayMap[r.date].value += i.totalPrice;
                              }
                          } else if (targetCategories.includes(master)) {
                              dayMap[r.date][master] += i.totalPrice;
                          }
                      });
                  }
              });
              
              if (isSingleItem) {
                  Object.values(dayMap).forEach((d: any) => {
                      d.delta = d.value - d.meta;
                  });
              }

              return Object.values(dayMap).sort((a: any, b: any) => a.fullDate.localeCompare(b.fullDate));
          } else {
              const curr = new Date(startDate);
              curr.setDate(1);
              let safety = 0;
              while (curr <= endDate && safety < 24) {
                  const label = `${MONTHS_SHORT[curr.getMonth()]} ${curr.getFullYear().toString().slice(-2)}`;
                  const point: any = { name: label, month: curr.getMonth(), year: curr.getFullYear() };
                  targetCategories.forEach(c => point[isSingleItem ? 'value' : c] = 0);
                  if (isSingleItem) point.meta = metaValue;

                  filteredReceipts.forEach(r => {
                      const rd = new Date(r.date + 'T12:00:00');
                      if (rd.getFullYear() === curr.getFullYear() && rd.getMonth() === curr.getMonth()) {
                          r.items.forEach(i => {
                              const sub = i.category;
                              const master = sub.split(' - ')[0];
                              if (isSingleItem) {
                                  if (sub === targetCategories[0] || sub.startsWith(targetCategories[0] + ' - ')) {
                                      point.value += i.totalPrice;
                                  }
                              } else if (targetCategories.includes(master)) {
                                  point[master] += i.totalPrice;
                              }
                          });
                      }
                  });
                  if (isSingleItem) point.delta = point.value - point.meta;
                  dataPoints.push(point);
                  curr.setMonth(curr.getMonth() + 1);
                  safety++;
              }
              return dataPoints;
          }
      }

      if (config.month !== null) {
          for (let d = 1; d <= 31; d++) {
              const dayStr = d.toString().padStart(2, '0');
              const point: any = { name: dayStr };
              targetCategories.forEach(c => point[isSingleItem ? 'value' : c] = 0);
              if (isSingleItem) point.meta = metaValue;
              filteredReceipts.forEach(r => {
                  if (new Date(r.date + 'T12:00:00').getDate() === d) {
                      r.items.forEach(i => {
                          const sub = i.category;
                          const master = sub.split(' - ')[0];
                          if (isSingleItem) {
                              if (sub === targetCategories[0] || sub.startsWith(targetCategories[0] + ' - ')) {
                                  point.value += i.totalPrice;
                              }
                          } else if (targetCategories.includes(master)) {
                              point[master] += i.totalPrice;
                          }
                      });
                  }
              });
              if (isSingleItem) point.delta = point.value - point.meta;
              dataPoints.push(point);
          }
      } else {
          MONTHS_SHORT.forEach((m, idx) => {
              const point: any = { name: m };
              targetCategories.forEach(c => point[isSingleItem ? 'value' : c] = 0);
              if (isSingleItem) point.meta = metaValue;
              receipts.filter(r => {
                  const rd = new Date(r.date + 'T12:00:00');
                  return rd.getFullYear() === config.year && rd.getMonth() === idx;
              }).forEach(r => {
                  r.items.forEach(i => {
                      const sub = i.category;
                      const master = sub.split(' - ')[0];
                      if (isSingleItem) {
                          if (sub === targetCategories[0] || sub.startsWith(targetCategories[0] + ' - ')) {
                              point.value += i.totalPrice;
                          }
                      } else if (targetCategories.includes(master)) {
                          point[master] += i.totalPrice;
                      }
                  });
              });
              if (isSingleItem) point.delta = point.value - point.meta;
              dataPoints.push(point);
          });
      }
      return dataPoints;
  };

  const comparativeData = useMemo(() => getTimelineData(selectedCats), [filteredReceipts, selectedCats, config, receipts]);

  const goalPerfData = useMemo(() => {
      if (!goalItem) return [];
      return getTimelineData([goalItem], true);
  }, [filteredReceipts, goalItem, goals, config, receipts]);

  const establishmentRankData = useMemo(() => {
    if (!rankingCat) return [];
    const agg: Record<string, { total: number, cnpj: string }> = {};
    filteredReceipts.forEach(r => {
        r.items.forEach(item => {
            if (item.category.startsWith(rankingCat)) {
                if (!agg[r.establishmentName]) agg[r.establishmentName] = { total: 0, cnpj: r.cnpj };
                agg[r.establishmentName].total += item.totalPrice;
            }
        });
    });
    return Object.entries(agg)
        .map(([name, data]) => ({ 
            name: getEstablishmentDisplayName(name, data.cnpj, establishments), 
            realName: name,
            value: data.total 
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5); 
  }, [filteredReceipts, rankingCat, establishments]);

  const CustomTooltip = ({ active, payload, label }: any) => {
      if (active && payload && payload.length) {
          return (
              <div className="bg-zinc-950 border border-white/10 p-5 rounded-[1.5rem] shadow-2xl backdrop-blur-md">
                  <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-[0.1em] mb-3 border-b border-white/5 pb-2">Auditoria: {label}</p>
                  <div className="space-y-2">
                      {payload.map((p: any, idx: number) => {
                        const isDelta = p.dataKey === 'delta';
                        const deltaVal = p.value;
                        const isPositiveDelta = deltaVal > 0;
                        
                        return (
                            <div key={idx} className="flex items-center justify-between gap-8">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color || p.fill || '#D4AF37' }} />
                                    <span className="text-[11px] font-bold text-zinc-300 uppercase">{p.name || p.dataKey}</span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className={`text-xs font-sans font-bold ${isDelta ? (isPositiveDelta ? 'text-red-500' : 'text-emerald-500') : 'text-white'}`}>
                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.value)}
                                    </span>
                                    {isDelta && <span className="text-[11px] uppercase font-bold text-zinc-500">{isPositiveDelta ? 'EXCEDENTE' : 'ECONOMIA'}</span>}
                                </div>
                            </div>
                        );
                      })}
                  </div>
              </div>
          );
      }
      return null;
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-8 duration-1000 pb-20">
      <div className="flex flex-col gap-4 md:gap-6 mb-8 md:mb-10 md:sticky md:top-0 z-[40] bg-black/60 backdrop-blur-xl py-2 md:py-4 md:-mx-6 md:px-6">
        <div className="flex flex-col md:flex-row ls:flex-row md:items-center ls:items-center justify-between gap-6 ls:gap-4 mb-4 ls:mb-0">
            <div>
                <h2 className="text-3xl ls:text-2xl md:text-5xl font-serif text-white mb-1 tracking-tight uppercase">Performance Matrix</h2>
                <p className="text-zinc-400 font-sans text-sm">Auditoria de fluxo por período</p>
            </div>
            <div className="grid grid-cols-2 md:flex ls:flex items-center gap-3">
                <button onClick={onAddManual} className="px-6 py-3 rounded-xl bg-luxury-gold text-black text-sm font-bold whitespace-nowrap justify-center hover:bg-white transition-all flex items-center gap-2 shadow-lg shadow-luxury-gold/10"><Plus className="w-4 h-4" /> Novo Lançamento</button>
                <button onClick={onBack} className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-sm font-bold whitespace-nowrap justify-center hover:bg-white/10 transition-all flex items-center gap-2"><ChevronLeft className="w-4 h-4" /> Dashboard</button>
            </div>
        </div>

        <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-1.5 flex flex-wrap md:flex-nowrap ls:flex-nowrap items-center gap-y-2 md:gap-4 ls:gap-2 overflow-hidden">
            {config.quickFilter === 'custom' ? (
                <div className="order-3 ls:order-2 w-full md:w-auto ls:w-auto md:flex-1 ls:flex-1 flex items-center gap-1.5 px-2 md:px-6 animate-in slide-in-from-left-2">
                    <div className="relative flex-1 min-w-0">
                        <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
                        <input type="date" value={config.customStartDate} onChange={e => onConfigChange({...config, customStartDate: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-6 pr-1 text-xs text-zinc-300 outline-none focus:border-luxury-gold/40" />
                    </div>
                    <span className="text-zinc-700 font-bold text-xs uppercase shrink-0">A</span>
                    <div className="relative flex-1 min-w-0">
                        <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
                        <input type="date" value={config.customEndDate} onChange={e => onConfigChange({...config, customEndDate: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-6 pr-1 text-xs text-zinc-300 outline-none focus:border-luxury-gold/40" />
                    </div>
                </div>
            ) : (
                <>
                    <div className="order-1 flex-1 md:flex-none ls:flex-none flex items-center gap-2 px-3 md:px-5 md:border-r ls:border-r border-white/10 shrink-0">
                        <CalendarDays className="w-4 h-4 text-zinc-500" />
                        <select 
                            value={config.year} 
                            onChange={(e) => onConfigChange({ ...config, year: Number(e.target.value) })} 
                            className="bg-transparent text-xs font-bold text-zinc-300 focus:outline-none cursor-pointer uppercase tracking-[0.08em]"
                        >
                            {[2024, 2025, 2026].map(y => <option key={y} value={y} className="bg-black text-white">{y}</option>)}
                        </select>
                    </div>
                    <div className="order-3 ls:order-2 w-full md:w-auto ls:w-auto md:flex-1 ls:flex-1 min-w-0 flex items-center justify-start md:justify-between gap-1 px-2 md:px-4 overflow-x-auto no-scrollbar">
                        <button 
                            onClick={() => onConfigChange({ ...config, month: null, quickFilter: null })} 
                            className={`px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${config.month === null && !config.quickFilter ? 'bg-luxury-gold text-black shadow-lg shadow-luxury-gold/20' : 'text-zinc-500 hover:text-white'}`}
                        >
                            ANUAL
                        </button>
                        {MONTHS_SHORT.map((m, idx) => (
                            <button key={m} onClick={() => onConfigChange({ ...config, month: idx, quickFilter: null })} className={`px-3 py-2 rounded-full text-xs font-bold transition-all ${config.month === idx ? 'bg-luxury-gold/15 text-luxury-gold' : 'text-zinc-500 hover:text-zinc-300'}`}>
                                {m}
                            </button>
                        ))}
                    </div>
                </>
            )}
            <div className="order-2 md:order-4 ls:order-3 flex items-center gap-2 px-2 md:px-4 md:border-l ls:border-l border-white/10 shrink-0">
                <button onClick={() => onConfigChange({ ...config, quickFilter: config.quickFilter === 'custom' ? null : 'custom', month: null })} className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-2 ${config.quickFilter === 'custom' ? 'bg-luxury-gold text-black border-luxury-gold' : 'border-white/5 text-zinc-500'}`}><Calendar className="w-3.5 h-3.5" /> <span className="hidden sm:inline">FILTRAR </span>PERÍODO</button>
                {(config.category || config.month !== null || config.quickFilter) && (
                    <button
                        onClick={() => { onConfigChange({ year: new Date().getFullYear(), month: null, category: null, quickFilter: null, customStartDate: '', customEndDate: '', establishment: null }); setSelectedCats([]); }}
                        title="Limpar filtros"
                        className="p-2 rounded-xl border border-white/5 text-zinc-600 hover:text-luxury-gold hover:border-luxury-gold/30 transition-all"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
        </div>
      </div>

      <div className={`grid grid-cols-1 md:grid-cols-3 ls:grid-cols-3 gap-3 md:gap-6 mb-8 md:mb-12 ${activeSection === 'panorama' ? 'hidden' : ''}`}>
        <KPIBlock icon={DollarSign} label="INVESTIMENTO NOS GRUPOS" value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.total)} color="text-luxury-gold" />
        <KPIBlock icon={ShoppingBag} label="VOLUMETRIA DE ITENS" value={stats.itemsCount.toString()} color="text-zinc-400" />
        <KPIBlock icon={Target} label="MÉDIA POR RECIBO" value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.avg)} color="text-emerald-500" />
      </div>

      {/* SELETOR DE SEÇÃO: transforma o que era uma rolagem longa com tudo
          empilhado em um dashboard por abas — cada seção só renderiza quando
          está ativa, então a tela mostra uma coisa de cada vez. */}
      <div className="flex items-center gap-1 mb-8 bg-white/[0.03] border border-white/5 rounded-2xl p-1.5 w-full sm:w-fit max-w-full overflow-x-auto no-scrollbar">
          {[
              { id: 'panorama' as const, label: 'Panorama', icon: Sparkles },
              { id: 'overview' as const, label: 'Comparativo', icon: LucideLineChart },
              { id: 'goals' as const, label: 'Metas', icon: Goal },
              { id: 'catalog' as const, label: 'Catálogo', icon: Package },
          ].map(tab => (
              <button
                  key={tab.id}
                  onClick={() => setActiveSection(tab.id)}
                  className={`flex flex-1 sm:flex-none items-center justify-center gap-2 px-2 sm:px-5 py-2.5 rounded-xl text-xs sm:text-[13px] font-semibold transition-all whitespace-nowrap ${activeSection === tab.id ? 'bg-luxury-gold text-black shadow-lg shadow-luxury-gold/10' : 'text-zinc-400 hover:text-white'}`}
              >
                  <tab.icon className="hidden sm:block w-3.5 h-3.5" /> {tab.label}
              </button>
          ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className={activeSection === 'catalog' || activeSection === 'panorama' ? 'hidden' : 'lg:col-span-3 space-y-4'}>
              <section className="bg-black/20 border border-white/5 rounded-2xl p-5 shadow-xl">
                  <h4 className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold mb-4 flex items-center gap-2"><Zap className="w-3.5 h-3.5 text-luxury-gold" /> Filtros Expressos</h4>
                  <div className="grid grid-cols-1 gap-1.5">
                      <QuickFilterBtn label="7 DIAS" active={config.quickFilter === '7d'} onClick={() => setQuickRange('7d')} icon={Clock} />
                      <QuickFilterBtn label="30 DIAS" active={config.quickFilter === '30d'} onClick={() => setQuickRange('30d')} icon={CalendarDays} />
                      <QuickFilterBtn label="MÊS ATUAL" active={config.month === new Date().getMonth() && !config.quickFilter} onClick={() => setQuickRange('thisMonth')} icon={Calendar} />
                      <QuickFilterBtn label="ANO INTEIRO" active={config.month === null && !config.quickFilter} onClick={() => setQuickRange('thisYear')} icon={BarChart3} />
                  </div>
                  <button 
                    onClick={() => { onConfigChange({ ...config, month: null, category: null, quickFilter: null, establishment: null }); setSelectedCats([]); }}
                    className="w-full mt-3 py-2.5 rounded-xl bg-white/5 border border-white/5 text-[11px] font-bold text-zinc-500 uppercase tracking-[0.08em] hover:text-white hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                  >
                      <RotateCcw className="w-3.5 h-3.5" /> Limpar Filtros
                  </button>
              </section>

              <section className="bg-black/20 border border-white/5 rounded-2xl p-5 shadow-xl">
                  <h4 className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold mb-4 flex items-center gap-2"><Filter className="w-3.5 h-3.5 text-luxury-gold" /> Departamentos</h4>
                  <div className="space-y-1.5 max-h-[420px] overflow-y-auto custom-scrollbar pr-2">
                      {allCategories.map(name => {
                          const isSelected = selectedCats.includes(name);
                          return (
                              <button key={name} onClick={() => toggleCategory(name)} className={`w-full flex items-center justify-between p-2.5 rounded-xl border transition-all text-left ${isSelected ? 'bg-luxury-gold/10 border-luxury-gold/30 text-white' : 'bg-white/[0.01] border-white/5 text-zinc-600 hover:text-zinc-400'}`}>
                                  <span className="text-[11px] font-bold uppercase tracking-wide truncate font-sans">{name}</span>
                                  {isSelected ? <div className="w-3.5 h-3.5 shrink-0 rounded border border-luxury-gold flex items-center justify-center bg-luxury-gold"><Check className="w-2.5 h-2.5 text-black" /></div> : <div className="w-3.5 h-3.5 shrink-0 rounded border border-zinc-800" />}
                              </button>
                          );
                      })}
                  </div>
              </section>
          </div>

          <div className={activeSection === 'catalog' || activeSection === 'panorama' ? 'lg:col-span-12 space-y-10' : 'lg:col-span-9 space-y-10'}>
              {activeSection === 'panorama' && (
                  <ReportsPanorama
                      receipts={receipts}
                      config={config}
                      displayName={(name, cnpj) => getEstablishmentDisplayName(name, cnpj, establishments)}
                      onQuickRange={setQuickRange}
                      onSelectEstablishment={onSelectEstablishment}
                      onAddManual={onAddManual}
                  />
              )}

              {activeSection === 'overview' && (<>
              {/* TREND MATRIX - WIDE */}
              <div className="bg-[#121214] border border-white/5 rounded-[2rem] p-6 md:p-8 shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-96 h-96 bg-luxury-gold/5 blur-[120px] rounded-full pointer-events-none group-hover:bg-luxury-gold/10 transition-all duration-1000" />
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 relative z-10">
                      <div className="flex flex-col">
                        <h3 className="text-[11px] text-zinc-500 uppercase tracking-[0.1em] font-bold mb-1 flex items-center gap-2">
                            <LucideLineChart className="w-3 h-3 text-luxury-gold" /> Trend Matrix Comparativa
                        </h3>
                        <span className="text-2xl font-serif text-white tracking-tighter">Timeline de Fluxo</span>
                      </div>
                  </div>
                  <div className="h-[240px] md:h-[350px] w-full relative z-10">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={comparativeData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={axisTickX} dy={15} />
                            <YAxis axisLine={false} tickLine={false} width={AXIS_Y_WIDTH} tick={renderYTick} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend iconType="circle" verticalAlign="top" align="right" wrapperStyle={{ paddingBottom: '24px', fontSize: '12px', fontWeight: 600 }} />
                            {selectedCats.map((name, idx) => (
                                <Line key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[idx % CHART_COLORS.length]} strokeWidth={3} dot={{ r: 4, fill: '#000', stroke: CHART_COLORS[idx % CHART_COLORS.length], strokeWidth: 2 }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }} animationDuration={2000} />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                  </div>
              </div>

              {/* TOP 5 ESTABELECIMENTOS - COLUNAS MULTICOLORIDAS VERTICAIS */}
              <div className="bg-[#121214] border border-white/5 rounded-[2rem] p-6 md:p-8 shadow-2xl overflow-hidden relative group">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 blur-[80px] rounded-full pointer-events-none" />
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6 relative z-10">
                      <div className="flex items-center gap-3">
                        <Award className="w-5 h-5 text-emerald-500" />
                        <h3 className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-bold">Top 5 Estabelecimentos</h3>
                      </div>
                      <div className="flex gap-2 overflow-x-auto no-scrollbar max-w-full">
                          {selectedCats.map(cat => (
                              <button key={cat} onClick={() => setRankingCat(cat)} className={`px-6 py-2 rounded-2xl text-[11px] font-bold uppercase transition-all tracking-[0.08em] whitespace-nowrap ${rankingCat === cat ? 'bg-luxury-gold/15 text-luxury-gold' : 'text-zinc-500 hover:text-zinc-400'}`}>{cat}</button>
                          ))}
                      </div>
                  </div>
                  <div className="h-[240px] md:h-[350px] w-full relative z-10">
                      <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={establishmentRankData} margin={{ top: 20, right: 16, left: 0, bottom: 4 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#a1a1aa', fontSize: 11, fontWeight: 600 }} angle={-25} textAnchor="end" height={70} />
                              <YAxis axisLine={false} tickLine={false} width={AXIS_Y_WIDTH} tick={renderYTick} />
                              <Tooltip cursor={{fill: 'rgba(255,255,255,0.02)'}} content={<CustomTooltip />} />
                              {/* Fix: casting data to any when accessing realName to avoid TS error */}
                              <Bar dataKey="value" radius={[8, 8, 0, 0]} barSize={50} animationDuration={1500} onClick={(data) => data && onSelectEstablishment && onSelectEstablishment((data as any).realName)}>
                                  {establishmentRankData.map((entry, index) => (
                                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} className="cursor-pointer" />
                                  ))}
                              </Bar>
                          </BarChart>
                      </ResponsiveContainer>
                  </div>
              </div>
              </>)}

              {activeSection === 'goals' && (<>
              {/* AUDITÓRIO DE METAS - LARGO E NA BASE COM FILTRO NO CABEÇALHO */}
              <div className="bg-[#121214] border border-white/5 rounded-[2rem] p-6 md:p-8 shadow-2xl overflow-hidden relative group">
                    <div className="absolute top-0 right-0 w-80 h-80 bg-blue-500/5 blur-[80px] rounded-full pointer-events-none" />
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-6 relative z-10">
                        <div className="flex items-center gap-3">
                            <Goal className="w-5 h-5 text-blue-400" />
                            <h3 className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-bold">Auditório de Metas</h3>
                        </div>
                        <div className="flex flex-col md:flex-row items-center gap-3 flex-1 md:justify-end">
                            <select value={goalItem} onChange={(e) => setGoalItem(e.target.value)} className="w-full md:w-64 bg-black/40 border border-white/5 rounded-2xl p-3 text-[11px] text-zinc-200 font-bold uppercase tracking-[0.08em] outline-none focus:border-luxury-gold/40 transition-all cursor-pointer">
                                <option value="">Selecione para auditar...</option>
                                {taxonomyOptions.map(opt => <option key={opt} value={opt} className="bg-zinc-950">{opt}</option>)}
                            </select>
                            {goalItem && (
                                <div className="flex gap-2 w-full md:w-auto">
                                    <input type="number" value={tempGoalValue} onChange={(e) => setTempGoalValue(e.target.value)} placeholder="Teto..." className="w-full md:w-32 bg-black/60 border border-white/10 rounded-2xl px-4 py-3 text-xs text-luxury-gold font-bold outline-none focus:border-luxury-gold/40" />
                                    <button onClick={handleSaveGoal} className="p-3 bg-luxury-gold text-black rounded-xl hover:bg-white transition-all shadow-lg shadow-luxury-gold/10"><Save className="w-4 h-4" /></button>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="relative z-10">
                        {goalItem ? (
                            <div className="h-[240px] md:h-[350px] w-full animate-in fade-in slide-in-from-top-2">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={goalPerfData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorGoal" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.25}/><stop offset="95%" stopColor="#D4AF37" stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={axisTickX} dy={15} />
                                        <YAxis axisLine={false} tickLine={false} width={AXIS_Y_WIDTH} tick={renderYTick} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <ReferenceLine y={goals[goalItem] || 0} stroke="#D4AF37" strokeDasharray="8 8" strokeWidth={2} />
                                        <Area type="monotone" dataKey="value" name="REALIZADO" stroke="#D4AF37" strokeWidth={3} fillOpacity={1} fill="url(#colorGoal)" animationDuration={2000} dot={{ r: 4, fill: '#000', stroke: '#D4AF37', strokeWidth: 2 }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }} />
                                        <Line type="monotone" dataKey="delta" name="DIFERENÇA" stroke="transparent" dot={false} activeDot={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="h-[200px] md:h-[300px] flex flex-col items-center justify-center opacity-20 gap-4">
                                <PieChartIcon className="w-12 h-12" />
                                <span className="text-[11px] uppercase tracking-[0.08em] font-bold">Selecione um departamento para auditar metas</span>
                            </div>
                        )}
                    </div>
                </div>
                </>)}

                {activeSection === 'catalog' && (<>
                {/* CATÁLOGO DE PRODUTOS */}
                <div className="bg-[#121214] border border-white/5 rounded-[2rem] p-6 md:p-8 shadow-2xl overflow-hidden relative group">
                    <div className="absolute top-0 right-0 w-80 h-80 bg-violet-500/5 blur-[80px] rounded-full pointer-events-none" />
                    
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-5 relative z-10">
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <Package className="w-5 h-5 text-violet-400" />
                                <h3 className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-bold">Unificação & Consistência de Dados</h3>
                            </div>
                            <span className="text-2xl font-serif text-white tracking-tighter">Produtos do Banco de Dados</span>
                        </div>
                        
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                            {/* TABS FOR CATALOG & DUPLICATES */}
                            <div className="flex bg-black/60 border border-white/5 p-1 rounded-xl">
                                <button
                                    onClick={() => setActiveCatalogTab('catalog')}
                                    className={`px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all ${activeCatalogTab === 'catalog' ? 'bg-luxury-gold text-black' : 'text-zinc-400 hover:text-white'}`}
                                >
                                    Catálogo ({productsList.length})
                                </button>
                                <button
                                    onClick={() => setActiveCatalogTab('duplicates')}
                                    className={`px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${activeCatalogTab === 'duplicates' ? 'bg-red-500 text-white' : 'text-zinc-400 hover:text-red-400'}`}
                                >
                                    Duplicidades {duplicatesState.status === 'done' ? `(${duplicatesState.pairs.length})` : ''}
                                </button>
                            </div>

                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                <input 
                                    type="text" 
                                    placeholder="Pesquisar produto, código..." 
                                    value={productSearch}
                                    onChange={(e) => setProductSearch(e.target.value)}
                                    className="bg-black/40 border border-white/5 rounded-2xl pl-10 pr-4 py-3 text-[11px] text-zinc-200 uppercase tracking-wider font-bold outline-none focus:border-luxury-gold/40 transition-all w-full sm:w-64"
                                />
                                {productSearch && (
                                    <button onClick={() => setProductSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white text-xs">
                                        ✕
                                    </button>
                                )}
                            </div>
                            
                            <button 
                                onClick={handleExportProductsCSV} 
                                disabled={productsList.length === 0}
                                className="px-6 py-3 rounded-xl bg-luxury-gold hover:bg-white text-black text-[11px] font-bold uppercase tracking-[0.08em] transition-all flex items-center justify-center gap-2 shadow-lg shadow-luxury-gold/10 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap"
                            >
                                <Download className="w-4 h-4" /> Exportar CSV
                            </button>
                        </div>
                    </div>

                    <div className="relative z-10">
                        {activeCatalogTab === 'catalog' ? (
                            <div>
                                {filteredProducts.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full border-collapse">
                                            <thead>
                                                <tr className="border-b border-white/5">
                                                    <th className="text-left py-4 px-4 text-[11px] uppercase tracking-[0.08em] text-zinc-500 font-bold">Cód. Original</th>
                                                    <th className="text-left py-4 px-4 text-[11px] uppercase tracking-[0.08em] text-zinc-500 font-bold">Item Original (Recibo)</th>
                                                    <th className="text-center py-4 px-4 text-[11px] uppercase tracking-[0.08em] text-zinc-500 font-bold">Unid.</th>
                                                    <th className="text-left py-4 px-4 text-[11px] uppercase tracking-[0.08em] text-zinc-500 font-bold">Código Mãe</th>
                                                    <th className="text-left py-4 px-4 text-[11px] uppercase tracking-[0.08em] text-zinc-500 font-bold">Produto Mãe (Padrão)</th>
                                                    <th className="text-left py-4 px-4 text-[11px] uppercase tracking-[0.08em] text-zinc-500 font-bold">Departamento Central</th>
                                                    <th className="text-right py-4 px-4 text-[11px] uppercase tracking-[0.08em] text-zinc-500 font-bold">Último Preço</th>
                                                    <th className="text-center py-4 px-4 text-[11px] uppercase tracking-[0.08em] text-zinc-500 font-bold">Ações</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {paginatedProducts.map((prod, idx) => (
                                                    <tr key={idx} className="border-b border-white/[0.02] last:border-0 hover:bg-white/[0.01] transition-colors group">
                                                        <td className="py-4 px-4">
                                                            <span className="font-mono text-xs text-zinc-500 bg-white/5 px-2 py-0.5 rounded">
                                                                {prod.code}
                                                            </span>
                                                        </td>
                                                        <td className="py-4 px-4">
                                                            <span className="text-xs font-semibold text-zinc-300 block truncate max-w-[200px]" title={prod.description}>
                                                                {prod.description}
                                                            </span>
                                                        </td>
                                                        <td className="py-4 px-4 text-center">
                                                            <span className="font-mono text-xs text-zinc-400 font-bold px-2 py-1 bg-white/5 rounded">
                                                                {prod.unitType}
                                                            </span>
                                                        </td>
                                                        <td className="py-4 px-4">
                                                            <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${prod.parentCode === 'SEM_VINCULO' ? 'text-red-400 bg-red-400/5 border border-red-500/10' : 'text-luxury-gold bg-luxury-gold/5 border border-luxury-gold/10'}`}>
                                                                {prod.parentCode}
                                                            </span>
                                                        </td>
                                                        <td className="py-4 px-4">
                                                            <span className="text-sm font-bold text-white block truncate max-w-[200px]" title={prod.parentDescription}>
                                                                {prod.parentDescription}
                                                            </span>
                                                        </td>
                                                        <td className="py-4 px-4">
                                                            <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 block truncate max-w-[150px]">
                                                                {prod.parentCategory}
                                                            </span>
                                                        </td>
                                                        <td className="py-4 px-4 text-right">
                                                            <span className="font-mono text-xs font-bold text-emerald-400">
                                                                {prod.lastPrice > 0 ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(prod.lastPrice) : 'N/A'}
                                                            </span>
                                                        </td>
                                                        <td className="py-4 px-4 text-center">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <button
                                                                    onClick={() => {
                                                                        setEditingRawProduct(prod);
                                                                        setParentSelectionType('existing');
                                                                        setSelectedExistingMasterCode(prod.parentCode === 'SEM_VINCULO' ? '' : prod.parentCode);
                                                                        setNewMasterDesc(prod.description);
                                                                        setNewMasterCategory(prod.parentCategory);
                                                                        setNewMasterUnit(prod.unitType);
                                                                    }}
                                                                    className="p-2 bg-white/5 border border-white/10 text-zinc-400 hover:text-luxury-gold hover:border-luxury-gold/30 rounded-lg transition-all"
                                                                    title="Gerenciar Vínculo Central"
                                                                >
                                                                    <Edit3 className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        setMergeSource(prod);
                                                                        setMergeTargetCode('');
                                                                    }}
                                                                    className="p-2 bg-white/5 border border-white/10 text-zinc-400 hover:text-blue-400 hover:border-blue-500/30 rounded-lg transition-all"
                                                                    title="Unificar com outro Produto"
                                                                >
                                                                    <GitMerge className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        
                                        {/* PAGINAÇÃO */}
                                        {totalProductPages > 1 && (
                                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8 pt-4 border-t border-white/5">
                                                <span className="text-[11px] text-zinc-500 uppercase tracking-[0.08em] font-semibold">
                                                    Página {productPage} de {totalProductPages} • Exibindo {paginatedProducts.length} de {filteredProducts.length} itens
                                                </span>
                                                
                                                <div className="flex items-center gap-2">
                                                    <button 
                                                        onClick={() => setProductPage(prev => Math.max(prev - 1, 1))}
                                                        disabled={productPage === 1}
                                                        className="p-2 rounded-lg bg-white/5 border border-white/10 text-zinc-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-all"
                                                    >
                                                        <ChevronLeft className="w-4 h-4" />
                                                    </button>
                                                    
                                                    <div className="flex items-center gap-1">
                                                        {Array.from({ length: Math.min(5, totalProductPages) }, (_, i) => {
                                                            let pageNum = i + 1;
                                                            if (totalProductPages > 5 && productPage > 3) {
                                                                pageNum = productPage - 3 + i;
                                                                if (pageNum + (4 - i) > totalProductPages) {
                                                                    pageNum = totalProductPages - 4 + i;
                                                                }
                                                            }
                                                            return (
                                                                <button 
                                                                    key={pageNum}
                                                                    onClick={() => setProductPage(pageNum)}
                                                                    className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${productPage === pageNum ? 'bg-luxury-gold text-black' : 'bg-white/5 text-zinc-400 hover:text-white'}`}
                                                                >
                                                                    {pageNum}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>

                                                    <button 
                                                        onClick={() => setProductPage(prev => Math.min(prev + 1, totalProductPages))}
                                                        disabled={productPage === totalProductPages}
                                                        className="p-2 rounded-lg bg-white/5 border border-white/10 text-zinc-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-all"
                                                    >
                                                        <ChevronRight className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="h-[200px] flex flex-col items-center justify-center opacity-30 gap-3 py-10">
                                        <Package className="w-10 h-10 text-zinc-500" />
                                        <span className="text-[11px] uppercase tracking-[0.08em] font-bold">Nenhum produto cadastrado</span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            /* DUPLICATES FINDER VIEW */
                            <div className="space-y-4">
                                <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex gap-3 items-start max-w-3xl">
                                    <Zap className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                                    <div>
                                        <h4 className="text-xs font-bold text-yellow-500 uppercase tracking-wider">Detecção Inteligente de Duplicidades</h4>
                                        <p className="text-xs text-zinc-400 mt-1">O motor de aprendizagem do sistema analisa variações de texto e unidades e sugere a unificação para manter seu banco de dados limpo e consistente de forma auto-sustentável.</p>
                                    </div>
                                </div>

                                {duplicatesState.status === 'idle' && (
                                    <div className="h-[220px] flex flex-col items-center justify-center gap-4 border border-dashed border-white/10 rounded-3xl py-12">
                                        <Zap className="w-8 h-8 text-zinc-500" />
                                        <span className="text-[11px] uppercase tracking-[0.08em] font-bold text-zinc-500 text-center max-w-xs">
                                            A varredura roda sob demanda para não travar a tela com catálogos grandes.
                                        </span>
                                        <button
                                            onClick={runDuplicateDetection}
                                            className="flex items-center gap-2 px-6 py-3 bg-luxury-gold text-black rounded-xl text-[11px] font-bold uppercase tracking-[0.08em] hover:bg-white transition-all"
                                        >
                                            <Zap className="w-4 h-4" /> Detectar Duplicidades
                                        </button>
                                    </div>
                                )}

                                {duplicatesState.status === 'running' && (
                                    <div className="h-[220px] flex flex-col items-center justify-center gap-4 border border-dashed border-white/10 rounded-3xl py-12">
                                        <Loader2 className="w-8 h-8 text-luxury-gold animate-spin" />
                                        <span className="text-[11px] uppercase tracking-[0.08em] font-bold text-zinc-400">Analisando catálogo… {duplicatesState.progress}%</span>
                                        <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
                                            <div className="h-full bg-luxury-gold transition-all duration-200" style={{ width: `${duplicatesState.progress}%` }} />
                                        </div>
                                    </div>
                                )}

                                {duplicatesState.status === 'done' && duplicatesState.pairs.length > 0 && (
                                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
                                        <span className="text-xs text-zinc-400 font-bold">{duplicatesState.pairs.length} possível(is) duplicidade(s) encontrada(s).</span>
                                        <button
                                            onClick={handleUnifyAllDuplicates}
                                            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-luxury-gold text-black rounded-xl text-[11px] font-bold uppercase tracking-[0.08em] hover:bg-white transition-all shrink-0"
                                        >
                                            <GitMerge className="w-4 h-4" /> Unificar Todas de Uma Vez
                                        </button>
                                    </div>
                                )}

                                {duplicatesState.status === 'done' && duplicatesState.pairs.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {duplicatesState.pairs.map((dup, dIdx) => (
                                            <div key={dIdx} className="bg-zinc-950 border border-white/5 rounded-2xl p-6 flex flex-col justify-between hover:border-luxury-gold/30 transition-all">
                                                <div>
                                                    <div className="flex justify-between items-start mb-4">
                                                        <span className="text-[11px] uppercase tracking-[0.08em] font-bold text-zinc-500 bg-white/5 border border-white/10 px-2 py-0.5 rounded">
                                                            {Math.round(dup.similarity * 100)}% de Similaridade
                                                        </span>
                                                        <span className="font-mono text-xs text-zinc-500">Duplicidade #{dIdx + 1}</span>
                                                    </div>
                                                    
                                                    <div className="space-y-3">
                                                        <div className="flex items-center gap-3">
                                                            <span className="font-mono text-xs text-zinc-400 bg-white/5 px-1.5 py-0.5 rounded font-bold">{dup.master1.code}</span>
                                                            <span className="text-xs text-zinc-300 font-bold uppercase truncate max-w-[200px]">{dup.master1.description}</span>
                                                        </div>
                                                        <div className="h-4 border-l-2 border-dashed border-white/10 ml-6 flex items-center justify-center"><Repeat className="w-3 h-3 text-zinc-700" /></div>
                                                        <div className="flex items-center gap-3">
                                                            <span className="font-mono text-xs text-luxury-gold bg-luxury-gold/5 px-1.5 py-0.5 rounded font-bold">{dup.master2.code}</span>
                                                            <span className="text-xs text-white font-bold uppercase truncate max-w-[200px]">{dup.master2.description}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={() => handleMergeMastersCustom(dup.master1.code, dup.master2.code)}
                                                    className="mt-6 w-full py-3 bg-luxury-gold/10 hover:bg-luxury-gold border border-luxury-gold/20 text-luxury-gold hover:text-black font-bold text-[11px] uppercase tracking-[0.08em] rounded-xl transition-all flex items-center justify-center gap-2"
                                                >
                                                    <GitMerge className="w-4 h-4" /> Unificar Produtos
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : duplicatesState.status === 'done' ? (
                                    <div className="h-[200px] flex flex-col items-center justify-center text-zinc-500 gap-3 border border-dashed border-white/10 rounded-3xl py-12">
                                        <Check className="w-8 h-8 text-emerald-500" />
                                        <span className="text-[11px] uppercase tracking-[0.08em] font-bold">Parabéns! Nenhuma duplicidade detectada no momento.</span>
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </div>
                </div>
                </>)}

            {/* MODAL DE GERENCIAMENTO DE VÍNCULO DO ITEM ORIGINAL */}
            {editingRawProduct && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
                    <div className="w-full max-w-2xl bg-[#0c0c0e] border border-luxury-gold/20 rounded-[3rem] overflow-hidden shadow-3xl shadow-luxury-gold/5">
                        <div className="p-5 sm:p-8 border-b border-white/5 bg-luxury-gold/5 flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-luxury-gold text-black rounded-2xl"><Tag className="w-6 h-6" /></div>
                                <div>
                                    <h3 className="text-xl font-serif text-white uppercase tracking-tighter">Vincular Produto Original</h3>
                                    <p className="text-[11px] text-luxury-gold uppercase font-bold tracking-[0.08em] mt-1">Configuração de Vínculo com Cadastro Central (Mãe)</p>
                                </div>
                            </div>
                            <button onClick={() => setEditingRawProduct(null)} className="p-2 text-zinc-500 hover:text-white"><X className="w-6 h-6" /></button>
                        </div>

                        <div className="p-5 sm:p-8 space-y-6">
                            {/* DADOS ORIGINAIS DE COMPRA - NÃO EDITÁVEIS */}
                            <div className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl">
                                <span className="text-[11px] text-zinc-500 uppercase font-bold tracking-wider block mb-2">Dados Originais de Compra (Inalteráveis)</span>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <span className="text-xs text-zinc-400 block mb-1">Código Original</span>
                                        <span className="text-xs font-mono font-bold text-zinc-300 bg-white/5 px-2 py-1 rounded">{editingRawProduct.code}</span>
                                    </div>
                                    <div className="md:col-span-2">
                                        <span className="text-xs text-zinc-400 block mb-1">Descrição no Recibo</span>
                                        <span className="text-xs font-bold text-zinc-200 bg-white/5 px-2 py-1 rounded block truncate">{editingRawProduct.description}</span>
                                    </div>
                                </div>
                            </div>

                            {/* SELEÇÃO DO VÍNCULO */}
                            <div className="space-y-4">
                                <label className="text-[11px] text-zinc-500 uppercase tracking-[0.08em] font-bold block">Definir Relacionamento Mãe</label>
                                <div className="grid grid-cols-2 gap-4">
                                    <button
                                        type="button"
                                        onClick={() => setParentSelectionType('existing')}
                                        className={`p-4 rounded-xl border text-center transition-all ${parentSelectionType === 'existing' ? 'bg-luxury-gold/10 border-luxury-gold text-luxury-gold' : 'bg-black/40 border-white/5 text-zinc-400 hover:bg-white/5'}`}
                                    >
                                        <span className="text-[11px] uppercase font-bold tracking-[0.08em] block">Mapear para Existente</span>
                                        <span className="text-xs block text-zinc-500 mt-1">Agrupar com outro item já cadastrado</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setParentSelectionType('new')}
                                        className={`p-4 rounded-xl border text-center transition-all ${parentSelectionType === 'new' ? 'bg-luxury-gold/10 border-luxury-gold text-luxury-gold' : 'bg-black/40 border-white/5 text-zinc-400 hover:bg-white/5'}`}
                                    >
                                        <span className="text-[11px] uppercase font-bold tracking-[0.08em] block">Criar Novo Cadastro Mãe</span>
                                        <span className="text-xs block text-zinc-500 mt-1">Este item será o padrão para este grupo</span>
                                    </button>
                                </div>
                            </div>

                            {parentSelectionType === 'existing' ? (
                                <div>
                                    <label className="text-[11px] text-zinc-500 uppercase tracking-[0.08em] font-bold block mb-2">Selecionar Produto Mãe Destino</label>
                                    <select
                                        value={selectedExistingMasterCode}
                                        onChange={e => setSelectedExistingMasterCode(e.target.value)}
                                        className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-xs text-zinc-300 outline-none focus:border-luxury-gold/40 cursor-pointer uppercase font-bold"
                                    >
                                        <option value="">Selecione o produto mestre...</option>
                                        {masterProducts.map(m => (
                                            <option key={m.code} value={m.code} className="bg-zinc-950">
                                                {m.code} - {m.description} ({m.unitType}) - {m.category}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-[11px] text-zinc-500 uppercase tracking-[0.08em] font-bold block mb-2">Nova Descrição Central (Padrão)</label>
                                            <input
                                                type="text"
                                                value={newMasterDesc}
                                                onChange={e => setNewMasterDesc(e.target.value)}
                                                placeholder="Ex: ALCATRA LIMPA"
                                                className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-luxury-gold/40 uppercase tracking-wide font-bold"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[11px] text-zinc-500 uppercase tracking-[0.08em] font-bold block mb-2">Unidade Padrão</label>
                                            <input
                                                type="text"
                                                value={newMasterUnit}
                                                onChange={e => setNewMasterUnit(e.target.value)}
                                                placeholder="Ex: KG, UN"
                                                className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-luxury-gold/40 uppercase tracking-wide font-bold"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[11px] text-zinc-500 uppercase tracking-[0.08em] font-bold block mb-2">Departamento Central</label>
                                        <select
                                            value={newMasterCategory}
                                            onChange={e => setNewMasterCategory(e.target.value)}
                                            className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-xs text-zinc-300 outline-none focus:border-luxury-gold/40 cursor-pointer uppercase font-bold font-mono"
                                        >
                                            {DEFAULT_CATEGORIES.map(cat => (
                                                <option key={cat} value={cat} className="bg-zinc-950">{cat}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={handleSaveRawProductLinkage}
                                disabled={parentSelectionType === 'existing' ? !selectedExistingMasterCode : !newMasterDesc}
                                className="w-full py-4 bg-luxury-gold hover:bg-white text-black disabled:opacity-30 disabled:pointer-events-none rounded-xl font-bold text-[11px] uppercase tracking-[0.1em] transition-all shadow-xl shadow-luxury-gold/10"
                            >
                                Salvar Vínculo Central
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL DE UNIFICAÇÃO MANUAL */}
            {mergeSource && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
                    <div className="w-full max-w-md bg-[#0c0c0e] border border-blue-500/20 rounded-[3rem] overflow-hidden shadow-3xl shadow-blue-500/5">
                        <div className="p-5 sm:p-8 border-b border-white/5 bg-blue-500/5 flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-blue-500 text-black rounded-2xl"><GitMerge className="w-6 h-6" /></div>
                                <div>
                                    <h3 className="text-xl font-serif text-white uppercase tracking-tighter">Unificação Manual</h3>
                                    <p className="text-[11px] text-blue-400 uppercase font-bold tracking-[0.08em] mt-1">Consolidação Manual de cadastros</p>
                                </div>
                            </div>
                            <button onClick={() => setMergeSource(null)} className="p-2 text-zinc-500 hover:text-white"><X className="w-6 h-6" /></button>
                        </div>

                        <div className="p-5 sm:p-8 space-y-6">
                            <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
                                <span className="text-[11px] text-zinc-500 uppercase font-bold block mb-1">Item Original Selecionado:</span>
                                <span className="text-xs text-white font-bold uppercase block">{mergeSource.description}</span>
                                <span className="text-xs text-zinc-500 mt-2 block">Vínculo Atual: {mergeSource.parentDescription} ({mergeSource.parentCode})</span>
                            </div>

                            <div>
                                <label className="text-[11px] text-zinc-500 uppercase tracking-[0.08em] font-bold block mb-2">Unificar sob o Produto Mãe:</label>
                                <select
                                    value={mergeTargetCode}
                                    onChange={e => setMergeTargetCode(e.target.value)}
                                    className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-xs text-zinc-300 outline-none focus:border-luxury-gold/40 cursor-pointer uppercase font-bold font-mono"
                                >
                                    <option value="">Selecione o produto mestre destino...</option>
                                    {masterProducts.filter(m => m.code !== mergeSource.parentCode).map(m => (
                                        <option key={m.code} value={m.code} className="bg-zinc-950">
                                            {m.code} - {m.description} ({m.unitType}) - {m.category}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <button 
                                onClick={() => handleMergeRawProductToMaster(mergeSource.description, mergeTargetCode)}
                                disabled={!mergeTargetCode}
                                className="w-full py-4 bg-blue-500 hover:bg-white text-black disabled:opacity-30 disabled:pointer-events-none rounded-xl font-bold text-[11px] uppercase tracking-[0.1em] transition-all shadow-xl shadow-blue-500/10"
                            >
                                Confirmar Unificação
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL DE CONFIRMAÇÃO PERSONALIZADO */}
            {confirmModal && (
                <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
                    <div className="w-full max-w-md bg-[#0c0c0e] border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
                        <div className="p-6 border-b border-white/5 bg-white/[0.02] flex items-center gap-3">
                            <HelpCircle className="w-5 h-5 text-luxury-gold" />
                            <h3 className="text-sm font-sans text-white uppercase tracking-wider">{confirmModal.title}</h3>
                        </div>
                        <div className="p-6">
                            <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-line">{confirmModal.message}</p>
                        </div>
                        <div className="p-6 bg-white/[0.01] border-t border-white/5 flex items-center justify-end gap-3">
                            <button
                                onClick={() => setConfirmModal(null)}
                                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    confirmModal.onConfirm();
                                    setConfirmModal(null);
                                }}
                                className="px-4 py-2 bg-luxury-gold text-black hover:bg-white rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all"
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* FLOATING LOCAL NOTIFICATION */}
            {localNotification && (
                <div className="fixed bottom-6 right-6 z-[500] animate-in slide-in-from-bottom-5 duration-300">
                    <div className={`px-6 py-4 rounded-2xl border shadow-2xl flex items-center gap-3 ${localNotification.type === 'error' ? 'bg-red-950/95 border-red-500/30 text-red-200' : 'bg-zinc-900/95 border-luxury-gold/30 text-zinc-100'}`}>
                        <div className={`p-1.5 rounded-lg ${localNotification.type === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-luxury-gold/20 text-luxury-gold'}`}>
                            <Check className="w-4 h-4" />
                        </div>
                        <span className="text-xs font-bold uppercase tracking-wider">{localNotification.message}</span>
                    </div>
                </div>
            )}
          </div>
      </div>
    </div>
  );
};

const QuickFilterBtn = ({ label, active, onClick, icon: Icon }: any) => (
    <button 
        onClick={onClick}
        className={`flex items-center justify-between p-2.5 rounded-xl border transition-all text-left group ${active ? 'bg-luxury-gold text-black border-luxury-gold' : 'bg-white/[0.02] border-white/5 text-zinc-500 hover:bg-white/5'}`}
    >
        <span className="text-[11px] font-bold uppercase tracking-wide">{label}</span>
        <Icon className={`w-3.5 h-3.5 ${active ? 'text-black' : 'text-zinc-700 group-hover:text-luxury-gold'}`} />
    </button>
);

// Um pequeno mapa de classes completas (não construídas em tempo de
// execução) — o Tailwind só gera CSS para nomes de classe que aparecem por
// inteiro no código-fonte, então "bg-" + color.replace(...) nunca geraria
// nada.
const KPI_ACCENT: Record<string, string> = {
  'text-luxury-gold': 'bg-luxury-gold',
  'text-zinc-400': 'bg-zinc-400',
  'text-emerald-500': 'bg-emerald-500',
};

const KPIBlock = ({ icon: Icon, label, value, color }: any) => (
  <div className="relative bg-[#121214] border border-white/5 rounded-2xl md:rounded-[1.75rem] p-4 md:p-6 flex flex-row md:flex-col items-center md:items-start gap-4 shadow-xl group transition-all duration-300 hover:border-white/10 overflow-hidden">
    <div className={`absolute top-0 left-0 right-0 h-[3px] ${KPI_ACCENT[color] || 'bg-zinc-600'} opacity-70`} />
    <div className={`p-3 md:p-3 rounded-xl bg-white/5 shrink-0 ${color}`}><Icon className="w-5 h-5 md:w-5 md:h-5" /></div>
    <div className="flex flex-col min-w-0">
      <span className="text-[11px] md:text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold mb-1">{label}</span>
      <span className={`text-2xl md:text-3xl font-serif font-bold tracking-tighter ${color === 'text-luxury-gold' ? 'text-white' : color}`}>{value}</span>
    </div>
  </div>
);

export default Reports;
