import React, { useEffect, useMemo, useState } from 'react';
import { Receipt } from '../types';
import * as cloud from '../services/cloudService';
import { useMasterInfo } from './MasterContext';
import { buildProduceCompare, mergeObs, rankItem, WD, MIN_ITEMS_RANK, MIN_DAY_OBS, MAX_STORES_PER_ITEM } from '../services/produceCompare';
import { unitLabel } from '../services/productPriceStats';
import { QualityFace } from './QualityFace';
import { deptObservations, sharedObservations } from '../services/quotes';
import { GROCERY_STORE_TYPES } from '../services/storeTypes';

/* Hortifruti em Análises › Panorama: compara os mercados onde a pessoa compra (preço, nota de qualidade, dia da semana).
   Preço e dia da semana saem dos cupons dela (todo o histórico). A nota de qualidade vem do banco e, por ora, só para o administrador. */

const money = (v: number) => v.toFixed(2).replace('.', ',');
const pctTxt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0).replace('.', ',')}%`;
const idxColor = (v: number) => (v <= -0.02 ? '#34d399' : v >= 0.02 ? '#f87171' : '#a1a1aa');
const scoreColor = (s: number) => (s >= 7 ? '#34d399' : s >= 4 ? '#DDB94B' : '#f87171');
const short = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

let sharedCache: { key: string; at: number; rows: cloud.SharedRow[] } | null = null;
type Tab = 'stores' | 'items' | 'days';
type Q = { score: number | null; n: number; last: string | null };

const ProduceCompareCard: React.FC<{ receipts: Receipt[]; nameOf: (name: string, cnpj: string) => string; dept?: string; label?: string; minItems?: number; center?: { lat: number; lng: number } | null }> = ({ receipts, nameOf, dept = 'HORTIFRUTI', label = 'Hortifruti', minItems = MIN_ITEMS_RANK, center = null }) => {
  const { isAdmin: admin } = useMasterInfo();
  const isAdmin = admin && dept === 'HORTIFRUTI';   // a nota de qualidade só existe para hortifruti
  // Fonte: leituras de TODOS os usuários num raio (anônimas), somadas às suas compras. Sem login, sem conexão ou sem posição: só as suas.
  const [km, setKm] = useState<number>(() => { try { const v = Number(localStorage.getItem('eukasconta_compare_km')); return [10, 30, 60].includes(v) ? v : 30; } catch { return 30; } });
  const pickKm = (v: number) => { setKm(v); try { localStorage.setItem('eukasconta_compare_km', String(v)); } catch { /* vale só nesta tela */ } };
  const [shared, setShared] = useState<cloud.SharedRow[] | null>(null);
  const [src, setSrc] = useState<'loading' | 'shared' | 'local'>('loading');
  const cKey = center ? `${center.lat.toFixed(3)},${center.lng.toFixed(3)}` : '';
  useEffect(() => {
    if (!cloud.cloudAvailable()) { setSrc('local'); return; }
    let alive = true;
    (async () => {
      setSrc('loading');
      let c = center;
      try {   // se o app já tem permissão de localização, usa a posição atual; senão, o centro das lojas que você mais frequenta
        const perm = await (navigator as any).permissions?.query({ name: 'geolocation' });
        if (perm?.state === 'granted') c = await cloud.getCurrentPosition();
      } catch { /* fica com o centro das lojas */ }
      if (!c) { if (alive) setSrc('local'); return; }
      const key = `${km}|${c.lat.toFixed(2)},${c.lng.toFixed(2)}`;
      if (sharedCache && sharedCache.key === key && Date.now() - sharedCache.at < 5 * 60000) { if (alive) { setShared(sharedCache.rows); setSrc('shared'); } return; }
      const rows = await cloud.sharedObservations(c, km, 400);
      sharedCache = { key, at: Date.now(), rows };
      if (alive) { setShared(rows); setSrc('shared'); }
    })().catch(() => { if (alive) setSrc('local'); });
    return () => { alive = false; };
  }, [km, cKey]);
  const obs = useMemo(() => {
    if (src !== 'shared' || !shared) return undefined;
    return mergeObs(sharedObservations(shared, dept, t => !t || GROCERY_STORE_TYPES.has(t)), deptObservations(receipts, dept));
  }, [src, shared, receipts, dept]);
  const data = useMemo(() => buildProduceCompare(receipts, nameOf, dept, minItems, obs), [receipts, nameOf, dept, minItems, obs]);
  const [tab, setTab] = useState<Tab>('items');
  const [storeBy, setStoreBy] = useState<'price' | 'score'>('price');
  const [itemBy, setItemBy] = useState<'n' | 'spread' | 'recent'>('n');
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
  const todayIso = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, []);
  const ranked = useMemo(() => data.items.map(r => ({ r, ...rankItem(r, win, todayIso) })), [data.items, win, todayIso]);
  // nada some: itens com preço recente em 2+ lojas vêm primeiro (comparáveis); os outros ficam depois, apagados, só com os preços e a idade
  const items = useMemo(() => {
    if (itemBy === 'recent') return [...ranked].sort((a, b) => b.r.lastDate.localeCompare(a.r.lastDate) || b.r.n - a.r.n);   // o que você leu por último, comparável ou não
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
  const ageTxt = (d: number) => (d === 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`);

  if (data.nObs === 0) return null;
  const rankedStores = data.stores.filter(s => s.index !== null);
  const bestPrice = rankedStores[0];
  const scored = (Object.entries(quality) as [string, Q][]).filter(([, q]) => q.score !== null && q.n >= 1).sort((a, b) => (b[1].score as number) - (a[1].score as number));
  const bestScore = scored[0] ? data.stores.find(s => s.id === scored[0][0]) : undefined;
  const Pill: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode; tid?: string }> = ({ on, onClick, children, tid }) => (
    <button type="button" onClick={onClick} aria-pressed={on} data-testid={tid}
      className={`h-8 px-3 rounded-full text-xs font-semibold border whitespace-nowrap transition-colors ${on ? 'bg-luxury-gold/15 border-luxury-gold/40 text-luxury-gold' : 'border-white/10 text-zinc-500 hover:text-zinc-300'}`}>{children}</button>
  );

  return (
    <div className="bg-[#121214] border border-white/5 rounded-2xl md:rounded-[1.75rem] p-3 md:p-6 shadow-xl" data-testid="produce-compare">
      <h3 className="text-[12px] font-semibold text-zinc-300 px-0.5">{label} · comparativo entre lojas</h3>
      <p className="text-[11px] text-zinc-500 px-0.5 mt-0.5">{data.nItems} itens · {data.stores.length} lojas · leituras de {short(data.firstDate)} a {short(data.lastDate)}</p>
      <div className="flex items-center gap-1.5 mt-1.5 overflow-x-auto no-scrollbar" data-testid="pc-source">
        <span className="text-[11px] text-zinc-500 whitespace-nowrap">{src === 'shared' ? 'Todos os usuários · raio' : src === 'loading' ? 'Buscando dados de todos os usuários…' : 'Só as suas compras (sem conexão, login ou posição)'}</span>
        {src === 'shared' && [10, 30, 60].map(v => (
          <button key={v} type="button" onClick={() => pickKm(v)} aria-pressed={km === v} data-testid={`pc-km-${v}`}
            className={`h-7 px-2.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${km === v ? 'bg-luxury-gold/15 border-luxury-gold/40 text-luxury-gold' : 'border-white/10 text-zinc-500'}`}>{v} km</button>
        ))}
      </div>
      {hf && qErr && <p className="text-[10px] text-red-400 px-0.5 mt-1" data-testid="pc-qerr">Notas não carregaram: {qErr}</p>}

      {(bestPrice || bestScore) && (
        <div className={`grid ${dept === 'HORTIFRUTI' ? 'grid-cols-2' : 'grid-cols-1'} gap-2 mt-3`}>
          <div className="rounded-xl border border-white/5 bg-white/[0.03] p-2.5">
            <p className="text-[10px] tracking-[0.1em] text-zinc-500 font-bold">MELHOR PREÇO</p>
            <p className="text-sm font-bold text-white truncate">{bestPrice ? bestPrice.name : '—'}</p>
            {bestPrice && <p className="text-[11px] font-mono" style={{ color: idxColor(bestPrice.index as number) }}>{pctTxt(bestPrice.index as number)} da média</p>}
          </div>
          {dept === 'HORTIFRUTI' && <div className="rounded-xl border border-white/5 bg-white/[0.03] p-2.5">
            <p className="text-[10px] tracking-[0.1em] text-zinc-500 font-bold">MELHOR NOTA</p>
            <p className="text-sm font-bold text-white truncate">{bestScore ? bestScore.name : '—'}</p>
            <p className="text-[11px] font-mono text-zinc-500">{bestScore ? <><QualityFace score={quality[bestScore.id].score as number} size={14} /> {(quality[bestScore.id].score as number).toFixed(1).replace('.', ',')} · {quality[bestScore.id].n} {quality[bestScore.id].n === 1 ? 'voto' : 'votos'}</> : isAdmin ? 'precisa de 5 votos' : 'em breve'}</p>
          </div>}
        </div>
      )}

      <div className="flex gap-1.5 mt-3 overflow-x-auto no-scrollbar">
        <Pill on={tab === 'items'} onClick={() => setTab('items')} tid="pc-tab-items">Item a item</Pill>
        <Pill on={tab === 'stores'} onClick={() => setTab('stores')} tid="pc-tab-stores">Lojas</Pill>
        <Pill on={tab === 'days'} onClick={() => setTab('days')} tid="pc-tab-days">Dia da semana</Pill>
      </div>

      {tab === 'stores' && (
        <div className="mt-3">
          <div className="flex gap-1.5 mb-1">
            <Pill on={storeBy === 'price'} onClick={() => setStoreBy('price')}>Preço</Pill>
            {isAdmin && <Pill on={storeBy === 'score'} onClick={() => setStoreBy('score')}>Nota</Pill>}
          </div>
          <div className="divide-y divide-white/5">
            {stores.map(s => {
              const q = quality[s.id];
              return (
                <div key={s.id} className="flex items-center justify-between gap-3 py-2.5" data-testid="pc-store-row">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-200 truncate">{s.name}</p>
                    <p className="text-[10px] text-zinc-500 font-mono">{s.days} {s.days === 1 ? 'dia' : 'dias'} de compra · {s.items} {s.items === 1 ? 'item' : 'itens'} em comum</p>
                  </div>
                  <div className="text-right shrink-0 leading-tight">
                    {s.index !== null
                      ? <span className="block text-sm font-bold font-mono" style={{ color: idxColor(s.index) }}>{pctTxt(s.index)}</span>
                      : <span className="block text-[11px] text-zinc-500">poucos itens p/ comparar</span>}
                    {q && q.n > 0 && (q.score !== null
                      ? <span className="block text-[11px] font-mono" style={{ color: scoreColor(q.score) }}><QualityFace score={q.score} size={14} /> {q.score.toFixed(1).replace('.', ',')} <span className="text-zinc-500">· {q.n} {q.n === 1 ? 'voto' : 'votos'}{q.n < 5 ? ' (poucos)' : ''}{q.last ? ` · ${short(q.last.slice(0, 10))}` : ''}</span></span>
                      : <span className="block text-[10px] font-mono text-zinc-500">{q.n} {q.n === 1 ? 'voto' : 'votos'} (poucos)</span>)}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-zinc-500 mt-2">Preço = quanto a loja fica acima (+) ou abaixo (−) da média das lojas nos itens que você comprou em mais de uma (mínimo {minItems} {minItems === 1 ? 'item' : 'itens'}).{dept === 'HORTIFRUTI' && !isAdmin && ' Nota de qualidade por mercado: em breve para todos.'}</p>
        </div>
      )}

      {tab === 'items' && (
        <div className="mt-3">
          <div className="flex gap-1.5 mb-1">
            <Pill on={itemBy === 'n'} onClick={() => { setItemBy('n'); setLimit(30); }}>Mais comprados</Pill>
            <Pill on={itemBy === 'spread'} onClick={() => { setItemBy('spread'); setLimit(30); }}>Maior diferença</Pill>
            <Pill on={itemBy === 'recent'} onClick={() => { setItemBy('recent'); setLimit(30); }} tid="pc-sort-recent">Recentes</Pill>
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
            <div className="space-y-4 mt-2">
              {items.slice(0, limit).map(({ r, fresh, stale, spread }) => {
                const cmp = fresh.length >= 2;
                const lines = cmp ? fresh.slice(0, MAX_STORES_PER_ITEM) : [...fresh, ...stale].sort((a, b) => a.age - b.age).slice(0, MAX_STORES_PER_ITEM);
                const cut = cmp && fresh.length > lines.length;
                const qMap = qOn && r.mids.length > 0 ? itemQ[r.item] : undefined;
                const loadingQ = qOn && r.mids.length > 0 && !itemQ[r.item];
                const hasQ = !!qMap && lines.some(m => { const q = qMap[cnpjOf.get(m.id) || '']; return q && q.score !== null; });
                const showQ = hasQ || loadingQ;   // sem nenhuma nota no item, a coluna nem aparece
                const cols = showQ ? 'minmax(0,1fr) auto 92px' : 'minmax(0,1fr) auto';
                return (
                  <div key={r.item} className={cmp ? '' : 'opacity-60'} data-testid="pc-item-row">
                    <div className="flex items-baseline justify-between gap-2 px-0.5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-100 truncate">{r.label}</p>
                        {r.ean && <p className="text-[10px] font-mono text-zinc-500">EAN {r.ean}</p>}
                      </div>
                      {cmp
                        ? <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border border-white/10 text-zinc-400 tabular-nums">dif. {pctTxt(spread)}</span>
                        : <span className="shrink-0 text-[10px] text-zinc-500">{r.cells.length === 1 ? 'só 1 loja' : 'sem comparação atual'}</span>}
                    </div>
                    <div className="mt-1.5 rounded-xl border border-white/5 bg-white/[0.02] px-2.5">
                      <div className="grid gap-x-3 pt-1.5 pb-0.5 text-[9px] font-bold tracking-[0.1em] text-zinc-500" style={{ gridTemplateColumns: cols }}>
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
                                <p className="text-[12px] font-semibold text-zinc-200 truncate">{cmp ? `${i + 1}º ` : ''}{m.name}</p>
                                <p className="text-[10px] text-zinc-500">{ageTxt(m.age)}</p>
                              </div>
                              <div className="text-right leading-tight">
                                <p className="text-[13px] font-bold tabular-nums whitespace-nowrap" style={{ color: priceColor }}>R$ {money(m.last)}</p>
                                {(first || lastRow) && <p className="text-[9px] font-semibold" style={{ color: priceColor }}>{first ? 'mais barato' : 'mais caro'}</p>}
                              </div>
                              {showQ && (
                                <div className="text-right leading-tight" data-testid="pc-item-quality">
                                  {loadingQ ? <span className="text-[11px] text-zinc-600">…</span>
                                    : qd && qd.score !== null ? (
                                      <>
                                        <p className="whitespace-nowrap"><QualityFace score={qd.score} size={18} /> <span className="text-[12px] font-bold tabular-nums align-middle" style={{ color: scoreColor(qd.score) }}>{qd.score.toFixed(1).replace('.', ',')}</span></p>
                                        <p className="text-[9px] text-zinc-500 whitespace-nowrap">{qd.n} {qd.n === 1 ? 'voto' : 'votos'}{qd.n < 5 ? ' · poucos' : ''}{qd.last ? ` · ${short(qd.last.slice(0, 10))}` : ''}</p>
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
                    </div>
                  </div>
                );
              })}
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
                        <p className="text-[9px] text-zinc-500">{label}</p>
                        <p className="text-[11px] font-mono font-bold" style={{ color: c ? idxColor(c.index) : '#71717a' }}>{c ? pctTxt(c.index) : '–'}</p>
                        <p className="text-[8px] text-zinc-500">{c ? `${c.n}x` : ''}</p>
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
    </div>
  );
};

export default ProduceCompareCard;
