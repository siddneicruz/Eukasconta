import { useEffect, useRef, useState } from 'react';
import type { TileArchive } from './offlineMaps';
import { Bbox, Poi, loadPois } from './poiService';

export interface PoisState {
  pois: Poi[];
  status: 'idle' | 'loading' | 'ok' | 'error';
  origin: 'salvo' | 'online' | 'nenhum' | null;
}

const IDLE: PoisState = { pois: [], status: 'idle', origin: null };

/**
 * Lojas do mapa dentro de uma caixa (null = não carrega nada). Espera a pessoa parar de mexer no mapa e cancela a
 * busca anterior. Com internet usa o OpenStreetMap online; sem ela, o mapa salvo no celular.
 */
export const usePois = (
  bbox: Bbox | null,
  opts: { archive?: TileArchive | null; archiveZoom?: number; online: boolean },
  delayMs = 450,
): PoisState => {
  const [state, setState] = useState<PoisState>(IDLE);
  const key = bbox ? bbox.map(v => v.toFixed(4)).join(',') : '';
  const archiveRef = useRef(opts.archive);
  archiveRef.current = opts.archive;
  const hasArchive = !!opts.archive;

  useEffect(() => {
    if (!bbox) { setState(IDLE); return; }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setState(s => ({ ...s, status: 'loading' }));
      try {
        const r = await loadPois(bbox, { archive: archiveRef.current, archiveZoom: opts.archiveZoom, online: opts.online, signal: ctrl.signal });
        if (!ctrl.signal.aborted) setState({ pois: r.pois, status: r.origin === 'nenhum' ? 'error' : 'ok', origin: r.origin });
      } catch (e: any) {
        if (!ctrl.signal.aborted && e?.name !== 'AbortError') setState({ pois: [], status: 'error', origin: null });
      }
    }, delayMs);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [key, hasArchive, opts.online, opts.archiveZoom]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
};
