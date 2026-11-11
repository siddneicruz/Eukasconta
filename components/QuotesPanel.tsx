import React, { useEffect, useMemo, useState } from 'react';
import { TrendingDown, TrendingUp, Minus, Search } from 'lucide-react';
import { Receipt } from '../types';
import { Quote, buildQuotes, topMovers } from '../services/quotes';

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

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const pctTxt = (p: number) => `${Math.abs(p) >= 10 ? Math.round(Math.abs(p)) : (Math.round(Math.abs(p) * 10) / 10).toString().replace('.', ',')}%`;
const UNIT: Record<string, string> = { KG: 'kg', G: 'g', L: 'L', ML: 'ml', UN: 'un', DZ: 'dúzia' };
const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
// Para quem compra, preço SUBINDO é ruim (vermelho) e CAINDO é bom (verde)
const UP = '#E5675F', DOWN = '#3FB68B', FLAT = '#8E9AB8';
const toneOf = (c: number | null) => (c === null || Math.abs(c) < 0.5 ? FLAT : c > 0 ? UP : DOWN);

const Spark: React.FC<{ v: number[]; color: string }> = ({ v, color }) => {
  if (v.length < 2) return <div className="w-[72px] h-7" aria-hidden="true" />;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * 70 + 1},${26 - ((y - lo) / span) * 22 - 1}`).join(' ');
  return (
    <svg width="72" height="28" viewBox="0 0 72 28" aria-hidden="true" className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const Badge: React.FC<{ c: number | null; label?: string }> = ({ c, label }) => {
  if (c === null) return <span className="text-[11px] text-zinc-600">—</span>;
  const color = toneOf(c);
  const Icon = Math.abs(c) < 0.5 ? Minus : c > 0 ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-bold tabular-nums" style={{ color }} title={label}>
      <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />{Math.abs(c) < 0.5 ? '0%' : `${c > 0 ? '+' : '−'}${pctTxt(c)}`}
    </span>
  );
};

/** Letreiro com os maiores movimentos de preço, no estilo painel de bolsa. Rola sozinho; parado quando o aparelho pede menos movimento. */
export const QuotesTicker: React.FC<{ receipts: Receipt[]; onOpen?: () => void }> = ({ receipts, onOpen }) => {
  const movers = useMemo(() => topMovers(buildQuotes(receipts), 12), [receipts]);
  if (movers.length < 2) return null;
  const items = [...movers, ...movers];
  return (
    <button type="button" onClick={onOpen} data-testid="quotes-ticker" aria-label="Abrir cotações"
      className="block w-full overflow-hidden rounded-xl bg-black/40 border border-white/10 py-2 text-left">
      <div className="flex w-max gap-6 px-3 whitespace-nowrap quotes-marquee">
        {items.map((q, i) => (
          <span key={i} className="inline-flex items-center gap-2 text-[12px] tabular-nums">
            <span className="font-bold text-zinc-200 uppercase tracking-[0.04em]">{q.name}</span>
            <span className="text-zinc-400">{brl(q.last)}</span>
            <Badge c={q.chg} />
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

const QuotesPanel: React.FC<{ receipts: Receipt[] }> = ({ receipts }) => {
  const all = useMemo(() => buildQuotes(receipts), [receipts]);
  const [dept, setDept] = useState('');
  const [sort, setSort] = useState<Sort>('mov');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const depts = useMemo(() => {
    const m = new Map<string, number>();
    all.forEach(x => m.set(x.dept, (m.get(x.dept) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
  }, [all]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = all.filter(x => (!dept || x.dept === dept) && (!needle || x.name.toLowerCase().includes(needle)));
    const c = (x: Quote) => x.chg ?? 0;
    if (sort === 'up') list = list.filter(x => c(x) > 0.5).sort((a, b) => c(b) - c(a));
    else if (sort === 'down') list = list.filter(x => c(x) < -0.5).sort((a, b) => c(a) - c(b));
    else if (sort === 'freq') list = [...list].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
    else list = [...list].sort((a, b) => Math.abs(c(b)) - Math.abs(c(a)) || b.days - a.days);
    return list.slice(0, 80);
  }, [all, dept, sort, q]);

  const ups = all.filter(x => !x.stale && (x.chg ?? 0) > 0.5).length;
  const downs = all.filter(x => !x.stale && (x.chg ?? 0) < -0.5).length;

  if (!all.length) return <p className="text-sm text-zinc-500 py-10 text-center">Ainda não há compras para montar cotações.</p>;

  return (
    <div className="space-y-3" data-testid="quotes-panel">
      <QuotesTicker receipts={receipts} />

      <div className="bg-[#121214] border border-white/5 rounded-2xl p-3 md:p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] md:text-lg font-semibold text-zinc-100">Cotações: Açougue e Hortifruti</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">Última compra contra o preço típico (mediana das compras anteriores), por kg ou unidade. <span style={{ color: DOWN }}>Verde</span> = ficou mais barato · <span style={{ color: UP }}>vermelho</span> = ficou mais caro.</p>
          </div>
        </div>
        <div className="mt-3 flex gap-4 text-[12px] tabular-nums">
          <span style={{ color: UP }} className="font-semibold">▲ {ups} {ups === 1 ? 'subiu' : 'subiram'}</span>
          <span style={{ color: DOWN }} className="font-semibold">▼ {downs} {downs === 1 ? 'caiu' : 'caíram'}</span>
          <span className="text-zinc-500">{all.length} produtos</span>
        </div>

        <label className="mt-3 flex items-center gap-2 h-10 px-3 rounded-xl bg-white/5 border border-white/10 text-zinc-400">
          <Search className="w-4 h-4 shrink-0" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar produto" data-testid="quotes-search"
            className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-zinc-100 placeholder:text-zinc-500" />
        </label>

        <div className="mt-2.5 flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1" role="group" aria-label="Departamento">
          {['', ...depts].map(d => (
            <button key={d || 'todos'} type="button" onClick={() => setDept(d)} aria-pressed={dept === d} data-testid={`quotes-dept-${d || 'todos'}`}
              className={`shrink-0 h-8 px-3 rounded-full border text-[12px] font-semibold ${dept === d ? 'bg-luxury-gold text-black border-luxury-gold' : 'bg-white/5 border-white/10 text-zinc-400'}`}>{d || 'Todos'}</button>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1" role="group" aria-label="Ordenar">
          {SORTS.map(s => (
            <button key={s.id} type="button" onClick={() => setSort(s.id)} aria-pressed={sort === s.id} data-testid={`quotes-sort-${s.id}`}
              className={`shrink-0 h-7 px-2.5 rounded-lg text-[11px] font-semibold ${sort === s.id ? 'text-luxury-gold bg-luxury-gold/10 border border-luxury-gold/30' : 'text-zinc-500 border border-transparent'}`}>{s.label}</button>
          ))}
        </div>
      </div>

      <div className="bg-[#121214] border border-white/5 rounded-2xl shadow-xl overflow-hidden divide-y divide-white/5" data-testid="quotes-list">
        {rows.length === 0 && <p className="text-sm text-zinc-500 py-8 text-center">Nenhum produto nesse filtro.</p>}
        {rows.map(x => {
          const color = toneOf(x.chg);
          const isOpen = open === x.key;
          return (
            <div key={x.key} data-testid="quote-row">
              <button type="button" onClick={() => setOpen(isOpen ? null : x.key)} aria-expanded={isOpen}
                className="w-full flex items-center gap-3 px-3 md:px-5 py-3 text-left active:bg-white/5">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-zinc-100 truncate">{x.name}</p>
                  <p className="text-[11px] text-zinc-500 truncate">{x.dept} · {x.days} {x.days === 1 ? 'compra' : 'compras'}{x.stale ? ' · sem compra há mais de 3 meses' : ''}{x.odd ? ' · confira' : ''}</p>
                </div>
                <Spark v={x.spark} color={color} />
                <div className="shrink-0 w-[92px] text-right">
                  <p className="text-[14px] font-bold text-zinc-100 tabular-nums">{brl(x.last)}<span className="text-[10px] font-medium text-zinc-500">/{UNIT[x.unit] || x.unit.toLowerCase()}</span></p>
                  <Badge c={x.chg} label="da última compra contra o preço típico" />
                </div>
              </button>
              {isOpen && (
                <div className="px-3 md:px-5 pb-3 space-y-2" data-testid="quote-detail">
                  <div className="grid grid-cols-3 gap-2 text-[11px] tabular-nums">
                    <div className="rounded-xl bg-white/5 p-2.5"><p className="text-zinc-500">Preço típico</p><p className="text-zinc-100 font-semibold mt-0.5">{x.typical !== null ? brl(x.typical) : '—'}</p><p className="text-zinc-500">{x.nBase ? `${x.nBase} ${x.nBase === 1 ? 'compra antes' : 'compras antes'}` : ''}</p></div>
                    <div className="rounded-xl bg-white/5 p-2.5"><p className="text-zinc-500">Última compra</p><p className="text-zinc-100 font-semibold mt-0.5">{brl(x.last)}</p><p className="text-zinc-500 truncate">{shortDate(x.lastDate)} · {x.lastStore}</p></div>
                    <div className="rounded-xl bg-white/5 p-2.5"><p className="text-zinc-500">Variação</p><p className="mt-0.5"><Badge c={x.chg} /></p><p className="text-zinc-500">{x.typical !== null ? `${x.last < x.typical ? '−' : '+'}${brl(Math.abs(x.last - x.typical))}` : ''}</p></div>
                  </div>
                  <p className="text-[11px] text-zinc-500 tabular-nums">Penúltima compra: {x.prev !== null ? `${brl(x.prev)}${x.prevDate ? ` em ${shortDate(x.prevDate)}` : ''}` : '—'}</p>
                  {x.odd && <p className="text-[11px] text-amber-400">Salto grande: vale conferir se a última compra não foi lida com unidade ou quantidade errada.</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="px-1 text-[11px] text-zinc-600 leading-relaxed">Só o que você comprou no Açougue e no Hortifruti, item por item. Compras no mesmo dia viram a média do dia. São só os seus cupons; informação de preço, não recomendação de compra.</p>
    </div>
  );
};

export default QuotesPanel;
