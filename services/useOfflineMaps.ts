import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapManifest, MapCell, SavedCell, OpenedMaps, DownloadProgress,
  cachedManifest, fetchManifest, cellsForPoints, listSaved, deleteSaved, downloadCells, openSaved,
  getMapSource, setMapSource, MapSource,
} from './offlineMaps';

export type DownloadState =
  | { status: 'idle' }
  | { status: 'running'; progress: DownloadProgress }
  | { status: 'error'; message: string };

/* Estado do mapa salvo: o que já está no aparelho, o que falta para as lojas da pessoa e o download em andamento. */
export const useOfflineMaps = (points: [number, number][]) => {
  const [saved, setSaved] = useState<SavedCell[]>([]);
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [manifest, setManifest] = useState<MapManifest | null>(() => cachedManifest());
  const [manifestState, setManifestState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [source, setSourceState] = useState<MapSource>(() => getMapSource());
  // com internet o mapa é o do OpenStreetMap (sempre o mais novo); sem internet, o que está salvo no celular
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const [dl, setDl] = useState<DownloadState>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; abortRef.current?.abort(); }; }, []);

  const reloadSaved = useCallback(async () => {
    const list = await listSaved();
    if (alive.current) { setSaved(list); setSavedLoaded(true); }
  }, []);
  useEffect(() => { reloadSaved(); }, [reloadSaved]);

  const loadManifest = useCallback(async () => {
    setManifestState('loading');
    try {
      const m = await fetchManifest();
      if (!alive.current) return;
      setManifest(m); setManifestState('ok');
    } catch {
      if (alive.current) setManifestState('error');
    }
  }, []);
  useEffect(() => { loadManifest(); }, [loadManifest]);

  const opened: OpenedMaps | null = useMemo(() => openSaved(saved), [saved]);

  // células do catálogo que cobrem as lojas (e a posição da pessoa)
  const pointsKey = points.map(p => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join('|');
  const needed: MapCell[] = useMemo(
    () => (manifest ? cellsForPoints(manifest, points) : []),
    [manifest, pointsKey] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const savedIds = useMemo(() => new Set(saved.map(s => s.id)), [saved]);
  const missing = useMemo(() => needed.filter(c => !savedIds.has(c.id)), [needed, savedIds]);
  const outdated = useMemo(
    () => !!manifest && saved.some(s => manifest.cells.some(c => c.id === s.id) && (s.built || '') < manifest.built),
    [manifest, saved]
  );

  const run = useCallback(async (cells: MapCell[]) => {
    if (!manifest || cells.length === 0 || abortRef.current) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setDl({ status: 'running', progress: { done: 0, total: cells.reduce((a, c) => a + c.bytes, 0), index: 1, count: cells.length } });
    try {
      await downloadCells(manifest, cells, progress => { if (alive.current) setDl({ status: 'running', progress }); }, ctrl.signal);
      await reloadSaved();
      if (alive.current) setDl({ status: 'idle' });
    } catch (e: any) {
      await reloadSaved();   // células que já terminaram ficam salvas
      if (!alive.current) return;
      if (ctrl.signal.aborted || e?.name === 'AbortError') setDl({ status: 'idle' });
      else setDl({ status: 'error', message: String(e?.message || 'Não consegui baixar o mapa.') });
    } finally {
      abortRef.current = null;
    }
  }, [manifest, reloadSaved]);

  const download = useCallback(() => run(missing), [run, missing]);
  const update = useCallback(() => {
    if (!manifest) return;
    const ids = new Set(saved.map(s => s.id));
    run(manifest.cells.filter(c => ids.has(c.id) || missing.some(m => m.id === c.id)));
  }, [manifest, saved, missing, run]);
  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);
  const remove = useCallback(async () => {
    await deleteSaved();
    await reloadSaved();
  }, [reloadSaved]);

  const setSource = useCallback((v: MapSource) => { setMapSource(v); setSourceState(v); }, []);
  const useVector = !!opened && (source === 'saved' || (source === 'auto' && !online));

  return {
    saved, savedLoaded, opened, manifest, manifestState, loadManifest,
    needed, missing, outdated,
    source, setSource, useVector, online,
    dl, download, update, cancel, remove,
  };
};
