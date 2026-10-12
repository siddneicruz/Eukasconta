import React, { useState } from 'react';
import { UserRound, LogOut, Loader2, ShieldCheck, Share2, BellRing, Send, Bell, Info, MailCheck, CloudOff } from 'lucide-react';
import type { CloudApi } from '../services/useCloud';

const Switch: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }> = ({ on, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!on)}
    className={`relative w-12 h-7 rounded-full border transition-all shrink-0 disabled:opacity-40 ${on ? 'bg-luxury-gold border-luxury-gold' : 'bg-white/5 border-white/15'}`}
  >
    <span className={`absolute top-0.5 w-5 h-5 rounded-full transition-all ${on ? 'left-6 bg-black' : 'left-0.5 bg-zinc-400'}`} />
  </button>
);

interface Props {
  cloud: CloudApi;
  onOpenAlerts: () => void;
}

const RADII = [2, 5, 8, 15, 30];

const CloudAccountPanel: React.FC<Props> = ({ cloud, onOpenAlerts }) => {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [working, setWorking] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  if (!cloud.available) {
    return (
      <div className="p-5 md:p-8 bg-white/[0.02] border border-white/5 rounded-[2rem] md:rounded-[2.5rem] animate-in slide-in-from-bottom-4 duration-500">
        <h3 className="text-xl font-serif text-white uppercase tracking-tight flex items-center gap-3"><CloudOff className="w-5 h-5 text-zinc-500" /> Conta na nuvem</h3>
        <p className="text-sm text-zinc-500 mt-4 leading-relaxed">A nuvem ainda não está ligada neste app. O resto funciona normalmente, só no seu aparelho.</p>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setInfo(null); setGoogleError(null); setWorking(true);
    try {
      if (mode === 'in') {
        await cloud.signIn(email, password);
      } else {
        const entered = await cloud.signUp(email, password, name);
        if (!entered) setInfo('Conta criada. Enviamos um e-mail de confirmação: clique no link e depois volte aqui para entrar.');
      }
      setPassword('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  };

  const loginWithGoogle = async () => {
    setError(null); setInfo(null); setGoogleError(null); setGoogleBusy(true);
    try {
      await cloud.signInWithGoogle();
    } catch (err: any) {
      setGoogleError(err.message);
    } finally {
      setGoogleBusy(false);
    }
  };

  const change = async (patch: Parameters<CloudApi['updatePrivacy']>[0]) => {
    setSaveErr(null);
    try { await cloud.updatePrivacy(patch); } catch (err: any) { setSaveErr(err.message); }
  };

  const pending = cloud.user ? cloud.pendingHistory().length : 0;
  const runShare = async () => {
    setShareMsg(null); setProgress({ done: 0, total: Math.min(pending, 75) });
    const res = await cloud.shareHistory((done, total) => setProgress({ done, total }));
    setProgress(null);
    setShareMsg(
      res.limited
        ? `Enviados ${res.sent} cupons. Chegou ao limite de 80 por dia — o resto segue amanhã.`
        : `Enviados ${res.sent} cupons${res.skipped ? ` (${res.skipped} ignorados por CNPJ inválido ou erro)` : ''}.`
    );
  };

  if (!cloud.ready) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 text-luxury-gold animate-spin" /></div>;
  }

  /* ── sem login ── */
  if (!cloud.user) {
    return (
      <div className="animate-in slide-in-from-bottom-4 duration-500 space-y-6">
        <div className="p-5 md:p-8 bg-white/[0.02] border border-white/5 rounded-[2rem] md:rounded-[2.5rem]">
          <h3 className="text-xl font-serif text-white uppercase tracking-tight flex items-center gap-3"><UserRound className="w-5 h-5 text-luxury-gold" /> Conta na nuvem</h3>
          <p className="text-zinc-500 text-[11px] uppercase font-bold mt-1 tracking-[0.08em] max-w-md">Opcional. Seus cupons continuam no aparelho.</p>

          <button type="button" onClick={loginWithGoogle} disabled={googleBusy || working} data-testid="google-login"
            className="mt-6 w-full flex items-center justify-center gap-3 py-4 rounded-xl bg-white/5 border border-white/15 text-zinc-100 text-[11px] font-bold uppercase tracking-[0.08em] hover:border-luxury-gold/50 transition-all disabled:opacity-50">
            {googleBusy
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center text-xs font-black leading-none" aria-hidden="true">G</span>}
            Continuar com Google
          </button>
          {googleError && <div className="mt-3 px-5 py-4 rounded-xl bg-red-950/20 border border-red-900/30 text-red-300 text-xs" data-testid="google-error">{googleError}</div>}

          <div className="flex items-center gap-3 mt-6 text-[11px] uppercase tracking-[0.08em] font-bold text-zinc-500"><span className="flex-1 h-px bg-white/5" />ou com e-mail<span className="flex-1 h-px bg-white/5" /></div>

          <div className="grid grid-cols-2 bg-black/40 p-1 rounded-2xl border border-white/5 my-6 gap-1">
            {(['in', 'up'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setError(null); setInfo(null); }}
                className={`py-3 rounded-xl text-[11px] font-bold uppercase tracking-[0.08em] transition-all ${mode === m ? 'bg-luxury-gold text-black shadow-lg shadow-luxury-gold/20' : 'text-zinc-500 hover:text-white'}`}>
                {m === 'in' ? 'Entrar' : 'Criar conta'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === 'up' && (
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Seu nome (opcional)" autoComplete="name"
                className="w-full bg-black/60 border border-white/10 rounded-xl py-4 px-4 text-sm text-zinc-100 focus:border-luxury-gold/50 outline-none" />
            )}
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail" autoComplete="email" inputMode="email"
              className="w-full bg-black/60 border border-white/10 rounded-xl py-4 px-4 text-sm text-zinc-100 focus:border-luxury-gold/50 outline-none" />
            <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Senha (mínimo 6 caracteres)"
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              className="w-full bg-black/60 border border-white/10 rounded-xl py-4 px-4 text-sm text-zinc-100 focus:border-luxury-gold/50 outline-none" />
            {error && <div className="px-5 py-4 rounded-xl bg-red-950/20 border border-red-900/30 text-red-300 text-xs">{error}</div>}
            {info && <div className="px-5 py-4 rounded-xl bg-emerald-950/20 border border-emerald-900/30 text-emerald-400 text-xs flex gap-3"><MailCheck className="w-4 h-4 shrink-0 mt-0.5" />{info}</div>}
            <button type="submit" disabled={working}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-luxury-gold text-black text-[11px] font-bold uppercase tracking-[0.08em] hover:bg-white transition-all disabled:opacity-50">
              {working && <Loader2 className="w-4 h-4 animate-spin" />}{mode === 'in' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>
        </div>

        <div className="p-5 md:p-8 bg-white/[0.02] border border-white/5 rounded-[2rem] space-y-4">
          <div className="flex gap-3"><Share2 className="w-4 h-4 text-luxury-gold shrink-0 mt-0.5" /><p className="text-xs text-zinc-400 leading-relaxed">Com a conta, os preços que você escaneia ajudam todo mundo a achar a loja mais barata — e você recebe o mesmo dos outros.</p></div>
          <div className="flex gap-3"><BellRing className="w-4 h-4 text-luxury-gold shrink-0 mt-0.5" /><p className="text-xs text-zinc-400 leading-relaxed">Crie alertas: o app avisa quando alguém comprar um item no preço que você quer, ou em uma loja perto de você.</p></div>
          <div className="flex gap-3"><ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /><p className="text-xs text-zinc-400 leading-relaxed">O cadastro comum guarda só loja, produto, preço, unidade e dia. Nada disso aparece ligado ao seu nome.</p></div>
        </div>
      </div>
    );
  }

  /* ── logado ── */
  const p = cloud.profile;
  return (
    <div className="animate-in slide-in-from-bottom-4 duration-500 space-y-6">
      <div className="p-5 md:p-8 bg-white/[0.02] border border-white/5 rounded-[2rem] md:rounded-[2.5rem]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-luxury-gold/10 border border-luxury-gold/30 flex items-center justify-center shrink-0"><UserRound className="w-6 h-6 text-luxury-gold" /></div>
            <div className="min-w-0">
              <div className="text-white font-serif text-lg truncate" data-testid="account-name">{p?.display_name || 'Sua conta'}</div>
              <div className="text-xs text-zinc-500 truncate" data-testid="account-email">{cloud.user.email}</div>
            </div>
          </div>
          <button onClick={() => cloud.signOut()} className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-[11px] font-bold uppercase tracking-[0.08em] hover:border-red-500/40 hover:text-red-400 transition-all shrink-0">
            <LogOut className="w-4 h-4" /> Sair
          </button>
        </div>
        <button onClick={onOpenAlerts} className="mt-6 w-full flex items-center justify-between gap-3 px-5 py-4 rounded-2xl bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold text-[11px] font-bold uppercase tracking-[0.08em] hover:bg-luxury-gold/20 transition-all">
          <span className="flex items-center gap-3"><Bell className="w-4 h-4" /> Avisos e alertas</span>
          {cloud.unread > 0 && <span className="px-2.5 py-0.5 rounded-full bg-luxury-gold text-black text-xs">{cloud.unread} novo{cloud.unread > 1 ? 's' : ''}</span>}
        </button>
      </div>

      <div className="p-5 md:p-8 bg-white/[0.02] border border-white/5 rounded-[2rem] md:rounded-[2.5rem] space-y-8">
        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="text-sm text-white font-bold flex items-center gap-2"><Share2 className="w-4 h-4 text-luxury-gold" /> Compartilhar preços</div>
            <p className="text-xs text-zinc-500 mt-2 leading-relaxed">Ao escanear um cupom, loja, produto, preço, unidade e dia entram no cadastro comum. Sem seu nome, sem o total da compra e sem o cupom em si. Desligado: você também deixa de ver sugestões de preço menor.</p>
          </div>
          <Switch on={!!p?.share_prices} onChange={v => change({ share_prices: v })} label="Compartilhar preços" disabled={!p} />
        </div>

        <div className="flex items-start justify-between gap-5 pt-8 border-t border-white/5">
          <div>
            <div className="text-sm text-white font-bold flex items-center gap-2"><BellRing className="w-4 h-4 text-luxury-gold" /> Avisar quando achar mais barato perto</div>
            <p className="text-xs text-zinc-500 mt-2 leading-relaxed">Para comparar, seus cupons dos últimos 60 dias ficam guardados na nuvem, visíveis só para você. Desligar apaga essa cópia.</p>
            {p?.notify_cheaper_nearby && (
              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] uppercase tracking-[0.08em] text-zinc-500 font-bold mr-1">Raio</span>
                {RADII.map(r => (
                  <button key={r} onClick={() => change({ suggest_radius_km: r })}
                    className={`px-3.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-[0.08em] border transition-all ${Number(p.suggest_radius_km) === r ? 'bg-luxury-gold text-black border-luxury-gold' : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'}`}>
                    {r} km
                  </button>
                ))}
              </div>
            )}
          </div>
          <Switch on={!!p?.notify_cheaper_nearby} onChange={v => change({ notify_cheaper_nearby: v })} label="Avisar quando achar mais barato perto" disabled={!p} />
        </div>

        {saveErr && <div className="px-5 py-4 rounded-xl bg-red-950/20 border border-red-900/30 text-red-300 text-xs">{saveErr}</div>}

        {p?.share_prices && (
          <div className="pt-8 border-t border-white/5">
            <div className="text-sm text-white font-bold flex items-center gap-2"><Send className="w-4 h-4 text-luxury-gold" /> Compras recentes</div>
            <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
              {pending > 0
                ? `${pending} cupom${pending > 1 ? 's' : ''} dos últimos 90 dias ainda não ${pending > 1 ? 'foram enviados' : 'foi enviado'} ao cadastro comum.`
                : 'Tudo o que você escaneou nos últimos 90 dias já foi enviado.'}
            </p>
            {pending > 0 && (
              <button onClick={runShare} disabled={!!progress}
                className="mt-4 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-[11px] font-bold uppercase tracking-[0.08em] hover:border-luxury-gold/40 transition-all disabled:opacity-60">
                {progress ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando {progress.done}/{progress.total}</> : <><Send className="w-4 h-4 text-luxury-gold" /> Enviar agora</>}
              </button>
            )}
            {shareMsg && <p className="text-xs text-emerald-500 mt-3 leading-relaxed">{shareMsg}</p>}
          </div>
        )}
      </div>

      <div className="flex items-start gap-3 px-2">
        <Info className="w-4 h-4 text-zinc-600 shrink-0 mt-0.5" />
        <p className="text-xs text-zinc-500 leading-relaxed">Preços que fogem muito da faixa normal do produto são marcados e não geram sugestões nem alertas.</p>
      </div>
    </div>
  );
};

export default CloudAccountPanel;
