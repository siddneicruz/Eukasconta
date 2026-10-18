// Backup da conta (Supabase): guarda os dados do app e, à parte, a chave de IA da própria pessoa,
// para tudo voltar sozinho depois de reinstalar o app (é só entrar na conta).
// Local-first: o app continua funcionando sem conta; aqui é só uma cópia por cima.
// O backup é um mapa "chave do localStorage -> texto", então qualquer dado novo do app entra
// sem mexer neste arquivo (basta a chave começar com "eukasconta_").
import { supabase } from './supabaseClient';
import { PREFIX, isSecretKey, isDeviceOnly, safeGet, collectLocal, fingerprint, localReceiptCount, applyData, applySecretsIfMissing } from './localData';
import type { LocalSnapshot } from './localData';

// O que é "dado do app" neste aparelho (quais chaves contam e como ler e gravar) mora em localData.ts;
// é reexportado aqui para quem já importava daqui.
export { collectLocal, fingerprint, localReceiptCount, applyData, applySecretsIfMissing };
export type { LocalSnapshot };

const MAX_BYTES = 20 * 1024 * 1024;

export interface BackupMeta {
  updated_at: string;
  receipt_count: number;
}

export interface BackupRow extends BackupMeta {
  data: Record<string, string>;
  secrets: Record<string, string>;
}

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
