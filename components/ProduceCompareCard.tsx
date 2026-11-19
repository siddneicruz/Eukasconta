import { createPortal } from 'react-dom';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Sprout, Beef, Fuel, Milk, Wheat, Wine, SprayCan, UtensilsCrossed, Shirt, Lamp, LayoutGrid, Croissant, PawPrint, Pill, Smartphone, Tag, Sparkles, Baby, Gamepad2, BookOpen, Wrench, Car, GraduationCap, Dumbbell, Gift, Candy, ShoppingBasket } from 'lucide-react';
import { Receipt } from '../types';
import * as cloud from '../services/cloudService';
import { useMasterInfo } from './MasterContext';
import { buildProduceCompare, mergeObs, rankItem, WD, MIN_ITEMS_RANK, MIN_DAY_OBS, MAX_STORES_PER_ITEM } from '../services/produceCompare';
import { unitLabel } from '../services/productPriceStats';
import { QualityFace } from './QualityFace';
import { loadShared } from '../services/sharedLoader';
import { fetchEanSizes, sizeFromText } from '../services/eanSizes';
import { deptObservations, sharedObservations } from '../services/quotes';
import { GROCERY_STORE_TYPES } from '../services/storeTypes';
import WheelPicker, { WheelOption } from './WheelPicker';

/* Hortifruti em Análises › Panorama: compara os mercados onde a pessoa compra (preço, nota de qualidade, dia da semana).
   Preço e dia da semana saem dos cupons dela (todo o histórico). A nota de qualidade vem do banco e, por ora, só para o administrador. */

const money = (v: number) => v.toFixed(2).replace('.', ',');
const pctTxt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0).replace('.', ',')}%`;
const idxColor = (v: number) => (v <= -0.02 ? '#34d399' : v >= 0.02 ? '#f87171' : '#a1a1aa');
const scoreColor = (s: number) => (s >= 7 ? '#34d399' : s >= 4 ? '#DDB94B' : '#f87171');
const short = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');


/* Ícone de cada categoria no quadrado do cartão (o mesmo traço fino do Sprout do Hortifruti) */
const CAT_ICONS: Array<[RegExp, React.ComponentType<{ className?: string }>]> = [
  [/hortifruti|fruta|verdura|legume/, Sprout],
  [/acougue|carne|aves|peixe/, Beef],
  [/transporte|combust|posto|automotiv/, Fuel],
  [/veiculo|carro|oficina/, Car],
  [/frios|laticin|queijo|leite/, Milk],
  [/padaria|panific|confeitaria/, Croissant],
  [/doce|matinal|biscoito|chocolate|sobremesa/, Candy],
  [/mercearia|grao|cereal|massa/, Wheat],
  [/bebida|vinho|cerveja|refrigerante/, Wine],
  [/comer fora|delivery|restaurante|lanche/, UtensilsCrossed],
  [/higiene|perfum|beleza|cosmet/, Sparkles],
  [/limpeza|lavanderia/, SprayCan],
  [/vestuario|roupa|calcado|moda/, Shirt],
  [/bazar|utilidade|casa|domestic|decora/, Lamp],
  [/pet|animal/, PawPrint],
  [/saude|farmacia|medic/, Pill],
  [/eletron|tecnolog|celular|informatica/, Smartphone],
  [/bebe|infantil|crianca/, Baby],
  [/lazer|jogo|entretenimento|brinquedo/, Gamepad2],
  [/educac|escola|curso/, GraduationCap],
  [/livro|papelaria/, BookOpen],
  [/esporte|academia|fitness/, Dumbbell],
  [/presente|festa/, Gift],
  [/ferramenta|construc|reforma/, Wrench],
  [/todas/, LayoutGrid],
];
const catIconOf = (label: string): React.ComponentType<{ className?: string }> => {
  const n = String(label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const hit = CAT_ICONS.find(([re]) => re.test(n));
  return hit ? hit[1] : (/mercado|supermerc|aliment/.test(n) ? ShoppingBasket : Tag);
};

type Tab = 'stores' | 'items' | 'days';
type Q = { score: number | null; n: number; last: string | null };

const ProduceCompareCard: React.FC<{ receipts: Receipt[]; nameOf: (name: string, cnpj: string) => string; dept?: string; label?: string; minItems?: number; center?: { lat: number; lng: number } | null; catWheel?: { options: WheelOption[]; value: string; onChange: (key: string) => void } }> = ({ receipts, nameOf, dept = 'HORTIFRUTI', label = 'Hortifruti', minItems = MIN_ITEMS_RANK, center = null, catWheel }) => {
  const { isAdmin: admin } = useMasterInfo();
  const isAdmin = admin && dept === 'HORTIFRUTI';   // a nota de qualidade só existe para hortifruti
  // Fonte: leituras de TODOS os usuários num raio (anônimas), somadas às suas compras. Sem login, sem conexão ou sem posição: só as suas.
  const [km, setKm] = useState<number>(() => { try { const v = Number(localStorage.getItem('eukasconta_compare_km')); return [10, 30, 60].includes(v) ? v : 30; } catch { return 30; } });
  const pickKm = (v: number) => { setKm(v); try { localStorage.setItem('eukasconta_compare_km', String(v)); } catch { /* vale só nesta tela */ } };
  const [shared, setShared] = useState<cloud.SharedRow[] | null>(null);
  const [src, setSrc] = useState<'loading' | 'shared' | 'local'>('loading');
  const cKey = center ? `${center.lat.toFixed(3)},${center.lng.toFixed(3)}` : '';
  useEffect(() => {
    let alive = true;
    setSrc('loading');
    loadShared(center, km).then(rows => { if (!alive) return; if (rows) { setShared(rows); setSrc('shared'); } else setSrc('local'); }).catch(() => { if (alive) setSrc('local'); });
    return () => { alive = false; };
  }, [km, cKey]);
  const obs = useMemo(() => {
    if (src !== 'shared' || !shared) return undefined;
    return mergeObs(sharedObservations(shared, dept, t => !t || GROCERY_STORE_TYPES.has(t)), deptObservations(receipts, dept));
  }, [src, shared, receipts, dept]);
  const data = useMemo(() => buildProduceCompare(receipts, nameOf, dept, minItems, obs), [receipts, nameOf, dept, minItems, obs]);
  const [tab, setTab] = useState<Tab>('items');
  const [storeBy, setStoreBy] = useState<'price' | 'score'>('price');
  const [itemBy, setItemBy] = useState<'n' | 'spread' | 'recent' | 'az'>('n');
  const [quality, setQuality] = useState<Record<string, Q>>({});
  const [qErr, setQErr] = useState<string>('');   // por que a nota não carregou (aparece na tela em vez de sumir em silêncio)

  // nota de qualidade por mercado: média das notas dos itens, ponderada pelos votos (administrador)
  useEffect(() => {
    if (!isAdmin) return;
    if (!cloud.cloudAvailable()) { setQErr('sem conexão com a nuvem — entre na conta (Ajustes › Conta)'); return; }
    let alive = true;
    data.stores.filter(s => s.cnpj).forEach(s => {
      cloud.produceQualityAdminByStore(s.cnpj).then(rows => {
        if (!alive) return;
        const n = rows.reduce((a, r) => a + r.n, 0);
        const score = n ? Math.round((rows.reduce((a, r) => a + r.avg_score * r.n, 0) / n) * 10) / 10 : null;
        const last = rows.map(r => r.last_rated_at).sort().pop() || null;
        setQuality(q => ({ ...q, [s.id]: { score, n, last } }));
      }).catch((e: any) => { if (alive) setQErr(String(e?.message || e || 'erro')); });
    });
    return () => { alive = false; };
  }, [isAdmin, data.stores.map(s => s.cnpj).join(',')]);

  const stores = useMemo(() => {
    const l = [...data.stores];
    if (storeBy === 'score') l.sort((a, b) => (quality[b.id]?.score ?? -1) - (quality[a.id]?.score ?? -1) || (quality[b.id]?.n ?? 0) - (quality[a.id]?.n ?? 0));
    return l;
  }, [data.stores, storeBy, quality]);
  // só valem para comparar as leituras recentes: o preço de uma loja lido há muito tempo sai da disputa (promoção antiga, preço mudou)
  const [win, setWin] = useState<number>(() => { try { const v = Number(localStorage.getItem('eukasconta_compare_window')); return [7, 15, 30, 90, 9999].includes(v) ? v : 30; } catch { return 30; } });
  const pickWin = (v: number) => { setWin(v); try { localStorage.setItem('eukasconta_compare_window', String(v)); } catch { /* sem armazenamento: vale só nesta tela */ } };
  // Qualidade por loja em cada item (só Hortifruti). Administrador vê sempre; os demais ligam no botão, porque cada consulta gasta o "tanque".
  const hf = dept === 'HORTIFRUTI';
  const [showQ, setShowQ] = useState<boolean | null>(() => { try { const v = localStorage.getItem('eukasconta_compare_quality'); return v === null ? null : v === '1'; } catch { return null; } });
  const qOn = hf && (showQ === null ? isAdmin : showQ);
  const pickQ = (v: boolean) => { setShowQ(v); try { localStorage.setItem('eukasconta_compare_quality', v ? '1' : '0'); } catch { /* vale só nesta tela */ } };
  const [itemQ, setItemQ] = useState<Record<string, Record<string, Q>>>({});
  // tamanho/peso de cada produto com EAN (catálogo); o que o catálogo não tem, lê da descrição
  const [eanSize, setEanSize] = useState<Record<string, string>>({});
  const todayIso = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, []);
  const ranked = useMemo(() => data.items.map(r => ({ r, ...rankItem(r, win, todayIso) })), [data.items, win, todayIso]);
  // nada some: itens com preço recente em 2+ lojas vêm primeiro (comparáveis); os outros ficam depois, apagados, só com os preços e a idade
  const items = useMemo(() => {
    if (itemBy === 'recent') return [...ranked].sort((a, b) => b.r.lastDate.localeCompare(a.r.lastDate) || b.r.n - a.r.n);   // o que você leu por último, comparável ou não
    if (itemBy === 'az') return [...ranked].sort((a, b) => a.r.label.localeCompare(b.r.label, 'pt-BR', { sensitivity: 'base' }));
    const ok = ranked.filter(x => x.fresh.length >= 2).sort(itemBy === 'n' ? (a, b) => b.r.n - a.r.n || b.spread - a.spread : (a, b) => b.spread - a.spread || b.r.n - a.r.n);
    const rest = ranked.filter(x => x.fresh.length < 2).sort((a, b) => b.r.n - a.r.n);
    return [...ok, ...rest];
  }, [ranked, itemBy]);
  const cnpjOf = useMemo(() => new Map(data.stores.map(st => [st.id, String(st.cnpj || '').replace(/\D/g, '')] as const)), [data.stores]);
  const comparable = useMemo(() => ranked.filter(x => x.fresh.length >= 2).length, [ranked]);
  const [limit, setLimit] = useState(30);
  useEffect(() => {
    if (!qOn || tab !== 'items') return;
    if (!cloud.cloudAvailable()) { setQErr('sem conexão com a nuvem — entre na conta (Ajustes › Conta)'); return; }
    let alive = true;
    const todo = items.slice(0, limit).map(x => x.r).filter(r => r.mids.length > 0 && !itemQ[r.item]);
    let i = 0;
    const worker = async () => {
      while (alive && i < todo.length) {
        const r = todo[i++];
        try {
          const parts = await Promise.all(r.mids.slice(0, 6).map(m => cloud.produceQualityByProduct(m)));
          const byStore: Record<string, { n: number; sum: number; w: number; last: string | null; locked: boolean }> = {};
          parts.flat().forEach(q => {
            const k = String(q.cnpj || '').replace(/\D/g, '');
            const c = byStore[k] || (byStore[k] = { n: 0, sum: 0, w: 0, last: null, locked: false });
            c.n += q.n; if (q.avg_score !== null) { c.sum += q.avg_score * q.n; c.w += q.n; } else if (q.locked) c.locked = true;
            if (q.last_rated_at && (!c.last || q.last_rated_at > c.last)) c.last = q.last_rated_at;
          });
          const out: Record<string, Q> = {};
          Object.entries(byStore).forEach(([k, c]) => { out[k] = { score: c.w ? Math.round((c.sum / c.w) * 10) / 10 : null, n: c.n, last: c.last }; });
          if (alive) setItemQ(prev => ({ ...prev, [r.item]: out }));
        } catch (e: any) { if (alive) { setQErr(String(e?.message || e || 'erro')); setItemQ(prev => ({ ...prev, [r.item]: {} })); } }
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => { alive = false; };
  }, [qOn, tab, items, limit]);
  useEffect(() => {
    if (tab !== 'items' || !cloud.cloudAvailable()) return;
    const eans = items.slice(0, limit).map(x => x.r.ean).filter(e => e && eanSize[e] === undefined);
    if (!eans.length) return;
    let alive = true;
    fetchEanSizes(eans).then(m => { if (alive) setEanSize(p => ({ ...p, ...m })); }).catch(() => { /* fica só com a descrição */ });
    return () => { alive = false; };
  }, [tab, items, limit]);
  // níveis de visualização: cartão inteiro › lista de itens › lojas de cada item
  const openKey = `eukasconta_pc_open_${dept}`;
  const [cardOpen, setCardOpen] = useState<boolean>(() => { try { return localStorage.getItem(openKey) !== '0'; } catch { return true; } });
  const toggleCard = () => setCardOpen(o => { try { localStorage.setItem(openKey, o ? '0' : '1'); } catch { /* vale só nesta tela */ } return !o; });
  const [level, setLevel] = useState<'stores' | 'items'>(() => { try { return localStorage.getItem('eukasconta_pc_level') === 'stores' ? 'stores' : 'items'; } catch { return 'items'; } });
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});
  const pickLevel = (v: 'stores' | 'items') => { setLevel(v); setOpenItems({}); try { localStorage.setItem('eukasconta_pc_level', v); } catch { /* vale só nesta tela */ } };
  // índice por letra (à direita): tocar numa letra põe a lista em ordem alfabética e rola até ela
  const letterOf = (label: string) => { const c = String(label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().charAt(0).toUpperCase(); return c >= 'A' && c <= 'Z' ? c : '#'; };
  const letters = useMemo(() => Array.from(new Set<string>(ranked.map(x => letterOf(x.r.label)))).sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b))), [ranked]);
  const [goLetter, setGoLetter] = useState<{ l: string; k: number } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastLetter = useRef('');
  const [bubble, setBubble] = useState<string | null>(null);   // letra grande no meio da tela enquanto o dedo passa pela barra
  const bubbleT = useRef<any>(null);
  const showBubble = (l: string, hold = 0) => { clearTimeout(bubbleT.current); setBubble(l); if (hold) bubbleT.current = setTimeout(() => setBubble(null), hold); };
  const jump = (l: string) => {
    if (!l || l === lastLetter.current) return;
    lastLetter.current = l;
    try { navigator.vibrate?.(9); } catch { /* sem vibração neste aparelho */ }   // toque leve a cada letra nova
    const az = [...ranked].sort((a, b) => a.r.label.localeCompare(b.r.label, 'pt-BR', { sensitivity: 'base' }));
    const idx = az.findIndex(x => letterOf(x.r.label) === l);
    if (idx < 0) return;
    setItemBy('az'); setLimit(n => Math.max(n, idx + 15)); setGoLetter({ l, k: Date.now() });
  };
  useEffect(() => {
    if (!goLetter) return;
    const el = listRef.current?.querySelector(`[data-letter="${goLetter.l}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [goLetter]);
  const railTouch = (e: React.TouchEvent) => { const t = e.touches[0]; const el = t && document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null; const l = el?.getAttribute?.('data-rail'); if (l) { showBubble(l); jump(l); } };
  const [openStores, setOpenStores] = useState<Record<string, boolean>>({});
  // trocou de categoria pela roleta: recomeça a lista (o cartão não é mais recriado, para a roleta não perder a posição)
  const firstDept = useRef(true);
  useEffect(() => { if (firstDept.current) { firstDept.current = false; return; } setOpenItems({}); setLimit(30); setGoLetter(null); setOpenStores({}); setTab(t => (t === 'stores' && storeBy === 'score' && !isAdmin ? 'items' : t)); }, [dept]);
  // segunda roleta: o modo de ver (junta as abas Item a item / Lojas / Dia da semana com a ordem de cada uma)
  const modeOptions = useMemo<WheelOption[]>(() => [
    { key: 'n', label: 'Mais comprados' }, { key: 'spread', label: 'Maior diferença' }, { key: 'recent', label: 'Recentes' }, { key: 'az', label: 'Item A–Z' },
    { key: 'stores:price', label: 'Lojas · Preço' }, ...(isAdmin ? [{ key: 'stores:score', label: 'Lojas · Nota' }] : []), { key: 'days', label: 'Dia da semana' },
  ], [isAdmin]);
  const modeValue = tab === 'days' ? 'days' : tab === 'stores' ? (storeBy === 'score' && isAdmin ? 'stores:score' : 'stores:price') : itemBy;
  const pickMode = (k: string) => {
    if (k === 'days') setTab('days');
    else if (k.startsWith('stores:')) { setTab('stores'); setStoreBy(k === 'stores:score' ? 'score' : 'price'); }
    else { setTab('items'); setItemBy(k as 'n' | 'spread' | 'recent' | 'az'); setLimit(30); }
  };
  const dayAge = (iso: string) => Math.max(0, Math.round((Date.parse(todayIso) - Date.parse(iso)) / 864e5));
  // todos os itens comprados numa loja: último preço lido, quando, e se é o mais barato entre as lojas que têm o item
  const itemsOfStore = (id: string) => data.items
    .map(r => { const c = r.cells.find(x => x.id === id); return c ? { r, c } : null; })
    .filter((x): x is { r: typeof data.items[number]; c: typeof data.items[number]['cells'][number] } => !!x)
    .sort((a, b) => a.r.label.localeCompare(b.r.label, 'pt-BR', { sensitivity: 'base' }));
  const ageTxt = (d: number) => (d === 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`);

  if (data.nObs === 0 && !catWheel) return null;
  // com a roleta de categoria, uma categoria sem leituras não pode sumir com o cartão (a roleta ficaria presa dentro dele)
  if (data.nObs === 0 && catWheel) return (
    <div className="bg-ek-card border border-luxury-gold/30 rounded-2xl md:rounded-[2rem] p-3 md:p-6 shadow-xl" data-testid="produce-compare" data-open="true">
      <div className="flex items-center gap-3">
        <span className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-luxury-gold/15 border border-luxury-gold/40">{React.createElement(catIconOf(label), { className: 'w-5 h-5 text-luxury-gold' })}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold tracking-[0.14em] text-luxury-gold">COTAÇÃO ENTRE LOJAS</span>
          <span className="block text-lg font-bold text-zinc-100 leading-tight truncate">{label}</span>
        </span>
      </div>
      <div className="grid gap-2 mt-3" style={{ gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)' }} data-testid="pc-wheels">
        <WheelPicker title="CATEGORIA" ariaLabel="Categoria" options={catWheel.options} value={catWheel.value} onChange={catWheel.onChange} testId="pc-wheel-cat" />
        <WheelPicker title="VER POR" ariaLabel="Modo de ver" options={modeOptions} value={modeValue} onChange={pickMode} testId="pc-wheel-mode" />
      </div>
      <p className="py-6 text-center text-[13px] text-zinc-500" data-testid="pc-empty">Ainda não há preços desta categoria comprados em duas lojas diferentes.</p>
    </div>
  );
  const Pill: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode; tid?: string }> = ({ on, onClick, children, tid }) => (
    <button type="button" onClick={onClick} aria-pressed={on} data-testid={tid}
      className={`h-8 px-3 rounded-full text-xs font-semibold border whitespace-nowrap transition-colors ${on ? 'bg-luxury-gold/15 border-luxury-gold/40 text-luxury-gold' : 'border-white/10 text-zinc-500 hover:text-zinc-300'}`}>{children}</button>
  );

  return (
    <div className="bg-ek-card border border-luxury-gold/30 rounded-2xl md:rounded-[2rem] p-3 md:p-6 shadow-xl" data-testid="produce-compare" data-open={cardOpen ? 'true' : 'false'}>
      <div className={catWheel ? 'sticky top-0 z-[39] bg-ek-card -mx-3 px-3 md:-mx-6 md:px-6 pt-1 pb-2' : ''} data-testid={catWheel ? 'pc-sticky' : undefined}>
      <button type="button" onClick={toggleCard} aria-expanded={cardOpen} data-testid="pc-toggle" className="w-full flex items-center gap-3 text-left">
        <span className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-luxury-gold/15 border border-luxury-gold/40">{React.createElement(catIconOf(label), { className: 'w-5 h-5 text-luxury-gold' })}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold tracking-[0.14em] text-luxury-gold">COTAÇÃO ENTRE LOJAS</span>
          <span className="block text-lg font-bold text-zinc-100 leading-tight truncate">{label}</span>
          <span className="block text-[11px] text-zinc-500 truncate">{data.nItems} itens · {data.stores.length} lojas · leituras de {short(data.firstDate)} a {short(data.lastDate)}</span>
        </span>
        <span className="shrink-0 w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-zinc-400">{cardOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</span>
      </button>
      {cardOpen && catWheel && (
        <div className="grid gap-2 mt-3" style={{ gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)' }} data-testid="pc-wheels">
          <WheelPicker title="CATEGORIA" ariaLabel="Categoria" options={catWheel.options} value={catWheel.value} onChange={catWheel.onChange} testId="pc-wheel-cat" />
          <WheelPicker title="VER POR" ariaLabel="Modo de ver" options={modeOptions} value={modeValue} onChange={pickMode} testId="pc-wheel-mode" />
        </div>
      )}
      </div>
      {cardOpen && <>
      <div className="flex items-center gap-1.5 mt-1.5 overflow-x-auto no-scrollbar" data-testid="pc-source">
        <span className="text-[11px] text-zinc-500 whitespace-nowrap">{src === 'shared' ? 'Todos os usuários · raio' : src === 'loading' ? 'Buscando dados de todos os usuários…' : 'Só as suas compras (sem conexão, login ou posição)'}</span>
        {src === 'shared' && [10, 30, 60].map(v => (
          <button key={v} type="button" onClick={() => pickKm(v)} aria-pressed={km === v} data-testid={`pc-km-${v}`}
            className={`h-7 px-2.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${km === v ? 'bg-luxury-gold/15 border-luxury-gold/40 text-luxury-gold' : 'border-white/10 text-zinc-500'}`}>{v} km</button>
        ))}
      </div>
      {hf && qErr && <p className="text-[10px] text-red-400 px-0.5 mt-1" data-testid="pc-qerr">Notas não carregaram: {qErr}</p>}

      {!catWheel && <div className="flex gap-1.5 mt-3 overflow-x-auto no-scrollbar">
        <Pill on={tab === 'items'} onClick={() => setTab('items')} tid="pc-tab-items">Item a item</Pill>
        <Pill on={tab === 'stores'} onClick={() => setTab('stores')} tid="pc-tab-stores">Lojas</Pill>
        <Pill on={tab === 'days'} onClick={() => setTab('days')} tid="pc-tab-days">Dia da semana</Pill>
      </div>}

      {tab === 'stores' && (
        <div className="mt-3">
          {!catWheel && <div className="flex gap-1.5 mb-1">
            <Pill on={storeBy === 'price'} onClick={() => setStoreBy('price')}>Preço</Pill>
            {isAdmin && <Pill on={storeBy === 'score'} onClick={() => setStoreBy('score')}>Nota</Pill>}
          </div>}
          <div className="divide-y divide-white/5">
            {stores.map(s => {
              const q = quality[s.id];
              return (
                <div key={s.id} data-testid="pc-store-row">
                  <button type="button" onClick={() => setOpenStores(o => ({ ...o, [s.id]: !o[s.id] }))} aria-expanded={!!openStores[s.id]} data-testid="pc-store-toggle"
                    className="w-full flex items-center justify-between gap-3 py-2.5 text-left">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-200 truncate">{s.name}</p>
                      <p className="text-[10px] text-zinc-500 font-mono">{s.days} {s.days === 1 ? 'dia' : 'dias'} de compra · {s.items} {s.items === 1 ? 'item' : 'itens'} em comum</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right leading-tight">

                        {s.index !== null
                          ? <span className="block text-sm font-bold font-mono" style={{ color: idxColor(s.index) }}>{pctTxt(s.index)}</span>
                          : <span className="block text-[11px] text-zinc-500">poucos itens p/ comparar</span>}
                        {q && q.n > 0 && (q.score !== null
                          ? <span className="block text-[11px] font-mono" style={{ color: scoreColor(q.score) }}><QualityFace score={q.score} size={14} /> {q.score.toFixed(1).replace('.', ',')} <span className="text-zinc-500">· {q.n} {q.n === 1 ? 'voto' : 'votos'}{q.n < 5 ? ' (poucos)' : ''}{q.last ? ` · ${short(q.last.slice(0, 10))}` : ''}</span></span>
                          : <span className="block text-[10px] font-mono text-zinc-500">{q.n} {q.n === 1 ? 'voto' : 'votos'} (poucos)</span>)}
                      </div>
                      <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${openStores[s.id] ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                  {openStores[s.id] && (() => {
                    const list = itemsOfStore(s.id);
                    return (
                      <div className="mb-2 rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-1" data-testid="pc-store-items">
                        <p className="py-1.5 text-[11px] font-semibold text-zinc-400">{list.length} {list.length === 1 ? 'item comprado' : 'itens comprados'} aqui</p>
                        <div className="divide-y divide-white/5">
                          {list.map(({ r, c }) => {
                            const best = r.stores > 1 && r.cheap.id === s.id;
                            const worst = r.stores > 1 && r.dear.id === s.id;
                            const color = best ? '#34d399' : worst ? '#f87171' : undefined;
                            return (
                              <div key={r.item} className="flex items-center justify-between gap-3 py-1.5">
                                <div className="min-w-0">
                                  <p className="text-[12px] font-semibold text-zinc-200 leading-snug line-clamp-2">{r.label}</p>
                                  <p className="text-[10px] text-zinc-500">{c.n} {c.n === 1 ? 'compra' : 'compras'} · {ageTxt(dayAge(c.date))}{r.stores > 1 ? ` · ${r.stores} lojas` : ' · só aqui'}</p>
                                </div>
                                <div className="text-right leading-tight shrink-0">
                                  <p className="text-[13px] font-bold tabular-nums whitespace-nowrap" style={{ color }}>R$ {money(c.last)}<span className="text-[10px] font-normal text-zinc-500"> / {unitLabel(r.unit)}</span></p>
                                  {(best || worst) && <p className="text-[10px] font-semibold" style={{ color }}>{best ? 'mais barato' : 'mais caro'}</p>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-zinc-500 mt-2">Preço = quanto a loja fica acima (+) ou abaixo (−) da média das lojas nos itens que você comprou em mais de uma (mínimo {minItems} {minItems === 1 ? 'item' : 'itens'}).{dept === 'HORTIFRUTI' && !isAdmin && ' Nota de qualidade por mercado: em breve para todos.'}</p>
        </div>
      )}

      {tab === 'items' && (
        <div className="mt-3">
          {!catWheel && <div className="flex flex-wrap gap-1.5 mb-1">
            <Pill on={itemBy === 'n'} onClick={() => { setItemBy('n'); setLimit(30); }}>Mais comprados</Pill>
            <Pill on={itemBy === 'spread'} onClick={() => { setItemBy('spread'); setLimit(30); }}>Maior diferença</Pill>
            <Pill on={itemBy === 'recent'} onClick={() => { setItemBy('recent'); setLimit(30); }} tid="pc-sort-recent">Recentes</Pill>
            <Pill on={itemBy === 'az'} onClick={() => { setItemBy('az'); setLimit(30); }} tid="pc-sort-az">A–Z</Pill>
          </div>}
          <div className="flex items-center gap-1.5 mb-1" role="group" aria-label="Nível de detalhe">
            <span className="text-[11px] text-zinc-500 whitespace-nowrap">Mostrar</span>
            <Pill on={level === 'items'} onClick={() => pickLevel('items')} tid="pc-level-items">Só itens</Pill>
            <Pill on={level === 'stores'} onClick={() => pickLevel('stores')} tid="pc-level-stores">Itens e lojas</Pill>
          </div>
          <div className="flex items-center gap-1.5 mb-1 overflow-x-auto no-scrollbar" role="group" aria-label="Preços lidos até">
            <span className="text-[11px] text-zinc-500 whitespace-nowrap">Preço lido até</span>
            {([[7, '7 dias'], [15, '15 dias'], [30, '30 dias'], [90, '90 dias'], [9999, 'Tudo']] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => pickWin(v)} aria-pressed={win === v} data-testid={`pc-win-${v}`}
                className={`h-7 px-2.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${win === v ? 'bg-luxury-gold/15 border-luxury-gold/40 text-luxury-gold' : 'border-white/10 text-zinc-500'}`}>{l}</button>
            ))}
          </div>
          {hf && !isAdmin && (
            <div className="flex items-center gap-1.5 mb-1">
              <button type="button" onClick={() => pickQ(!qOn)} aria-pressed={qOn} data-testid="pc-quality-toggle"
                className={`h-7 px-2.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${qOn ? 'bg-luxury-gold/15 border-luxury-gold/40 text-luxury-gold' : 'border-white/10 text-zinc-500'}`}>★ Qualidade por loja</button>
              {qOn && <span className="text-[10px] text-zinc-500">cada consulta usa o seu tanque</span>}
            </div>
          )}
          {items.length === 0 ? <p className="py-6 text-center text-[13px] text-zinc-500">{dept === 'HORTIFRUTI' || dept === 'TRANSPORTE' ? 'Ainda não há item comprado em duas lojas diferentes.' : 'Ainda não há produto com código de barras (EAN) comprado em duas lojas diferentes.'}</p> : (
            <div className="flex items-start gap-1.5 mt-2" ref={listRef}>
            <div className={`min-w-0 flex-1 ${level === 'items' ? 'space-y-1' : 'space-y-4'}`}>
              {items.slice(0, limit).map(({ r, fresh, stale, spread }, idx, arr) => {
                const L = letterOf(r.label);
                const firstOfLetter = itemBy === 'az' && (idx === 0 || letterOf(arr[idx - 1].r.label) !== L);
                const open = openItems[r.item] ?? (level === 'stores');
                const cheapest = [...fresh, ...stale].sort((a, b) => (fresh.includes(a) ? 0 : 1) - (fresh.includes(b) ? 0 : 1) || a.last - b.last)[0];
                const cmp = fresh.length >= 2;
                const lines = cmp ? fresh.slice(0, MAX_STORES_PER_ITEM) : [...fresh, ...stale].sort((a, b) => a.age - b.age).slice(0, MAX_STORES_PER_ITEM);
                const cut = cmp && fresh.length > lines.length;
                const qMap = qOn && r.mids.length > 0 ? itemQ[r.item] : undefined;
                const loadingQ = qOn && r.mids.length > 0 && !itemQ[r.item];
                const hasQ = !!qMap && lines.some(m => { const q = qMap[cnpjOf.get(m.id) || '']; return q && q.score !== null; });
                const showQ = hasQ || loadingQ;   // sem nenhuma nota no item, a coluna nem aparece
                const cols = showQ ? 'minmax(0,1fr) auto 92px' : 'minmax(0,1fr) auto';
                const sizeTxt = (r.ean && eanSize[r.ean]) || sizeFromText(r.label);
                return (
                  <div key={r.item} className={cmp ? '' : 'opacity-60'} data-testid="pc-item-row" data-letter={firstOfLetter ? L : undefined} style={{ scrollMarginTop: 190 }}>
                    {firstOfLetter && <p className="text-[11px] font-bold text-luxury-gold px-0.5 pt-1 pb-0.5 border-b border-luxury-gold/20 mb-1.5">{L}</p>}
                    <button type="button" onClick={() => setOpenItems(o => ({ ...o, [r.item]: !open }))} aria-expanded={open} data-testid="pc-item-toggle" className="w-full flex items-center justify-between gap-2 px-0.5 text-left min-h-[36px]">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-zinc-100 leading-snug line-clamp-2">{r.label}{sizeTxt && !r.label.toLowerCase().includes(sizeTxt.toLowerCase()) && <span className="text-luxury-gold"> · {sizeTxt}</span>}</p>
                        <p className="text-[10px] text-zinc-500 tabular-nums">
                          {cmp ? <span className="font-semibold text-zinc-400">dif. {pctTxt(spread)}</span> : <span>{r.cells.length === 1 ? 'só 1 loja' : 'sem comparação atual'}</span>}
                          {r.ean && <span className="font-mono"> · EAN {r.ean}</span>}
                        </p>
                      </div>
                      {!open && cheapest && <span className="shrink-0 text-right leading-tight"><span className="block text-[12px] font-bold tabular-nums" style={{ color: cmp ? '#34d399' : undefined }}>R$ {money(cheapest.last)}</span><span className="block text-[10px] text-zinc-500 max-w-[110px] truncate">{cheapest.name}</span></span>}
                      {open ? <ChevronUp className="shrink-0 w-4 h-4 text-zinc-500" /> : <ChevronDown className="shrink-0 w-4 h-4 text-zinc-500" />}
                    </button>
                    {open && <div className="mt-1.5 rounded-xl border border-white/5 bg-white/[0.02] px-2.5">
                      <div className="grid gap-x-3 pt-1.5 pb-0.5 text-[10px] font-bold tracking-[0.1em] text-zinc-500" style={{ gridTemplateColumns: cols }}>
                        <span>LOJA</span><span className="text-right">PREÇO / {unitLabel(r.unit).toUpperCase()}</span>{showQ && <span className="text-right">QUALIDADE</span>}
                      </div>
                      <div className="divide-y divide-white/5">
                        {lines.map((m, i) => {
                          const first = cmp && i === 0;
                          const lastRow = cmp && i === fresh.length - 1;
                          const qd = qMap ? qMap[cnpjOf.get(m.id) || ''] : undefined;
                          const priceColor = first ? '#34d399' : lastRow ? '#f87171' : undefined;
                          return (
                            <div key={m.id} className="grid items-center gap-x-3 py-1.5" style={{ gridTemplateColumns: cols }}>
                              <div className="min-w-0">
                                <p className="text-[12px] font-semibold text-zinc-200 leading-snug line-clamp-2">{cmp ? `${i + 1}º ` : ''}{m.name}</p>
                                <p className="text-[10px] text-zinc-500">{ageTxt(m.age)}</p>
                              </div>
                              <div className="text-right leading-tight">
                                <p className="text-[13px] font-bold tabular-nums whitespace-nowrap" style={{ color: priceColor }}>R$ {money(m.last)}</p>
                                {(first || lastRow) && <p className="text-[10px] font-semibold" style={{ color: priceColor }}>{first ? 'mais barato' : 'mais caro'}</p>}
                              </div>
                              {showQ && (
                                <div className="text-right leading-tight" data-testid="pc-item-quality">
                                  {loadingQ ? <span className="text-[11px] text-zinc-600">…</span>
                                    : qd && qd.score !== null ? (
                                      <>
                                        <p className="whitespace-nowrap"><QualityFace score={qd.score} size={18} /> <span className="text-[12px] font-bold tabular-nums align-middle" style={{ color: scoreColor(qd.score) }}>{qd.score.toFixed(1).replace('.', ',')}</span></p>
                                        <p className="text-[10px] text-zinc-500 whitespace-nowrap">{qd.n} {qd.n === 1 ? 'voto' : 'votos'}{qd.n < 5 ? ' · poucos' : ''}{qd.last ? ` · ${short(qd.last.slice(0, 10))}` : ''}</p>
                                      </>
                                    ) : null}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {cut && <p className="text-[10px] text-zinc-500 py-1.5 border-t border-white/5">+ {fresh.length - lines.length} {fresh.length - lines.length === 1 ? 'loja' : 'lojas'} mais caras (a mais cara: <span style={{ color: '#f87171' }}>{fresh[fresh.length - 1].name} R$ {money(fresh[fresh.length - 1].last)}</span>)</p>}
                      {cmp && stale.slice(0, 2).map(m => (
                        <p key={m.id} className="text-[10px] flex justify-between gap-2 text-zinc-500 opacity-60 py-1 border-t border-white/5">
                          <span className="truncate">fora do prazo · {m.name}</span>
                          <span className="whitespace-nowrap tabular-nums">R$ {money(m.last)} · {ageTxt(m.age)}</span>
                        </p>
                      ))}
                    </div>}
                  </div>
                );
              })}
            </div>
            {bubble && createPortal(
              <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] pointer-events-none w-24 h-24 rounded-[2rem] flex items-center justify-center text-5xl font-bold text-luxury-gold border border-luxury-gold/40 shadow-2xl" style={{ background: 'var(--ek-tab)' }} data-testid="pc-letter-bubble">{bubble}</div>, document.body
            )}
            {letters.length > 1 && (
              <div className="shrink-0 sticky top-[190px] self-start flex flex-col items-center rounded-full border border-white/10 bg-white/[0.03] py-1 select-none" style={{ touchAction: 'none' }} data-testid="pc-letters" aria-label="Ir para a letra"
                onTouchStart={railTouch} onTouchMove={railTouch} onTouchEnd={() => { lastLetter.current = ''; showBubble(bubble || '', 350); }} onTouchCancel={() => { lastLetter.current = ''; setBubble(null); }}>
                {letters.map(l => (
                  <button key={l} type="button" data-rail={l} onClick={() => { lastLetter.current = ''; showBubble(l, 600); jump(l); lastLetter.current = ''; }} aria-label={`Letra ${l}`}
                    className={`w-6 h-[19px] text-[10px] font-bold leading-none ${goLetter?.l === l && itemBy === 'az' ? 'text-luxury-gold' : 'text-zinc-500'}`}>{l}</button>
                ))}
              </div>
            )}
            </div>
          )}
          {items.length > limit && <button type="button" onClick={() => setLimit(l => l + 30)} className="mt-2 w-full h-9 rounded-lg border border-white/10 text-xs font-semibold text-zinc-400" data-testid="pc-more">Mostrar mais ({items.length - limit})</button>}
          {items.length > 0 && <p className="text-[10px] text-zinc-500 mt-2">{comparable} {comparable === 1 ? 'item comparável' : 'itens comparáveis'} (preço lido nos últimos {win >= 9999 ? 'tempo todo' : `${win} dias`} em 2+ lojas). Os demais (uma loja só ou sem leitura recente) aparecem apagados, ao final; em “Recentes” vêm na ordem em que você leu.</p>}
          <p className="text-[10px] text-zinc-500 mt-2">O preço de cada loja é o último que você pagou, com a idade da leitura. Lojas lidas antes do prazo escolhido saem da disputa (não são o 1º nem o último) e aparecem apagadas.</p>
        </div>
      )}

      {tab === 'days' && (
        <div className="mt-3 space-y-3">
          {[{ id: 'all', name: 'Todas as lojas', cells: data.overall, best: null as any, worst: null as any, obs: 0 }, ...data.weekdays].map(w => {
            const ok = w.cells.filter(c => c.n >= MIN_DAY_OBS);
            const sorted = [...ok].sort((a, b) => a.index - b.index);
            const best = sorted.length >= 2 ? sorted[0] : null; const worst = sorted.length >= 2 ? sorted[sorted.length - 1] : null;
            return (
              <div key={w.id} className="rounded-xl border border-white/5 bg-white/[0.03] p-2.5" data-testid="pc-days-row">
                <p className="text-sm font-semibold text-zinc-200 truncate">{w.name}</p>
                <p className="text-[11px] mt-0.5 text-zinc-500">
                  {best && worst ? <><span style={{ color: '#34d399' }}>mais barato: {WD[best.wd]} ({pctTxt(best.index)})</span> · <span style={{ color: '#f87171' }}>mais caro: {WD[worst.wd]} ({pctTxt(worst.index)})</span></> : 'ainda poucos dados para apontar um dia'}
                </p>
                <div className="grid grid-cols-7 gap-1 mt-2">
                  {WD.map((label, i) => {
                    const c = w.cells.find(x => x.wd === i);
                    const solid = !!c && c.n >= MIN_DAY_OBS;
                    return (
                      <div key={label} className="rounded-md py-1 text-center border border-white/5" style={{ opacity: c ? (solid ? 1 : 0.5) : 0.25 }}>
                        <p className="text-[10px] text-zinc-500">{label}</p>
                        <p className="text-[11px] font-mono font-bold" style={{ color: c ? idxColor(c.index) : '#71717a' }}>{c ? pctTxt(c.index) : '–'}</p>
                        <p className="text-[10px] text-zinc-500">{c ? `${c.n}x` : ''}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <p className="text-[10px] text-zinc-500">Cada dia compara o preço pago com a média do mesmo item no mesmo mercado (−% = mais barato que o normal). Dias com menos de {MIN_DAY_OBS} compras ficam apagados e não entram na conclusão.</p>
        </div>
      )}
      </>}
    </div>
  );
};

export default ProduceCompareCard;
