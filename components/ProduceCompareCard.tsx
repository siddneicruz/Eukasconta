import React, { useEffect, useMemo, useState } from 'react';
import { Receipt } from '../types';
import * as cloud from '../services/cloudService';
import { useMasterInfo } from './MasterContext';
import { buildProduceCompare, WD, MIN_ITEMS_RANK, MIN_DAY_OBS } from '../services/produceCompare';
import { unitLabel } from '../services/productPriceStats';

/* Hortifruti em Análises › Panorama: compara os mercados onde a pessoa compra (preço, nota de qualidade, dia da semana).
   Preço e dia da semana saem dos cupons dela (todo o histórico). A nota de qualidade vem do banco e, por ora, só para o administrador. */

const money = (v: number) => v.toFixed(2).replace('.', ',');
const pctTxt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0).replace('.', ',')}%`;
const idxColor = (v: number) => (v <= -0.02 ? '#34d399' : v >= 0.02 ? '#f87171' : '#a1a1aa');
const scoreColor = (s: number) => (s >= 7 ? '#34d399' : s >= 4 ? '#DDB94B' : '#f87171');
const short = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

type Tab = 'stores' | 'items' | 'days';
type Q = { score: number | null; n: number; last: string | null };

const ProduceCompareCard: React.FC<{ receipts: Receipt[]; nameOf: (name: string, cnpj: string) => string; dept?: string; label?: string; minItems?: number }> = ({ receipts, nameOf, dept = 'HORTIFRUTI', label = 'Hortifruti', minItems = MIN_ITEMS_RANK }) => {
  const { isAdmin: admin } = useMasterInfo();
  const isAdmin = admin && dept === 'HORTIFRUTI';   // a nota de qualidade só existe para hortifruti
  const data = useMemo(() => buildProduceCompare(receipts, nameOf, dept, minItems), [receipts, nameOf, dept, minItems]);
  const [tab, setTab] = useState<Tab>('items');
  const [storeBy, setStoreBy] = useState<'price' | 'score'>('price');
  const [itemBy, setItemBy] = useState<'n' | 'spread'>('n');
  const [quality, setQuality] = useState<Record<string, Q>>({});

  // nota de qualidade por mercado: média das notas dos itens, ponderada pelos votos (administrador)
  useEffect(() => {
    if (!isAdmin || !cloud.cloudAvailable()) return;
    let alive = true;
    data.stores.filter(s => s.cnpj).forEach(s => {
      cloud.produceQualityAdminByStore(s.cnpj).then(rows => {
        if (!alive) return;
        const n = rows.reduce((a, r) => a + r.n, 0);
        const score = n ? Math.round((rows.reduce((a, r) => a + r.avg_score * r.n, 0) / n) * 10) / 10 : null;
        const last = rows.map(r => r.last_rated_at).sort().pop() || null;
        setQuality(q => ({ ...q, [s.id]: { score, n, last } }));
      }).catch(() => { /* sem nota: o preço aparece igual */ });
    });
    return () => { alive = false; };
  }, [isAdmin, data.stores.map(s => s.cnpj).join(',')]);

  const stores = useMemo(() => {
    const l = [...data.stores];
    if (storeBy === 'score') l.sort((a, b) => (quality[b.id]?.score ?? -1) - (quality[a.id]?.score ?? -1) || (quality[b.id]?.n ?? 0) - (quality[a.id]?.n ?? 0));
    return l;
  }, [data.stores, storeBy, quality]);
  const items = useMemo(() => [...data.items].sort(itemBy === 'n' ? (a, b) => b.n - a.n || b.spread - a.spread : (a, b) => b.spread - a.spread || b.n - a.n), [data.items, itemBy]);

  if (data.nObs === 0) return null;
  const ranked = data.stores.filter(s => s.index !== null);
  const bestPrice = ranked[0];
  const scored = (Object.entries(quality) as [string, Q][]).filter(([, q]) => q.score !== null && q.n >= 5).sort((a, b) => (b[1].score as number) - (a[1].score as number));
  const bestScore = scored[0] ? data.stores.find(s => s.id === scored[0][0]) : undefined;
  const Pill: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode; tid?: string }> = ({ on, onClick, children, tid }) => (
    <button type="button" onClick={onClick} aria-pressed={on} data-testid={tid}
      className={`h-8 px-3 rounded-full text-xs font-semibold border whitespace-nowrap transition-colors ${on ? 'bg-luxury-gold/15 border-luxury-gold/40 text-luxury-gold' : 'border-white/10 text-zinc-500 hover:text-zinc-300'}`}>{children}</button>
  );

  return (
    <div className="bg-[#121214] border border-white/5 rounded-2xl md:rounded-[1.75rem] p-3 md:p-6 shadow-xl" data-testid="produce-compare">
      <h3 className="text-[12px] font-semibold text-zinc-300 px-0.5">{label} · comparativo entre lojas</h3>
      <p className="text-[11px] text-zinc-500 px-0.5 mt-0.5">{data.nItems} itens · {data.stores.length} lojas · compras de {short(data.firstDate)} a {short(data.lastDate)} (todo o histórico)</p>

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
            <p className="text-[11px] font-mono text-zinc-500">{bestScore ? `★ ${String(quality[bestScore.id].score).replace('.', ',')} · ${quality[bestScore.id].n} votos` : isAdmin ? 'precisa de 5 votos' : 'em breve'}</p>
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
                    {q && q.n > 0 && (q.score !== null && q.n >= 5
                      ? <span className="block text-[11px] font-mono" style={{ color: scoreColor(q.score) }}>★ {String(q.score).replace('.', ',')} <span className="text-zinc-500">· {q.n} votos{q.last ? ` · ${short(q.last.slice(0, 10))}` : ''}</span></span>
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
            <Pill on={itemBy === 'n'} onClick={() => setItemBy('n')}>Mais comprados</Pill>
            <Pill on={itemBy === 'spread'} onClick={() => setItemBy('spread')}>Maior diferença</Pill>
          </div>
          {items.length === 0 ? <p className="py-6 text-center text-[13px] text-zinc-500">{dept === 'HORTIFRUTI' || dept === 'TRANSPORTE' ? 'Ainda não há item comprado em duas lojas diferentes.' : 'Ainda não há produto com código de barras (EAN) comprado em duas lojas diferentes.'}</p> : (
            <div className="divide-y divide-white/5">
              {items.map(r => (
                <div key={r.item} className="py-2.5" data-testid="pc-item-row">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-200 truncate">{r.label}</p>
                    <span className="text-[11px] font-mono text-zinc-500 whitespace-nowrap">diferença {pctTxt(r.spread)}</span>
                  </div>
                  {r.ean && <p className="text-[10px] font-mono text-zinc-500">EAN {r.ean}</p>}
                  <div className="mt-1 space-y-0.5">
                    {r.all.map((m, i) => (
                      <p key={m.id} className="text-[11px] font-mono flex justify-between gap-2" style={{ color: i === 0 ? '#34d399' : i === r.all.length - 1 && r.all.length === r.stores ? '#f87171' : undefined }}>
                        <span className={`truncate ${i === 0 || (i === r.all.length - 1 && r.all.length === r.stores) ? '' : 'text-zinc-400'}`}>{i + 1}º {m.name}</span>
                        <span className="whitespace-nowrap">R$ {money(m.price)}<span className="text-zinc-500">/{unitLabel(r.unit)}</span></span>
                      </p>
                    ))}
                    {r.stores > r.all.length && <p className="text-[10px] text-zinc-500">+ {r.stores - r.all.length} {r.stores - r.all.length === 1 ? 'mercado' : 'mercados'} mais caros (o mais caro: <span style={{ color: '#f87171' }}>{r.dear.name} R$ {money(r.dear.price)}</span>)</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
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
