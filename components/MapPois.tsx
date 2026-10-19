import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Search, Store, X, Link2, Plus, CheckCircle2 } from 'lucide-react';
import { Establishment } from '../types';
import { Bbox, Poi, PoiGroup, distanceM, kindGroup, kindLabel, nameMatch } from '../services/poiService';

/* ───────────── ícones das lojas do mapa ───────────── */

const GLYPH: Record<PoiGroup, string> = {
  // carrinho de compras
  mercado: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  // cruz
  saude: '<path d="M12 5v14M5 12h14"/>',
  // gota
  posto: '<path d="M12 2.7c3.4 4 6 7.2 6 10.3a6 6 0 0 1-12 0c0-3.1 2.6-6.3 6-10.3z"/>',
  // garfo e faca
  comer: '<path d="M7 2v20M4 2v6a3 3 0 0 0 6 0V2M17 22V2c-2.5 1.5-3.5 4-3.5 7.5 0 2 1 3 3.5 3.5"/>',
  // sacola
  outras: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
};
const COLOR: Record<PoiGroup, string> = { mercado: '#10b981', saude: '#ef4444', posto: '#3b82f6', comer: '#f97316', outras: '#71717a' };

const iconCache = new Map<string, L.DivIcon>();
export const poiIcon = (group: PoiGroup, active: boolean, light: boolean): L.DivIcon => {
  const key = `${group}${active ? 1 : 0}${light ? 1 : 0}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const px = active ? 38 : 28;
  const edge = light ? '#27272a' : '#ffffff';
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:${px}px;height:${px}px;border-radius:50%;background:${COLOR[group]};border:${active ? 3 : 2}px solid ${active ? '#F2D36B' : edge};box-shadow:0 1px 4px rgba(0,0,0,.5)${active ? ',0 0 0 5px rgba(242,211,107,.35)' : ''};display:flex;align-items:center;justify-content:center;">
      <svg viewBox="0 0 24 24" width="${Math.round(px * 0.58)}" height="${Math.round(px * 0.58)}" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${GLYPH[group]}</svg></div>`,
    iconSize: [px, px],
    iconAnchor: [px / 2, px / 2],
  });
  iconCache.set(key, icon);
  return icon;
};

/* ───────────── dentro do mapa ───────────── */

/** Avisa a caixa e o zoom do que está na tela, quando a pessoa para de mexer. */
export const ViewWatcher: React.FC<{ onView: (bbox: Bbox, zoom: number) => void }> = ({ onView }) => {
  const map = useMap();
  const report = () => { const b = map.getBounds(); onView([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], map.getZoom()); };
  useMapEvents({ moveend: report, zoomend: report });
  useEffect(() => { report(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
};

/** Toque no mapa → posição (só quando ligado). */
export const MapTap: React.FC<{ enabled: boolean; onTap: (lat: number, lng: number) => void }> = ({ enabled, onTap }) => {
  useMapEvents({ click: e => { if (enabled) onTap(e.latlng.lat, e.latlng.lng); } });
  return null;
};

export const PoiMarkers: React.FC<{
  pois: Poi[]; light: boolean; activeId?: string | null; hideNear?: { lat: number; lng: number }[]; onPick: (p: Poi) => void;
}> = ({ pois, light, activeId, hideNear = [], onPick }) => {
  const shown = useMemo(
    () => pois.filter(p => !hideNear.some(h => distanceM(h.lat, h.lng, p.lat, p.lng) < 25)).slice(0, 250),
    [pois, hideNear],
  );
  return (
    <>
      {shown.map(p => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={poiIcon(kindGroup(p.kind), p.id === activeId, light)} zIndexOffset={p.id === activeId ? 800 : -200}
          eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e as any); onPick(p); } }} />
      ))}
    </>
  );
};

/* ───────────── cartão da loja do mapa ───────────── */

const btnGold = 'flex items-center justify-center gap-2 py-3 rounded-2xl bg-luxury-gold text-black text-xs font-bold active:scale-[0.98] transition-transform';
const btnNeutral = 'flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/5 border border-white/10 text-zinc-200 text-xs font-bold active:scale-[0.98] transition-transform';

export const PoiCard: React.FC<{
  poi: Poi;
  /** a loja da pessoa que já está neste lugar, se houver */
  mine: { name: string } | null;
  fromMeM: number | null;
  onClose: () => void;
  onAdd?: () => void;
  onAssociate: () => void;
}> = ({ poi, mine, fromMeM, onClose, onAdd, onAssociate }) => (
  <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4 md:p-5" data-testid="map-poi-card">
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0" style={{ background: COLOR[kindGroup(poi.kind)] }}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: GLYPH[kindGroup(poi.kind)] }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold text-white leading-tight" data-testid="map-poi-name">{poi.name}</p>
        <p className="text-xs text-zinc-500 mt-0.5 leading-snug">
          {kindLabel(poi.kind)}{poi.address ? ` · ${poi.address}` : ''}{fromMeM !== null ? ` · a ${fromMeM < 1000 ? `${Math.round(fromMeM)} m` : `${(fromMeM / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`} de você` : ''}
        </p>
      </div>
      <button onClick={onClose} aria-label="Fechar" data-testid="map-poi-close"
        className="shrink-0 -mr-1 -mt-1 w-9 h-9 rounded-xl flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/5 active:bg-white/10">
        <X className="w-5 h-5" />
      </button>
    </div>
    {mine ? (
      <p className="mt-3 flex items-center gap-2 text-sm font-bold text-emerald-500" data-testid="map-poi-mine">
        <CheckCircle2 className="w-4 h-4 shrink-0" /> Esta é a sua loja “{mine.name}”.
      </p>
    ) : (
      <div className={`mt-3 grid gap-2 ${onAdd ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {onAdd && (
          <button onClick={onAdd} data-testid="map-poi-add" className={btnGold}><Plus className="w-4 h-4" /> Adicionar às minhas</button>
        )}
        <button onClick={onAssociate} data-testid="map-poi-associate" className={btnNeutral}><Link2 className="w-4 h-4" /> É uma das minhas…</button>
      </div>
    )}
  </div>
);

/* ───────────── escolher qual das minhas lojas é este lugar ───────────── */

export interface PickableStore { est: Establishment; name: string; address: string; lat: number | null; lng: number | null }

export const StorePickerSheet: React.FC<{ poi: Poi; stores: PickableStore[]; onPick: (s: PickableStore) => void; onClose: () => void }> = ({ poi, stores, onPick, onClose }) => {
  const [query, setQuery] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const rows = useMemo(() => {
    const q = plain(query.trim());
    return stores
      .map(s => ({
        s,
        score: nameMatch([s.est.originalName, s.est.aliasName || '', s.name], poi.name),
        meters: s.lat !== null && s.lng !== null ? distanceM(s.lat, s.lng, poi.lat, poi.lng) : null,
      }))
      .filter(r => !q || plain(`${r.s.name} ${r.s.est.originalName} ${r.s.address}`).includes(q))
      .sort((a, b) => b.score - a.score || (a.meters ?? 1e9) - (b.meters ?? 1e9) || a.s.name.localeCompare(b.s.name, 'pt-BR'))
      .slice(0, 80);
  }, [stores, poi, query]);

  const fmt = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`);

  return createPortal(
    <div className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-150" onClick={onClose} data-testid="map-picker">
      <div role="dialog" aria-modal="true" aria-label="Escolher a loja" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[88dvh] flex flex-col bg-[#0c0c0e] border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] shadow-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="shrink-0 w-9 h-9 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold flex items-center justify-center"><Store className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-serif text-white tracking-tight leading-tight">Qual das suas lojas é “{poi.name}”?</h3>
            <p className="text-xs text-zinc-400 mt-0.5 leading-snug">A loja escolhida passa a ficar no lugar que o mapa mostra.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar loja" autoComplete="off" spellCheck={false} data-testid="map-picker-search"
              className="w-full bg-white/5 border border-white/5 rounded-xl py-2.5 pl-10 pr-3 text-[13px] text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-luxury-gold/40" />
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto px-5 divide-y divide-white/5">
          {rows.length === 0 && <li className="py-8 text-center text-sm text-zinc-500">Nenhuma loja{query ? ` com “${query.trim()}”` : ''}.</li>}
          {rows.map(r => (
            <li key={`${r.s.est.cnpj}|${r.s.est.originalName}`}>
              <button type="button" onClick={() => onPick(r.s)} data-testid="map-picker-option" data-score={r.score.toFixed(2)}
                className="w-full text-left py-2.5 min-h-[52px] flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white truncate">{r.s.name}</p>
                  <p className="text-[11px] text-zinc-500 truncate">{r.s.address || 'sem endereço'}</p>
                </div>
                <div className="text-right shrink-0">
                  {r.score >= 0.5 && <p className="text-[10px] font-bold text-emerald-500">nome parecido</p>}
                  <p className="text-[11px] text-zinc-500 tabular-nums">{r.meters !== null ? `pino a ${fmt(r.meters)}` : 'sem posição'}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
};
