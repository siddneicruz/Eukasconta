// Liga os pontos de restauração à tela: a lista, criar, restaurar, exportar, importar, e o ponto automático do dia.
import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { isNativeApp } from './platform';
import { downloadFile } from './nativeFiles';
import { markFileBackup } from './lastWhen';
import {
  POINTS_EVENT, PointMeta, autoEnabled, createPoint, deletePoint, ensureDailyPoint, exportPoint, importPointFile, listPoints,
  migrateLegacySnapshots, pointSummary, pointsSupported, restorePoint, safetyPoint, setAutoEnabled,
} from './restorePoints';

// Depois de restaurar a tela recarrega na hora (sem deixar nenhum efeito do app regravar os dados antigos por cima);
// o aviso de "restaurado" espera a tela abrir de novo.
const RESTORE_TOAST_KEY = 'eukasconta_restore_toast';

export interface RestorePointsApi {
  points: PointMeta[];
  loaded: boolean;
  supported: boolean;
  busy: string | null;        // 'create' | 'import' | id do ponto em ação
  auto: boolean;
  setAuto: (v: boolean) => void;
  create: (name?: string) => Promise<boolean>;
  restore: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  exportOne: (id: string) => Promise<void>;
  importFile: (file: File) => Promise<boolean>;
  /** Guarda o estado de agora antes de uma ação arriscada (não espera nem atrapalha a ação). */
  before: (reason: string) => void;
}

interface Options { onToast?: (msg: string) => void }

export const useRestorePoints = ({ onToast }: Options = {}): RestorePointsApi => {
  const [points, setPoints] = useState<PointMeta[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [auto, setAutoState] = useState(() => autoEnabled());
  const toastRef = useRef(onToast);
  toastRef.current = onToast;
  const toast = (m: string) => toastRef.current?.(m);
  const lastDaily = useRef(0);

  const refresh = useCallback(async () => {
    try { setPoints(await listPoints()); } catch { /* sem armazenamento: a lista fica vazia */ }
  }, []);

  const daily = useCallback(async () => {
    const now = Date.now();
    if (now - lastDaily.current < 5 * 60_000) return;   // no máximo uma checagem a cada 5 minutos
    lastDaily.current = now;
    try { if (await ensureDailyPoint()) await refresh(); } catch { /* o ponto do dia é um extra */ }
  }, [refresh]);

  /* ── ao abrir: confere se dá para guardar pontos, traz os antigos, mostra a lista e, depois de um respiro, o ponto do dia ── */
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const ok = await pointsSupported();
      if (!alive) return;
      setSupported(ok);
      if (!ok) { setLoaded(true); return; }
      try { await migrateLegacySnapshots(); } catch { /* tenta de novo na próxima abertura */ }
      await refresh();
      if (!alive) return;
      setLoaded(true);
      let pending: string | null = null;
      try { pending = sessionStorage.getItem(RESTORE_TOAST_KEY); sessionStorage.removeItem(RESTORE_TOAST_KEY); } catch { /* ignora */ }
      if (pending) toast(pending);
      timer = setTimeout(() => { void daily(); }, 4000);
    })();
    return () => { alive = false; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── volta para o app (ou vira o dia com ele aberto): confere o ponto do dia ── */
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void daily(); };
    document.addEventListener('visibilitychange', onVis);
    let remove: (() => void) | undefined;
    let alive = true;
    if (isNativeApp()) {
      CapApp.addListener('appStateChange', s => { if (s.isActive) void daily(); })
        .then(h => { if (alive) remove = () => h.remove(); else h.remove(); })
        .catch(() => { /* sem o plugin: fica só o visibilitychange */ });
    }
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis); remove?.(); };
  }, [daily]);

  useEffect(() => {
    const on = () => { void refresh(); };
    window.addEventListener(POINTS_EVENT, on);
    return () => window.removeEventListener(POINTS_EVENT, on);
  }, [refresh]);

  const setAuto = useCallback((v: boolean) => { setAutoEnabled(v); setAutoState(v); if (v) { lastDaily.current = 0; void daily(); } }, [daily]);

  const create = useCallback(async (name?: string) => {
    setBusy('create');
    try {
      const m = await createPoint({ kind: 'manual', name });
      await refresh();
      if (m) toast(`Ponto criado: ${m.name}.`);
      return Boolean(m);
    } catch (e: any) {
      toast(`Não consegui criar o ponto: ${String(e?.message || e)}`);
      return false;
    } finally { setBusy(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const restore = useCallback(async (id: string) => {
    const meta = points.find(p => p.id === id);
    setBusy(id);
    try {
      const r = await restorePoint(id);
      if ('error' in r) { toast(r.error); return; }
      const msg = `Ponto restaurado${meta ? `: ${pointSummary(meta)}` : ''}.${r.safety ? ' O estado de antes ficou guardado na lista.' : ''}`;
      try { sessionStorage.setItem(RESTORE_TOAST_KEY, msg); } catch { /* sem aviso depois de abrir */ }
      window.location.reload();
    } finally { setBusy(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  const remove = useCallback(async (id: string) => {
    setBusy(id);
    try { await deletePoint(id); await refresh(); toast('Ponto excluído.'); }
    catch (e: any) { toast(`Não consegui excluir: ${String(e?.message || e)}`); }
    finally { setBusy(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const exportOne = useCallback(async (id: string) => {
    setBusy(id);
    try {
      const out = await exportPoint(id);
      if ('error' in out) { toast(out.error); return; }
      const outcome = await downloadFile(out.blob, out.fileName);
      if (outcome === 'saved') { markFileBackup(); toast('Ponto exportado.'); }
    } catch (e: any) {
      toast(`Não consegui exportar: ${String(e?.message || e)}`);
    } finally { setBusy(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const importFile = useCallback(async (file: File) => {
    setBusy('import');
    try {
      const r = await importPointFile(file);
      if ('error' in r) { toast(r.error); return false; }
      await refresh();
      toast(r.duplicate ? `Esse ponto já está na lista: ${r.meta.name}.` : `Ponto importado: ${r.meta.name}. Restaure pela lista quando quiser.`);
      return true;
    } catch (e: any) {
      toast(`Não consegui importar: ${String(e?.message || e)}`);
      return false;
    } finally { setBusy(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const before = useCallback((reason: string) => { void safetyPoint(reason); }, []);

  return { points, loaded, supported, busy, auto, setAuto, create, restore, remove, exportOne, importFile, before };
};
