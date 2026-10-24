import React, { useEffect, useState } from 'react';
import { Loader2, MailCheck, DatabaseBackup, ShieldCheck } from 'lucide-react';
import { AppMark } from './Brand';
import type { CloudApi } from '../services/useCloud';

/* Tela de entrada da versão web: só com a conta (Google ou e-mail) o app abre e traz de volta os cupons do backup. */

const field = 'w-full bg-black/60 border border-white/10 rounded-xl py-4 px-4 text-sm text-zinc-100 focus:border-luxury-gold/50 outline-none';

// o Supabase devolve a pessoa com ?code=… (ou #access_token=…) enquanto a biblioteca troca isso por uma sessão
const returningFromLogin = (): boolean => {
  try { return /[?&]code=|access_token=/.test(window.location.search + window.location.hash); } catch { return false; }
};
const returnError = (): string | null => {
  try {
    const q = new URLSearchParams(window.location.search + '&' + window.location.hash.replace(/^#/, ''));
    return q.get('error_description') || null;
  } catch { return null; }
};

const WebLoginGate: React.FC<{ cloud: CloudApi }> = ({ cloud }) => {
  const [waiting, setWaiting] = useState(returningFromLogin);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(returnError());
  const [info, setInfo] = useState<string | null>(null);
  const [useEmail, setUseEmail] = useState(false);
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);

  // volta do Google: dá alguns segundos para a sessão aparecer antes de mostrar o botão de novo
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setWaiting(false), 9000);
    return () => clearTimeout(t);
  }, [waiting]);

  const google = async () => {
    setError(null); setInfo(null); setGoogleBusy(true);
    try { await cloud.signInWithGoogle(); }
    catch (e: any) { setError(e.message); setGoogleBusy(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setInfo(null); setWorking(true);
    try {
      if (mode === 'in') await cloud.signIn(email, password);
      else if (!(await cloud.signUp(email, password))) setInfo('Conta criada. Enviamos um e-mail de confirmação: clique no link e volte aqui para entrar.');
      setPassword('');
    } catch (err: any) { setError(err.message); }
    finally { setWorking(false); }
  };

  if (!cloud.ready || waiting) {
    return (
      <div className="min-h-[100dvh] bg-[#09090b] flex flex-col items-center justify-center gap-4" data-testid="web-gate-loading">
        <AppMark className="w-16 h-16" title="Eu Kasconta" />
        <Loader2 className="w-5 h-5 text-luxury-gold animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#09090b] text-zinc-100 flex items-center justify-center px-5 py-10" data-testid="web-gate">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <AppMark className="w-20 h-20 drop-shadow-[0_8px_30px_rgba(212,175,55,0.25)]" title="Eu Kasconta" />
          <h1 className="mt-6 text-3xl font-serif text-white uppercase tracking-tight">Eu Kasconta</h1>
          <p className="mt-2 text-[11px] uppercase font-bold tracking-[0.08em] text-zinc-500">Seus gastos, pelos cupons fiscais</p>
        </div>

        <div className="mt-8 p-5 md:p-8 bg-white/[0.02] border border-white/5 rounded-[2rem]">
          <button type="button" onClick={google} disabled={googleBusy || working} data-testid="web-google"
            className="w-full flex items-center justify-center gap-3 py-4 rounded-xl bg-luxury-gold text-black text-[11px] font-bold uppercase tracking-[0.08em] hover:bg-white transition-all disabled:opacity-50 active:opacity-80">
            {googleBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center text-xs font-black leading-none" aria-hidden="true">G</span>}
            Continuar com Google
          </button>

          {error && <div className="mt-3 px-5 py-4 rounded-xl bg-red-950/20 border border-red-900/30 text-red-300 text-xs" data-testid="web-gate-error">{error}</div>}

          {!useEmail ? (
            <button type="button" onClick={() => setUseEmail(true)} data-testid="web-email-toggle"
              className="mt-5 w-full text-center text-[11px] uppercase tracking-[0.08em] font-bold text-zinc-500 hover:text-zinc-300 transition-colors py-2">Entrar com e-mail</button>
          ) : (
            <>
              <div className="flex items-center gap-3 mt-6 text-[11px] uppercase tracking-[0.08em] font-bold text-zinc-500"><span className="flex-1 h-px bg-white/5" />com e-mail<span className="flex-1 h-px bg-white/5" /></div>
              <div className="grid grid-cols-2 bg-black/40 p-1 rounded-2xl border border-white/5 my-5 gap-1">
                {(['in', 'up'] as const).map(m => (
                  <button key={m} type="button" onClick={() => { setMode(m); setError(null); setInfo(null); }}
                    className={`py-3 rounded-xl text-[11px] font-bold uppercase tracking-[0.08em] transition-all ${mode === m ? 'bg-luxury-gold text-black' : 'text-zinc-500'}`}>
                    {m === 'in' ? 'Entrar' : 'Criar conta'}
                  </button>
                ))}
              </div>
              <form onSubmit={submit} className="space-y-3">
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail" autoComplete="email" inputMode="email" className={field} data-testid="web-email" />
                <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Senha (mínimo 6 caracteres)"
                  autoComplete={mode === 'in' ? 'current-password' : 'new-password'} className={field} data-testid="web-password" />
                {info && <div className="px-5 py-4 rounded-xl bg-emerald-950/20 border border-emerald-900/30 text-emerald-400 text-xs flex gap-3"><MailCheck className="w-4 h-4 shrink-0 mt-0.5" />{info}</div>}
                <button type="submit" disabled={working} data-testid="web-submit"
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-white/5 border border-white/15 text-zinc-100 text-[11px] font-bold uppercase tracking-[0.08em] hover:border-luxury-gold/50 transition-all disabled:opacity-50 active:opacity-80">
                  {working && <Loader2 className="w-4 h-4 animate-spin" />}{mode === 'in' ? 'Entrar' : 'Criar conta'}
                </button>
              </form>
            </>
          )}
        </div>

        <div className="mt-6 space-y-3 px-2">
          <div className="flex gap-3"><DatabaseBackup className="w-4 h-4 text-luxury-gold shrink-0 mt-0.5" /><p className="text-xs text-zinc-400 leading-relaxed">Ao entrar, seus cupons do backup da conta voltam sozinhos neste navegador.</p></div>
          <div className="flex gap-3"><ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /><p className="text-xs text-zinc-400 leading-relaxed">Use a mesma conta do app no celular para ver tudo junto.</p></div>
        </div>
      </div>
    </div>
  );
};

export default WebLoginGate;
