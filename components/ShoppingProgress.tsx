import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle, Sparkles } from 'lucide-react';
import { ProgressState, StepState, aiPending, percentOf, secs, stamp } from '../services/shoppingProgress';

/* Andamento da lista de compras, no mesmo jeito da leitura de cupons: as etapas (conectar na IA, analisar as compras,
   calcular, separar por compra...), o que cada uma achou e um registro ao vivo. A pessoa vê onde está e pode seguir sem a IA. */

const Icon: React.FC<{ st: StepState }> = ({ st }) => {
  if (st.status === 'done') return <CheckCircle2 className="w-5 h-5 text-emerald-400" aria-hidden="true" />;
  if (st.status === 'run') return <Loader2 className="w-5 h-5 text-luxury-gold animate-spin" aria-hidden="true" />;
  if (st.status === 'fail') return <XCircle className="w-5 h-5 text-rose-400" aria-hidden="true" />;
  if (st.status === 'skip') return <MinusCircle className="w-5 h-5 text-zinc-500" aria-hidden="true" />;
  return <Circle className="w-5 h-5 text-zinc-600" aria-hidden="true" />;
};

const STATUS_TEXT: Record<StepState['status'], string> = { wait: 'aguardando', run: 'em andamento', done: 'concluída', skip: 'pulada', fail: 'falhou' };

const ShoppingProgress: React.FC<{
  state: ProgressState;
  aiLabel: string;
  onSkipAi: () => void;
  onCancel: () => void;
}> = ({ state, aiLabel, onSkipAi, onCancel }) => {
  const [now, setNow] = useState(() => Date.now());
  const logRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  // o formulário estava rolado até o fim: o andamento começa mostrando o topo
  useEffect(() => { topRef.current?.scrollIntoView?.({ block: 'start' }); }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.logs.length]);

  const pct = percentOf(state);
  const current = state.steps.find(s => s.status === 'run');
  const doneCount = state.steps.filter(s => s.status === 'done' || s.status === 'skip' || s.status === 'fail').length;
  const canSkip = aiPending(state);

  return (
    <div ref={topRef} className="space-y-3 scroll-mt-20" data-testid="shop-gen-progress">
      <section className="bg-[#121214] border border-white/5 rounded-2xl p-4 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0 w-14 h-14">
            <Loader2 className="w-14 h-14 text-luxury-gold animate-spin" aria-hidden="true" />
            <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white tabular-nums" data-testid="shop-progress-pct">{pct}%</span>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-serif font-bold text-white leading-tight">Montando sua lista</h2>
            <p className="text-[12px] text-zinc-400 mt-0.5 leading-snug" data-testid="shop-progress-now" aria-live="polite">
              {current ? current.label : 'Quase pronta'} · {secs(now - state.startedAt)} no total
            </p>
            <p className="text-[11px] text-zinc-500 tabular-nums">Etapa {Math.min(doneCount + 1, state.steps.length)} de {state.steps.length}</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Andamento da lista">
          <div className="h-full bg-luxury-gold rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </section>

      <section className="bg-[#121214] border border-white/5 rounded-2xl p-2 shadow-xl">
        <ol data-testid="shop-steps">
          {state.steps.map(st => {
            const time = st.status === 'run' && st.since != null ? secs(now - st.since) : st.took != null && st.took >= 1500 ? secs(st.took) : '';
            return (
              <li key={st.id} data-testid="shop-step" data-step={st.id} data-status={st.status}
                className={`flex items-start gap-3 rounded-xl px-3 py-2.5 ${st.status === 'run' ? 'bg-luxury-gold/[0.07]' : ''}`}>
                <span className="mt-0.5 shrink-0"><Icon st={st} /></span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[14px] leading-snug ${st.status === 'wait' ? 'text-zinc-500' : st.status === 'skip' ? 'text-zinc-400' : 'text-zinc-100 font-semibold'}`}>
                    {st.label}<span className="sr-only"> — {STATUS_TEXT[st.status]}</span>
                  </span>
                  {st.detail && <span className={`block text-[11.5px] leading-snug mt-0.5 break-words ${st.status === 'fail' ? 'text-rose-400' : 'text-zinc-500'}`} data-testid="shop-step-detail">{st.detail}</span>}
                  {st.status === 'run' && st.ai && <span className="block text-[11px] text-zinc-500 mt-0.5">Os modelos grátis podem demorar um pouco; sigo sem a IA se passar do limite.</span>}
                </span>
                {time && <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums mt-0.5">{time}</span>}
              </li>
            );
          })}
        </ol>
      </section>

      <div className="flex gap-2">
        {canSkip && (
          <button type="button" onClick={onSkipAi} data-testid="shop-skip-ai"
            className="flex-1 min-h-[48px] rounded-xl border border-luxury-gold/50 text-luxury-gold text-[13px] font-bold flex items-center justify-center gap-1.5 active:opacity-80">
            <Sparkles className="w-4 h-4" /> Seguir sem a IA
          </button>
        )}
        <button type="button" onClick={onCancel} data-testid="shop-cancel-gen"
          className={`${canSkip ? 'w-28' : 'flex-1'} min-h-[48px] rounded-xl border border-white/10 text-zinc-300 text-[13px] font-semibold active:opacity-80`}>
          Cancelar
        </button>
      </div>

      <section className="bg-[#121214] border border-white/5 rounded-2xl p-3 shadow-xl">
        <h3 className="text-[11px] font-semibold text-zinc-400 px-1 mb-1.5">Registro ao vivo{aiLabel ? ` · ${aiLabel}` : ''}</h3>
        <div ref={logRef} className="h-40 overflow-y-auto rounded-xl bg-white/5 border border-white/5 p-3" data-testid="shop-log" role="log" aria-live="off">
          {state.logs.map((l, i) => (
            <p key={i} className="text-[11.5px] leading-snug text-zinc-400 font-mono mb-1.5 last:mb-0 break-words" data-testid="shop-log-line">
              <span className="text-zinc-600 mr-1.5 tabular-nums">{stamp(l.at)}</span>{l.text}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
};

export default ShoppingProgress;
