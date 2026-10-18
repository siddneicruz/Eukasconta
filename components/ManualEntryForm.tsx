
import React, { useState, useEffect } from 'react';
import { Receipt, ReceiptItem } from '../types';
import { generateId } from '../services/idUtils';
import EggCountPicker from './EggCountPicker';
import { isEggItem } from '../services/eggs';
import { Save, X, Plus, Trash2, Calendar, Clock, MapPin, Store, Hash, Globe, CheckCircle2, Sparkles } from 'lucide-react';

interface ManualEntryFormProps {
  onSave: (receipt: Receipt) => void;
  onCancel: () => void;
  knownEstablishments: string[];
  knownProducts: string[];
  categories: string[];
  allReceipts?: Receipt[];
}

const ManualEntryForm: React.FC<ManualEntryFormProps> = ({ onSave, onCancel, knownEstablishments, knownProducts, categories, allReceipts = [] }) => {
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

  // Motor de Preenchimento Preditivo
  const performLookup = (query: string, field: 'name' | 'cnpj') => {
      if (query.length < 3) return;
      
      const match = allReceipts.find(r => {
          if (field === 'cnpj') {
              const cleanQ = query.replace(/\D/g, '');
              const cleanR = (r.cnpj || '').replace(/\D/g, '');
              return cleanQ && cleanR && cleanR === cleanQ;
          } else {
              return r.establishmentName.toLowerCase().trim() === query.toLowerCase().trim();
          }
      });

      if (match) {
          setFormData(prev => ({
              ...prev,
              establishmentName: match.establishmentName,
              cnpj: match.cnpj || prev.cnpj,
              address: match.address || prev.address,
              city: match.city || prev.city,
              state: match.state || prev.state
          }));
          setIsDataPrefilled(true);
          // Pequeno reset do feedback visual após alguns segundos
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
                              onChange={e => {
                                  setFormData({...formData, cnpj: e.target.value});
                                  if (e.target.value.length >= 14) performLookup(e.target.value, 'cnpj');
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
                              list="establishments-list-manual"
                              value={formData.establishmentName}
                              onChange={e => {
                                  setFormData({...formData, establishmentName: e.target.value});
                                  performLookup(e.target.value, 'name');
                              }}
                              className="w-full bg-black border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-zinc-100 focus:border-luxury-gold outline-none transition-all font-sans"
                              placeholder="NOME DA LOJA"
                          />
                          <datalist id="establishments-list-manual">
                              {knownEstablishments.map((est, i) => <option key={i} value={est} />)}
                          </datalist>
                      </div>
                  </div>
              </div>

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
                      <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 rounded-2xl bg-black border border-white/5 items-start relative group hover:border-white/10 transition-all">
                          <div className="col-span-4">
                              <label className="md:hidden text-xs text-zinc-500 font-bold block mb-1">Descrição</label>
                              <input type="text" list="products-list-manual" value={item.description} onChange={e => updateItem(index, 'description', e.target.value)} className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-zinc-200 focus:border-luxury-gold outline-none" placeholder="Produto"/>
                          </div>
                          <div className="col-span-3">
                              <label className="md:hidden text-xs text-zinc-500 font-bold block mb-1">Categoria</label>
                              <select value={item.category} onChange={e => updateItem(index, 'category', e.target.value)} className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-2.5 px-3 text-xs text-zinc-400 focus:border-luxury-gold outline-none">
                                  {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                              </select>
                          </div>
                          <div className="col-span-1">
                              <label className="md:hidden text-xs text-zinc-500 font-bold block mb-1">Qtd</label>
                              <input type="number" value={item.quantity} onChange={e => updateItem(index, 'quantity', e.target.value)} className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-2.5 px-2 text-sm text-center text-zinc-200" />
                          </div>
                          <div className="col-span-1">
                              <label className="md:hidden text-xs text-zinc-500 font-bold block mb-1">Un</label>
                              <input type="text" value={item.unitType || 'UN'} onChange={e => updateItem(index, 'unitType', e.target.value)} className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-2.5 px-2 text-xs text-center text-zinc-200 uppercase" />
                          </div>
                          <div className="col-span-1">
                              <label className="md:hidden text-xs text-zinc-500 font-bold block mb-1">Unitário</label>
                              <input type="number" step="0.01" value={item.unitPrice} onChange={e => updateItem(index, 'unitPrice', e.target.value)} className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-2.5 px-2 text-sm text-right text-zinc-200" />
                          </div>
                          <div className="col-span-1">
                              <label className="md:hidden text-xs text-zinc-500 font-bold block mb-1">Total</label>
                              <input type="number" step="0.01" value={item.totalPrice} onChange={e => updateItem(index, 'totalPrice', Number(e.target.value))} className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-2.5 px-2 text-sm text-right font-bold text-luxury-gold" />
                          </div>
                          <div className="col-span-1 flex justify-center pt-2">
                              <button type="button" onClick={() => removeItem(index)} className="text-zinc-700 hover:text-red-500 transition-colors">
                                  <Trash2 className="w-5 h-5" />
                              </button>
                          </div>
                          {isEggItem(item) && (
                              <div className="md:col-span-12">
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
      <datalist id="products-list-manual">{knownProducts.slice(0, 50).map((prod, i) => <option key={i} value={prod} />)}</datalist>
    </div>
  );
};

export default ManualEntryForm;
