// Estado da nuvem no app: conta, avisos em tempo real, alertas, contribuição de preços no escaneamento,
// sugestão de loja mais barata e envio dos cupons recentes. Local-first: sem login nada disso roda.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Receipt, Establishment } from '../types';
import { cleanCNPJ } from './productNormalization';
import { geocodeEstablishment } from './geocodingService';
import { isValidCNPJ } from './registryLookupService';
import * as authService from './authService';
import * as cloud from './cloudService';
import type {
  CloudProfile, CloudNotification, PriceAlert, NewPriceAlert, PriceSuggestion, NearbyPrice, ResolvedItem,
} from './cloudService';

export interface SuggestionGroup {
  store: string;
  items: PriceSuggestion[];
}

export interface UseCloudOptions {
  receipts: Receipt[];
  establishments: Establishment[];
  onGeocoded: (cnpj: string, patch: Partial<Establishment>) => void;
  onToast?: (message: string) => void;
}

const readJson = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
};
const writeJson = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sem espaço: segue sem guardar */ } };

const SYNC_KEY = (uid: string) => `eukasconta_cloud_sync_${uid}`;
const SENT_KEY = (uid: string) => `eukasconta_cloud_sent_${uid}`;

export const useCloud = ({ receipts, establishments, onGeocoded, onToast }: UseCloudOptions) => {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!cloud.cloudAvailable());
  const [profile, setProfile] = useState<CloudProfile | null>(null);
  const [notifications, setNotifications] = useState<CloudNotification[]>([]);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Valores atuais para fluxos assíncronos longos (evita ler estado antigo dentro de laços).
  const userRef = useRef<User | null>(null);
  const profileRef = useRef<CloudProfile | null>(null);
  const receiptsRef = useRef<Receipt[]>(receipts);
  const estRef = useRef<Establishment[]>(establishments);
  const busyCount = useRef(0);
  const inflight = useRef<Set<string>>(new Set());
  const toastRef = useRef(onToast);
  const geoRef = useRef(onGeocoded);
  userRef.current = user;
  profileRef.current = profile;
  receiptsRef.current = receipts;
  estRef.current = establishments;
  toastRef.current = onToast;
  geoRef.current = onGeocoded;

  /* ── sessão ── */
  useEffect(() => {
    if (!cloud.cloudAvailable()) return;
    let alive = true;
    authService.getSession()
      .then(s => { if (alive) setUser(s?.user ?? null); })
      .catch(() => { /* sem sessão guardada */ })
      .finally(() => { if (alive) setReady(true); });
    const sub = authService.onAuthStateChange(u => { if (alive) setUser(u); });
    return () => { alive = false; sub.unsubscribe(); };
  }, []);

  /* ── dados da conta + avisos em tempo real ── */
  const uid = user?.id ?? null;
  useEffect(() => {
    if (!uid) {
      setProfile(null); setNotifications([]); setAlerts([]); setSuggestions([]);
      return;
    }
    let alive = true;
    cloud.fetchProfile(uid).then(p => { if (alive) setProfile(p); }).catch(e => alive && setLastError(e.message));
    cloud.listNotifications().then(n => { if (alive) setNotifications(n); }).catch(() => {});
    cloud.listAlerts().then(a => { if (alive) setAlerts(a); }).catch(() => {});
    const unsub = cloud.subscribeNotifications(uid, n => {
      setNotifications(prev => (prev.some(x => x.id === n.id) ? prev : [n, ...prev]));
      toastRef.current?.(n.title);
    });
    return () => { alive = false; unsub(); };
  }, [uid]);

  const unread = notifications.filter(n => !n.read_at).length;

  /* ── conta ── */
  const signIn = useCallback(async (email: string, password: string) => {
    try { await authService.signIn(email.trim(), password); }
    catch (e: any) { throw new Error(cloud.friendlyAuthError(e?.message)); }
  }, []);

  // Devolve true quando a conta já entrou; false quando falta confirmar o e-mail.
  const signUp = useCallback(async (email: string, password: string, name?: string): Promise<boolean> => {
    try {
      const data = await authService.signUp(email.trim(), password, name?.trim() || undefined);
      return Boolean(data.session);
    } catch (e: any) { throw new Error(cloud.friendlyAuthError(e?.message)); }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    try { await authService.signInWithGoogle(); }
    catch (e: any) { throw new Error(cloud.friendlyAuthError(e?.message)); }
  }, []);

  // App Android: o login volta por um link; erros dessa volta aparecem como aviso.
  useEffect(() => {
    if (!cloud.cloudAvailable()) return;
    return authService.listenForOAuthRedirects(msg => toastRef.current?.(cloud.friendlyAuthError(msg)));
  }, []);

  const signOut = useCallback(async () => { await authService.signOut(); }, []);

  const updatePrivacy = useCallback(async (patch: Partial<Pick<CloudProfile, 'share_prices' | 'notify_cheaper_nearby' | 'suggest_radius_km' | 'display_name'>>) => {
    const u = userRef.current;
    if (!u) return;
    const before = profileRef.current;
    setProfile(p => (p ? { ...p, ...patch } : p));
    try {
      await cloud.savePrivacy(u.id, patch);
      if (patch.notify_cheaper_nearby === false) {
        // Sem aviso de "mais barato perto" não há motivo para manter cópia dos cupons na nuvem.
        await cloud.deleteCloudReceipts(u.id);
        try { localStorage.removeItem(SYNC_KEY(u.id)); } catch { /* ok */ }
      }
    } catch (e: any) {
      setProfile(before);
      throw e;
    }
  }, []);

  /* ── contribuição de preços (escaneamento e histórico) ── */
  const contribute = useCallback(async (
    list: Receipt[],
    opts: { silent?: boolean; onProgress?: (done: number, total: number) => void } = {}
  ): Promise<{ sent: number; skipped: number; limited: boolean; invalid: number; failed: number; error?: string }> => {
    const u = userRef.current;
    const p = profileRef.current;
    const stats: { sent: number; skipped: number; limited: boolean; invalid: number; failed: number; error?: string } = { sent: 0, skipped: 0, limited: false, invalid: 0, failed: 0 };
    if (!u || !p || !p.share_prices) return stats;

    // Cada cupom é enviado uma vez só, mesmo se a tela avisar duas vezes (React em modo de desenvolvimento faz isso).
    const sentIds = new Set<string>(readJson<string[]>(SENT_KEY(u.id), []));
    list = list.filter(r => !inflight.current.has(r.id) && !sentIds.has(r.id));
    if (list.length === 0) return stats;
    list.forEach(r => inflight.current.add(r.id));

    busyCount.current++; setBusy(true);
    const groups: SuggestionGroup[] = [];
    const geoTried = new Set<string>();
    try {
      let i = 0;
      for (const r of list) {
        i++;
        opts.onProgress?.(i - 1, list.length);
        const cnpj = cleanCNPJ(r.cnpj);
        if (!isValidCNPJ(cnpj)) { stats.skipped++; stats.invalid++; continue; }

        const est = estRef.current.find(e => cleanCNPJ(e.cnpj) === cnpj);
        const hasCoords = est && typeof est.latitude === 'number' && typeof est.longitude === 'number';
        const coords = hasCoords ? { lat: est!.latitude as number, lng: est!.longitude as number } : undefined;

        let res: cloud.ContributeResult;
        try { res = await cloud.contributeReceipt(r, coords); }
        catch (e: any) { setLastError(e.message); stats.skipped++; stats.failed++; stats.error = e.message; continue; }

        if (res.status === 'skipped') {
          if (res.reason === 'rate_limited') { stats.limited = true; break; }
          if (res.reason === 'opt_out') break;
          if (res.reason === 'invalid_cnpj' || res.reason === 'invalid_date') stats.invalid++; else stats.failed++;
          stats.skipped++; continue;
        }
        sentIds.add(r.id);
        stats.sent++;

        let sugs = res.suggestions || [];
        // A loja ainda não tem posição no cadastro: acha pelo endereço uma vez e já busca as sugestões.
        if (res.needs_location && !coords && !geoTried.has(cnpj) && est?.geocodeStatus !== 'not_found' && (r.address || r.city)) {
          geoTried.add(cnpj);
          const geo = await geocodeEstablishment({ address: r.address, city: r.city, state: r.state });
          if (geo) {
            try { await cloud.setEstablishmentLocation(cnpj, geo.latitude, geo.longitude); } catch { /* outra pessoa pode ter informado antes */ }
            geoRef.current(cnpj, { latitude: geo.latitude, longitude: geo.longitude, geocodeStatus: 'found', geocodedAt: Date.now() });
            if (res.establishment_id && res.items?.length) {
              try { sugs = await cloud.priceSuggestions(res.establishment_id, res.items, profileRef.current?.suggest_radius_km ?? 8, 45); } catch { /* sem sugestão desta vez */ }
            }
          } else {
            geoRef.current(cnpj, { geocodeStatus: 'not_found', geocodedAt: Date.now() });
          }
        }
        if (!opts.silent && sugs.length) groups.push({ store: r.establishmentName, items: sugs });
      }
      opts.onProgress?.(list.length, list.length);
    } finally {
      writeJson(SENT_KEY(u.id), Array.from(sentIds).slice(-3000));
      list.forEach(r => inflight.current.delete(r.id));
      busyCount.current--; if (busyCount.current === 0) setBusy(false);
    }
    if (groups.length) setSuggestions(groups);
    return stats;
  }, []);

  // O cadastro comum só aceita CNPJ com os dígitos verificadores certos e data real: o resto nunca vai, então não conta como "a enviar".
  const sendable = (r: Receipt): boolean => {
    const d = r.date || '';
    return isValidCNPJ(r.cnpj) && d >= '2020-01-01' && d <= new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  };
  const recentUnsent = (): Receipt[] => {
    const u = userRef.current;
    if (!u) return [];
    const sent = new Set<string>(readJson<string[]>(SENT_KEY(u.id), []));
    const limit = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    return receiptsRef.current.filter(r => !sent.has(r.id) && (r.date || '') >= limit).sort((a, b) => b.date.localeCompare(a.date));
  };

  // Cupons dos últimos 90 dias que ainda não foram enviados ao cadastro comum (e podem ser).
  const pendingHistory = useCallback((): Receipt[] => recentUnsent().filter(sendable), []);
  // Cupons dos últimos 90 dias que não podem ir: CNPJ ou data inválidos (o certo é corrigir no cupom).
  const blockedHistory = useCallback((): Receipt[] => recentUnsent().filter(r => !sendable(r)), []);

  const shareHistory = useCallback(async (onProgress?: (done: number, total: number) => void) => {
    const todo = pendingHistory().slice(0, 75); // a conta aceita até 80 cupons por dia
    return contribute(todo, { silent: true, onProgress });
  }, [contribute, pendingHistory]);

  /* ── envio dos cupons recentes (base do aviso "mais barato perto de você") ── */
  useEffect(() => {
    if (!uid || !profile?.notify_cheaper_nearby || receipts.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      // espera a contribuição em andamento terminar, para os cupons já nascerem ligados à loja
      for (let k = 0; k < 20 && busyCount.current > 0; k++) await new Promise(r => setTimeout(r, 1500));
      if (cancelled) return;
      try {
        const synced = readJson<Record<string, string>>(SYNC_KEY(uid), {});
        const next = await cloud.syncRecentReceipts(uid, receiptsRef.current, synced, 60);
        if (!cancelled) writeJson(SYNC_KEY(uid), next);
      } catch (e: any) { if (!cancelled) setLastError(e.message); }
    }, 4000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [uid, profile?.notify_cheaper_nearby, receipts]);

  /* ── avisos ── */
  const refreshNotifications = useCallback(async () => {
    try { setNotifications(await cloud.listNotifications()); } catch (e: any) { setLastError(e.message); }
  }, []);

  const markRead = useCallback(async (ids?: string[]) => {
    const now = new Date().toISOString();
    setNotifications(prev => prev.map(n => (!n.read_at && (!ids || ids.includes(n.id)) ? { ...n, read_at: now } : n)));
    try { await cloud.markNotificationsRead(ids); } catch (e: any) { setLastError(e.message); }
  }, []);

  const removeNotification = useCallback(async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    try { await cloud.deleteNotification(id); } catch (e: any) { setLastError(e.message); }
  }, []);

  /* ── alertas ── */
  const refreshAlerts = useCallback(async () => {
    try { setAlerts(await cloud.listAlerts()); } catch (e: any) { setLastError(e.message); }
  }, []);

  const addAlert = useCallback(async (a: NewPriceAlert) => {
    const created = await cloud.createAlert(a);
    setAlerts(prev => [created, ...prev]);
    return created;
  }, []);

  const toggleAlert = useCallback(async (id: string, active: boolean) => {
    setAlerts(prev => prev.map(a => (a.id === id ? { ...a, active } : a)));
    try { await cloud.setAlertActive(id, active); }
    catch (e: any) { setAlerts(prev => prev.map(a => (a.id === id ? { ...a, active: !active } : a))); throw e; }
  }, []);

  const removeAlert = useCallback(async (id: string) => {
    const before = alerts;
    setAlerts(prev => prev.filter(a => a.id !== id));
    try { await cloud.deleteAlert(id); } catch (e: any) { setAlerts(before); throw e; }
  }, [alerts]);

  /* ── página do produto: quem vende mais barato por perto ── */
  const findNearby = useCallback(async (
    sample: { description: string; cnpj: string; unitType?: string },
    radiusKm = 10
  ): Promise<{ resolved: ResolvedItem | null; rows: NearbyPrice[]; origin: cloud.Coords }> => {
    const origin = await cloud.getCurrentPosition();
    const [resolved] = await cloud.resolveItems(sample.cnpj, [{ description: sample.description, unit_type: sample.unitType || 'UN' }]);
    if (!resolved?.master_product_id) return { resolved: null, rows: [], origin };
    const rows = await cloud.bestPricesNearby(resolved.master_product_id, origin, radiusKm, 60);
    return { resolved, rows, origin };
  }, []);

  return {
    available: cloud.cloudAvailable(), ready, user, profile, busy, lastError,
    notifications, unread, alerts, suggestions,
    signIn, signUp, signInWithGoogle, signOut, updatePrivacy,
    contribute, shareHistory, pendingHistory, blockedHistory,
    dismissSuggestions: () => setSuggestions([]),
    refreshNotifications, markRead, removeNotification,
    refreshAlerts, addAlert, toggleAlert, removeAlert,
    findNearby,
    searchProducts: cloud.searchProducts,
    getCurrentPosition: cloud.getCurrentPosition,
  };
};

export type CloudApi = ReturnType<typeof useCloud>;
