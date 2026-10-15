import React, { useEffect, useState } from 'react';
import { Download, Loader2, Trash2, WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { formatMB } from '../services/offlineMaps';
import type { useOfflineMaps } from '../services/useOfflineMaps';

type Maps = ReturnType<typeof useOfflineMaps>;

const dayMonthYear = (ts: number) => new Date(ts).toLocaleDateString('pt-BR');

/* Cartão "Mapa sem internet": baixa uma vez as áreas que cobrem as lojas e deixa guardado no celular. */
const OfflineMapCard: React.FC<{ maps: Maps; hasPoints: boolean }> = ({ maps, hasPoints }) => {
  const { saved, savedLoaded, manifest, manifestState, loadManifest, missing, outdated, dl, download, update, cancel, remove } = maps;

  // apagar pede confirmação no próprio botão (um segundo toque em até 4 s)
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const savedBytes = saved.reduce((a, c) => a + c.bytes, 0);
  const missingBytes = missing.reduce((a, c) => a + c.bytes, 0);
  const lastSaved = saved.length ? Math.max(...saved.map(s => s.savedAt)) : 0;
  const running = dl.status === 'running';
  const pct = dl.status === 'running' && dl.progress.total ? Math.min(100, Math.round((dl.progress.done / dl.progress.total) * 100)) : 0;

  let body: React.ReactNode;
  if (running && dl.status === 'running') {
    body = (
      <>
        <p className="text-sm text-zinc-300 tabular-nums" data-testid="offmap-progress-text">
          Baixando {formatMB(dl.progress.done)} de {formatMB(dl.progress.total)}
          {dl.progress.count > 1 ? ` · área ${dl.progress.index} de ${dl.progress.count}` : ''}
        </p>
        <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-luxury-gold transition-[width] duration-300" style={{ width: `${pct}%` }} data-testid="offmap-bar" />
        </div>
        <button onClick={cancel} data-testid="offmap-cancel" className="mt-3 w-full py-3 rounded-2xl bg-white/5 border border-white/10 text-zinc-300 text-xs font-bold active:scale-[0.98]">
          Cancelar
        </button>
      </>
    );
  } else if (!savedLoaded) {
    body = <p className="text-sm text-zinc-500">Verificando…</p>;
  } else if (!manifest && manifestState === 'loading') {
    body = <p className="inline-flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /> Consultando os mapas disponíveis…</p>;
  } else if (!manifest && saved.length === 0) {
    body = (
      <>
        <p className="text-sm text-zinc-400">Não consegui ver os mapas disponíveis agora. É preciso internet para baixar.</p>
        <button onClick={loadManifest} data-testid="offmap-retry" className="mt-3 w-full py-3 rounded-2xl bg-white/5 border border-white/10 text-zinc-200 text-xs font-bold">Tentar de novo</button>
      </>
    );
  } else {
    body = (
      <>
        {saved.length > 0 && (
          <p className="flex items-start gap-2 text-sm text-zinc-300" data-testid="offmap-saved">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <span>Mapa salvo no celular: {formatMB(savedBytes)} · {saved.length} {saved.length === 1 ? 'área' : 'áreas'}<span className="text-zinc-500"> · {dayMonthYear(lastSaved)}</span></span>
          </p>
        )}

        {missing.length > 0 && (
          <>
            <p className="text-sm text-zinc-400 mt-1 leading-relaxed" data-testid="offmap-missing">
              {saved.length === 0
                ? 'Baixe o mapa da região das suas lojas uma vez: ele fica guardado no celular, abre na hora e funciona sem internet.'
                : `Faltam ${missing.length} ${missing.length === 1 ? 'área' : 'áreas'} para cobrir todas as suas lojas.`}
            </p>
            <button onClick={download} data-testid="offmap-download"
              className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-luxury-gold text-black text-xs font-bold active:scale-[0.98] transition-transform">
              <Download className="w-4 h-4" /> Baixar mapa · {formatMB(missingBytes)}
            </button>
            {missingBytes > 40e6 && <p className="mt-2 text-[11px] text-zinc-600">É um arquivo grande: prefira o Wi-Fi.</p>}
          </>
        )}

        {missing.length === 0 && saved.length === 0 && (
          <p className="text-sm text-zinc-400 leading-relaxed" data-testid="offmap-none">
            {hasPoints
              ? 'Ainda não temos mapa salvo para a região das suas lojas. Por enquanto o mapa funciona só com internet.'
              : 'Assim que as lojas forem localizadas, mostro aqui o mapa da região para baixar.'}
          </p>
        )}

        {outdated && missing.length === 0 && (
          <button onClick={update} data-testid="offmap-update"
            className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-luxury-gold/10 border border-luxury-gold/25 text-luxury-gold text-xs font-bold active:scale-[0.98]">
            <RefreshCw className="w-4 h-4" /> Há uma versão mais nova do mapa · Atualizar
          </button>
        )}

        {saved.length > 0 && (
          <button
            onClick={() => { if (confirmDelete) { setConfirmDelete(false); remove(); } else setConfirmDelete(true); }}
            data-testid="offmap-delete"
            className={`mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border text-xs font-bold active:scale-[0.98] ${confirmDelete ? 'border-red-500/40 bg-red-500/10 text-red-400' : 'border-white/10 bg-white/[0.03] text-zinc-400'}`}>
            <Trash2 className="w-4 h-4" /> {confirmDelete ? 'Toque de novo para apagar' : 'Apagar mapa salvo'}
          </button>
        )}
      </>
    );
  }

  return (
    <section className="mt-4 rounded-3xl border border-white/10 bg-white/[0.03] p-4 md:p-5" data-testid="offmap-card" aria-label="Mapa sem internet">
      <div className="flex items-center gap-2 mb-2">
        <WifiOff className="w-4 h-4 text-luxury-gold" />
        <h3 className="text-sm font-bold text-white">Mapa sem internet</h3>
      </div>
      {body}
      {dl.status === 'error' && (
        <div className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300 leading-relaxed" data-testid="offmap-error">
          {dl.message}
          <button onClick={missing.length ? download : update} className="block mt-2 font-bold text-red-200 underline">Tentar de novo</button>
        </div>
      )}
      <p className="mt-3 text-[10px] text-zinc-600 leading-relaxed">
        Dados © colaboradores do OpenStreetMap (licença ODbL), em mapa montado com Protomaps. O servidor de imagens do OpenStreetMap não permite baixar para uso offline; por isso o mapa salvo é montado a partir dos dados.
      </p>
    </section>
  );
};

export default OfflineMapCard;
