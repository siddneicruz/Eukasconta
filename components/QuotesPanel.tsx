import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Receipt } from '../types';
import { unitLabel } from '../services/productPriceStats';
import { MIN_PURCHASES, Quote, buildQuotes, topMovers } from '../services/quotes';

/* Painel de cotações no estilo de bolsa: fundo escuro fixo (em qualquer tema), números em fonte monoespaçada, uma linha
   por item com ÚLTIMO e VAR% numa célula colorida. Para quem COMPRA, preço subindo é ruim: vermelho = mais caro,
   verde = mais barato, cinza = dentro da faixa normal do item. */

const TICKER_KEY = 'ek_quotes_ticker';
const TICKER_EVT = 'ek-quotes-ticker';
const readTicker = (): boolean => { try { return localStorage.getItem(TICKER_KEY) !== 'off'; } catch { return true; } };
/** Mostrar ou ocultar o letreiro do Início (guardado no aparelho; vale em todas as telas que o usam). */
export const useQuotesTicker = (): [boolean, (v: boolean) => void] => {
  const [on, setOn] = useState<boolean>(readTicker);
  useEffect(() => {
    const sync = () => setOn(readTicker());
    window.addEventListener(TICKER_EVT, sync);
    return () => window.removeEventListener(TICKER_EVT, sync);
  }, []);
  const set = (v: boolean) => {
    try { localStorage.setItem(TICKER_KEY, v ? 'on' : 'off'); } catch { /* sem armazenamento: vale só nesta sessão */ }
    setOn(v);
    window.dispatchEvent(new Event(TICKER_EVT));
  };
  return [on, set];
};

const num = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctTxt = (p: number) => { const a = Math.abs(p); return `${a >= 10 ? Math.round(a) : (Math.round(a * 10) / 10).toFixed(1).replace('.', ',')}%`; };
const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const MONO = 'font-mono tabular-nums';

const toneKey = (q: Quote): 'up' | 'dn' | 'flat' => (q.zone === 'above' ? 'up' : q.zone === 'below' ? 'dn' : 'flat');
const toneOf = (q: Quote): string => `var(--q-${toneKey(q)})`;
const arrowOf = (q: Quote): string => (q.zone === 'above' ? '▲' : q.zone === 'below' ? '▼' : '■');
const signed = (q: Quote) => (q.chg === null ? '—' : `${q.chg > 0.05 ? '+' : q.chg < -0.05 ? '−' : ''}${pctTxt(q.chg)}`);

/** Célula de variação pintada, como na bolsa */
const VarCell: React.FC<{ q: Quote }> = ({ q }) => {
  const c = toneOf(q);
  return (
    <span className={`inline-flex items-center justify-center gap-1 min-w-[74px] h-8 px-2 rounded-md text-[13px] font-bold ${MONO}`}
      style={{ color: c, background: `var(--q-${toneKey(q)}-bg)`, border: `1px solid var(--q-${toneKey(q)}-bd)` }} title="última compra contra o preço médio">
      <span className="text-[9px]" aria-hidden="true">{arrowOf(q)}</span>{signed(q)}
    </span>
  );
};

/** Barra da faixa normal: faixa destacada e um ponto onde a última compra caiu */
const RangeBar: React.FC<{ q: Quote; className?: string }> = ({ q, className = '' }) => {
  if (q.lo === null || q.hi === null || q.mean === null) return null;
  const min = Math.min(q.lo, q.last, q.mean) * 0.92, max = Math.max(q.hi, q.last, q.mean) * 1.08;
  const pos = (v: number) => `${Math.min(Math.max(((v - min) / (max - min || 1)) * 100, 0), 100)}%`;
  const c = toneOf(q);
  return (
    <div className={`relative h-2 rounded-full bg-[var(--q-fill2)] ${className}`} aria-label={`Margem normal de ${num(q.lo)} a ${num(q.hi)}, última compra ${num(q.last)}`}>
      <div className="absolute top-0 bottom-0 rounded-full bg-[var(--q-bar)]" style={{ left: pos(q.lo), width: `calc(${pos(q.hi)} - ${pos(q.lo)})` }} />
      <div className="absolute top-1/2 w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-[color:var(--q-bg)]" style={{ left: pos(q.last), background: c }} />
    </div>
  );
};

/** Gráfico das últimas compras com a faixa normal sombreada e o preço médio tracejado */
const BigSpark: React.FC<{ q: Quote }> = ({ q }) => {
  const v = q.spark;
  if (v.length < 2) return null;
  const all = [...v, ...(q.lo !== null ? [q.lo] : []), ...(q.hi !== null ? [q.hi] : [])];
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const W = 300, H = 64, X = (i: number) => (i / (v.length - 1)) * (W - 8) + 4, Y = (y: number) => H - 6 - ((y - lo) / span) * (H - 12);
  const c = toneOf(q);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" role="img" aria-label={`Últimos ${v.length} preços de ${q.name}`}>
      {q.lo !== null && q.hi !== null && <rect x="0" width={W} y={Y(q.hi)} height={Math.max(Y(q.lo) - Y(q.hi), 1)} fill="var(--q-band)" />}
      {q.mean !== null && <line x1="0" x2={W} y1={Y(q.mean)} y2={Y(q.mean)} stroke="var(--q-gold)" strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />}
      <polyline points={v.map((y, i) => `${X(i)},${Y(y)}`).join(' ')} fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={X(v.length - 1)} cy={Y(v[v.length - 1])} r="3.5" fill={c} />
    </svg>
  );
};

/** Letreiro com os maiores movimentos de preço, como o da bolsa. Rola sozinho; parado quando o aparelho pede menos movimento. */
export const QuotesTicker: React.FC<{ receipts: Receipt[]; onOpen?: () => void }> = ({ receipts, onOpen }) => {
  const movers = useMemo(() => topMovers(buildQuotes(receipts), 12), [receipts]);
  if (movers.length < 2) return null;
  const items = [...movers, ...movers];
  return (
    <button type="button" onClick={onOpen} data-testid="quotes-ticker" aria-label="Abrir cotações"
      className="qb block w-full overflow-hidden rounded-xl bg-[var(--q-bg)] border border-[color:var(--q-bd)] py-2 text-left">
      <div className="flex w-max gap-7 px-3 whitespace-nowrap quotes-marquee">
        {items.map((q, i) => (
          <span key={i} className={`inline-flex items-center gap-2 text-[12px] ${MONO}`}>
            <span className="font-bold text-[color:var(--q-t1)] uppercase tracking-[0.04em]">{q.name}</span>
            <span className="text-[color:var(--q-t2)]">{num(q.last)}</span>
            <span className="font-bold" style={{ color: toneOf(q) }}>{arrowOf(q)} {signed(q)}</span>
          </span>
        ))}
      </div>
    </button>
  );
};

type Sort = 'mov' | 'up' | 'down' | 'freq';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'mov', label: 'Maiores variações' }, { id: 'up', label: 'Altas' }, { id: 'down', label: 'Quedas' }, { id: 'freq', label: 'Mais comprados' },
];

const QuotesPanel: React.FC<{ receipts: Receipt[]; onOpenPurchases?: (f: { label: string; descs: string[] }) => void }> = ({ receipts, onOpenPurchases }) => {
  const all = useMemo(() => buildQuotes(receipts), [receipts]);
  const [dept, setDept] = useState('');
  const [sort, setSort] = useState<Sort>('mov');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [showBuilding, setShowBuilding] = useState(false);

  const depts = useMemo(() => {
    const m = new Map<string, number>();
    all.forEach(x => m.set(x.dept, (m.get(x.dept) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
  }, [all]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(x => (!dept || x.dept === dept) && (!needle || x.name.toLowerCase().includes(needle)));
  }, [all, dept, q]);

  const ready = useMemo(() => {
    const c = (x: Quote) => x.chg ?? 0;
    let list = matches.filter(x => x.ready);
    if (sort === 'up') list = list.filter(x => x.zone === 'above').sort((a, b) => c(b) - c(a));
    else if (sort === 'down') list = list.filter(x => x.zone === 'below').sort((a, b) => c(a) - c(b));
    else if (sort === 'freq') list = [...list].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
    else list = [...list].sort((a, b) => Math.abs(c(b)) - Math.abs(c(a)) || b.days - a.days);
    return list.slice(0, 100);
  }, [matches, sort]);
  const building = useMemo(() => matches.filter(x => !x.ready).sort((a, b) => b.days - a.days || a.name.localeCompare(b.name)), [matches]);

  const live = all.filter(x => x.ready && !x.stale);
  const ups = live.filter(x => x.zone === 'above').length;
  const downs = live.filter(x => x.zone === 'below').length;
  const topUp = [...live].filter(x => x.zone === 'above' && !x.odd).sort((a, b) => (b.chg ?? 0) - (a.chg ?? 0)).slice(0, 3);
  const topDown = [...live].filter(x => x.zone === 'below' && !x.odd).sort((a, b) => (a.chg ?? 0) - (b.chg ?? 0)).slice(0, 3);
  const lastDate = all.reduce((m, x) => (x.lastDate > m ? x.lastDate : m), '');

  if (!all.length) return <p className="text-sm text-[color:var(--q-t3)] py-10 text-center">Ainda não há compras de Açougue ou Hortifruti para montar cotações.</p>;

  const Mover: React.FC<{ x: Quote }> = ({ x }) => (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <span className="truncate text-[color:var(--q-t1)] uppercase tracking-[0.02em]">{x.name}</span>
      <span className={`shrink-0 font-bold ${MONO}`} style={{ color: toneOf(x) }}>{arrowOf(x)} {signed(x)}</span>
    </div>
  );

  return (
    <div className="qb space-y-3 text-[color:var(--q-t1)]" data-testid="quotes-panel">
      <QuotesTicker receipts={receipts} />

      <div className="rounded-2xl bg-[var(--q-bg)] border border-[color:var(--q-bd)] p-3 md:p-5 shadow-xl">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-bold tracking-[0.12em] text-[color:var(--q-gold)] uppercase">Cotações · Açougue e Hortifruti</h3>
          {lastDate && <span className={`text-[11px] text-[color:var(--q-t3)] whitespace-nowrap shrink-0 ${MONO}`}>até {shortDate(lastDate)}</span>}
        </div>
        <p className="text-[11px] text-[color:var(--q-t3)] mt-1 leading-relaxed">
          Última compra contra o seu preço médio (até {30} compras, 1 ano). Só com {MIN_PURCHASES} compras ou mais.
          <span style={{ color: 'var(--q-up)' }}> ▲ vermelho</span> = mais caro · <span style={{ color: 'var(--q-dn)' }}>▼ verde</span> = mais barato · <span style={{ color: 'var(--q-flat)' }}>■ cinza</span> = normal.
        </p>

        {(topUp.length > 0 || topDown.length > 0) && (
          <div className="mt-3 grid grid-cols-2 gap-2" data-testid="quotes-movers">
            <div className="rounded-lg border border-[color:var(--q-bd)] p-2.5 space-y-1.5">
              <p className="text-[10px] font-bold tracking-[0.12em]" style={{ color: 'var(--q-up)' }}>MAIORES ALTAS</p>
              {topUp.length ? topUp.map(x => <Mover key={x.key} x={x} />) : <p className="text-[11px] text-[color:var(--q-t4)]">nenhuma</p>}
            </div>
            <div className="rounded-lg border border-[color:var(--q-bd)] p-2.5 space-y-1.5">
              <p className="text-[10px] font-bold tracking-[0.12em]" style={{ color: 'var(--q-dn)' }}>MAIORES QUEDAS</p>
              {topDown.length ? topDown.map(x => <Mover key={x.key} x={x} />) : <p className="text-[11px] text-[color:var(--q-t4)]">nenhuma</p>}
            </div>
          </div>
        )}

        <div className={`mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] ${MONO}`}>
          <span style={{ color: 'var(--q-up)' }} className="font-bold whitespace-nowrap">▲ {ups}</span>
          <span style={{ color: 'var(--q-dn)' }} className="font-bold whitespace-nowrap">▼ {downs}</span>
          <span className="text-[color:var(--q-t3)] min-w-0">{live.length} cotados · {all.length - all.filter(x => x.ready).length} juntando histórico</span>
        </div>

        <label className="mt-3 flex items-center gap-2 h-10 px-3 rounded-lg bg-[var(--q-fill)] border border-[color:var(--q-bd)] text-[color:var(--q-t2)]">
          <Search className="w-4 h-4 shrink-0" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar item" data-testid="quotes-search"
            className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-[color:var(--q-t1)] placeholder:text-[color:var(--q-t3)]" />
        </label>
        <div className="mt-2.5 flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1" role="group" aria-label="Departamento">
          {['', ...depts].map(d => (
            <button key={d || 'todos'} type="button" onClick={() => setDept(d)} aria-pressed={dept === d} data-testid={`quotes-dept-${d || 'todos'}`}
              className={`shrink-0 h-8 px-3 rounded-full border text-[12px] font-semibold ${dept === d ? 'bg-[var(--q-gold)] text-[color:var(--q-on-gold)] border-[color:var(--q-gold)]' : 'bg-[var(--q-fill)] border-[color:var(--q-bd)] text-[color:var(--q-t2)]'}`}>{d || 'Todos'}</button>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1" role="group" aria-label="Ordenar">
          {SORTS.map(s => (
            <button key={s.id} type="button" onClick={() => setSort(s.id)} aria-pressed={sort === s.id} data-testid={`quotes-sort-${s.id}`}
              className={`shrink-0 h-7 px-2.5 rounded-md text-[11px] font-semibold ${sort === s.id ? 'text-[color:var(--q-gold)] bg-[var(--q-gold-bg)] border border-[color:var(--q-gold-bd)]' : 'text-[color:var(--q-t3)] border border-transparent'}`}>{s.label}</button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-[var(--q-bg)] border border-[color:var(--q-bd)] shadow-xl overflow-hidden" data-testid="quotes-list">
        <div className={`grid grid-cols-[1fr_80px_82px] gap-2 px-3 md:px-5 py-2 text-[10px] font-bold tracking-[0.12em] text-[color:var(--q-t3)] bg-[var(--q-hd)] border-b border-[color:var(--q-bd)]`}>
          <span>ITEM</span><span className="text-right">ÚLTIMO R$</span><span className="text-right">VAR</span>
        </div>
        {ready.length === 0 && <p className="text-sm text-[color:var(--q-t3)] py-8 text-center px-4">Nenhum item com {MIN_PURCHASES} compras ou mais nesse filtro.</p>}
        <div className="divide-y divide-[color:var(--q-bd)]">
          {ready.map(x => {
            const isOpen = open === x.key;
            return (
              <div key={x.key} data-testid="quote-row">
                <button type="button" onClick={() => setOpen(isOpen ? null : x.key)} aria-expanded={isOpen}
                  className="w-full grid grid-cols-[1fr_80px_82px] gap-2 items-center px-3 md:px-5 py-2.5 text-left active:bg-[var(--q-fill)]">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 min-w-0"><span className="text-[13px] font-bold text-[color:var(--q-t1)] uppercase tracking-[0.02em] truncate">{x.name}</span><span className="shrink-0 px-1.5 py-0.5 rounded bg-[var(--q-gold-bg)] border border-[color:var(--q-gold-bd)] text-[color:var(--q-gold)] text-[12px] font-bold font-mono">{unitLabel(x.unit)}</span></p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <RangeBar q={x} className="flex-1 max-w-[120px]" />
                      <span className={`text-[10px] text-[color:var(--q-t3)] ${MONO}`}>méd {num(x.mean as number)}</span>
                    </div>
                  </div>
                  <span className="flex justify-end"><span className={`inline-flex items-center justify-center min-w-[74px] h-8 px-2 rounded-md bg-[var(--q-fill)] border border-[color:var(--q-bd2)] text-[14px] font-bold text-[color:var(--q-t1)] ${MONO}`}>{num(x.last)}</span></span>
                  <span className="text-right"><VarCell q={x} /></span>
                </button>
                {isOpen && (
                  <div className="px-3 md:px-5 pb-3 space-y-2" data-testid="quote-detail">
                    <BigSpark q={x} />
                    <div className={`grid grid-cols-3 gap-2 text-[11px] ${MONO}`}>
                      <div className="rounded-lg bg-[var(--q-fill)] p-2.5"><p className="text-[color:var(--q-t3)]">Último</p><p className="text-[color:var(--q-t1)] font-bold mt-0.5">{num(x.last)}</p><p className="text-[color:var(--q-t3)] truncate">{shortDate(x.lastDate)} · {x.lastStore}</p></div>
                      <div className="rounded-lg bg-[var(--q-fill)] p-2.5"><p className="text-[color:var(--q-t3)]">Médio</p><p className="text-[color:var(--q-t1)] font-bold mt-0.5">{num(x.mean as number)}</p><p className="text-[color:var(--q-t3)]">{x.nBase} compras</p></div>
                      <div className="rounded-lg bg-[var(--q-fill)] p-2.5"><p className="text-[color:var(--q-t3)]">Margem ±10%</p><p className="text-[color:var(--q-t1)] font-bold mt-0.5">{num(x.lo as number)}–{num(x.hi as number)}</p><p className="text-[color:var(--q-t3)]">{x.days} compras no total</p></div>
                    </div>
                    {onOpenPurchases && x.descs.length > 0 && (
                      <button type="button" data-testid="quote-open-purchases" onClick={() => onOpenPurchases({ label: x.name, descs: x.descs })}
                        className="w-full h-11 rounded-lg border border-[color:var(--q-gold-bd)] bg-[var(--q-gold-bg)] text-[color:var(--q-gold)] text-[13px] font-bold">Ver as {x.days} compras em Compras →</button>
                    )}
                    <p className="text-[11px] text-[color:var(--q-t3)]">Até ±10% do preço médio a variação não conta como alta nem queda. A linha tracejada é o preço médio.</p>
                    {x.odd && <p className="text-[11px] text-[color:var(--q-warn)]">Salto grande: vale conferir se a última compra não foi lida com unidade ou quantidade errada.</p>}
                    {x.stale && <p className="text-[11px] text-[color:var(--q-t3)]">Sem compra há mais de 3 meses.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {building.length > 0 && (
        <div className="rounded-2xl bg-[var(--q-bg)] border border-[color:var(--q-bd)] overflow-hidden" data-testid="quotes-building">
          <button type="button" onClick={() => setShowBuilding(v => !v)} aria-expanded={showBuilding} data-testid="quotes-building-toggle"
            className="w-full min-h-[48px] flex items-center justify-between gap-3 px-4 text-left">
            <span className="text-[12px] font-bold tracking-[0.1em] text-[color:var(--q-t2)] uppercase">Juntando histórico · {building.length}</span>
            <span className="text-[color:var(--q-t3)] text-sm" aria-hidden="true">{showBuilding ? '−' : '+'}</span>
          </button>
          {showBuilding && (
            <div className="divide-y divide-[color:var(--q-bd)] border-t border-[color:var(--q-bd)]">
              {building.slice(0, 120).map(x => (
                <div key={x.key} className="flex items-center gap-3 px-4 py-2.5" data-testid="quote-building-row">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-[color:var(--q-t2)] uppercase truncate">{x.name}</p>
                    <div className="mt-1.5 h-1.5 rounded-full bg-[var(--q-fill2)] overflow-hidden"><div className="h-full rounded-full bg-[var(--q-gold)]" style={{ width: `${Math.min(x.days / MIN_PURCHASES, 1) * 100}%` }} /></div>
                  </div>
                  <span className={`text-[11px] text-[color:var(--q-t3)] shrink-0 ${MONO}`}>{x.days}/{MIN_PURCHASES}</span>
                  <span className={`text-[13px] text-[color:var(--q-t2)] shrink-0 w-[64px] text-right ${MONO}`}>{num(x.last)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="px-1 text-[11px] text-[color:var(--q-t4)] leading-relaxed">Só os seus cupons de Açougue e Hortifruti, item por item. Compras no mesmo dia viram a média do dia. Informação de preço, não recomendação de compra.</p>
    </div>
  );
};

export default QuotesPanel;
