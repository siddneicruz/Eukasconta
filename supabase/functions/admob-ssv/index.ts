// Verificação do lado do servidor (SSV) do AdMob: o Google chama esta URL quando alguém termina um vídeo com recompensa.
// Confere a assinatura do Google, a unidade de anúncio permitida (secret REWARD_AD_UNITS, separadas por vírgula) e paga 1 crédito.
// Sem REWARD_AD_UNITS a função recusa tudo (não paga nada). verify_jwt = false (quem chama é o Google).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
let cache: { at: number; keys: Record<string, string> } = { at: 0, keys: {} };

const fromB64 = (s: string): Uint8Array => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

// Assinatura ECDSA do Google vem em DER; o WebCrypto quer r||s (64 bytes).
const derToRaw = (der: Uint8Array): Uint8Array => {
  let o = 2;
  if (der[1] & 0x80) o = 2 + (der[1] & 0x7f);
  const rl = der[o + 1];
  const r = der.slice(o + 2, o + 2 + rl);
  o = o + 2 + rl;
  const sl = der[o + 1];
  const s = der.slice(o + 2, o + 2 + sl);
  const fix = (x: Uint8Array) => {
    while (x.length > 32 && x[0] === 0) x = x.slice(1);
    const out = new Uint8Array(32);
    out.set(x, 32 - x.length);
    return out;
  };
  const out = new Uint8Array(64);
  out.set(fix(r), 0);
  out.set(fix(s), 32);
  return out;
};

const googleKeys = async (): Promise<Record<string, string>> => {
  if (Date.now() - cache.at < 6 * 3600_000 && Object.keys(cache.keys).length) return cache.keys;
  const res = await fetch(KEYS_URL, { signal: AbortSignal.timeout(10_000) });
  const data = await res.json();
  const keys: Record<string, string> = {};
  for (const k of data?.keys || []) keys[String(k.keyId)] = k.base64;
  cache = { at: Date.now(), keys };
  return keys;
};

const verify = async (query: string): Promise<boolean> => {
  const i = query.indexOf('&signature=');
  if (i < 0) return false;
  const signed = query.slice(0, i);
  const p = new URLSearchParams(query);
  const sig = p.get('signature');
  const keyId = p.get('key_id');
  if (!sig || !keyId) return false;
  let keys = await googleKeys();
  if (!keys[keyId]) { cache.at = 0; keys = await googleKeys(); }
  if (!keys[keyId]) return false;
  const key = await crypto.subtle.importKey('spki', fromB64(keys[keyId]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(fromB64(sig)), new TextEncoder().encode(signed));
};

const text = (status: number, body: string) => new Response(body, { status });

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') return text(405, 'método não permitido');
  const allowed = (Deno.env.get('REWARD_AD_UNITS') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return text(503, 'não configurado');

  const query = new URL(req.url).search.replace(/^\?/, '');
  let okSig = false;
  try { okSig = await verify(query); } catch { okSig = false; }
  if (!okSig) return text(400, 'assinatura inválida');

  const p = new URLSearchParams(query);
  const adUnit = p.get('ad_unit') || '';
  const userId = p.get('user_id') || '';
  const tx = p.get('transaction_id') || '';
  if (!allowed.includes(adUnit)) return text(400, 'unidade de anúncio não permitida');
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !tx) return text(400, 'pedido incompleto');

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const maxDay = Number(Deno.env.get('MAX_VIDEOS_DAY')) || 10;
  const { data, error } = await admin.rpc('srv_video_reward', { p_user: userId, p_tx: tx, p_ad_unit: adUnit, p_amount: 1, p_max_day: maxDay });
  if (error) return text(500, 'erro');
  // Mesmo recusado por limite diário, responde 200 para o Google não repetir a chamada.
  return text(200, data?.ok ? 'ok' : String(data?.reason || 'recusado'));
});
