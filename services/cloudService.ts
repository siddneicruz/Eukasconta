// Camada de nuvem (Supabase): cadastro compartilhado de lojas e produtos, preços anônimos,
// sugestão de preço menor por perto, alertas e avisos. O app continua local-first: tudo aqui só roda
// com a pessoa logada, e qualquer falha de rede é tratada pelo chamador sem travar o app.
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { Receipt } from '../types';
import { cleanCNPJ } from './productNormalization';

export const cloudAvailable = isSupabaseConfigured;

/* ───────────────────────── tipos ───────────────────────── */

export interface CloudProfile {
  id: string;
  display_name: string | null;
  plan: 'free' | 'paid';
  share_prices: boolean;
  notify_cheaper_nearby: boolean;
  suggest_radius_km: number;
}

export interface ContributedItem {
  description: string;
  master_product_id: string;
  unit_type: string;
  paid_price: number;
  match: string;
}

export interface PriceSuggestion {
  description: string;
  master_product_id: string;
  unit_type: string;
  paid_price: number;
  cheaper_price: number;
  establishment_id: string;
  establishment_name: string;
  address: string | null;
  city: string | null;
  distance_km: number;
  observed_on: string;
  savings_pct: number;
}

export interface ContributeResult {
  status: 'ok' | 'duplicate' | 'skipped';
  reason?: 'opt_out' | 'invalid_cnpj' | 'invalid_date' | 'rate_limited';
  establishment_id?: string;
  needs_location?: boolean;
  items?: ContributedItem[];
  suggestions?: PriceSuggestion[];
}

export interface PriceAlert {
  id: string;
  master_product_id: string;
  label: string | null;
  unit_type: string | null;
  min_price: number | null;
  max_price: number | null;
  establishment_id: string | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_km: number | null;
  active: boolean;
  last_triggered_at: string | null;
  created_at: string;
}

export type NewPriceAlert = Pick<PriceAlert, 'master_product_id' | 'label' | 'unit_type' | 'min_price' | 'max_price' | 'center_lat' | 'center_lng' | 'radius_km'>;

export interface CloudNotification {
  id: string;
  alert_id: string | null;
  kind: 'alert' | 'cheaper_nearby';
  title: string;
  body: string;
  payload: Record<string, any>;
  read_at: string | null;
  created_at: string;
}

export interface ProductHit {
  id: string;
  code: string;
  description: string;
  unit_type: string;
  category: string;
  score: number;
}

export interface NearbyPrice {
  establishment_id: string;
  establishment_name: string;
  address: string | null;
  city: string | null;
  distance_km: number;
  unit_price: number;
  unit_type: string;
  observed_on: string;
}

export interface ResolvedItem {
  input: string;
  master_product_id: string | null;
  master_code: string | null;
  master_description: string | null;
  master_unit: string | null;
  master_category: string | null;
  match_kind: string | null;
}

/* ───────────────────────── util ───────────────────────── */

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};

const num = (v: any): number => (v === null || v === undefined ? NaN : Number(v));

export const friendlyAuthError = (message: string): string => {
  const m = (message || '').toLowerCase();
  if (m.includes('google_not_enabled') || m.includes('provider is not enabled') || m.includes('unsupported provider'))
    return 'O login com Google ainda não foi ativado neste projeto. No Supabase: Authentication → Sign In / Providers → Google.';
  if (m.includes('access_denied') || m.includes('user denied') || m.includes('cancel')) return 'Login com Google cancelado.';
  if (m.includes('code verifier') || m.includes('flow state') || m.includes('code challenge')) return 'O login expirou antes de terminar. Toque em "Continuar com Google" de novo.';
  if (m.includes('invalid login')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail (veja a caixa de entrada) antes de entrar.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Este e-mail já tem conta. Use "Entrar".';
  if (m.includes('password') && (m.includes('at least') || m.includes('weak') || m.includes('short'))) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas seguidas. Aguarde alguns minutos.';
  if (m.includes('invalid') && m.includes('email')) return 'E-mail inválido.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sem conexão com o servidor. Tente de novo.';
  return message || 'Não foi possível concluir. Tente de novo.';
};

/* ───────────────────────── perfil ───────────────────────── */

export const fetchProfile = async (userId: string): Promise<CloudProfile | null> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, plan, share_prices, notify_cheaper_nearby, suggest_radius_km')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { ...data, suggest_radius_km: num(data.suggest_radius_km) } as CloudProfile;
};

export const savePrivacy = async (
  userId: string,
  patch: Partial<Pick<CloudProfile, 'share_prices' | 'notify_cheaper_nearby' | 'suggest_radius_km' | 'display_name'>>
): Promise<void> => {
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw new Error(error.message);
};

/* ───────────────────────── cupom → cadastro comum ───────────────────────── */

export interface Coords { lat: number; lng: number }

// Só entram no cadastro compartilhado: loja (CNPJ, nome, endereço), produto, preço, unidade e dia.
export const receiptToPayload = (r: Receipt, coords?: Coords) => ({
  cnpj: cleanCNPJ(r.cnpj),
  name: r.establishmentName,
  address: r.address || '',
  city: r.city || '',
  state: r.state || '',
  date: r.date,
  time: r.time || '',
  receipt_number: r.receiptNumber || '',
  total: r.totalAmount,
  lat: coords?.lat ?? null,
  lng: coords?.lng ?? null,
  items: (r.items || []).map(i => ({
    description: i.description,
    quantity: i.quantity,
    unit_type: i.unitType || 'UN',
    unit_price: i.unitPrice,
    total_price: i.totalPrice,
    category: i.category,
  })),
});

export const contributeReceipt = (r: Receipt, coords?: Coords): Promise<ContributeResult> =>
  rpc<ContributeResult>('contribute_receipt', { p: receiptToPayload(r, coords) });

export const setEstablishmentLocation = (cnpj: string, lat: number, lng: number): Promise<boolean> =>
  rpc<boolean>('set_establishment_location', { p_cnpj: cleanCNPJ(cnpj), p_lat: lat, p_lng: lng });

export const priceSuggestions = (establishmentId: string, items: ContributedItem[], radiusKm = 8, days = 45): Promise<PriceSuggestion[]> =>
  rpc<PriceSuggestion[]>('price_suggestions', { p_establishment_id: establishmentId, p_items: items, p_radius_km: radiusKm, p_days: days });

/* ───────────────────────── consultas ───────────────────────── */

export const searchProducts = async (query: string, limit = 12): Promise<ProductHit[]> => {
  const rows = await rpc<any[]>('search_products', { p_query: query, p_limit: limit });
  return (rows || []).map(r => ({ ...r, score: num(r.score) }));
};

export const resolveItems = (cnpj: string, items: { description: string; unit_type?: string }[]): Promise<ResolvedItem[]> =>
  rpc<ResolvedItem[]>('resolve_items', { p_cnpj: cleanCNPJ(cnpj), p_items: items });

export const bestPricesNearby = async (masterId: string, at: Coords, radiusKm = 10, days = 60): Promise<NearbyPrice[]> => {
  const rows = await rpc<any[]>('best_prices_nearby', {
    p_master_product_id: masterId, p_lat: at.lat, p_lng: at.lng, p_radius_km: radiusKm, p_days: days,
  });
  return (rows || []).map(r => ({ ...r, distance_km: num(r.distance_km), unit_price: num(r.unit_price) }));
};

export const getCurrentPosition = (): Promise<Coords> =>
  new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Este aparelho não informa a localização.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(new Error(err.code === 1 ? 'Permissão de localização negada.' : 'Não consegui obter sua localização.')),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 }
    );
  });

/* ───────────────────────── alertas ───────────────────────── */

const normAlert = (a: any): PriceAlert => ({
  ...a,
  min_price: a.min_price === null ? null : num(a.min_price),
  max_price: a.max_price === null ? null : num(a.max_price),
  radius_km: a.radius_km === null ? null : num(a.radius_km),
});

export const listAlerts = async (): Promise<PriceAlert[]> => {
  const { data, error } = await supabase.from('price_alerts').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(normAlert);
};

export const createAlert = async (a: NewPriceAlert): Promise<PriceAlert> => {
  const { data, error } = await supabase.from('price_alerts').insert(a).select('*').single();
  if (error) throw new Error(error.message.startsWith('alert_limit') ? 'Limite de 50 alertas por conta.' : error.message);
  return normAlert(data);
};

export const setAlertActive = async (id: string, active: boolean): Promise<void> => {
  const { error } = await supabase.from('price_alerts').update({ active }).eq('id', id);
  if (error) throw new Error(error.message);
};

export const deleteAlert = async (id: string): Promise<void> => {
  const { error } = await supabase.from('price_alerts').delete().eq('id', id);
  if (error) throw new Error(error.message);
};

/* ───────────────────────── avisos ───────────────────────── */

export const listNotifications = async (limit = 60): Promise<CloudNotification[]> => {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, alert_id, kind, title, body, payload, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []) as CloudNotification[];
};

// ids omitido = marca todos os não lidos
export const markNotificationsRead = async (ids?: string[]): Promise<void> => {
  let q = supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
  if (ids) q = q.in('id', ids);
  const { error } = await q;
  if (error) throw new Error(error.message);
};

export const deleteNotification = async (id: string): Promise<void> => {
  const { error } = await supabase.from('notifications').delete().eq('id', id);
  if (error) throw new Error(error.message);
};

export const subscribeNotifications = (userId: string, onInsert: (n: CloudNotification) => void): (() => void) => {
  const channel = supabase
    .channel(`notifications-${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      payload => onInsert(payload.new as CloudNotification))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
};

/* ───────────────────────── cupons privados (base dos avisos "mais barato perto") ───────────────────────── */

const hashReceipt = (r: Receipt): string => {
  const base = [r.date, r.cnpj, r.totalAmount, (r.items || []).map(i => `${i.description}|${i.quantity}|${i.unitPrice}|${i.unitType || ''}`).join(';')].join('#');
  let h = 5381;
  for (let i = 0; i < base.length; i++) h = ((h << 5) + h + base.charCodeAt(i)) | 0;
  return String(h >>> 0);
};

const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// Envia (só os que mudaram) os cupons recentes da própria pessoa. Fica visível só para ela (RLS).
export const syncRecentReceipts = async (
  userId: string,
  receipts: Receipt[],
  alreadySynced: Record<string, string>,
  days = 60
): Promise<Record<string, string>> => {
  const limit = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const todo = receipts.filter(r => isoDay.test(r.date || '') && r.date >= limit && alreadySynced[r.id] !== hashReceipt(r));
  const done: Record<string, string> = { ...alreadySynced };

  for (const group of chunk(todo, 25)) {
    const rows = group.map(r => ({
      user_id: userId,
      client_id: r.id,
      cnpj: cleanCNPJ(r.cnpj) || null,
      establishment_name: r.establishmentName || '',
      receipt_number: r.receiptNumber || null,
      address: r.address || null,
      city: r.city || null,
      state: r.state || null,
      date: r.date,
      time: r.time || null,
      total_amount: Number(r.totalAmount) || 0,
      scanned_at: r.scannedAt && !isNaN(Date.parse(r.scannedAt)) ? new Date(r.scannedAt).toISOString() : null,
    }));
    const up = await supabase.from('receipts').upsert(rows, { onConflict: 'user_id,client_id' }).select('id, client_id');
    if (up.error) throw new Error(up.error.message);
    const idByClient = new Map<string, string>((up.data || []).map((x: any) => [x.client_id, x.id]));

    const ids = Array.from(idByClient.values());
    if (ids.length) {
      const del = await supabase.from('receipt_items').delete().in('receipt_id', ids);
      if (del.error) throw new Error(del.error.message);
    }
    const itemRows: any[] = [];
    group.forEach(r => {
      const rid = idByClient.get(r.id);
      if (!rid) return;
      (r.items || []).forEach((i, idx) => itemRows.push({
        receipt_id: rid, user_id: userId, position: idx,
        description: i.description, quantity: i.quantity, unit_type: i.unitType || 'UN',
        unit_price: i.unitPrice, total_price: i.totalPrice, category: i.category || null,
      }));
    });
    for (const part of chunk(itemRows, 400)) {
      const ins = await supabase.from('receipt_items').insert(part);
      if (ins.error) throw new Error(ins.error.message);
    }
    group.forEach(r => { if (idByClient.has(r.id)) done[r.id] = hashReceipt(r); });
  }
  return done;
};

// Apaga da nuvem os cupons privados da pessoa (ao desligar os avisos de "mais barato perto").
export const deleteCloudReceipts = async (userId: string): Promise<void> => {
  const { error } = await supabase.from('receipts').delete().eq('user_id', userId);
  if (error) throw new Error(error.message);
};

// Apaga da nuvem a cópia privada de um cupom que a pessoa excluiu no app (os itens saem junto, em cascata).
export const deleteCloudReceipt = async (userId: string, clientId: string): Promise<void> => {
  const { error } = await supabase.from('receipts').delete().eq('user_id', userId).eq('client_id', clientId);
  if (error) throw new Error(error.message);
};
