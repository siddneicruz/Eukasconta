// Backup automático na conta: guarda os dados (e, se a pessoa deixar, a chave de IA) depois de cada
// mudança e, numa instalação vazia, traz tudo de volta sozinho quando ela entra na conta.
// Regras de segurança:
//  - nunca grava um aparelho vazio por cima de um backup que tem cupons;
//  - só restaura sozinho quando este aparelho não tem nenhum cupom (senão, só pelo botão);
//  - a chave de IA de um backup nunca troca uma chave que a pessoa já colou neste aparelho;
//  - se este aparelho já tem cupons e a conta também (primeira vez que os dois se encontram), nada é enviado nem
//    apagado até a pessoa escolher: juntar os dois, usar a conta ou manter o aparelho.
import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { isNativeApp } from './platform';
import {
  BackupMeta, applyData, applySecretsIfMissing, clearBackupSecrets, collectLocal, deleteBackup, fetchBackupData,
  fetchBackupMeta, fingerprint, localReceiptCount, mergeData, uploadBackup,
} from './backupService';

export const KEYS_CHANGED_EVENT = 'eukasconta:keys-changed';

const AUTO_KEY = 'eukasconta_backup_auto';
const KEYS_KEY = 'eukasconta_backup_keys';
const HASH_KEY = (uid: string) => `eukasconta_backup_hash_${uid}`;
const RESTORED_FLAG = 'eukasconta_backup_restored';
const APP_VERSION = '1';

const readFlag = (key: string, fallback: boolean): boolean => {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; }
};
const writeFlag = (key: string, v: boolean) => { try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* ignora */ } };
const readStr = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStr = (key: string, v: string | null) => { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch { /* ignora */ } };

export type BackupStatus = 'idle' | 'checking' | 'saving' | 'restoring' | 'error';

export interface BackupConflict { remoteCount: number; localCount: number; remoteAt: string }
export type ConflictChoice = 'merge' | 'account' | 'device';

export interface BackupApi {
  signedIn: boolean;
  auto: boolean;
  setAuto: (v: boolean) => void;
  includeKeys: boolean;
  setIncludeKeys: (v: boolean) => void;
  status: BackupStatus;
  remote: BackupMeta | null;
  conflict: BackupConflict | null;
  resolveConflict: (choice: ConflictChoice) => Promise<void>;
  error: string | null;
  backupNow: () => Promise<void>;
  restoreNow: () => Promise<void>;
  deleteRemote: () => Promise<void>;
}

interface Options {
  userId: string | null;
  // muda de identidade sempre que os dados do app mudam (dispara o backup automático)
  trigger: unknown;
  onToast?: (msg: string) => void;
}

const errMsg = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|network|load failed|timeout/i.test(m)) return 'Sem conexão. O backup continua quando a internet voltar.';
  return m;
};

export const useCloudBackup = ({ userId, trigger, onToast }: Options): BackupApi => {
  const [auto, setAutoState] = useState(() => readFlag(AUTO_KEY, true));
  const [includeKeys, setIncludeKeysState] = useState(() => readFlag(KEYS_KEY, true));
  const [status, setStatus] = useState<BackupStatus>('idle');
  const [remote, setRemote] = useState<BackupMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [conflict, setConflictState] = useState<BackupConflict | null>(null);
  const conflictRef = useRef<BackupConflict | null>(null);
  const setConflict = (c: BackupConflict | null) => { conflictRef.current = c; setConflictState(c); };

  const uidRef = useRef<string | null>(userId);
  const autoRef = useRef(auto);
  const keysRef = useRef(includeKeys);
  const remoteRef = useRef<BackupMeta | null>(null);
  const remoteKnown = useRef(false);   // a consulta à nuvem deu certo nesta sessão
  const checkedRef = useRef(false);
  const busy = useRef(false);
  const restoring = useRef(false);     // restaurando da conta: nenhum envio automático pode passar na frente
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastRef = useRef(onToast);
  uidRef.current = userId;
  autoRef.current = auto;
  keysRef.current = includeKeys;
  checkedRef.current = checked;
  toastRef.current = onToast;

  const setRemoteMeta = (m: BackupMeta | null) => { remoteRef.current = m; setRemote(m); };

  // Envia o que mudou. `force` ignora só a comparação de "nada mudou" (botão "Fazer backup agora").
  const flush = useCallback(async (force = false) => {
    const uid = uidRef.current;
    if (!uid || !checkedRef.current) return;
    if (conflictRef.current) return;   // esperando a pessoa escolher o que fazer com os dois lados
    if (restoring.current) return;
    if (busy.current) { dirty.current = true; return; }
    const snap = collectLocal();
    // aparelho vazio nunca sobrescreve um backup que tem cupons (nem um que não deu para consultar)
    if (snap.receiptCount === 0 && (!remoteKnown.current || (remoteRef.current?.receipt_count ?? 0) > 0)) return;
    const withKeys = keysRef.current;
    const hash = fingerprint({ data: snap.data, secrets: withKeys ? snap.secrets : {} }) + (withKeys ? 'k' : '-');
    if (!force && hash === readStr(HASH_KEY(uid))) return;
    busy.current = true;
    setStatus('saving');
    try {
      const at = await uploadBackup(uid, snap, withKeys, APP_VERSION);
      writeStr(HASH_KEY(uid), hash);
      remoteKnown.current = true;
      setRemoteMeta({ updated_at: at, receipt_count: snap.receiptCount });
      setError(null);
      setStatus('idle');
    } catch (e) {
      setError(errMsg(e));
      setStatus('error');
    } finally {
      busy.current = false;
      if (dirty.current) { dirty.current = false; schedule(2000); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void flush(false); }, ms);
  }, [flush]);

  /* ── ao entrar (ou abrir o app já logado): olha a nuvem, traz a chave e, se o aparelho está vazio, os dados ── */
  useEffect(() => {
    remoteKnown.current = false;
    checkedRef.current = false;
    setChecked(false);
    setRemoteMeta(null);
    setConflict(null);
    setError(null);
    if (!userId) { setStatus('idle'); return; }
    let alive = true;
    (async () => {
      setStatus('checking');
      try {
        const meta = await fetchBackupMeta(userId);
        if (!alive) return;
        remoteKnown.current = true;
        setRemoteMeta(meta ? { updated_at: meta.updated_at, receipt_count: meta.receipt_count } : null);
        if (meta) {
          const gotKeys = applySecretsIfMissing(meta.secrets);
          const emptyHere = localReceiptCount() === 0;
          let already = false;
          try { already = sessionStorage.getItem(RESTORED_FLAG) === '1'; } catch { /* ignora */ }
          if (emptyHere && meta.receipt_count > 0 && !already) {
            setStatus('restoring');
            const data = await fetchBackupData(userId);
            if (!alive) return;
            if (data && applyData(data) > 0) {
              try { sessionStorage.setItem(RESTORED_FLAG, '1'); } catch { /* ignora */ }
              const snap = collectLocal();
              writeStr(HASH_KEY(userId), fingerprint({ data: snap.data, secrets: keysRef.current ? snap.secrets : {} }) + (keysRef.current ? 'k' : '-'));
              toastRef.current?.(`Seus dados voltaram da conta: ${meta.receipt_count} ${meta.receipt_count === 1 ? 'cupom' : 'cupons'}.`);
              setTimeout(() => window.location.reload(), 1200);
              return;
            }
          } else if (!emptyHere && meta.receipt_count > 0 && !readStr(HASH_KEY(userId))) {
            // primeiro encontro deste aparelho com esta conta, e os dois têm cupons: quem decide é a pessoa
            setConflict({ remoteCount: meta.receipt_count, localCount: localReceiptCount(), remoteAt: meta.updated_at });
            if (gotKeys > 0) toastRef.current?.('Sua chave de IA voltou da conta.');
          } else if (gotKeys > 0) {
            toastRef.current?.('Sua chave de IA voltou da conta.');
          }
        }
        checkedRef.current = true;
        setChecked(true);
        setStatus('idle');
      } catch (e) {
        if (!alive) return;
        setError(errMsg(e));
        setStatus('error');
        checkedRef.current = true;   // sem rede: o app segue; o envio só vale com a nuvem consultada (ver flush)
        setChecked(true);
      }
    })();
    return () => { alive = false; };
  }, [userId]);

  /* ── envio automático depois de cada mudança nos dados ── */
  useEffect(() => {
    if (userId && checked && auto) schedule(4000);
  }, [trigger, userId, checked, auto, includeKeys, schedule]);
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } }, []);

  /* ── chave de IA mudou ── */
  useEffect(() => {
    const onKeys = () => { if (uidRef.current && autoRef.current) schedule(2500); };
    window.addEventListener(KEYS_CHANGED_EVENT, onKeys);
    return () => window.removeEventListener(KEYS_CHANGED_EVENT, onKeys);
  }, [schedule]);

  /* ── indo para segundo plano: manda já o que estiver pendente ── */
  useEffect(() => {
    const leaving = () => {
      if (!uidRef.current || !autoRef.current) return;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      void flush(false);
    };
    const onVis = () => { if (document.visibilityState === 'hidden') leaving(); };
    document.addEventListener('visibilitychange', onVis);
    let remove: (() => void) | undefined;
    let alive = true;
    if (isNativeApp()) {
      CapApp.addListener('appStateChange', s => { if (!s.isActive) leaving(); })
        .then(h => { if (alive) remove = () => h.remove(); else h.remove(); })
        .catch(() => { /* sem o plugin: fica só o visibilitychange */ });
    }
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis); remove?.(); };
  }, [flush]);

  /* ── ações da tela ── */
  const setAuto = useCallback((v: boolean) => { writeFlag(AUTO_KEY, v); setAutoState(v); }, []);

  const setIncludeKeys = useCallback((v: boolean) => {
    writeFlag(KEYS_KEY, v); keysRef.current = v; setIncludeKeysState(v);
    // desligar tira a chave da conta na hora, mesmo com o envio automático desligado (sem reenviar os dados)
    const uid = uidRef.current;
    if (!v && uid && checkedRef.current && remoteKnown.current && remoteRef.current) {
      clearBackupSecrets(uid).catch(e => setError(errMsg(e)));
    }
  }, []);

  const backupNow = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    await flush(true);
  }, [flush]);

  const restoreNow = useCallback(async () => {
    const uid = uidRef.current;
    if (!uid) return;
    // restaurar vale mais que qualquer envio pendente: trava o envio automático até terminar
    restoring.current = true;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setStatus('restoring'); setError(null);
    try {
      const data = await fetchBackupData(uid);
      if (!data || Object.keys(data).length === 0) throw new Error('Não há backup nesta conta.');
      if (applyData(data) === 0) throw new Error('Não deu para gravar os dados neste aparelho.');
      const meta = await fetchBackupMeta(uid).catch(() => null);
      if (meta) applySecretsIfMissing(meta.secrets);
      const snap = collectLocal();
      writeStr(HASH_KEY(uid), fingerprint({ data: snap.data, secrets: keysRef.current ? snap.secrets : {} }) + (keysRef.current ? 'k' : '-'));
      toastRef.current?.('Backup restaurado. Reabrindo…');
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      restoring.current = false;
      setError(errMsg(e)); setStatus('error');
    }
  }, []);

  const resolveConflict = useCallback(async (choice: ConflictChoice) => {
    const uid = uidRef.current;
    if (!uid || !conflictRef.current) return;
    setError(null);
    try {
      if (choice === 'account') { setConflict(null); await restoreNow(); return; }
      if (choice === 'merge') {
        restoring.current = true;
        setStatus('restoring');
        const data = await fetchBackupData(uid);
        if (!data) throw new Error('Não há backup nesta conta.');
        const res = mergeData(data);
        // o resultado da junção vai de volta para a conta, então os dois ficam iguais
        const snap = collectLocal();
        await uploadBackup(uid, snap, keysRef.current, APP_VERSION);
        writeStr(HASH_KEY(uid), fingerprint({ data: snap.data, secrets: keysRef.current ? snap.secrets : {} }) + (keysRef.current ? 'k' : '-'));
        setConflict(null);
        toastRef.current?.(res.added > 0 ? `Juntei os dois: ${res.added} ${res.added === 1 ? 'cupom veio' : 'cupons vieram'} da conta. Reabrindo…` : 'Os cupons da conta já estavam aqui. Reabrindo…');
        setTimeout(() => window.location.reload(), 1000);
        return;
      }
      // 'device': o que está aqui passa a ser o backup da conta
      setConflict(null);
      await flush(true);
    } catch (e) {
      restoring.current = false;
      setError(errMsg(e)); setStatus('error');
    }
  }, [flush, restoreNow]);

  const deleteRemote = useCallback(async () => {
    const uid = uidRef.current;
    if (!uid) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    await deleteBackup(uid);
    writeStr(HASH_KEY(uid), null);
    setRemoteMeta(null);
    remoteKnown.current = true;
  }, []);

  return { signedIn: Boolean(userId), auto, setAuto, includeKeys, setIncludeKeys, status, remote, conflict, resolveConflict, error, backupNow, restoreNow, deleteRemote };
};
