import { supabase, supabaseUrl, supabaseAnonKey } from './supabaseClient';
import { isNativeApp, APP_SCHEME, NATIVE_AUTH_REDIRECT } from './platform';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import type { Session, User } from '@supabase/supabase-js';

export interface UserProfile {
  id: string;
  display_name: string | null;
  ai_provider: 'gemini' | 'openai' | 'anthropic' | 'openrouter';
  plan: 'free' | 'paid';
  revenuecat_app_user_id: string | null;
}

export const signUp = async (email: string, password: string, displayName?: string) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) throw error;
  return data;
};

export const signIn = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
};

/* ───────────────────────── Google ───────────────────────── */

// Pergunta ao Supabase se o Google já foi ligado no painel. Sem isso, o clique levaria a uma
// página de erro em JSON; assim dá para avisar com clareza.
export const googleEnabled = async (): Promise<boolean> => {
  const res = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseAnonKey } });
  if (!res.ok) throw new Error('Não consegui falar com o servidor de login.');
  const settings = await res.json();
  return Boolean(settings?.external?.google);
};

// Na web a volta do login é a própria página onde o app está (pode ser uma subpasta, como /Eukasconta/), sem busca nem #.
export const webAuthRedirect = (): string => `${window.location.origin}${window.location.pathname.replace(/index\.html$/, '')}`;

export const signInWithGoogle = async (): Promise<void> => {
  if (!(await googleEnabled())) throw new Error('GOOGLE_NOT_ENABLED');
  const native = isNativeApp();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: native ? NATIVE_AUTH_REDIRECT : webAuthRedirect(),
      skipBrowserRedirect: native,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
  // No navegador a própria biblioteca já redirecionou. No app, abre o login numa aba segura do Chrome.
  if (native && data?.url) await Browser.open({ url: data.url });
};

// Recebe o link de volta do login (app Android) e troca o código por uma sessão.
// Devolve true quando era um retorno de login e deu certo; false quando o link não é do login.
export const completeOAuthFromUrl = async (url: string): Promise<boolean> => {
  if (!url.startsWith(`${APP_SCHEME}://`)) return false;
  const u = new URL(url);
  const query = u.searchParams;
  const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
  const failure = query.get('error_description') || hash.get('error_description') || query.get('error') || hash.get('error');
  if (failure) throw new Error(failure);
  const code = query.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return true;
  }
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) throw error;
    return true;
  }
  return false;
};

// Só no app Android: fica escutando o link de volta do login (também quando o app estava fechado).
export const listenForOAuthRedirects = (onError: (message: string) => void): (() => void) => {
  if (!isNativeApp()) return () => {};
  const handled = new Set<string>();
  const handle = async (url?: string | null) => {
    if (!url || !url.startsWith(`${APP_SCHEME}://`) || handled.has(url)) return;
    handled.add(url);
    try { await Browser.close(); } catch { /* a aba já fechou */ }
    try { await completeOAuthFromUrl(url); }
    catch (e: any) { onError(e?.message || 'Não foi possível concluir o login.'); }
  };
  let alive = true;
  let remove: (() => void) | undefined;
  CapApp.addListener('appUrlOpen', ev => { void handle(ev.url); })
    .then(h => { if (alive) remove = () => h.remove(); else h.remove(); })
    .catch(() => {});
  CapApp.getLaunchUrl().then(r => handle(r?.url)).catch(() => {});
  return () => { alive = false; remove?.(); };
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

export const getSession = async (): Promise<Session | null> => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
};

export const onAuthStateChange = (callback: (user: User | null) => void) => {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return data.subscription;
};

export const getProfile = async (userId: string): Promise<UserProfile | null> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, ai_provider, plan, revenuecat_app_user_id')
    .eq('id', userId)
    .single();
  if (error) {
    console.error('Erro ao buscar perfil:', error.message);
    return null;
  }
  return data as UserProfile;
};

// Só nome e preferência de IA: plano e RevenueCat são alterados pelo servidor.
export const updateProfile = async (userId: string, updates: Partial<Pick<UserProfile, 'display_name' | 'ai_provider'>>) => {
  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId);
  if (error) throw error;
};
