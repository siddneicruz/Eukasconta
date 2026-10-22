import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ShoppingCart, Plus, Check, Trash2, SlidersHorizontal, Sparkles, Info, AlertTriangle, Undo2, ChevronLeft, ChevronRight, ChevronDown, Receipt as ReceiptIcon, MoreHorizontal, Star, Pencil, Save, Apple, Carrot, Beef,
} from 'lucide-react';
import { Receipt, MasterProduct } from '../types';
import {
  Advice, BaseInfo, Entry, Group, LineCheck, PlanPurchase, PurchaseCheck, Setup, ShoppingList,
  addManual, analyzeHistory, budgetState, buildList, cartTotal, cutTotal, duplicateList, entryCost, fmtQty, listName, listTotal, lookbackLabel, manualPlan, newListId, withBase,
  purchaseTotal, purchasesFromSetup, removeEntry, restoreCut, roundTo, setAllCart, setPrice, setQty, shortDate, stepOf, toggleCart, unitLabel, validateList,
} from '../services/shoppingList';
import { consultAi, describeHistory } from '../services/shoppingListAI';
import { ProgressEvent, ProgressState, StepId, applyEvent, initialProgress } from '../services/shoppingProgress';
import { localTodayIso } from '../services/productNormalization';
import { loadBaseId, loadLists, loadSetup, saveBaseId, saveLists, saveSetup } from '../services/shoppingStore';
import { getActiveProvider, getActiveProviderLabel, getOpenRouterModel, hasAnyUserApiKey, setOpenRouterModel } from '../services/keyStorageService';
import ShoppingSetup, { GenOptions } from './ShoppingSetup';
import ShoppingProgress from './ShoppingProgress';
import { AddSheet, ConfirmSheet, ItemSheet, ListMenuSheet, RenameSheet, brl } from './ShoppingSheets';
import ShoppingCatalogSheet from './ShoppingCatalogSheet';
import { CatGroup, resolveIds } from '../services/shoppingCatalog';

/* Lista de compras: gera a partir dos cupons, divide por semana ou pelos dias do mês, respeita teto e mínimo,
   deixa marcar o que já está no carrinho e depois confere com os cupons escaneados. */

interface Props {
  receipts: Receipt[];
  masters: MasterProduct[];
  onOpenReceipt?: (id: string) => void;
  backRef: React.MutableRefObject<() => boolean>;
}

type Screen = 'home' | 'setup' | 'list';
type SheetState = { kind: 'item'; pi: number; pid: string; group: Group } | { kind: 'add'; pi: number } | { kind: 'catalog'; pi: number; group: CatGroup } | { kind: 'delete'; id: string } | { kind: 'menu' } | { kind: 'rename'; id: string } | { kind: 'save'; id: string } | null;

interface Section { key: string; title: string; sub?: string; entries: Entry[] }

const sectionsOf = (entries: Entry[]): Section[] => {
  const out: Section[] = [];
  const pick = (gs: Group[]) => entries.filter(e => gs.includes(e.group));
  const ch = pick(['churrasco']);
  if (ch.length) out.push({ key: 'churrasco', title: 'Churrasco', sub: ch.find(e => e.note)?.note, entries: ch });
  const fr = pick(['fruta']);
  if (fr.length) out.push({ key: 'fruta', title: 'Frutas da semana', entries: fr });
  const ve = pick(['verdura']);
  if (ve.length) out.push({ key: 'verdura', title: 'Verduras e legumes da semana', entries: ve });
  const ex = pick(['extra']);
  if (ex.length) out.push({ key: 'extra', title: 'Para chegar ao mínimo', sub: 'Itens que você já comprou antes', entries: ex });
  const depts = new Map<string, Entry[]>();
  pick(['regular', 'manual']).forEach(e => { const a = depts.get(e.dept); if (a) a.push(e); else depts.set(e.dept, [e]); });
  depts.forEach((es, dept) => out.push({ key: `d:${dept}`, title: dept, entries: es }));
  return out;
};

const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : 0);
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))}%`;
const savedLabel = (ts: number) => { const d = new Date(ts); const p = (n: number) => String(n).padStart(2, '0'); return `Gravada em ${p(d.getDate())}/${p(d.getMonth() + 1)} às ${p(d.getHours())}:${p(d.getMinutes())}`; };
const brDate = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');

const Row: React.FC<{ e: Entry; check?: LineCheck; onToggle: () => void; onEdit: () => void }> = ({ e, check, onToggle, onEdit }) => (
  <li className="flex items-stretch" data-testid="shop-row" data-pid={e.pid} data-cart={e.cart ? '1' : '0'}>
    <button type="button" role="checkbox" aria-checked={e.cart} aria-label={`No carrinho: ${e.name}`} onClick={onToggle} data-testid="shop-check"
      className="w-12 shrink-0 flex items-center justify-center">
      <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${e.cart ? 'bg-luxury-gold border-luxury-gold text-black' : 'border-white/20'}`}>
        {e.cart && <Check className="w-3.5 h-3.5" strokeWidth={3.5} />}
      </span>
    </button>
    <button type="button" onClick={onEdit} data-testid="shop-edit" aria-label={`Editar ${e.name}`}
      className="min-w-0 flex-1 text-left py-2 pr-3 flex items-center gap-2 min-h-[56px] rounded-xl hover:bg-white/5">
      <span className="min-w-0 flex-1">
        <span className={`block text-[14px] font-semibold truncate ${e.cart ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}>{e.name}</span>
        <span className="block text-[11px] text-zinc-500 tabular-nums truncate">
          {fmtQty(e.qty, e.unit)}{e.price > 0 ? ` · ${brl(e.price)}/${unitLabel(e.unit)}` : ' · sem preço'}
        </span>
        {check && (
          <span className={`block text-[11px] tabular-nums truncate ${check.status === 'comprado' ? 'text-emerald-400' : check.status === 'parcial' ? 'text-amber-400' : 'text-rose-400'}`} data-testid="shop-row-check" data-status={check.status}>
            {check.status === 'faltou' ? 'não veio no cupom'
              : check.status === 'parcial' ? `parcial: ${fmtQty(check.bought || 0, e.unit)} de ${fmtQty(e.qty, e.unit)}`
              : check.paidPrice !== null ? `comprado a ${brl(check.paidPrice)}${e.price > 0 ? ` (${signed(pct(check.paidPrice, e.price))})` : ''}` : 'comprado'}
          </span>
        )}
      </span>
      <span className={`shrink-0 text-[14px] font-semibold tabular-nums ${e.cart ? 'text-zinc-500' : 'text-white'}`}>{e.price > 0 ? brl(entryCost(e)) : '—'}</span>
    </button>
  </li>
);

const ValidationCard: React.FC<{ check: PurchaseCheck; purchase: PlanPurchase; receipts: Receipt[]; onOpenReceipt?: (id: string) => void }> = ({ check, purchase, receipts, onOpenReceipt }) => {
  const [more, setMore] = useState(false);
  if (check.state === 'futuro') {
    return (
      <p className="flex items-start gap-2 text-[11px] text-zinc-500 leading-snug px-1" data-testid="shop-validation" data-state="futuro">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Depois da compra, escaneie o cupom: o app confere o que veio e quanto você pagou.
      </p>
    );
  }
  if (check.state === 'aguardando') {
    return (
      <p className="flex items-start gap-2 text-[11px] text-amber-400 leading-snug px-1" data-testid="shop-validation" data-state="aguardando">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Esperando o cupom desta compra. Escaneie-o e volte aqui para conferir.
      </p>
    );
  }
  const dTotal = pct(check.paid, check.planned);
  const dPrice = pct(check.pricePaid, check.priceEst);
  const counts = { comprado: 0, parcial: 0, faltou: 0 };
  check.lines.forEach(l => { counts[l.status] += 1; });
  const rs = check.receiptIds.map(id => receipts.find(r => r.id === id)).filter((r): r is Receipt => !!r);
  const tone = (d: number) => (d > 0.5 ? 'text-rose-400' : d < -0.5 ? 'text-emerald-400' : 'text-zinc-400');
  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3" data-testid="shop-validation" data-state="conferida">
      <p className="text-[13px] font-semibold text-emerald-400 flex items-center gap-1.5"><Check className="w-4 h-4" /> Conferida com {rs.length} {rs.length === 1 ? 'cupom' : 'cupons'}</p>
      <div className="grid grid-cols-2 gap-3 mt-2 tabular-nums">
        <div><p className="text-[10px] text-zinc-500">Previsto na lista</p><p className="text-[15px] font-serif font-bold text-white" data-testid="shop-val-planned">{brl(check.planned)}</p></div>
        <div><p className="text-[10px] text-zinc-500">Pago nos cupons</p>
          <p className="text-[15px] font-serif font-bold text-white" data-testid="shop-val-paid">{brl(check.paid)} {check.planned > 0 && <span className={`text-[11px] font-sans font-semibold ${tone(dTotal)}`}>{signed(dTotal)}</span>}</p></div>
      </div>
      {check.priced > 0 && check.priceEst > 0 && (
        <p className="text-[12px] mt-2 leading-snug tabular-nums" data-testid="shop-val-price">
          <span className="text-zinc-400">Preços: nos {check.priced} {check.priced === 1 ? 'item que veio' : 'itens que vieram'} você pagou </span>
          <span className={`font-semibold ${tone(dPrice)}`}>{Math.abs(dPrice) < 0.5 ? 'o mesmo preço' : `${Math.abs(Math.round(dPrice))}% ${dPrice > 0 ? 'a mais' : 'a menos'}`}</span>
          <span className="text-zinc-400"> que nas últimas compras ({brl(check.pricePaid)} contra {brl(check.priceEst)}).</span>
        </p>
      )}
      <p className="text-[11px] text-zinc-400 mt-2 tabular-nums" data-testid="shop-val-counts">
        {counts.comprado} {counts.comprado === 1 ? 'comprado' : 'comprados'} · {counts.parcial} {counts.parcial === 1 ? 'parcial' : 'parciais'} · {counts.faltou} {counts.faltou === 1 ? 'não veio' : 'não vieram'}
        {check.extraCost > 0 && <> · fora da lista: <span className="text-zinc-200 font-semibold">{brl(check.extraCost)}</span></>}
      </p>
      {check.extras.length > 0 && (
        <div className="mt-1.5">
          <button type="button" onClick={() => setMore(v => !v)} className="text-[11px] text-luxury-gold flex items-center gap-1 min-h-[32px]" aria-expanded={more} data-testid="shop-val-extras-toggle">
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${more ? 'rotate-180' : ''}`} /> {check.extras.length} {check.extras.length === 1 ? 'item fora da lista' : 'itens fora da lista'}
          </button>
          {more && (
            <ul className="mt-1 space-y-0.5" data-testid="shop-val-extras">
              {check.extras.slice(0, 12).map(x => (
                <li key={x.pid} className="flex justify-between gap-3 text-[11px] text-zinc-400 tabular-nums"><span className="truncate">{x.name} · {fmtQty(x.qty, x.unit)}</span><span className="shrink-0">{brl(x.cost)}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}
      {onOpenReceipt && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {rs.map(r => (
            <button key={r.id} type="button" onClick={() => onOpenReceipt(r.id)} data-testid="shop-open-receipt"
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg border border-white/10 text-[12px] font-semibold text-zinc-200 hover:border-luxury-gold/40">
              <ReceiptIcon className="w-3.5 h-3.5 text-luxury-gold" /> Cupom {brDate(r.date)} · {brl(Number(r.totalAmount) || 0)} <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
            </button>
          ))}
        </div>
      )}
      <p className="sr-only">{purchase.date}</p>
    </div>
  );
};

const ShoppingListView: React.FC<Props> = ({ receipts, masters, onOpenReceipt, backRef }) => {
  const today = localTodayIso();
  const [lists, setLists] = useState<ShoppingList[]>(() => loadLists());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [baseId, setBaseId] = useState<string | null>(() => loadBaseId());
  const [screen, setScreen] = useState<Screen>('home');
  const [pi, setPi] = useState(0);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const gen = useRef<{ cancelled: boolean; skipAi: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [cutOpen, setCutOpen] = useState(false);

  const hasKey = hasAnyUserApiKey();
  const aiLabel = getActiveProviderLabel();
  const history = useMemo(() => analyzeHistory(receipts, masters, { today }), [receipts, masters, today]);

  useEffect(() => { saveLists(lists); }, [lists]);
  useEffect(() => { saveBaseId(baseId); }, [baseId]);
  const baseList = lists.find(l => l.id === baseId) || null;

  const list = lists.find(l => l.id === activeId) || null;
  const checks = useMemo(() => (list ? validateList(list, receipts, masters, today) : []), [list, receipts, masters, today]);

  const cancelGenerate = () => { if (gen.current) { gen.current.cancelled = true; gen.current.skipAi(); } };
  backRef.current = () => {
    if (progress) { cancelGenerate(); return true; }
    if (sheet) { setSheet(null); return true; }
    if (screen !== 'home') { setScreen('home'); return true; }
    return false;
  };
  useEffect(() => () => { backRef.current = () => false; if (gen.current) { gen.current.cancelled = true; gen.current.skipAi(); } }, [backRef]);

  const update = (fn: (l: ShoppingList) => ShoppingList) => setLists(prev => prev.map(l => (l.id === activeId ? fn(l) : l)));
  const open = (id: string) => { setActiveId(id); setPi(0); setNotesOpen(false); setCutOpen(false); setScreen('list'); };
  const toggleBase = (id: string) => setBaseId(prev => (prev === id ? null : id));
  // dar nome é gravar: a lista passa a constar como gravada
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (msg: string) => { setNotice(msg); if (noticeTimer.current) clearTimeout(noticeTimer.current); noticeTimer.current = setTimeout(() => setNotice(null), 3200); };
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);
  const renameList = (id: string, name: string, saved = false) => {
    setLists(prev => prev.map(l => (l.id === id ? { ...l, name, savedAt: Date.now() } : l)));
    if (saved) say(`Lista gravada: ${name}`);
  };
  const removeList = (id: string) => {
    setLists(prev => prev.filter(l => l.id !== id));
    if (activeId === id) setActiveId(null);
    if (baseId === id) setBaseId(null);
    setSheet(null);
  };
  const copyList = (id: string) => {
    const l = lists.find(x => x.id === id);
    if (!l) return;
    const c = duplicateList(l, `${l.name} (cópia)`.slice(0, 60));
    setLists(prev => { const i = prev.findIndex(x => x.id === id); const n = [...prev]; n.splice(i + 1, 0, c); return n; });
    setSheet(null);
    open(c.id);
  };

  const generate = async (setup: Setup, go: GenOptions, replaceId?: string) => {
    setError(null);
    saveSetup(setup);
    const t = localTodayIso();
    const purchases = purchasesFromSetup(setup, t);
    if (!purchases.length) { setError('Escolha ao menos um dia de compra.'); return; }
    const targetId = replaceId || editingId;
    const old = targetId ? lists.find(l => l.id === targetId) : null;
    const baseSrc = go.fromBase && baseList ? baseList : null;

    // lista manual: vazia, só com as datas; a pessoa adiciona os itens
    if (go.mode === 'manual') {
      const plan = manualPlan(purchases);
      const next: ShoppingList = {
        id: newListId(), name: go.name || listName(setup, plan.purchases), createdAt: t,
        setup, info: { from: '', to: '', cycle: history.cycle, trips: 0, source: 'historico', manual: true },
        purchases: plan.purchases, cut: [], notes: [],
      };
      setLists(prev => [next, ...prev]);
      setEditingId(null);
      open(next.id);
      return;
    }

    const useAi = go.mode === 'ai' && hasKey && !baseSrc;
    let skipAi: () => void = () => {};
    const skip = new Promise<void>(res => { skipAi = res; });
    const ctl = { cancelled: false, skipAi };
    gen.current = ctl;

    let prog = initialProgress({ ai: useAi, aiLabel, fruitVeg: !!setup.fruitVeg, churrasco: !!setup.churrasco });
    const emit = (e: ProgressEvent) => { prog = applyEvent(prog, e); setProgress(prog); };
    const step = (id: StepId, status: 'run' | 'done' | 'skip' | 'fail', detail?: string) => emit({ kind: 'step', step: id, status, detail });
    const log = (text: string) => emit({ kind: 'log', text });
    // as etapas de conta são rápidas: uma pausa curta deixa a pessoa ver cada uma passar
    const pause = (ms = 380) => new Promise<void>(r => setTimeout(r, ms));
    setProgress(prog);

    try {
      step('cupons', 'run');
      const nItems = receipts.reduce((n, r) => n + (r.items?.length || 0), 0);
      log(`Lendo ${receipts.length} ${receipts.length === 1 ? 'cupom salvo' : 'cupons salvos'} (${nItems} itens)…`);
      await pause();
      let hist = analyzeHistory(receipts, masters, { today: t, lookbackDays: setup.lookback });
      if (hist.empty) {
        step('cupons', 'fail', 'Nenhum cupom com itens');
        setError('Não há cupons com itens para basear a lista.');
        return;
      }
      step('cupons', 'done', `${receipts.length} ${receipts.length === 1 ? 'cupom' : 'cupons'} · ${nItems} itens`);

      let advice: Advice = {};
      let info: BaseInfo = { from: hist.window.from, to: hist.window.to, cycle: hist.cycle, trips: hist.tripCount, source: 'historico', lookback: setup.lookback, ...(baseSrc ? { base: baseSrc.name } : {}) };
      if (useAi) {
        const c = await consultAi(receipts, masters, { purchases, fruitVeg: setup.fruitVeg, month: Number(purchases[0].date.slice(5, 7)) }, { today: t, emit, skip, label: aiLabel, lookbackDays: setup.lookback });
        if (ctl.cancelled) { setError(null); return; }
        hist = c.history;
        advice = c.advice;
        info = { from: hist.window.from, to: hist.window.to, cycle: hist.cycle, trips: hist.tripCount, source: c.info.source, note: c.info.note, aiError: c.info.aiError, aiLabel, lookback: setup.lookback };
      } else {
        step('analise', 'run');
        log('Analisando suas compras…');
        await pause();
        step('analise', 'done', describeHistory(hist));
        log(describeHistory(hist));
        if (baseSrc) {
          hist = withBase(hist, baseSrc);
          log(`Partindo da lista base “${baseSrc.name}”: ${hist.products.length} ${hist.products.length === 1 ? 'item' : 'itens'}, ajustados aos dias desta lista.`);
        } else if (go.mode === 'ai') log('Sem chave de IA salva: a lista sai só pelas suas compras.');
      }

      const days = purchases.reduce((n, p) => n + p.days, 0);
      step('calculo', 'run');
      log(`Calculando o que comprar em ${days} ${days === 1 ? 'dia' : 'dias'}…`);
      await pause();
      if (ctl.cancelled) return;
      const plan = buildList(hist, {
        purchases, min: setup.min, max: setup.max,
        fruitVeg: setup.fruitVeg ? { fruits: setup.fruits, veggies: setup.veggies, fruitPool: setup.fruitPool, veggiePool: setup.veggiePool } : null,
        churrasco: setup.churrasco ? { weekday: setup.churrascoWeekday, people: setup.people, grams: setup.grams, pool: setup.meatPool } : null,
        seed: Math.floor(Math.random() * 1e9),
      }, advice);
      const itemsOut = plan.purchases.reduce((n, p) => n + p.entries.length, 0);
      step('calculo', 'done', `${itemsOut} ${itemsOut === 1 ? 'item' : 'itens'} para ${days} ${days === 1 ? 'dia' : 'dias'}`);

      step('separacao', 'run');
      await pause();
      plan.purchases.forEach((p, i) => log(`Compra ${i + 1} · ${shortDate(p.date)} · ${p.entries.length} ${p.entries.length === 1 ? 'item' : 'itens'} · ${brl(purchaseTotal(p))}`));
      plan.notes.forEach(n => log(n));
      if (plan.cut.length) log(`${plan.cut.length} ${plan.cut.length === 1 ? 'item ficou' : 'itens ficaram'} de fora (você pode devolver na lista).`);
      step('separacao', 'done', `${plan.purchases.length} ${plan.purchases.length === 1 ? 'compra' : 'compras'}${plan.notes.length ? ` · ${plan.notes.length} ${plan.notes.length === 1 ? 'aviso' : 'avisos'}` : ''}`);

      step('montagem', 'run');
      await pause(250);
      if (ctl.cancelled) return;
      // ao gerar de novo, o que já estava no carrinho continua marcado (mesma data e mesmo produto)
      const carried = new Set<string>();
      old?.purchases.forEach(p => p.entries.forEach(e => { if (e.cart) carried.add(`${p.date}|${e.pid}`); }));
      const purchasesOut = plan.purchases.map(p => ({ ...p, entries: p.entries.map(e => (carried.has(`${p.date}|${e.pid}`) ? { ...e, cart: true } : e)) }));
      const next: ShoppingList = {
        id: old?.id || newListId(), name: go.name || listName(setup, purchasesOut), createdAt: old?.createdAt || t,
        setup, info, purchases: purchasesOut, cut: plan.cut, notes: plan.notes,
      };
      setLists(prev => (old ? prev.map(l => (l.id === old.id ? next : l)) : [next, ...prev]));
      step('montagem', 'done', `${listTotal(next) > 0 ? brl(listTotal(next)) : 'sem preços'} no total`);
      log(`Lista pronta: ${next.name}.`);
      await pause(700);
      setEditingId(null);
      open(next.id);
    } catch (err: any) {
      setError(String(err?.message || err || 'Não consegui montar a lista.'));
    } finally {
      gen.current = null;
      setProgress(null);
    }
  };

  // Modelos grátis do OpenRouter caem com frequência: refaz a lista com o Claude Haiku, que usa os créditos do OpenRouter.
  const HAIKU = 'anthropic/claude-haiku-5.5';
  const canRetryHaiku = (): boolean => getActiveProvider() === 'openrouter' && getOpenRouterModel('text') !== HAIKU;
  const retryWithHaiku = () => {
    if (!list) return;
    setOpenRouterModel('text', HAIKU);
    void generate(list.setup, { name: list.name, mode: 'ai', fromBase: false }, list.id);
  };

  const startNew = () => { setEditingId(null); setError(null); setScreen('setup'); };
  const startAdjust = () => { setEditingId(activeId); setError(null); setScreen('setup'); };

  /* ───────────── início ───────────── */
  if (screen === 'home' || (screen === 'list' && !list)) {
    return (
      <div className="max-w-2xl mx-auto space-y-4" data-testid="shop-view">
        <div className="flex items-start justify-between gap-3" data-testid="shop-home">
          <div className="min-w-0">
            <h2 className="text-2xl font-serif font-bold text-white leading-tight">Lista de compras</h2>
            <p className="text-[12px] text-zinc-500 mt-0.5 leading-snug">Feita com os preços e as quantidades das suas últimas compras.</p>
          </div>
          <button type="button" onClick={startNew} data-testid="shop-new"
            className="shrink-0 h-11 px-4 rounded-xl bg-luxury-gold text-black text-[13px] font-bold flex items-center gap-1.5 active:opacity-80"><Plus className="w-4 h-4" /> Nova lista</button>
        </div>

        {lists.length === 0 ? (
          <div className="bg-[#121214] border border-white/5 rounded-2xl p-6 text-center shadow-xl" data-testid="shop-empty">
            <ShoppingCart className="w-9 h-9 text-luxury-gold mx-auto" />
            <p className="text-[15px] font-semibold text-zinc-100 mt-3">Nenhuma lista ainda</p>
            <p className="text-[12px] text-zinc-500 mt-1 leading-snug">O app descobre de quanto em quanto tempo você compra, monta a lista com os últimos preços, divide por semana, respeita um teto e confere depois com os cupons.</p>
            <button type="button" onClick={startNew} className="mt-4 h-11 px-5 rounded-xl border border-luxury-gold/40 text-luxury-gold text-[13px] font-semibold">Montar a primeira lista</button>
          </div>
        ) : (
          <ul className="space-y-2" data-testid="shop-lists">
            {lists.map(l => {
              const items = l.purchases.reduce((s, p) => s + p.entries.length, 0);
              const inCart = l.purchases.reduce((s, p) => s + p.entries.filter(e => e.cart).length, 0);
              return (
                <li key={l.id} className="bg-[#121214] border border-white/5 rounded-2xl shadow-xl flex items-stretch" data-testid="shop-list-card" data-id={l.id}>
                  <button type="button" onClick={() => open(l.id)} className="min-w-0 flex-1 text-left p-4 flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="block text-[15px] font-semibold text-zinc-100 truncate">{l.name}</span>
                        {l.id === baseId && <span className="shrink-0 inline-flex items-center gap-1 text-[10.5px] font-bold text-luxury-gold" data-testid="shop-base-badge"><Star className="w-3 h-3 fill-current" /> Base</span>}
                      </span>
                      <span className="block text-[11px] text-zinc-500 tabular-nums mt-0.5">
                        {l.purchases.length} {l.purchases.length === 1 ? 'compra' : 'compras'} · {items} itens · {inCart} no carrinho
                      </span>
                    </span>
                    <span className="shrink-0 text-[15px] font-serif font-bold text-white tabular-nums">{brl(listTotal(l))}</span>
                    <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0" />
                  </button>
                  <button type="button" onClick={() => toggleBase(l.id)} aria-label={l.id === baseId ? `Tirar ${l.name} de lista base` : `Usar ${l.name} como lista base`} aria-pressed={l.id === baseId} data-testid="shop-list-base"
                    className={`w-12 shrink-0 flex items-center justify-center border-l border-white/5 ${l.id === baseId ? 'text-luxury-gold' : 'text-zinc-600 hover:text-luxury-gold'}`}><Star className={`w-4 h-4 ${l.id === baseId ? 'fill-current' : ''}`} /></button>
                  <button type="button" onClick={() => setSheet({ kind: 'delete', id: l.id })} aria-label={`Apagar ${l.name}`} data-testid="shop-list-delete"
                    className="w-12 shrink-0 flex items-center justify-center text-zinc-600 hover:text-rose-400 border-l border-white/5"><Trash2 className="w-4 h-4" /></button>
                </li>
              );
            })}
          </ul>
        )}
        {sheet?.kind === 'delete' && (
          <ConfirmSheet title="Apagar esta lista?" message="Só a lista é apagada. Seus cupons e o histórico continuam como estão." confirmLabel="Apagar"
            onClose={() => setSheet(null)} onConfirm={() => removeList(sheet.id)} />
        )}
      </div>
    );
  }

  /* ───────────── formulário ───────────── */
  if (screen === 'setup') {
    // Lista nova herda só o jeito de montar (tipo, frutas, churrasco, IA); orçamento e dias do mês são de cada lista.
    const fresh = (): Setup => {
      const saved = loadSetup(today, history.cycle);
      const nowYm = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
      const stale = saved.year * 12 + saved.month - 1 < nowYm;
      return { ...saved, min: null, max: null, ...(stale ? { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)), monthDays: [] } : {}) };
    };
    const base = editingId ? (lists.find(l => l.id === editingId)?.setup ?? fresh()) : fresh();
    return (
      <div className="max-w-2xl mx-auto" data-testid="shop-view">
        {progress ? (
          <ShoppingProgress state={progress} aiLabel={aiLabel} onSkipAi={() => gen.current?.skipAi()} onCancel={cancelGenerate} />
        ) : (
          <ShoppingSetup key={editingId || 'new'} initial={base} today={today} history={history} aiLabel={aiLabel} hasKey={hasKey} error={error}
            editing={!!editingId} initialName={editingId ? (lists.find(l => l.id === editingId)?.name || '') : ''}
            base={baseList ? { name: baseList.name } : null} baseDefault={editingId ? !!lists.find(l => l.id === editingId)?.info.base : true}
            onSubmit={generate} onCancel={() => setScreen(editingId ? 'list' : 'home')} />
        )}
      </div>
    );
  }

  /* ───────────── lista ───────────── */
  if (!list) return null;
  const idx = Math.min(pi, list.purchases.length - 1);
  const purchase = list.purchases[idx];
  const check = checks[idx];
  const lineOf = (e: Entry): LineCheck | undefined => (check?.state === 'conferida' ? check.lines.find(l => l.pid === e.pid) : undefined);
  const total = listTotal(list);
  const bs = budgetState(list);
  const allEntries = list.purchases.reduce((s, p) => s + p.entries.length, 0);
  const inCartAll = list.purchases.reduce((s, p) => s + p.entries.filter(e => e.cart).length, 0);
  const cartMoney = list.purchases.reduce((s, p) => s + cartTotal(p), 0);
  const multi = list.purchases.length > 1;
  const pTotal = purchaseTotal(purchase);
  const allChecked = purchase.entries.length > 0 && purchase.entries.every(e => e.cart);
  const share = list.setup.max ? (list.setup.max * purchase.days) / list.purchases.reduce((s, p) => s + p.days, 0) : 0;
  const info = list.info;
  const checked = checks.filter(c => c.state === 'conferida');
  const plannedChecked = checked.reduce((s, c) => s + (c.planned || 0), 0);
  const paidChecked = checked.reduce((s, c) => s + c.paid, 0);
  const cutSum = cutTotal(list);
  const purchaseLabel = shortDate(purchase.date);

  const sheetEntry = sheet && sheet.kind === 'item' ? list.purchases[sheet.pi]?.entries.find(e => e.pid === sheet.pid && e.group === sheet.group) : undefined;

  return (
    <div className="max-w-2xl mx-auto space-y-3" data-testid="shop-view">
      <div className="flex items-center gap-2" data-testid="shop-list-view" data-id={list.id}>
        <button type="button" onClick={() => setScreen('home')} aria-label="Voltar às listas" data-testid="shop-back" className="w-10 h-10 -ml-2 flex items-center justify-center rounded-xl text-zinc-400 hover:text-luxury-gold"><ChevronLeft className="w-5 h-5" /></button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => setSheet({ kind: 'rename', id: list.id })} aria-label={`Renomear ${list.name}`} data-testid="shop-rename" className="max-w-full text-left min-h-[28px] flex items-center gap-1.5">
            <h2 className="text-xl font-serif font-bold text-white leading-tight break-words min-w-0" data-testid="shop-title">{list.name}</h2>
            <Pencil className="w-3.5 h-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
          </button>
          <p className="text-[11px] text-zinc-500 tabular-nums flex items-center gap-1.5">
            <span>Criada em {brDate(list.createdAt)}</span>
            {list.id === baseId && <span className="inline-flex items-center gap-1 font-bold text-luxury-gold" data-testid="shop-base-flag"><Star className="w-3 h-3 fill-current" /> Lista base</span>}
          </p>
        </div>
        <button type="button" onClick={startAdjust} aria-label="Ajustar a lista" data-testid="shop-adjust" className="w-11 h-11 flex items-center justify-center rounded-xl border border-white/10 text-zinc-300 hover:text-luxury-gold"><SlidersHorizontal className="w-4 h-4" /></button>
        <button type="button" onClick={() => setSheet({ kind: 'menu' })} aria-label="Mais ações da lista" data-testid="shop-menu" className="w-11 h-11 flex items-center justify-center rounded-xl border border-white/10 text-zinc-300 hover:text-luxury-gold"><MoreHorizontal className="w-4 h-4" /></button>
      </div>

      {list.savedAt ? (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2" data-testid="shop-saved" role="status">
          <span className="shrink-0 w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center"><Check className="w-4 h-4 text-emerald-400" aria-hidden="true" /></span>
          <p className="min-w-0 flex-1 text-[12px] leading-snug text-zinc-300">
            <span className="block font-semibold text-emerald-400">Lista gravada</span>
            <span className="block text-zinc-500 tabular-nums" data-testid="shop-saved-at">{savedLabel(list.savedAt)} · o que você mudar fica salvo sozinho</span>
          </p>
          <button type="button" onClick={() => setSheet({ kind: 'save', id: list.id })} data-testid="shop-save-again"
            className="shrink-0 min-h-[40px] px-3 rounded-xl border border-white/10 text-[12px] font-semibold text-zinc-200 active:bg-white/5">Renomear</button>
        </div>
      ) : (
        <button type="button" onClick={() => setSheet({ kind: 'save', id: list.id })} data-testid="shop-save"
          className="w-full min-h-[52px] rounded-2xl bg-luxury-gold text-black px-4 py-2 flex items-center justify-center gap-2.5 active:opacity-80 shadow-lg">
          <Save className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span className="text-left leading-tight">
            <span className="block text-[15px] font-bold">Gravar lista</span>
            <span className="block text-[11px] font-medium text-black/70">Dê um nome e guarde na sua coleção</span>
          </span>
        </button>
      )}

      <section className="bg-[#121214] border border-white/5 rounded-2xl p-4 shadow-xl" data-testid="shop-summary-card">
        <p className="text-[11px] text-zinc-500">Total estimado com os últimos preços</p>
        <p className="text-3xl font-serif font-bold text-white tabular-nums leading-tight" data-testid="shop-total">{brl(total)}</p>
        {bs.status !== 'livre' && (
          <p className={`mt-1 text-[12px] font-semibold tabular-nums ${bs.status === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`} data-testid="shop-budget-state" data-status={bs.status}>
            {bs.status === 'ok' && 'Dentro do orçamento'}
            {bs.status === 'acima' && `${brl(bs.gap)} acima do teto`}
            {bs.status === 'abaixo' && `${brl(bs.gap)} abaixo do mínimo`}
            <span className="font-normal text-zinc-500"> · {bs.min ? `mín. ${brl(bs.min)}` : ''}{bs.min && bs.max ? ' · ' : ''}{bs.max ? `teto ${brl(bs.max)}` : ''}</span>
          </p>
        )}
        {cutSum > 0 && (
          <p className="mt-1 text-[11px] text-zinc-500 tabular-nums" data-testid="shop-intended">Pretendido {brl(total + cutSum)} · {brl(cutSum)} ficou fora da lista</p>
        )}
        <div className="mt-3">
          <div className="flex justify-between text-[11px] text-zinc-500 tabular-nums mb-1">
            <span data-testid="shop-progress-text">{inCartAll} de {allEntries} itens no carrinho</span>
            <span>{brl(cartMoney)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-luxury-gold transition-all" style={{ width: `${allEntries ? (inCartAll / allEntries) * 100 : 0}%` }} data-testid="shop-progress" /></div>
        </div>
        {checked.length > 0 && (
          <p className="mt-3 pt-3 border-t border-white/5 text-[11px] text-zinc-400 tabular-nums" data-testid="shop-conferido">
            Conferido em {checked.length} {checked.length === 1 ? 'compra' : 'compras'}: previsto {brl(plannedChecked)}, pago {brl(paidChecked)} {plannedChecked > 0 && <span className={paidChecked > plannedChecked * 1.005 ? 'text-rose-400 font-semibold' : 'text-zinc-300 font-semibold'}>({signed(pct(paidChecked, plannedChecked))})</span>}
          </p>
        )}
      </section>

      <section className="bg-[#121214] border border-white/5 rounded-2xl p-3 shadow-xl" data-testid="shop-info">
        <p className="flex items-start gap-2 text-[12px] text-zinc-300 leading-snug">
          <Sparkles className={`w-4 h-4 shrink-0 mt-0.5 ${info.source === 'ia' ? 'text-luxury-gold' : 'text-zinc-600'}`} />
          <span>
            {info.manual ? <>Lista feita à mão. Toque em “Adicionar item” para colocar o que você precisa; os preços vêm das suas últimas compras.</>
              : info.source === 'ia' ? <>{info.aiLabel || 'A IA'} escolheu as compras de <b className="text-zinc-100 tabular-nums">{brDate(info.from)}</b> a <b className="text-zinc-100 tabular-nums">{brDate(info.to)}</b> ({info.trips} {info.trips === 1 ? 'ida' : 'idas'}, uma a cada {info.cycle} dias).{info.note ? ` ${info.note}` : ''}</>
              : <>Montada só com o seu histórico: compras de <span className="tabular-nums">{brDate(info.from)}</span> a <span className="tabular-nums">{brDate(info.to)}</span> ({info.trips} {info.trips === 1 ? 'ida' : 'idas'}, uma a cada {info.cycle} dias).</>}
          </span>
        </p>
        {!info.manual && (info.base || (info.lookback ?? 0) > 0) && (
          <p className="text-[11px] text-zinc-500 leading-snug mt-1.5 pl-6" data-testid="shop-info-extra">
            {info.base ? `Partiu da lista base “${info.base}”. ` : ''}{(info.lookback ?? 0) > 0 ? `Período analisado: ${lookbackLabel(info.lookback!)}.` : ''}
          </p>
        )}
        {info.aiError && <p className="flex items-start gap-2 text-[11px] text-amber-400 leading-snug mt-2" data-testid="shop-ai-error"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {info.source === 'ia' ? info.aiError : `A IA não respondeu (${info.aiError}). A lista saiu só com o histórico.`}</p>}
        {info.aiError && canRetryHaiku() && (
          <button type="button" onClick={retryWithHaiku} data-testid="shop-retry-haiku"
            className="mt-2 ml-6 px-3 min-h-[36px] rounded-full border border-luxury-gold/40 text-[11px] font-semibold text-luxury-gold">
            Tentar com Claude Haiku (usa seus créditos do OpenRouter)
          </button>
        )}
        {list.notes.length > 0 && (
          <div className="mt-2">
            <button type="button" onClick={() => setNotesOpen(v => !v)} aria-expanded={notesOpen} data-testid="shop-notes-toggle" className="text-[11px] text-luxury-gold flex items-center gap-1 min-h-[32px]">
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${notesOpen ? 'rotate-180' : ''}`} /> Como a lista foi montada ({list.notes.length})
            </button>
            {notesOpen && <ul className="mt-1 space-y-1.5" data-testid="shop-notes">{list.notes.map((n, i) => <li key={i} className="text-[11px] text-zinc-400 leading-snug">• {n}</li>)}</ul>}
          </div>
        )}
      </section>

      {multi && (
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" role="tablist" aria-label="Compras da lista" data-testid="shop-tabs">
          {list.purchases.map((p, i) => (
            <button key={p.id} type="button" role="tab" aria-selected={i === idx} onClick={() => setPi(i)} data-testid={`shop-tab-${i}`}
              className={`shrink-0 min-w-[92px] text-left px-3 py-2 rounded-xl border transition-colors ${i === idx ? 'bg-luxury-gold text-black border-luxury-gold' : 'border-white/10 text-zinc-300'}`}>
              <span className="block text-[12px] font-bold capitalize tabular-nums">{shortDate(p.date)}</span>
              <span className={`block text-[11px] tabular-nums ${i === idx ? 'text-black/70' : 'text-zinc-500'}`}>{brl(purchaseTotal(p))}</span>
            </button>
          ))}
        </div>
      )}

      <section className="bg-[#121214] border border-white/5 rounded-2xl shadow-xl overflow-hidden" data-testid="shop-purchase" data-index={idx}>
        <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-zinc-100 capitalize tabular-nums">{purchaseLabel}</h3>
            <p className="text-[11px] text-zinc-500 tabular-nums">
              cobre {purchase.days} {purchase.days === 1 ? 'dia' : 'dias'} · {purchase.entries.length} {purchase.entries.length === 1 ? 'item' : 'itens'}
              {share > 0 && <> · parte do teto {brl(share)}</>}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[17px] font-serif font-bold text-white tabular-nums" data-testid="shop-purchase-total">{brl(pTotal)}</p>
            {share > 0 && pTotal > share + 0.005 && <p className="text-[10px] text-rose-400 tabular-nums">{brl(pTotal - share)} acima da parte</p>}
          </div>
        </div>

        {check && <div className="px-3 pb-2"><ValidationCard check={check} purchase={purchase} receipts={receipts} onOpenReceipt={onOpenReceipt} /></div>}

        {purchase.entries.length > 0 && (
          <div className="flex justify-end px-4 pb-1">
            <button type="button" onClick={() => update(l => setAllCart(l, idx, !allChecked))} data-testid="shop-check-all"
              className="min-h-[36px] text-[12px] font-semibold text-luxury-gold">{allChecked ? 'Desmarcar tudo' : 'Marcar tudo no carrinho'}</button>
          </div>
        )}

        {purchase.entries.length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-zinc-500" data-testid="shop-purchase-empty">Esta compra está vazia. Adicione itens abaixo.</p>
        ) : (
          sectionsOf(purchase.entries).map(sec => (
            <div key={sec.key} className="border-t border-white/5" data-testid="shop-section" data-section={sec.key}>
              <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-1">
                <div className="min-w-0">
                  <h4 className="text-[12px] font-semibold text-luxury-gold truncate">{sec.title}</h4>
                  {sec.sub && <p className="text-[10px] text-zinc-500 truncate">{sec.sub}</p>}
                </div>
                <span className="text-[11px] text-zinc-500 tabular-nums shrink-0">{brl(sec.entries.reduce((s, e) => s + entryCost(e), 0))}</span>
              </div>
              <ul className="px-1 pb-1">
                {sec.entries.map(e => (
                  <Row key={`${e.group}:${e.pid}`} e={e} check={lineOf(e)}
                    onToggle={() => update(l => toggleCart(l, idx, e.pid, e.group))}
                    onEdit={() => setSheet({ kind: 'item', pi: idx, pid: e.pid, group: e.group })} />
                ))}
              </ul>
            </div>
          ))
        )}

        <div className="border-t border-white/5 p-3 space-y-2">
          <button type="button" onClick={() => setSheet({ kind: 'add', pi: idx })} data-testid="shop-add"
            className="w-full h-11 rounded-xl border border-dashed border-white/20 text-[13px] font-semibold text-zinc-300 hover:text-luxury-gold hover:border-luxury-gold/40 flex items-center justify-center gap-1.5"><Plus className="w-4 h-4" /> Adicionar item</button>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Escolher no catálogo">
            {([['fruta', 'Frutas', Apple], ['verdura', 'Verduras', Carrot], ['carne', 'Carnes', Beef]] as const).map(([g, label, Icon]) => (
              <button key={g} type="button" onClick={() => setSheet({ kind: 'catalog', pi: idx, group: g })} data-testid={`shop-cat-${g}`} aria-label={`Escolher ${label.toLowerCase()} no catálogo`}
                className="h-11 rounded-xl border border-white/10 bg-white/[0.03] text-[12px] font-semibold text-zinc-200 hover:text-luxury-gold hover:border-luxury-gold/40 flex items-center justify-center gap-1.5 active:bg-white/10"><Icon className="w-4 h-4 text-luxury-gold" /> {label}</button>
            ))}
          </div>
        </div>
      </section>

      {list.cut.length > 0 && (
        <section className="bg-[#121214] border border-white/5 rounded-2xl shadow-xl" data-testid="shop-cut">
          <button type="button" onClick={() => setCutOpen(v => !v)} aria-expanded={cutOpen} data-testid="shop-cut-toggle" className="w-full flex items-center justify-between gap-3 px-4 min-h-[52px] text-left">
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-zinc-100">Fora da lista ({list.cut.length})</span>
              <span className="block text-[11px] text-zinc-500">Cortados pelo teto, pela IA ou por você{cutSum > 0 ? ` · ${brl(cutSum)}` : ''}</span>
            </span>
            <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${cutOpen ? 'rotate-180' : ''}`} />
          </button>
          {cutOpen && (
            <ul className="px-2 pb-2 border-t border-white/5" data-testid="shop-cut-list">
              {list.cut.map(c => {
                const qty = c.qtys.reduce((s, q) => s + q, 0);
                return (
                  <li key={`${c.why}:${c.pid}`} className="flex items-center gap-2 min-h-[56px] px-2" data-testid="shop-cut-row" data-pid={c.pid}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-zinc-200 truncate">{c.name}</span>
                      <span className="block text-[11px] text-zinc-500 truncate tabular-nums">{fmtQty(qty, c.unit)}{c.price > 0 ? ` · ${brl(c.price * qty)}` : ''} · {c.reason}</span>
                    </span>
                    <button type="button" onClick={() => update(l => restoreCut(l, c.pid, c.why))} data-testid="shop-cut-restore"
                      className="shrink-0 min-h-[40px] px-3 rounded-lg border border-white/10 text-[12px] font-semibold text-luxury-gold flex items-center gap-1"><Undo2 className="w-3.5 h-3.5" /> Voltar</button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {sheet?.kind === 'menu' && (
        <ListMenuSheet name={list.name} isBase={baseId === list.id} onClose={() => setSheet(null)}
          onRename={() => setSheet({ kind: 'rename', id: list.id })} onDuplicate={() => copyList(list.id)}
          onToggleBase={() => { toggleBase(list.id); setSheet(null); }} onDelete={() => setSheet({ kind: 'delete', id: list.id })} />
      )}
      {sheet?.kind === 'rename' && (
        <RenameSheet name={lists.find(l => l.id === sheet.id)?.name || ''} onClose={() => setSheet(null)} onSave={n => { renameList(sheet.id, n); setSheet(null); }} />
      )}
      {sheet?.kind === 'save' && (
        <RenameSheet mode="save" name={lists.find(l => l.id === sheet.id)?.name || ''} onClose={() => setSheet(null)} onSave={n => { renameList(sheet.id, n, true); setSheet(null); }} />
      )}
      {notice && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-[320] max-w-[90vw] px-4 py-2.5 rounded-full bg-emerald-500 text-black text-[13px] font-bold shadow-2xl flex items-center gap-2" role="status" aria-live="polite" data-testid="shop-notice">
          <Check className="w-4 h-4 shrink-0" aria-hidden="true" /><span className="truncate">{notice}</span>
        </div>
      )}
      {sheet?.kind === 'delete' && (
        <ConfirmSheet title="Apagar esta lista?" message="Só a lista é apagada. Seus cupons e o histórico continuam como estão." confirmLabel="Apagar"
          onClose={() => setSheet(null)} onConfirm={() => removeList(sheet.id)} />
      )}
      {sheet?.kind === 'item' && sheetEntry && (
        <ItemSheet entry={sheetEntry} purchaseLabel={shortDate(list.purchases[sheet.pi].date)} check={lineOf(sheetEntry)}
          onClose={() => setSheet(null)}
          onRemove={() => { const s = sheet; update(l => removeEntry(l, s.pi, s.pid)); setSheet(null); }}
          onSave={(qty, price) => { const s = sheet; update(l => { let n = setQty(l, s.pi, s.pid, qty); if (price !== sheetEntry.price) n = setPrice(n, s.pid, price); return n; }); setSheet(null); }} />
      )}
      {sheet?.kind === 'add' && (
        <AddSheet history={history} purchaseLabel={shortDate(list.purchases[sheet.pi].date)} onClose={() => setSheet(null)}
          onAdd={(p, name, group) => {
            const s = sheet;
            update(l => p
              ? addManual(l, s.pi, { pid: p.pid, name: p.name, unit: p.unit, price: p.price, dept: p.dept, category: p.category, qty: Math.max(stepOf(p.unit), roundTo(p.typical, stepOf(p.unit))), priceDate: p.priceDate, store: p.store, ...(group ? { group } : {}) })
              : addManual(l, s.pi, { name }));
          }} />
      )}
      {sheet?.kind === 'catalog' && (
        <ShoppingCatalogSheet
          mode="add" group={sheet.group} history={history}
          title={sheet.group === 'fruta' ? 'Frutas' : sheet.group === 'verdura' ? 'Verduras e legumes' : 'Carnes do churrasco'}
          subtitle={`Entram em ${shortDate(list.purchases[sheet.pi].date)}`}
          taken={list.purchases[sheet.pi].entries.map(e => e.pid)}
          onClose={() => setSheet(null)}
          onConfirm={ids => {
            const s = sheet;
            const group: Group = s.group === 'carne' ? 'churrasco' : s.group;
            const items = resolveIds(history, ids, s.group);
            update(l => items.reduce((acc, i) => addManual(acc, s.pi, {
              pid: i.id, name: i.name, unit: i.unit, price: i.price, dept: i.product.dept, category: i.product.category,
              qty: Math.max(stepOf(i.unit), roundTo(i.product.typical, stepOf(i.unit))), priceDate: i.priceDate, store: i.product.store, group,
            }), l));
            setSheet(null);
            if (items.length) say(`${items.length} ${items.length === 1 ? 'item entrou' : 'itens entraram'} em ${shortDate(list.purchases[s.pi].date)}`);
          }} />
      )}
    </div>
  );
};

export default ShoppingListView;
