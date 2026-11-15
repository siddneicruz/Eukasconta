import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp, TrendingDown, ChevronRight, Loader2 } from 'lucide-react';
import { Receipt } from '../types';
import { deptObservations, sharedObservations } from '../services/quotes';
import { mergeObs, buildProduceCompare } from '../services/produceCompare';
import { buildTicker, movers } from '../services/marketTicker';
import { loadShared } from '../services/sharedLoader';
import { GROCERY_STORE_TYPES } from '../services/storeTypes';
import { useStoreNames } from './StoreNamesContext';
import { useMasterInfo } from './MasterContext';
import * as cloud from '../services/cloudService';
import { QualityFace } from './QualityFace';

/* Cotação do mercado no Início: como numa bolsa, mostra o que subiu e o que caiu nos itens de hortifruti
   com base nas leituras de TODOS os usuários perto de você, e quanto a SUA compra ficou acima ou abaixo do mercado. */

type Tab = 'up' | 'down' | 'mine';
const money = (v: number) => v.toFixed(2).replace('.', ',');
const pctTxt = (p: number) => `${p > 0 ? '+' : ''}${Math.round(p * 100)}%`;
const unitTxt = (u: string) => (u === 'KG' ? 'kg' : u === 'L' ? 'L' : u === 'UN' ? 'un' : u.toLowerCase());
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const MarketTickerCard: React.FC<{ receipts: Receipt[]; center: { lat: number; lng: number } | null; onOpen?: () => void }> = ({ receipts, center, onOpen }) => {
  const { nameOf } = useStoreNames();
  const { isAdmin } = useMasterInfo();
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof loadShared>> | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('up');
  const [bestQ, setBestQ] = useState<{ cnpj: string; score: number; n: number } | null>(null);
  const cKey = center ? `${center.lat.toFixed(3)},${center.lng.toFixed(3)}` : '';

  // só busca na nuvem quando o cartão chega perto da tela (o Início abre sem esperar por isso)
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    let km = 30; try { const v = Number(localStorage.getItem('eukasconta_compare_km')); if ([10, 30, 60].includes(v)) km = v; } catch { /* usa 30 */ }
    loadShared(center, km).then(r => { if (alive) setRows(r); }).catch(() => { if (alive) setRows(null); });
    return () => { alive = false; };
  }, [visible, cKey]);

  const local = useMemo(() => deptObservations(receipts, 'HORTIFRUTI'), [receipts]);
  const all = useMemo(() => (rows ? mergeObs(sharedObservations(rows, 'HORTIFRUTI', t => !t || GROCERY_STORE_TYPES.has(t)), local) : []), [rows, local]);
  const ticker = useMemo(() => buildTicker(all, local, todayIso()), [all, local]);
  const mv = useMemo(() => movers(ticker), [ticker]);
  const cmp = useMemo(() => (rows ? buildProduceCompare(receipts, (n, c) => nameOf(n, c), 'HORTIFRUTI', 3, all) : null), [rows, receipts, all, nameOf]);
  const cheapest = cmp?.stores.find(s => s.index !== null);

  // melhor nota: só o administrador vê a média com poucos votos (regra do servidor); demais, "em breve"
  useEffect(() => {
    if (!isAdmin || !cmp || !cloud.cloudAvailable()) return;
    let alive = true;
    const out: { cnpj: string; score: number; n: number }[] = [];
    Promise.all(cmp.stores.filter(s => s.cnpj).map(s => cloud.produceQualityAdminByStore(s.cnpj).then(r => {
      const n = r.reduce((a, x) => a + x.n, 0);
      if (n) out.push({ cnpj: s.cnpj, score: Math.round((r.reduce((a, x) => a + x.avg_score * x.n, 0) / n) * 10) / 10, n });
    }).catch(() => { /* sem nota */ }))).then(() => { if (alive) setBestQ(out.sort((a, b) => b.score - a.score)[0] || null); });
    return () => { alive = false; };
  }, [isAdmin, cmp]);
  const bestQStore = bestQ ? cmp?.stores.find(s => s.cnpj === bestQ.cnpj) : undefined;

  const list = tab === 'up' ? mv.up : tab === 'down' ? mv.down : mv.mine;
  const chip = (t: Tab, label: string, icon?: React.ReactNode) => (
    <button type="button" onClick={() => setTab(t)} aria-pressed={tab === t} data-testid={`mk-tab-${t}`}
      className={`h-8 px-3 rounded-full text-[11px] font-bold border whitespace-nowrap flex items-center gap-1 ${tab === t ? 'bg-luxury-gold/15 border-luxury-gold/40 text-luxury-gold' : 'border-white/10 text-zinc-500'}`}>{icon}{label}</button>
  );

  return (
    <div ref={box} className="bg-black border border-white/10 rounded-[1.75rem] md:rounded-[2.5rem] p-4 md:p-8 shadow-2xl relative overflow-hidden" data-testid="market-ticker">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <h3 className="text-[13px] text-zinc-200 font-semibold tracking-tight">Cotação do mercado · Hortifruti</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">Todos os usuários perto de você · últimos 7 dias contra os 30 anteriores</p>
        </div>
        {onOpen && <button type="button" onClick={onOpen} className="shrink-0 text-[11px] font-bold text-luxury-gold flex items-center gap-0.5 h-8">ver tudo<ChevronRight className="w-3.5 h-3.5" /></button>}
      </div>

      {rows === undefined && <p className="text-[12px] text-zinc-500 py-6 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Buscando preços de todos os usuários…</p>}
      {rows === null && <p className="text-[12px] text-zinc-500 py-5">Sem conexão ou sem posição para comparar com o mercado. Ative a localização ou entre na conta.</p>}

      {rows && (
        <>
          {(cheapest || bestQStore) && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-zinc-500">Mais barato</p>
                <p className="text-[13px] font-bold text-zinc-100 truncate">{cheapest ? cheapest.name : '—'}</p>
                {cheapest && cheapest.index !== null && <p className="text-[11px] font-mono" style={{ color: '#34d399' }}>{pctTxt(cheapest.index - 1)} da média</p>}
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-zinc-500">Melhor nota</p>
                <p className="text-[13px] font-bold text-zinc-100 truncate">{bestQStore ? bestQStore.name : '—'}</p>
                <p className="text-[11px] font-mono text-zinc-500 flex items-center gap-1">{bestQ ? <><QualityFace score={bestQ.score} size={14} /> {bestQ.score.toFixed(1).replace('.', ',')} · {bestQ.n} {bestQ.n === 1 ? 'voto' : 'votos'}</> : isAdmin ? 'precisa de votos' : 'em breve'}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1.5 mt-3 overflow-x-auto no-scrollbar">
            {chip('up', 'Subiram', <TrendingUp className="w-3.5 h-3.5" />)}
            {chip('down', 'Caíram', <TrendingDown className="w-3.5 h-3.5" />)}
            {chip('mine', 'Sua compra')}
          </div>

          {list.length === 0 ? (
            <p className="text-[12px] text-zinc-500 py-4">{tab === 'mine' ? 'Quando você comprar itens que outros também compraram, aparece aqui quanto pagou a mais ou a menos que o mercado.' : 'Ainda não há itens com variação clara (precisa de leituras em pelo menos 2 lojas nas duas janelas).'}</p>
          ) : (
            <div className="mt-2 divide-y divide-white/5" data-testid="mk-list">
              {list.map(r => {
                const v = tab === 'mine' ? (r.mine as NonNullable<typeof r.mine>).vsMarket : r.pct;
                const bad = tab === 'mine' ? v > 0.03 : r.pct > 0;     // subir/pagar acima é ruim para quem compra
                const good = tab === 'mine' ? v < -0.03 : r.pct < 0;
                const color = bad ? '#f87171' : good ? '#34d399' : '#a1a1aa';
                return (
                  <div key={r.item} className="py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-zinc-100 truncate">{r.label}</p>
                      <p className="text-[11px] text-zinc-500 truncate">
                        {tab === 'mine' ? <>você pagou R$ {money((r.mine as NonNullable<typeof r.mine>).price)} · mercado R$ {money(r.now)}/{unitTxt(r.unit)}</> : <>antes R$ {money(r.before)} · {r.stores} lojas</>}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      {tab !== 'mine' && <p className="text-[13px] font-bold tabular-nums text-zinc-100">R$ {money(r.now)}<span className="text-[10px] text-zinc-500">/{unitTxt(r.unit)}</span></p>}
                      <p className="text-[11px] font-bold tabular-nums" style={{ color }}>{tab !== 'mine' && (r.pct > 0 ? '▲ ' : '▼ ')}{pctTxt(v)}{tab === 'mine' ? ' vs mercado' : ''}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MarketTickerCard;
