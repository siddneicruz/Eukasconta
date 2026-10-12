import { createClient } from '@supabase/supabase-js';
import { isNativeApp } from './platform';

// Projeto "Leitura de Cupons Eukasconta". A URL e a chave publicável são públicas por design:
// quem protege os dados é o RLS do banco, não o sigilo da chave. Um .env.local com
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (ou VITE_SUPABASE_PUBLISHABLE_KEY) sobrescreve estes valores.
const DEFAULT_URL = 'https://zmsqyhevruykpmyfzkfe.supabase.co';
const DEFAULT_KEY = 'sb_publishable_QFXhq07fgxkPvoYEsy8CZg_FEy-vU-g';

const env = import.meta.env as Record<string, string | undefined>;
const supabaseUrl = env.VITE_SUPABASE_URL || DEFAULT_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_KEY;

export { supabaseUrl, supabaseAnonKey };

// PKCE: no login com Google o app recebe só um código de uso único (inútil sem o segredo guardado
// neste aparelho), nunca o token em si. No app Android a volta chega por link próprio
// (br.com.eukasconta.app://auth/callback) e é tratada em authService, não pela leitura automática da URL.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: !isNativeApp(),
    persistSession: true,
    autoRefreshToken: true,
  },
});

export const isSupabaseConfigured = (): boolean => Boolean(supabaseUrl && supabaseAnonKey);
