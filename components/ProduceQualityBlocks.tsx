import React, { useEffect, useMemo, useState } from 'react';
import * as cloud from '../services/cloudService';
import { useMasterInfo } from './MasterContext';
import type { Quote } from '../services/quotes';
import { unitLabel } from '../services/productPriceStats';

/* Qualidade do hortifruti junto com o preço, para o administrador. Sem tanque e sem o mínimo de 5 notas: a nota
   aparece com o número de avaliações ao lado (poucas notas = pouca confiança). Só a média sai do banco, nunca quem votou. */

const money = (v: number) => v.toFixed(2).replace('.', ',');
const scoreColor = (s: number) => (s >= 7 ? '#34d399' : s >= 4 ? '#DDB94B' : '#f87171');
const short = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

export const ScoreChip: React.FC<{ score: number | null; n: number }> = ({ score, n }) => (
  score === null
    ? <span className="text-[11px] text-[color:var(--q-t4)]">sem nota</span>
    : <span className="text-[12px] font-bold font-mono whitespace-nowrap" style={{ color: scoreColor(score) }}>
        ★ {String(score).replace('.', ',')}<span className="font-normal text-[color:var(--q-t3)]"> · {n} {n === 1 ? 'voto' : 'votos'}{n < 5 ? ' (poucos)' : ''}</span>
      </span>
);

type Row = { key: string; name: string; price: number | null; date: string; score: number | null; n: number };

/** Dentro do item aberto na Cotações: cada loja com o último preço pago e a nota de qualidade. */
export const WhereToBuy: React.FC<{ q: Quote }> = ({ q }) => {
  const { isAdmin } = useMasterInfo();
  const [quality, setQuality] = useState<cloud.AdminQualityByProduct[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'none' | 'error'>('idle');
  const [by, setBy] = useState<'price' | 'score'>('price');

  useEffect(() => {
    if (!isAdmin || !cloud.cloudAvailable() || !q.lastCnpj || !q.variants.length) return;
    let alive = true;
    setState('loading'); setQuality(null);
    (async () => {
      try {
        const [res] = await cloud.resolveItems(q.lastCnpj, [{ description: q.variants[0].desc, unit_type: q.unit }]);
        if (!res?.master_product_id) { if (alive) setState('none'); return; }
        const rows = await cloud.produceQualityAdminByProduct(res.master_product_id);
        if (alive) { setQuality(rows); setState(rows.length ? 'idle' : 'none'); }
      } catch { if (alive) setState('error'); }
    })();
    return () => { alive = false; };
  }, [isAdmin, q.key, q.lastCnpj]);

  const rows = useMemo<Row[]>(() => {
    const m = new Map<string, Row>();
    q.stores.forEach(s => m.set(s.cnpj || s.name, { key: s.cnpj || s.name, name: s.name, price: s.last, date: s.lastDate, score: null, n: 0 }));
    (quality || []).forEach(r => {
      const cur = m.get(r.cnpj);
      if (cur) { cur.score = r.avg_score; cur.n = r.n; }
      else m.set(r.cnpj, { key: r.cnpj, name: r.store_name, price: null, date: '', score: r.avg_score, n: r.n });
    });
    const list = [...m.values()];
    const f = by === 'price'
      ? (a: Row, b: Row) => (a.price ?? Infinity) - (b.price ?? Infinity)
      : (a: Row, b: Row) => (b.score ?? -1) - (a.score ?? -1) || b.n - a.n;
    return list.sort((a, b) => f(a, b) || a.name.localeCompare(b.name, 'pt-BR'));
  }, [q.stores, quality, by]);

  if (!isAdmin || rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-[color:var(--q-bd)] p-2.5" data-testid="where-to-buy">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold tracking-[0.12em] text-[color:var(--q-gold)]">ONDE COMPRAR</p>
        <div className="flex gap-1" role="group" aria-label="Ordenar lojas">
          {([['price', 'Preço'], ['score', 'Nota']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setBy(k)} aria-pressed={by === k} data-testid={`where-sort-${k}`}
              className={`h-6 px-2 rounded-md text-[11px] font-semibold ${by === k ? 'text-[color:var(--q-gold)] bg-[var(--q-gold-bg)] border border-[color:var(--q-gold-bd)]' : 'text-[color:var(--q-t3)] border border-transparent'}`}>{label}</button>
          ))}
        </div>
      </div>
      <div className="mt-1.5 divide-y divide-[color:var(--q-bd)]">
        {rows.map(r => (
          <div key={r.key} className="flex items-center justify-between gap-2 py-1.5" data-testid="where-row">
            <div className="min-w-0">
              <p className="text-[12px] font-bold text-[color:var(--q-t1)] truncate">{r.name}</p>
              <p className="text-[10px] text-[color:var(--q-t3)] font-mono">{r.price !== null ? `R$ ${money(r.price)}/${unitLabel(q.unit)} · ${short(r.date)}` : 'sem compra sua'}</p>
            </div>
            <ScoreChip score={r.score} n={r.n} />
          </div>
        ))}
      </div>
      {state === 'loading' && <p className="text-[10px] text-[color:var(--q-t3)] mt-1">Buscando notas de qualidade…</p>}
      {state === 'error' && <p className="text-[10px] text-[color:var(--q-t3)] mt-1">Não consegui buscar as notas agora (preço aparece igual).</p>}
      {state === 'none' && <p className="text-[10px] text-[color:var(--q-t3)] mt-1">Ainda não há notas de qualidade para este item.</p>}
    </div>
  );
};

/** Na tela do estabelecimento (fundo escuro): itens de hortifruti avaliados naquela loja, com a nota e o número de votos. */
export const StoreProduceQuality: React.FC<{ cnpj: string }> = ({ cnpj }) => {
  const { isAdmin } = useMasterInfo();
  const [rows, setRows] = useState<cloud.AdminQualityByStore[] | null>(null);
  const [err, setErr] = useState(false);
  const [by, setBy] = useState<'score' | 'name'>('score');

  useEffect(() => {
    if (!isAdmin || !cloud.cloudAvailable() || !cnpj) return;
    let alive = true;
    setRows(null); setErr(false);
    cloud.produceQualityAdminByStore(cnpj).then(r => { if (alive) setRows(r); }).catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [isAdmin, cnpj]);

  const sorted = useMemo(() => {
    const l = [...(rows || [])];
    return by === 'score' ? l.sort((a, b) => b.avg_score - a.avg_score || b.n - a.n) : l.sort((a, b) => a.description.localeCompare(b.description, 'pt-BR'));
  }, [rows, by]);

  if (!isAdmin || err || !rows || rows.length === 0) return null;
  return (
    <div className="mb-10 bg-black border border-white/10 rounded-2xl p-6 shadow-2xl" data-testid="store-produce-quality">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs text-zinc-500 uppercase tracking-[0.08em] font-bold">Hortifruti · qualidade nesta loja</h3>
        <div className="flex gap-1">
          {([['score', 'Nota'], ['name', 'Nome']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setBy(k)} aria-pressed={by === k}
              className={`h-7 px-2.5 rounded-md text-xs font-semibold ${by === k ? 'bg-luxury-gold/10 text-luxury-gold border border-luxury-gold/20' : 'text-zinc-500'}`}>{label}</button>
          ))}
        </div>
      </div>
      <div className="mt-2 divide-y divide-white/5">
        {sorted.map(r => (
          <div key={r.master_product_id} className="flex items-center justify-between gap-2 py-2">
            <p className="text-sm font-semibold text-zinc-200 truncate">{r.description}</p>
            <span className="text-sm font-bold whitespace-nowrap" style={{ color: scoreColor(r.avg_score) }}>
              ★ {String(r.avg_score).replace('.', ',')}<span className="font-normal text-zinc-500 text-xs"> · {r.n} {r.n === 1 ? 'voto' : 'votos'}{r.n < 5 ? ' (poucos)' : ''}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
