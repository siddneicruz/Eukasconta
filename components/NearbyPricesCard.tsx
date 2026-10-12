import React, { useState } from 'react';
import { MapPin, Loader2, TrendingDown, BellPlus, Navigation, UserRound } from 'lucide-react';
import type { CloudApi } from '../services/useCloud';
import type { NearbyPrice, ResolvedItem } from '../services/cloudService';
import type { AlertDraft } from './AlertsView';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const RADII = [5, 10, 25];

export interface NearbySample {
  description: string;   // descrição como veio no último cupom
  cnpj: string;          // loja desse cupom (ajuda a reconhecer o produto no cadastro comum)
  unitType?: string;
  unitPrice: number;     // último preço que a pessoa pagou
}

interface Props {
  cloud: CloudApi;
  sample: NearbySample | null;
  onCreateAlert: (draft: AlertDraft) => void;
  onGoToAccount: () => void;
}

const NearbyPricesCard: React.FC<Props> = ({ cloud, sample, onCreateAlert, onGoToAccount }) => {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [radius, setRadius] = useState(10);
  const [rows, setRows] = useState<NearbyPrice[]>([]);
  const [resolved, setResolved] = useState<ResolvedItem | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!cloud.available || !sample) return null;

  const run = async (km: number) => {
    setState('loading'); setMessage(null); setRadius(km);
    try {
      const res = await cloud.findNearby({ description: sample.description, cnpj: sample.cnpj, unitType: sample.unitType }, km);
      setResolved(res.resolved); setRows(res.rows);
      setState('done');
    } catch (e: any) {
      setMessage(e.message || 'Não consegui buscar agora.');
      setState('error');
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="mb-6 bg-black/60 border border-white/10 rounded-2xl p-4 md:p-5" data-testid="nearby-card">{children}</div>
  );

  const title = (
    <div className="flex items-center gap-2.5 mb-3">
      <Navigation className="w-4 h-4 text-luxury-gold shrink-0" />
      <h3 className="text-zinc-300 text-xs uppercase tracking-widest font-bold">Quem vende mais barato por perto</h3>
    </div>
  );

  if (!cloud.user) {
    return shell(
      <>
        {title}
        <p className="text-xs text-zinc-500 leading-relaxed">Entre na sua conta para ver os preços que outras pessoas pagaram em lojas perto de você.</p>
        <button onClick={onGoToAccount} className="mt-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-[10px] font-bold uppercase tracking-widest hover:border-luxury-gold/40 transition-all">
          <UserRound className="w-4 h-4 text-luxury-gold" /> Entrar ou criar conta
        </button>
      </>
    );
  }

  const unit = (sample.unitType || 'UN').toUpperCase();
  const sameUnit = rows.filter(r => r.unit_type === unit);
  const best = sameUnit[0];

  return shell(
    <>
      {title}
      {state === 'idle' && (
        <>
          <p className="text-xs text-zinc-500 leading-relaxed">Usa sua localização de agora e os preços dos últimos 60 dias.</p>
          <button onClick={() => run(radius)} data-testid="nearby-run" className="mt-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-luxury-gold text-black text-[10px] font-bold uppercase tracking-widest hover:bg-white transition-all">
            <MapPin className="w-4 h-4" /> Buscar perto de mim
          </button>
        </>
      )}
      {state === 'loading' && <div className="flex items-center gap-3 py-2 text-xs text-zinc-500"><Loader2 className="w-4 h-4 animate-spin text-luxury-gold" /> Buscando…</div>}
      {state === 'error' && (
        <>
          <p className="text-xs text-red-400 leading-relaxed">{message}</p>
          <button onClick={() => run(radius)} className="mt-3 text-[10px] uppercase tracking-widest font-bold text-luxury-gold hover:text-white transition-colors">Tentar de novo</button>
        </>
      )}
      {state === 'done' && (
        <>
          <div className="flex items-center gap-2 mb-4">
            {RADII.map(km => (
              <button key={km} onClick={() => run(km)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-all ${radius === km ? 'bg-luxury-gold text-black border-luxury-gold' : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'}`}>{km} km</button>
            ))}
          </div>

          {!resolved ? (
            <p className="text-xs text-zinc-500 leading-relaxed" data-testid="nearby-empty">Este produto ainda não está no cadastro comum. Ele entra quando alguém escaneia um cupom com ele.</p>
          ) : sameUnit.length === 0 ? (
            <p className="text-xs text-zinc-500 leading-relaxed" data-testid="nearby-empty">Ninguém registrou {titleCase(resolved.master_description || sample.description)} em {radius} km nos últimos 60 dias. Que tal um alerta?</p>
          ) : (
            <div className="rounded-xl border border-white/5 overflow-hidden divide-y divide-white/5" data-testid="nearby-list">
              {sameUnit.slice(0, 6).map((r, i) => {
                const diff = sample.unitPrice > 0 ? ((r.unit_price - sample.unitPrice) / sample.unitPrice) * 100 : null;
                return (
                  <div key={r.establishment_id} data-nearby={r.establishment_id} className="flex items-center gap-3 px-4 py-3 bg-black/30">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-200 truncate">{titleCase(r.establishment_name)}</p>
                      <p className="text-[11px] text-zinc-600 truncate mt-0.5">{String(r.distance_km).replace('.', ',')} km · visto em {dayMonth(r.observed_on)}{r.address ? ` · ${r.address}` : ''}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`block text-sm font-mono font-bold tabular-nums ${i === 0 ? 'text-emerald-400' : 'text-white'}`}>{brl.format(r.unit_price)}</span>
                      {diff !== null && Math.abs(diff) >= 1 && (
                        <span className={`block text-[10px] font-bold mt-0.5 ${diff < 0 ? 'text-emerald-500' : 'text-red-500'}`}>{diff < 0 ? '' : '+'}{Math.round(diff)}% do seu último</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {resolved?.master_product_id && (
            <button
              onClick={() => onCreateAlert({
                master_product_id: resolved.master_product_id as string,
                label: resolved.master_description || sample.description,
                unit_type: unit,
                max_price: best ? Math.min(best.unit_price, sample.unitPrice) : sample.unitPrice,
              })}
              data-testid="nearby-alert"
              className="mt-4 flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-luxury-gold hover:text-white transition-colors">
              <BellPlus className="w-4 h-4" /> Avisar quando aparecer mais barato
            </button>
          )}
        </>
      )}
    </>
  );
};

export default NearbyPricesCard;
