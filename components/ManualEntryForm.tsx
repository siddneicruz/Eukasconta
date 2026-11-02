
import React, { useState, useEffect, useMemo } from 'react';
import { useStoreNames } from './StoreNamesContext';
import { buildItemIndex, suggestItems, knownCategoryFor, NO_CATEGORY } from '../services/itemSuggest';
import { Receipt, ReceiptItem, Establishment } from '../types';
import { useMasterInfo } from './MasterContext';
import { joinAddress } from '../services/establishmentEdit';
import { formatCNPJ } from '../services/productNormalization';
import { isValidCNPJ } from '../services/registryLookupService';
import { generateId } from '../services/idUtils';
import EggCountPicker from './EggCountPicker';
import { isEggItem } from '../services/eggs';
import ItemCategoryPicker from './ItemCategoryPicker';
import { Save, X, Plus, Trash2, Calendar, Clock, MapPin, Store, Hash, Globe, CheckCircle2, Sparkles } from 'lucide-react';

interface ManualEntryFormProps {
  onSave: (receipt: Receipt) => void;
  onCancel: () => void;
  knownEstablishments: string[];
  knownProducts: string[];
  categories: string[];
  allReceipts?: Receipt[];
  /** cadastro de lojas do app: o CNPJ já cadastrado traz o registro completo e não deixa criar outro igual */
  establishments?: Establishment[];
}

const ManualEntryForm: React.FC<ManualEntryFormProps> = ({ onSave, onCancel, knownEstablishments, knownProducts, categories, allReceipts = [], establishments = [] }) => {
  const masterInfo = useMasterInfo();
  const masterStores = masterInfo.master?.stores || [];
  const namer = useStoreNames();
  const [storeOpen, setStoreOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState<number | null>(null);
  const itemIndex = useMemo(() => buildItemIndex(allReceipts, masterInfo.master), [allReceipts, masterInfo.master]);
  const fold = (t: string) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const [locked, setLocked] = useState<'tabela mãe' | 'cadastro' | 'cupom anterior' | null>(null);
  const [formData, setFormData] = useState<Receipt>({
    id: generateId(),
    establishmentName: '',
    cnpj: '',
    address: '',
    city: '',
    state: '',
    date: new Date().toISOString().split('T')[0],
    time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    totalAmount: 0,
    items: [],
    scannedAt: new Date().toISOString()
  });

  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [isDataPrefilled, setIsDataPrefilled] = useState(false);

  useEffect(() => {
    if (items.length === 0) addItem();
  }, []);

  useEffect(() => {
    const total = items.reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0);
    setFormData(prev => ({ ...prev, totalAmount: total }));
  }, [items]);

  // CNPJ já conhecido: traz o registro completo (tabela mãe, depois o cadastro de lojas, depois cupons antigos) e trava os dados
  // da loja, para não nascer um segundo cadastro com o mesmo CNPJ.
  const digitsOf = (v: string) => String(v || '').replace(/\D/g, '');
  const lookupByCnpj = (raw: string) => {
      const d = digitsOf(raw);
      if (d.length !== 14 && d.length !== 11) { setLocked(null); return; }
      const m = masterStores.find(x => digitsOf(x.cnpj) === d);
      const est = establishments.find(x => digitsOf(x.cnpj) === d);
      const rec = allReceipts.find(r => digitsOf(r.cnpj) === d);
      if (m) {
          setFormData(prev => ({ ...prev, cnpj: m.cnpj, establishmentName: m.legalName || est?.originalName || rec?.establishmentName || prev.establishmentName,
              address: joinAddress({ street: m.address, number: m.number, neighborhood: m.neighborhood }) || est?.address || rec?.address || prev.address,
              city: m.city || est?.city || rec?.city || prev.city, state: m.state || est?.state || rec?.state || prev.state }));
          setLocked('tabela mãe');
      } else if (est) {
          setFormData(prev => ({ ...prev, cnpj: est.cnpj, establishmentName: est.originalName, address: est.address || prev.address, city: est.city || prev.city, state: est.state || prev.state }));
          setLocked('cadastro');
      } else if (rec) {
          setFormData(prev => ({ ...prev, cnpj: rec.cnpj, establishmentName: rec.establishmentName, address: rec.address || prev.address, city: rec.city || prev.city, state: rec.state || prev.state }));
          setLocked('cupom anterior');
      } else { setLocked(null); return; }
      setIsDataPrefilled(true);
      setTimeout(() => setIsDataPrefilled(false), 3000);
  };
  const storeOptions = useMemo(() => {
      const q = fold(formData.establishmentName).trim();
      const qd = digitsOf(formData.establishmentName);
      if (!q && !qd) return [];
      return establishments
          .map(e => ({ e, label: namer.nameOf(e.originalName, e.cnpj) || e.originalName }))
          .filter(({ e, label }) => fold(label).includes(q) || fold(e.originalName).includes(q) || (qd.length >= 3 && digitsOf(e.cnpj).includes(qd)))
          .sort((a, b) => Number(fold(b.label).startsWith(q)) - Number(fold(a.label).startsWith(q)) || a.label.localeCompare(b.label))
          .slice(0, 7);
  }, [formData.establishmentName, establishments, namer]);
  const pickStore = (e: Establishment) => {
      setStoreOpen(false);
      if (digitsOf(e.cnpj).length === 14 || digitsOf(e.cnpj).length === 11) {
          setFormData(prev => ({ ...prev, cnpj: e.cnpj }));
          lookupByCnpj(e.cnpj);
      } else {
          setFormData(prev => ({ ...prev, cnpj: e.cnpj || '', establishmentName: e.originalName, address: e.address || '', city: e.city || '', state: e.state || '' }));
          setLocked('cadastro');
      }
  };
  const pickItem = (index: number, s: { description: string; category: string; unitType?: string }) => {
      const newItems = [...items];
      newItems[index] = { ...newItems[index], description: s.description, category: s.category, unitType: s.unitType || newItems[index].unitType };
      setItems(newItems);
      setItemOpen(null);
  };
  const clearStore = () => { setLocked(null); setFormData(prev => ({ ...prev, cnpj: '', establishmentName: '', address: '', city: '', state: '' })); };

  // Nome já conhecido (sem CNPJ digitado): só completa, sem travar
  const performLookup = (query: string) => {
      if (query.length < 3) return;
      const match = allReceipts.find(r => r.establishmentName.toLowerCase().trim() === query.toLowerCase().trim());
      if (match) {
          setFormData(prev => ({ ...prev, establishmentName: match.establishmentName, cnpj: match.cnpj || prev.cnpj, address: match.address || prev.address, city: match.city || prev.city, state: match.state || prev.state }));
          setIsDataPrefilled(true);
          setTimeout(() => setIsDataPrefilled(false), 3000);
      }
  };

  const addItem = () => {
    setItems([
      ...items,
      { description: '', quantity: 1, unitType: 'UN', unitPrice: 0, totalPrice: 0, category: 'Outros' }
    ]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof ReceiptItem, value: any) => {
    const newItems = [...items];
    const item = { ...newItems[index], [field]: value };
    if (field === 'quantity' || field === 'unitPrice') {
        const qty = field === 'quantity' ? Number(value) : item.quantity;
        const unit = field === 'unitPrice' ? Number(value) : item.unitPrice;
        item.totalPrice = Number((qty * unit).toFixed(2));
    }
    newItems[index] = item;
    setItems(newItems);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.establishmentName.trim()) {
        alert("O nome do estabelecimento é obrigatório.");
        return;
    }
    const dd = digitsOf(formData.cnpj);
    if (dd.length > 0 && dd.length !== 11 && dd.length !== 14) { alert("O CNPJ tem 14 números (ou 11, se for CPF). Corrija ou deixe em branco."); return; }
    if (dd.length === 14 && !isValidCNPJ(dd)) { alert("Este CNPJ não passa na conferência dos dígitos. Corrija antes de salvar."); return; }
    const validItems = items.filter(i => i.description.trim() !== '');
    if (validItems.length === 0) {
        alert("Adicione pelo menos um item válido.");
        return;
    }
    onSave({ ...formData, items: validItems });
  };

  return (
    <div className="animate-in slide-in-from-bottom-8 duration-500 pb-20 max-w-4xl mx-auto">
      <form onSubmit={handleSubmit}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
              <div>
                  <h2 className="text-3xl sm:text-4xl font-serif text-white mb-1.5 tracking-tight uppercase">Nova nota</h2>
                  <p className="text-zinc-400 font-sans text-sm">Registre uma compra à mão</p>
              </div>
              <div className="grid grid-cols-2 sm:flex gap-3">
                  <button type="button" onClick={onCancel} className="px-6 py-2.5 rounded-xl border border-white/10 text-zinc-300 hover:text-white hover:bg-white/5 transition-colors text-sm font-semibold text-center">
                      Cancelar
                  </button>
                  <button type="submit" className="flex items-center justify-center gap-2 px-6 sm:px-8 py-2.5 rounded-xl bg-luxury-gold hover:bg-[#B5952F] text-black font-bold shadow-lg shadow-luxury-gold/20 transition-all active:scale-95 text-sm">
                      <Save className="w-4 h-4" /> Salvar nota
                  </button>
              </div>
          </div>

          <div className="bg-[#121214] border border-white/10 rounded-3xl p-8 mb-6 relative overflow-hidden shadow-2xl">
              {isDataPrefilled && (
                  <div className="absolute top-4 right-8 flex items-center gap-2 text-luxury-gold animate-in fade-in slide-in-from-right-4">
                      <Sparkles className="w-4 h-4" />
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em]">Dados Recuperados</span>
                  </div>
              )}

              <h3 className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold mb-6 flex items-center gap-2">
                  <Store className="w-4 h-4 text-luxury-gold" /> Identificação e Localização
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                  <div className="md:col-span-1">
                      <label className="text-[11px] uppercase text-zinc-500 font-bold mb-1.5 block ml-1">CNPJ</label>
                      <div className="relative">
                          <Hash className="absolute left-3 top-3 w-4 h-4 text-zinc-600" />
                          <input 
                              type="text" 
                              value={formData.cnpj}
                              readOnly={!!locked}
                              inputMode="numeric"
                              onChange={e => {
                                  const d = digitsOf(e.target.value).slice(0, 14);
                                  const shown = d.length === 14 ? formatCNPJ(d) : d.length === 11 ? d : e.target.value.slice(0, 18);
                                  setFormData({...formData, cnpj: shown});
                                  lookupByCnpj(d);
                              }}
                              className="w-full bg-black border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-zinc-200 focus:border-luxury-gold outline-none transition-all"
                              placeholder="00.000.000/0000-00"
                          />
                      </div>
                  </div>
                  <div className="md:col-span-2">
                      <label className="text-[11px] uppercase text-zinc-500 font-bold mb-1.5 block ml-1">Estabelecimento *</label>
                      <div className="relative">
                          <Store className="absolute left-3 top-3 w-4 h-4 text-zinc-600" />
                          <input 
                              type="text" 
                              value={formData.establishmentName}
                              readOnly={!!locked}
                              autoComplete="off"
                              onFocus={() => setStoreOpen(true)}
                              onBlur={() => setTimeout(() => setStoreOpen(false), 150)}
                              onChange={e => {
                                  setFormData({...formData, establishmentName: e.target.value});
                                  setStoreOpen(true);
                                  performLookup(e.target.value);
                              }}
                              className="w-full bg-black border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-zinc-100 focus:border-luxury-gold outline-none transition-all font-sans"
                              placeholder="NOME DA LOJA"
                          />
                          {storeOpen && !locked && storeOptions.length > 0 && (
                              <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-[#121214] border border-white/10 rounded-xl shadow-2xl overflow-hidden" data-testid="manual-store-suggestions">
                                  {storeOptions.map(({ e, label }) => (
                                      <button type="button" key={e.cnpj + e.originalName} onMouseDown={ev => ev.preventDefault()} onClick={() => pickStore(e)} className="w-full text-left px-4 py-2.5 hover:bg-white/5 border-b border-white/5 last:border-0">
                                          <span className="block text-sm text-zinc-100 truncate">{label}</span>
                                          <span className="block text-[11px] text-zinc-500 truncate">{[e.cnpj ? formatCNPJ(digitsOf(e.cnpj)) : '', e.city, e.state].filter(Boolean).join(' · ')}</span>
                                      </button>
                                  ))}
                              </div>
                          )}
                      </div>
                  </div>
              </div>

              {locked ? (
                  <p className="mb-6 -mt-2 text-xs text-emerald-400 flex flex-wrap items-center gap-x-2" data-testid="manual-store-locked">
                      <CheckCircle2 className="w-4 h-4" /> Loja já cadastrada ({locked}): dados completos trazidos e protegidos contra cadastro duplicado.
                      <button type="button" onClick={clearStore} className="underline text-zinc-400 hover:text-white">Usar outra loja</button>
                  </p>
              ) : (digitsOf(formData.cnpj).length > 0 && digitsOf(formData.cnpj).length !== 11 && digitsOf(formData.cnpj).length !== 14) ? (
                  <p className="mb-6 -mt-2 text-xs text-amber-500">O CNPJ tem 14 números (ou 11, se for CPF).</p>
              ) : (digitsOf(formData.cnpj).length === 14 && !isValidCNPJ(digitsOf(formData.cnpj))) ? (
                  <p className="mb-6 -mt-2 text-xs text-amber-500">Este CNPJ não passa na conferência dos dígitos. Veja se digitou certo.</p>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 mb-6">
                  <div className="md:col-span-3">
                      <label className="text-[11px] uppercase text-zinc-500 font-bold mb-1.5 block ml-1">Data</label>
                      <div className="relative">
                          <Calendar className="absolute left-3 top-3 w-4 h-4 text-zinc-600" />
                          <input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="w-full bg-black border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-zinc-200 focus:border-luxury-gold outline-none" />
                      </div>
                  </div>
                  <div className="md:col-span-2">
                      <label className="text-[11px] uppercase text-zinc-500 font-bold mb-1.5 block ml-1">Hora</label>
                      <div className="relative">
                          <Clock className="absolute left-3 top-3 w-4 h-4 text-zinc-600" />
                          <input type="time" value={formData.time} onChange={e => setFormData({...formData, time: e.target.value})} className="w-full bg-black border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-zinc-200 focus:border-luxury-gold outline-none" />
                      </div>
                  </div>
                  <div className="md:col-span-5">
                      <label className="text-[11px] uppercase text-zinc-500 font-bold mb-1.5 block ml-1">Cidade</label>
                      <div className="relative">
                          <MapPin className="absolute left-3 top-3 w-4 h-4 text-zinc-600" />
                          <input type="text" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="w-full bg-black border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-zinc-200 focus:border-luxury-gold outline-none" placeholder="Cidade" />
                      </div>
                  </div>
                  <div className="md:col-span-2">
                      <label className="text-[11px] uppercase text-zinc-500 font-bold mb-1.5 block ml-1">UF</label>
                      <div className="relative">
                          <Globe className="absolute left-3 top-3 w-4 h-4 text-zinc-600" />
                          <input type="text" maxLength={2} value={formData.state} onChange={e => setFormData({...formData, state: e.target.value.toUpperCase()})} className="w-full bg-black border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-center text-zinc-200 focus:border-luxury-gold outline-none uppercase" placeholder="UF" />
                      </div>
                  </div>
              </div>

              <div>
                  <label className="text-[11px] uppercase text-zinc-500 font-bold mb-1.5 block ml-1">Endereço Completo</label>
                  <div className="relative">
                      <MapPin className="absolute left-3 top-3 w-4 h-4 text-zinc-600" />
                      <input type="text" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="w-full bg-black border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-zinc-200 focus:border-luxury-gold outline-none" placeholder="Rua, Número, Bairro..." />
                  </div>
              </div>
          </div>

          <div className="bg-[#121214] border border-white/10 rounded-3xl p-8 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                  <h3 className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold flex items-center gap-2">Itens da Transação</h3>
                  <div className="text-right">
                      <span className="text-[11px] uppercase text-zinc-500 block mb-1">Total Calculado</span>
                      <span className="text-3xl font-serif text-white font-bold tracking-tight">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(formData.totalAmount)}</span>
                  </div>
              </div>

              <div className="space-y-3">
                  {items.map((item, index) => (
                      <div key={index} className="grid grid-cols-6 md:grid-cols-12 gap-3 p-4 rounded-2xl bg-black border border-white/5 items-start relative group hover:border-white/10 transition-all">
                          <div className="col-span-6 md:col-span-4 relative">
                              <label className="md:hidden text-xs text-zinc-500 font-bold block mb-1">Descrição</label>
                              <input type="text" autoComplete="off" onFocus={() => setItemOpen(index)} onBlur={() => setTimeout(() => setItemOpen(o => (o === index ? null : o)), 150)} value={item.description} onChange={e => { updateItem(index, 'description', e.target.value); setItemOpen(index); const k = knownCategoryFor(itemIndex, e.target.value); if (k && NO_CATEGORY.has(fold(items[index].category).trim())) { const ni = [...items]; ni[index] = { ...ni[index], description: e.target.value, category: k.category, unitType: k.unitType || ni[index].unitType }; setItems(ni); } }} className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-zinc-200 focus:border-luxury-gold outline-none" placeholder="Produto"/>
                              {itemOpen === index && (() => { const sg = suggestItems(itemIndex, item.description); return sg.length > 0 ? (
                                  <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-[#121214] border border-white/10 rounded-xl shadow-2xl overflow-hidden" data-testid={`new-item-suggestions-${index}`}>
                                      {sg.map(s => (
                                          <button type="button" key={s.description} onMouseDown={ev => ev.preventDefault()} onClick={() => pickItem(index, s)} className="w-full text-left px-3 py-2 hover:bg-white/5 border-b border-white/5 last:border-0">
                                              <span className="block text-sm text-zinc-100 truncate">{s.description}</span>
                                              <span className="block text-[11px] text-luxury-gold truncate">{s.category}</span>
                                          </button>
                                      ))}
                                  </div>
                              ) : null; })()}
                          </div>
                          <div className="col-span-6 md:col-span-3">
                              <label className="md:hidden text-xs text-zinc-500 font-bold block mb-1">Categoria</label>
                              <ItemCategoryPicker category={item.category} description={item.description} categories={categories} testId={`new-item-cat-${index}`} onPick={c => updateItem(index, 'category', c)} />
                          </div>
                          <div className="col-span-2 md:col-span-1">
                              <label className="md:hidden text-xs text-zinc-500 font-bold block mb-1">Qtd</label>
                              <input type="number" value={item.quantity} onChange={e => updateItem(index, 'quantity', e.target.value)} className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-2.5 px-2 text-sm text-center text-zinc-200" />
                          </div>
                          <div className="col-span-2 md:col-span-1">
                              <label className="md:hidden text-xs text-zinc-500 font-bold block mb-1">Un</label>
                              <input type="text" value={item.unitType || 'UN'} onChange={e => updateItem(index, 'unitType', e.target.value)} className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-2.5 px-2 text-xs text-center text-zinc-200 uppercase" />
                          </div>
                          <div className="col-span-2 md:col-span-1">
                              <label className="md:hidden text-xs text-zinc-500 font-bold block mb-1">Unitário</label>
                              <input type="number" step="0.01" value={item.unitPrice} onChange={e => updateItem(index, 'unitPrice', e.target.value)} className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-2.5 px-2 text-sm text-right text-zinc-200" />
                          </div>
                          <div className="col-span-5 md:col-span-1">
                              <label className="md:hidden text-xs text-zinc-500 font-bold block mb-1">Total</label>
                              <input type="number" step="0.01" value={item.totalPrice} onChange={e => updateItem(index, 'totalPrice', Number(e.target.value))} className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-2.5 px-2 text-sm text-right font-bold text-luxury-gold" />
                          </div>
                          <div className="col-span-1 flex justify-center pt-2">
                              <button type="button" onClick={() => removeItem(index)} className="text-zinc-700 hover:text-red-500 transition-colors">
                                  <Trash2 className="w-5 h-5" />
                              </button>
                          </div>
                          {isEggItem(item) && (
                              <div className="col-span-6 md:col-span-12">
                                  <EggCountPicker item={item} testId={`egg-picker-new-${index}`} onChange={n => updateItem(index, 'eggCount', n)} />
                              </div>
                          )}
                      </div>
                  ))}
              </div>

              <button type="button" onClick={addItem} className="mt-6 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-luxury-gold hover:text-white transition-all bg-white/5 px-6 py-3 rounded-xl border border-white/5 hover:border-luxury-gold/30">
                  <Plus className="w-4 h-4" /> Adicionar Novo Item
              </button>
          </div>
      </form>
    </div>
  );
};

export default ManualEntryForm;
