import React, { useEffect, useState } from 'react';
import { X, PlayCircle, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { fetchReadStatus, watchRewardVideo, ReadStatus } from '../services/rewardVideo';

/* Aparece quando as leituras grátis do dia acabaram: assistir a um vídeo libera mais uma leitura.
   O crédito é pago pelo servidor depois que o Google confirma o vídeo; a tela só espera o saldo subir. */
interface Props { onClose: () => void }

const RewardVideoSheet: React.FC<Props> = ({ onClose }) => {
  const [status, setStatus] = useState<ReadStatus | null>(null);
  const [busy, setBusy] = useState<string>('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'erro'; text: string } | null>(null);

  const refresh = () => { void fetchReadStatus().then(setStatus); };
  useEffect(refresh, []);

  const watch = async () => {
    setMsg(null); setBusy('Preparando...');
    const r = await watchRewardVideo(setBusy);
    setBusy('');
    if (r.ok === false) setMsg({ kind: 'erro', text: r.message });
    else if (r.credited) setMsg({ kind: 'ok', text: 'Pronto! Você ganhou 1 leitura. Pode ler o cupom de novo.' });
    else setMsg({ kind: 'erro', text: 'O vídeo terminou, mas o crédito ainda não chegou. Aguarde um instante e tente ler o cupom; se não liberar, tente de novo.' });
    refresh();
  };

  const capVideos = 10;
  const noMore = (status?.videos_today ?? 0) >= capVideos;

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true" data-testid="reward-sheet">
      <div className="w-full max-w-md rounded-3xl bg-[#fbf8ef] border border-[#e6dfc9] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-[#2b2616]">Suas leituras grátis de hoje acabaram</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-1 rounded-full hover:bg-black/5"><X className="w-5 h-5" /></button>
        </div>
        <p className="mt-2 text-sm text-[#5c553c]">
          Cada conta tem {status?.free_cap ?? 5} leituras grátis por dia. Para ler mais um cupom hoje, assista a um vídeo curto: cada vídeo libera 1 leitura.
        </p>
        <p className="mt-2 text-xs text-[#7b7459]">
          Créditos agora: <b>{status?.balance ?? 0}</b> · Vídeos hoje: <b>{status?.videos_today ?? 0}</b> de {capVideos}
        </p>
        {msg && (
          <div className={`mt-3 flex items-start gap-2 rounded-xl p-3 text-sm ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
            {msg.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}
        <button
          onClick={watch}
          disabled={!!busy || noMore}
          data-testid="reward-watch"
          className="mt-4 w-full flex items-center justify-center gap-2 rounded-2xl bg-[#d9b44a] py-3 font-semibold text-[#2b2616] disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlayCircle className="w-5 h-5" />}
          {busy || (noMore ? 'Limite de vídeos de hoje atingido' : 'Assistir vídeo e liberar 1 leitura')}
        </button>
        <p className="mt-3 text-[11px] leading-snug text-[#7b7459]">
          O vídeo é um anúncio de terceiros. Ao assistir você concorda com o uso do identificador de publicidade do aparelho, conforme a tela de consentimento.
        </p>
      </div>
    </div>
  );
};

export default RewardVideoSheet;
