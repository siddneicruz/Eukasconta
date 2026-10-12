import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellRing, TrendingDown, Plus, Trash2, X, Search, Loader2, MapPin, Check, UserRound, ChevronLeft } from 'lucide-react';
import type { CloudApi } from '../services/useCloud';
import type { CloudNotification, PriceAlert, ProductHit } from '../services/cloudService';

export interface AlertDraft {
  master_product_id: string;
  label: string;
  unit_type: string;
  max_price?: number;
}

interface Props {
  cloud: CloudApi;
  draft?: AlertDraft | null;
  onDraftConsumed?: () => void;
  onGoToAccount: () => void;
  onBack: () => void;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const UNITS = ['UN', 'KG', 'L', 'G', 'ML', 'PCT', 'CX'];
const RADII = [2, 5, 10, 25, 50];

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());

const timeAgo = (iso: string): string => {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d} dia${d > 1 ? 's' : ''}`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const parsePrice = (s: string): number | null => {
  const t = s.trim().replace(/\s/g, '').replace(/^R\$/i, '').replace(/\./g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

const alertSummary = (a: PriceAlert): string => {
  const u = a.unit_type ? `/${a.unit_type}` : '';
  if (a.min_price != null && a.max_price != null) return `de ${brl.format(a.min_price)} a ${brl.format(a.max_price)}${u}`;
  if (a.max_price != null) return `até ${brl.format(a.max_price)}${u}`;
  if (a.min_price != null) return `a partir de ${brl.format(a.min_price)}${u}`;
  return '';
};

const AlertsView: React.FC<Props> = ({ cloud, draft, onDraftConsumed, onGoToAccount, onBack }) => {
  const [tab, setTab] = useState<'avisos' | 'alertas'>('avisos');
  const [formOpen, setFormOpen] = useState(false);

  // formulário
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [product, setProduct] = useState<{ id: string; label: string; unit: string } | null>(null);
  const [unit, setUnit] = useState('UN');
  const [minP, setMinP] = useState('');
  const [maxP, setMaxP] = useState('');
  const [where, setWhere] = useState<'any' | 'near'>('any');
  const [radius, setRadius] = useState(10);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (cloud.user) { cloud.refreshNotifications(); cloud.refreshAlerts(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud.user?.id]);

  // Rascunho vindo da página do produto ou das sugestões
  useEffect(() => {
    if (!draft) return;
    setTab('alertas'); setFormOpen(true);
    setProduct({ id: draft.master_product_id, label: draft.label, unit: draft.unit_type });
    setUnit(draft.unit_type || 'UN');
    setMinP(''); setMaxP(draft.max_price != null ? String(draft.max_price).replace('.', ',') : '');
    setWhere('any'); setFormErr(null);
    onDraftConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // busca de produto no cadastro comum
  useEffect(() => {
    if (!formOpen || product) return;
    const q = query.trim();
    if (q.length < 2) { setHits([]); return; }
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const rows = await cloud.searchProducts(q, 10);
        if (seq === searchSeq.current) setHits(rows);
      } catch { if (seq === searchSeq.current) setHits([]); }
      finally { if (seq === searchSeq.current) setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, formOpen, product]);

  const resetForm = () => {
    setQuery(''); setHits([]); setProduct(null); setUnit('UN'); setMinP(''); setMaxP('');
    setWhere('any'); setRadius(10); setFormErr(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(null);
    if (!product) { setFormErr('Escolha o produto.'); return; }
    const min = parsePrice(minP);
    const max = parsePrice(maxP);
    if ((min !== null && Number.isNaN(min)) || (max !== null && Number.isNaN(max))) { setFormErr('Digite os valores como 12,90.'); return; }
    if (min === null && max === null) { setFormErr('Informe o preço máximo ou a faixa de preço.'); return; }
    if (max !== null && max <= 0) { setFormErr('O preço máximo precisa ser maior que zero.'); return; }
    if (min !== null && max !== null && min > max) { setFormErr('O preço mínimo não pode passar do máximo.'); return; }

    setSaving(true);
    try {
      let center: { lat: number; lng: number } | null = null;
      if (where === 'near') center = await cloud.getCurrentPosition();
      await cloud.addAlert({
        master_product_id: product.id,
        label: product.label,
        unit_type: unit || null,
        min_price: min,
        max_price: max,
        center_lat: center?.lat ?? null,
        center_lng: center?.lng ?? null,
        radius_km: center ? radius : null,
      });
      resetForm(); setFormOpen(false);
    } catch (err: any) {
      setFormErr(err.message);
    } finally {
      setSaving(false);
    }
  };

  const unreadIds = useMemo(() => cloud.notifications.filter(n => !n.read_at).map(n => n.id), [cloud.notifications]);

  const header = (
    <div className="mb-6 md:mb-10 flex items-center gap-4">
      <button onClick={onBack} className="p-2 -ml-2 rounded-xl text-zinc-500 hover:text-luxury-gold transition-colors" aria-label="Voltar"><ChevronLeft className="w-5 h-5" /></button>
      <div>
        <h2 className="text-3xl md:text-5xl font-serif text-white tracking-tighter uppercase">Avisos</h2>
        <p className="text-zinc-500 text-[11px] tracking-[0.1em] uppercase opacity-70 mt-1">Preços menores perto de você</p>
      </div>
    </div>
  );

  if (!cloud.available || !cloud.user) {
    return (
      <div className="animate-in fade-in duration-500 max-w-3xl mx-auto pb-20">
        {header}
        <div className="p-5 sm:p-8 bg-white/[0.02] border border-white/5 rounded-[2rem] text-center space-y-5">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-luxury-gold/10 border border-luxury-gold/30 flex items-center justify-center"><Bell className="w-6 h-6 text-luxury-gold" /></div>
          <p className="text-sm text-zinc-400 leading-relaxed max-w-sm mx-auto">Entre na sua conta para receber avisos quando alguém comprar mais barato perto de você, e para criar alertas de preço.</p>
          {cloud.available && (
            <button onClick={onGoToAccount} className="inline-flex items-center gap-2 px-6 py-4 rounded-xl bg-luxury-gold text-black text-[11px] font-bold uppercase tracking-[0.08em] hover:bg-white transition-all">
              <UserRound className="w-4 h-4" /> Entrar ou criar conta
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500 max-w-3xl mx-auto pb-20">
      {header}

      <div className="grid grid-cols-2 bg-white/5 p-1 rounded-2xl border border-white/5 mb-6 gap-1">
        <button onClick={() => setTab('avisos')} data-testid="tab-avisos"
          className={`flex items-center justify-center gap-2 py-3 rounded-xl text-[11px] font-bold uppercase tracking-[0.08em] transition-all ${tab === 'avisos' ? 'bg-luxury-gold text-black shadow-lg shadow-luxury-gold/20' : 'text-zinc-500 hover:text-white'}`}>
          <Bell className="w-4 h-4" /> Avisos{cloud.unread > 0 && <span className={`px-2 py-0.5 rounded-full text-xs ${tab === 'avisos' ? 'bg-black text-luxury-gold' : 'bg-luxury-gold text-black'}`}>{cloud.unread}</span>}
        </button>
        <button onClick={() => setTab('alertas')} data-testid="tab-alertas"
          className={`flex items-center justify-center gap-2 py-3 rounded-xl text-[11px] font-bold uppercase tracking-[0.08em] transition-all ${tab === 'alertas' ? 'bg-luxury-gold text-black shadow-lg shadow-luxury-gold/20' : 'text-zinc-500 hover:text-white'}`}>
          <BellRing className="w-4 h-4" /> Meus alertas{cloud.alerts.length > 0 && <span className={`px-2 py-0.5 rounded-full text-xs ${tab === 'alertas' ? 'bg-black text-luxury-gold' : 'bg-white/10 text-zinc-300'}`}>{cloud.alerts.length}</span>}
        </button>
      </div>

      {tab === 'avisos' && (
        <div className="space-y-3" data-testid="notifications">
          {cloud.notifications.length === 0 ? (
            <div className="p-6 sm:p-10 text-center bg-white/[0.02] border border-white/5 rounded-[2rem]">
              <p className="text-sm text-zinc-500 leading-relaxed">Nenhum aviso ainda. Quando alguém comprar mais barato perto de onde você compra — ou um alerta seu bater — aparece aqui.</p>
            </div>
          ) : (
            <>
              {unreadIds.length > 0 && (
                <div className="flex justify-end">
                  <button onClick={() => cloud.markRead()} className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] font-bold text-zinc-500 hover:text-luxury-gold transition-colors"><Check className="w-3.5 h-3.5" /> Marcar todos como lidos</button>
                </div>
              )}
              {cloud.notifications.map((n: CloudNotification) => {
                const isCheap = n.kind === 'cheaper_nearby';
                const Icon = isCheap ? TrendingDown : BellRing;
                const unread = !n.read_at;
                return (
                  <div key={n.id} data-notif={n.kind} onClick={() => unread && cloud.markRead([n.id])}
                    className={`relative flex gap-4 p-4 md:p-5 rounded-2xl border transition-all ${unread ? 'bg-luxury-gold/[0.06] border-luxury-gold/30 cursor-pointer' : 'bg-white/[0.02] border-white/5'}`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isCheap ? 'bg-emerald-500/10 text-emerald-400' : 'bg-luxury-gold/10 text-luxury-gold'}`}><Icon className="w-5 h-5" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-sm font-bold text-white leading-snug">{n.title}</div>
                        {unread && <span className="w-2 h-2 rounded-full bg-luxury-gold shrink-0 mt-1.5" aria-label="não lido" />}
                      </div>
                      <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">{n.body}</p>
                      {(n.payload?.address || n.payload?.city) && (
                        <p className="text-xs text-zinc-500 mt-1.5 flex items-start gap-1.5"><MapPin className="w-3 h-3 shrink-0 mt-0.5" />{[n.payload.address, n.payload.city].filter(Boolean).join(' · ')}</p>
                      )}
                      <div className="flex items-center justify-between mt-3">
                        <span className="text-[11px] uppercase tracking-[0.08em] text-zinc-500 font-bold">{timeAgo(n.created_at)}</span>
                        <button onClick={ev => { ev.stopPropagation(); cloud.removeNotification(n.id); }} className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors" aria-label="Apagar aviso"><X className="w-4 h-4" /></button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {tab === 'alertas' && (
        <div className="space-y-4">
          {!formOpen && (
            <button onClick={() => { resetForm(); setFormOpen(true); }} data-testid="new-alert"
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-luxury-gold text-black text-[11px] font-bold uppercase tracking-[0.08em] hover:bg-white transition-all">
              <Plus className="w-4 h-4" /> Novo alerta
            </button>
          )}

          {formOpen && (
            <form onSubmit={submit} data-testid="alert-form" className="p-5 md:p-7 bg-white/[0.03] border border-luxury-gold/30 rounded-[2rem] space-y-5 animate-in slide-in-from-top-2 duration-300">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-serif text-white uppercase tracking-tight">Novo alerta</h3>
                <button type="button" onClick={() => { resetForm(); setFormOpen(false); }} className="p-2 text-zinc-500 hover:text-white" aria-label="Fechar"><X className="w-5 h-5" /></button>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-[0.08em] mb-2">Produto</label>
                {product ? (
                  <div className="flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl bg-luxury-gold/10 border border-luxury-gold/30">
                    <span className="text-sm text-white font-bold truncate" data-testid="picked-product">{titleCase(product.label)}</span>
                    <button type="button" onClick={() => { setProduct(null); setQuery(''); }} className="text-zinc-400 hover:text-white shrink-0" aria-label="Trocar produto"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Ex: arroz, leite, café" autoFocus data-testid="product-search"
                        className="w-full bg-black/60 border border-white/10 rounded-xl py-4 pl-11 pr-10 text-sm text-zinc-100 focus:border-luxury-gold/50 outline-none" />
                      {searching && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 animate-spin" />}
                    </div>
                    {hits.length > 0 && (
                      <div className="mt-2 rounded-xl border border-white/10 overflow-hidden divide-y divide-white/5" data-testid="product-hits">
                        {hits.map(h => (
                          <button key={h.id} type="button" onClick={() => { setProduct({ id: h.id, label: h.description, unit: h.unit_type }); setUnit(h.unit_type || 'UN'); setHits([]); }}
                            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left bg-black/30 hover:bg-white/5 transition-colors">
                            <span className="text-sm text-zinc-200 truncate">{titleCase(h.description)}</span>
                            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-500 shrink-0">{h.unit_type}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {!searching && query.trim().length >= 2 && hits.length === 0 && (
                      <p className="text-xs text-zinc-500 mt-2">Nada encontrado no cadastro comum ainda. Ele cresce a cada cupom escaneado.</p>
                    )}
                  </>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-[0.08em] mb-2">Unidade</label>
                  <select value={unit} onChange={e => setUnit(e.target.value)} className="w-full bg-black/60 border border-white/10 rounded-xl py-4 px-3 text-sm text-zinc-100 focus:border-luxury-gold/50 outline-none">
                    {Array.from(new Set([unit, ...UNITS])).map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-[0.08em] mb-2">Até (R$)</label>
                  <input value={maxP} onChange={e => setMaxP(e.target.value)} inputMode="decimal" placeholder="22,00" data-testid="max-price"
                    className="w-full bg-black/60 border border-white/10 rounded-xl py-4 px-3 text-sm text-zinc-100 focus:border-luxury-gold/50 outline-none" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-[0.08em] mb-2">De (R$)</label>
                  <input value={minP} onChange={e => setMinP(e.target.value)} inputMode="decimal" placeholder="opcional" data-testid="min-price"
                    className="w-full bg-black/60 border border-white/10 rounded-xl py-4 px-3 text-sm text-zinc-100 focus:border-luxury-gold/50 outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-[0.08em] mb-2">Onde</label>
                <div className="grid grid-cols-2 bg-black/40 p-1 rounded-xl border border-white/5 gap-1">
                  <button type="button" onClick={() => setWhere('any')} className={`py-3 rounded-lg text-[11px] font-bold uppercase tracking-[0.08em] transition-all ${where === 'any' ? 'bg-luxury-gold text-black' : 'text-zinc-500 hover:text-white'}`}>Qualquer lugar</button>
                  <button type="button" onClick={() => setWhere('near')} data-testid="where-near" className={`flex items-center justify-center gap-1.5 py-3 rounded-lg text-[11px] font-bold uppercase tracking-[0.08em] transition-all ${where === 'near' ? 'bg-luxury-gold text-black' : 'text-zinc-500 hover:text-white'}`}><MapPin className="w-3.5 h-3.5" /> Perto de mim</button>
                </div>
                {where === 'near' && (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {RADII.map(r => (
                      <button type="button" key={r} onClick={() => setRadius(r)} className={`px-3.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-[0.08em] border transition-all ${radius === r ? 'bg-luxury-gold text-black border-luxury-gold' : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'}`}>{r} km</button>
                    ))}
                    <p className="w-full text-xs text-zinc-500 mt-1">Usa a localização de agora como centro do raio.</p>
                  </div>
                )}
              </div>

              {formErr && <div className="px-5 py-4 rounded-xl bg-red-950/20 border border-red-900/30 text-red-300 text-xs" data-testid="alert-error">{formErr}</div>}

              <button type="submit" disabled={saving} data-testid="save-alert"
                className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-luxury-gold text-black text-[11px] font-bold uppercase tracking-[0.08em] hover:bg-white transition-all disabled:opacity-50">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} Criar alerta
              </button>
            </form>
          )}

          {cloud.alerts.length === 0 && !formOpen ? (
            <div className="p-6 sm:p-10 text-center bg-white/[0.02] border border-white/5 rounded-[2rem]">
              <p className="text-sm text-zinc-500 leading-relaxed">Você ainda não tem alertas. Crie um para ser avisado quando alguém comprar um produto no preço que você quer.</p>
            </div>
          ) : (
            <div className="space-y-3" data-testid="alert-list">
              {cloud.alerts.map(a => (
                <div key={a.id} data-alert={a.id} className={`flex items-center gap-4 p-4 md:p-5 rounded-2xl border transition-all ${a.active ? 'bg-white/[0.03] border-white/10' : 'bg-white/[0.01] border-white/5 opacity-60'}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-white truncate">{titleCase(a.label || 'Produto')}</div>
                    <div className="text-xs text-luxury-gold font-bold mt-1">{alertSummary(a)}</div>
                    <div className="text-xs text-zinc-500 mt-1 flex items-center gap-1.5">
                      <MapPin className="w-3 h-3" />{a.radius_km ? `raio de ${String(a.radius_km).replace('.', ',')} km de onde você criou o alerta` : 'qualquer lugar'}
                      {a.last_triggered_at && <span className="ml-2">· último aviso {timeAgo(a.last_triggered_at)}</span>}
                    </div>
                  </div>
                  <button role="switch" aria-checked={a.active} aria-label={a.active ? 'Pausar alerta' : 'Ativar alerta'} onClick={() => cloud.toggleAlert(a.id, !a.active).catch(() => {})}
                    className={`relative w-12 h-7 rounded-full border transition-all shrink-0 ${a.active ? 'bg-luxury-gold border-luxury-gold' : 'bg-white/5 border-white/15'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full transition-all ${a.active ? 'left-6 bg-black' : 'left-0.5 bg-zinc-400'}`} />
                  </button>
                  <button onClick={() => cloud.removeAlert(a.id).catch(() => {})} className="p-2 text-zinc-600 hover:text-red-400 transition-colors shrink-0" aria-label="Apagar alerta"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AlertsView;
