// Backup da conta (Supabase): guarda os dados do app e, à parte, a chave de IA da própria pessoa,
// para tudo voltar sozinho depois de reinstalar o app (é só entrar na conta).
// Local-first: o app continua funcionando sem conta; aqui é só uma cópia por cima.
// O backup é um mapa "chave do localStorage -> texto", então qualquer dado novo do app entra
// sem mexer neste arquivo (basta a chave começar com "eukasconta_").
import { supabase } from './supabaseClient';

const PREFIX = 'eukasconta_';

// Chaves de IA e escolhas ligadas a elas: vão na coluna "secrets", só se a pessoa deixar.
const SECRET_PREFIXES = ['eukasconta_byok_', 'eukasconta_active_ai_provider', 'eukasconta_openrouter_model_'];

// Ficam só neste aparelho: controle da própria nuvem, diagnóstico, simulador, e os checkpoints
// (cada um é uma cópia inteira dos dados e multiplicaria o tamanho do backup).
const DEVICE_ONLY = [
  /^eukasconta_cloud_/,
  /^eukasconta_backup_/,
  /^eukasconta_diagnostics$/,
  /^eukasconta_emulator_prefs$/,
  /^eukasconta_snapshots$/,
];

const MAX_BYTES = 20 * 1024 * 1024;

export interface BackupMeta {
  updated_at: string;
  receipt_count: number;
}

export interface BackupRow extends BackupMeta {
  data: Record<string, string>;
  secrets: Record<string, string>;
}

export interface LocalSnapshot {
  data: Record<string, string>;
  secrets: Record<string, string>;
  receiptCount: number;
}

const isSecretKey = (k: string) => SECRET_PREFIXES.some(p => k === p || k.startsWith(p));
const isDeviceOnly = (k: string) => DEVICE_ONLY.some(r => r.test(k));

const safeGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };

export const localReceiptCount = (): number => {
  const raw = safeGet('eukasconta_data');
  if (!raw) return 0;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.length : 0; } catch { return 0; }
};

export const collectLocal = (): LocalSnapshot => {
  const data: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const v = localStorage.getItem(k);
      if (v === null) continue;
      if (isSecretKey(k)) { if (v.trim()) secrets[k] = v; continue; }
      if (isDeviceOnly(k)) continue;
      data[k] = v;
    }
  } catch { /* sem acesso ao armazenamento: devolve o que deu */ }
  return { data, secrets, receiptCount: localReceiptCount() };
};

// Impressão digital barata para saber se algo mudou desde o último envio.
export const fingerprint = (snap: { data: Record<string, string>; secrets: Record<string, string> }): string => {
  let h = 5381, n = 0;
  const feed = (s: string) => { for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; n += s.length; };
  [snap.data, snap.secrets].forEach(obj => Object.keys(obj).sort().forEach(k => { feed(k); feed('='); feed(obj[k]); feed(';'); }));
  return `${n}:${h >>> 0}`;
};

const asStringMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object') {
    Object.entries(v as Record<string, unknown>).forEach(([k, val]) => { if (typeof val === 'string') out[k] = val; });
  }
  return out;
};

/* ───────────────────────── nuvem ───────────────────────── */

export const fetchBackupMeta = async (userId: string): Promise<(BackupMeta & { secrets: Record<string, string> }) | null> => {
  const { data, error } = await supabase.from('user_backups').select('updated_at, receipt_count, secrets').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { updated_at: data.updated_at, receipt_count: Number(data.receipt_count) || 0, secrets: asStringMap(data.secrets) };
};

export const fetchBackupData = async (userId: string): Promise<Record<string, string> | null> => {
  const { data, error } = await supabase.from('user_backups').select('data').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? asStringMap(data.data) : null;
};

export const uploadBackup = async (userId: string, snap: LocalSnapshot, includeKeys: boolean, appVersion?: string): Promise<string> => {
  const row = {
    user_id: userId,
    data: snap.data,
    secrets: includeKeys ? snap.secrets : {},
    receipt_count: snap.receiptCount,
    app_version: appVersion || null,
    updated_at: new Date().toISOString(),
  };
  if (JSON.stringify(row).length > MAX_BYTES) throw new Error('Os dados ficaram grandes demais para o backup automático.');
  const { error } = await supabase.from('user_backups').upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  return row.updated_at;
};

// Tira só as chaves de IA da cópia na conta (sem reenviar os dados). Usado ao desligar "guardar minha chave".
export const clearBackupSecrets = async (userId: string): Promise<void> => {
  const { error } = await supabase.from('user_backups').update({ secrets: {} }).eq('user_id', userId);
  if (error) throw new Error(error.message);
};

export const deleteBackup = async (userId: string): Promise<void> => {
  const { error } = await supabase.from('user_backups').delete().eq('user_id', userId);
  if (error) throw new Error(error.message);
};

/* ───────────────────────── aplicar no aparelho ───────────────────────── */

// Grava os dados do backup neste aparelho (a tela precisa recarregar depois para lê-los).
export const applyData = (data: Record<string, string>): number => {
  let n = 0;
  Object.entries(data).forEach(([k, v]) => {
    if (!k.startsWith(PREFIX) || isSecretKey(k) || isDeviceOnly(k)) return;
    try { localStorage.setItem(k, v); n++; } catch { /* sem espaço: segue com o resto */ }
  });
  return n;
};

// Traz as chaves de IA do backup só para os provedores que este aparelho ainda não tem;
// nunca troca uma chave que a pessoa já colou aqui. Devolve quantas entraram.
export const applySecretsIfMissing = (secrets: Record<string, string>): number => {
  let n = 0;
  Object.entries(secrets).forEach(([k, v]) => {
    if (!k.startsWith(PREFIX) || !isSecretKey(k) || !v.trim()) return;
    if (safeGet(k)) return;
    try { localStorage.setItem(k, v); n++; } catch { /* ignora */ }
  });
  return n;
};

// Junta o backup da conta com o que já existe neste aparelho, sem perder nada de nenhum dos dois:
// cupons = união (mesmo id ou mesma loja+dia+valor contam como o mesmo cupom, vale o do aparelho);
// as demais chaves do backup só entram se o aparelho ainda não tiver aquela chave.
export const mergeData = (remote: Record<string, string>): { receipts: number; added: number } => {
  let local: any[] = [];
  try { const v = JSON.parse(safeGet('eukasconta_data') || '[]'); if (Array.isArray(v)) local = v; } catch { /* aparelho sem cupons legíveis */ }
  let theirs: any[] = [];
  try { const v = JSON.parse(remote['eukasconta_data'] || '[]'); if (Array.isArray(v)) theirs = v; } catch { /* backup sem cupons legíveis */ }
  const sig = (r: any) => `${String(r?.establishmentName || '').trim().toLowerCase()}|${r?.date}|${Number(r?.totalAmount || 0).toFixed(2)}`;
  const ids = new Set(local.map(r => r?.id));
  const sigs = new Set(local.map(sig));
  const merged = [...local];
  let added = 0;
  theirs.forEach(r => {
    if (!r || ids.has(r.id) || sigs.has(sig(r))) return;
    merged.push(r); ids.add(r.id); sigs.add(sig(r)); added++;
  });
  merged.sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')));
  try { localStorage.setItem('eukasconta_data', JSON.stringify(merged)); } catch { return { receipts: local.length, added: 0 }; }
  Object.entries(remote).forEach(([k, v]) => {
    if (k === 'eukasconta_data' || !k.startsWith(PREFIX) || isSecretKey(k) || isDeviceOnly(k)) return;
    if (safeGet(k) !== null) return;
    try { localStorage.setItem(k, v); } catch { /* sem espaço: segue */ }
  });
  return { receipts: merged.length, added };
};
