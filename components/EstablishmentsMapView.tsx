import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Browser } from '@capacitor/browser';
import { ChevronLeft, MapPin, Loader2, RefreshCw, LocateFixed, Navigation, Car, Store, X, WifiOff, Pencil, Move, CheckCircle2 } from 'lucide-react';
import { Receipt, Establishment } from '../types';
import { geocodeMissingEstablishments, needsGeocoding } from '../services/geocodingService';
import { fetchRoute, haversineKm, formatDistance, formatDuration, navigationLinks, RouteResult, LatLng } from '../services/routingService';
import { getCurrentPosition } from '../services/cloudService';
import { isNativeApp } from '../services/platform';
import { useStoreNames } from './StoreNamesContext';
import { useOfflineMaps } from '../services/useOfflineMaps';
import OfflineVectorLayer from './OfflineVectorLayer';
import OfflineMapCard from './OfflineMapCard';
import MapStoreSearch from './MapStoreSearch';
import { SearchableStore } from '../services/mapSearch';
import { PoiCard, PoiMarkers, MapTap, ViewWatcher, StorePickerSheet, PickableStore } from './MapPois';
import { usePois } from '../services/usePois';
import { Bbox, Poi, boxAround, distanceM, nameMatch, poisNear, suggestPoi } from '../services/poiService';

interface MapViewProps {
  receipts: Receipt[];
  establishments: Establishment[];
  /** grava o endereço já localizado (ou a falha) no cadastro da loja */
  onPatchEstablishment: (est: Establishment, patch: Partial<Establishment>) => void;
  /** abre a folha com todos os dados da loja para editar */
  onEditEstablishment?: (est: Establishment) => void;
  /** cadastra uma loja que a pessoa achou no mapa (sem cupom ainda) */
  onAddEstablishment?: (est: Establishment) => void;
  onBack: () => void;
}

/* ───────────── dados ───────────── */

const digits = (s: string | undefined | null) => String(s ?? '').replace(/\D/g, '');
const plain = (s: string | undefined | null) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// CNPJ (14) ou CPF (11) identificam a loja; sem isso, vale o nome do cupom
const storeKey = (cnpj: string | undefined, name: string) => {
  const d = digits(cnpj);
  return d.length === 14 || d.length === 11 ? d : `n:${plain(name)}`;
};
const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const dayMonth = (iso: string) => { const [, m, d] = (iso || '').split('-'); return d && m ? `${d}/${m}` : ''; };

// O endereço do cupom muitas vezes já traz a cidade; só acrescenta se não estiver lá.
const fullAddress = (address?: string, city?: string) => {
  const a = String(address || '').replace(/\s+/g, ' ').trim();
  const c = String(city || '').replace(/\s+/g, ' ').trim();
  return c && !plain(a).includes(plain(c)) ? [a, c].filter(Boolean).join(', ') : a;
};

interface MapStore {
  id: string;
  est: Establishment;
  name: string;
  address: string;
  lat: number;
  lng: number;
  spent: number;
  visits: number;
  lastDate: string;
  km: number | null;       // em linha reta, a partir de você
  approx: boolean;         // só se achou a cidade, não o endereço
}

const openExternal = (url: string) => {
  if (isNativeApp()) Browser.open({ url }).catch(() => {});
  else window.open(url, '_blank', 'noopener');
};

// "Agora não" para a sugestão de mover o pino: guarda loja + nome do lugar do mapa
const DISMISS_KEY = 'eukasconta_poi_dismissed';
const readDismissed = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'); return Array.isArray(v) ? v.filter((x: unknown) => typeof x === 'string') : []; } catch { return []; }
};
const writeDismissed = (list: string[]) => { try { localStorage.setItem(DISMISS_KEY, JSON.stringify(list.slice(-300))); } catch { /* sem espaço: ignora */ } };

const useIsLight = () => {
  const read = () => typeof document !== 'undefined' && document.documentElement.classList.contains('light-theme');
  const [light, setLight] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setLight(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return light;
};

/* ───────────── marcadores ───────────── */

// Pino em forma de gota (cor da marca). A loja escolhida fica maior e mais clara; a mais perto, com anel.
// De longe (zoom baixo, muitas lojas juntas) viram bolinhas, para não virar uma mancha escura.
// Os ícones são criados uma vez só: trocar o objeto a cada desenho faria o Leaflet recolocar todos os pinos.
const pinCache = new Map<string, L.DivIcon>();
const pinIcon = (selected: boolean, nearest: boolean, compact: boolean, light: boolean) => {
  const key = `${selected ? 1 : 0}${nearest ? 1 : 0}${compact ? 1 : 0}${light ? 1 : 0}`;
  const hit = pinCache.get(key);
  if (hit) return hit;
  const color = selected ? '#F2D36B' : nearest ? '#D4AF37' : '#B8902E';
  // contorno que destaca o pino do mapa nos dois temas (claro no escuro, escuro no claro)
  const edge = light ? '#3a2a05' : '#ffffff';
  let icon: L.DivIcon;
  if (compact && !selected && !nearest) {
    icon = L.divIcon({
      className: '',
      html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid ${edge};box-shadow:0 0 0 1px rgba(0,0,0,.25);"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  } else {
    const px = selected ? 42 : nearest ? 34 : 28;
    icon = L.divIcon({
      className: '',
      html: `<div style="width:${px}px;height:${px}px;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35));">
      <svg viewBox="0 0 24 24" width="${px}" height="${px}">
        <path d="M12 1C6.9 1 3 5 3 10c0 6.8 9 13 9 13s9-6.2 9-13c0-5-3.9-9-9-9z" fill="${color}" stroke="${edge}" stroke-opacity=".95" stroke-width="1.4" stroke-linejoin="round"/>
        <circle cx="12" cy="10" r="3.4" fill="${edge}" fill-opacity=".92"/>
      </svg></div>`,
      iconSize: [px, px],
      iconAnchor: [px / 2, px - 1],
    });
  }
  pinCache.set(key, icon);
  return icon;
};

const meIcon = L.divIcon({
  className: '',
  html: `<div style="width:22px;height:22px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 0 6px rgba(59,130,246,.28),0 2px 6px rgba(0,0,0,.5);"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/* ───────────── enquadramento ───────────── */

// Perto o bastante para ver as ruas ao redor de quem apertou "minha localização"
const ME_ZOOM = 16;
// Ao abrir, o mapa mostra 2 km ao redor de quem está olhando
const START_RADIUS_M = 2000;

const Framer: React.FC<{ me: LatLng | null; target: LatLng | null; path: [number, number][] | null; all: [number, number][]; targetId: string | null; focusMe: number; focus: { lat: number; lng: number; zoom: number; n: number } }> = ({ me, target, path, all, targetId, focusMe, focus }) => {
  const map = useMap();
  // 'me' = 2 km ao redor de você · 'all' = todas as lojas · null = ainda nada
  const placed = useRef<'me' | 'all' | null>(null);
  const hadTarget = useRef(false);
  const fitCount = useRef(0);
  const touched = useRef(false);
  // Depois de "minha localização", a loja escolhida que muda não afasta o mapa de novo
  const focusedOn = useRef<{ targetId: string | null } | null>(null);

  // A pessoa mexeu no mapa (arrastou, deu zoom, tocou): daí em diante o mapa não pula sozinho para a posição dela.
  useEffect(() => {
    const el = map.getContainer();
    const mark = () => { touched.current = true; };
    map.on('dragstart', mark);
    el.addEventListener('wheel', mark, { passive: true });
    el.addEventListener('touchstart', mark, { passive: true });
    return () => { map.off('dragstart', mark); el.removeEventListener('wheel', mark); el.removeEventListener('touchstart', mark); };
  }, [map]);

  // loja escolhida pela pessoa: enquadra você + a loja (ou a rota inteira)
  useEffect(() => {
    if (!target) return;
    hadTarget.current = true;
    if (focusedOn.current && focusedOn.current.targetId === targetId) return;
    focusedOn.current = null;
    const pts: [number, number][] = path && path.length > 1 ? path : me ? [[me.lat, me.lng], [target.lat, target.lng]] : [[target.lat, target.lng]];
    if (pts.length === 1) map.setView(pts[0], 15);
    else map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 16 });
  }, [targetId, path, me?.lat, me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // nada escolhido: o mapa abre em 2 km ao redor de você; sem a sua localização, mostra todas as lojas.
  // Volta para cá também quando a escolha é desfeita.
  useEffect(() => {
    if (target) return;
    const comeback = hadTarget.current;
    if (me && (placed.current !== 'me' || comeback) && (!touched.current || comeback)) {
      placed.current = 'me'; hadTarget.current = false;
      const bounds = L.latLng(me.lat, me.lng).toBounds(START_RADIUS_M * 2);
      map.setView([me.lat, me.lng], map.getBoundsZoom(bounds, false), { animate: false });
      return;
    }
    // sem a sua localização: mostra todas as lojas, e enquadra de novo a cada loja que acaba de ser localizada (até a pessoa mexer no mapa)
    if (!me && all.length > 0 && (comeback || (!touched.current && (placed.current !== 'all' || fitCount.current !== all.length)))) {
      placed.current = 'all'; fitCount.current = all.length; hadTarget.current = false;
      const pts = all;
      if (pts.length === 1) map.setView(pts[0], 14);
      else map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 15 });
    }
  }, [all.length, target, me?.lat, me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Busca: leva o mapa até a loja que a pessoa escolheu (quando ela já era a loja escolhida, o enquadramento acima não se repete)
  useEffect(() => {
    if (focus.n === 0) return;
    focusedOn.current = null;
    map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), focus.zoom), { duration: 0.6 });
  }, [focus.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Minha localização": fecha o mapa em cima de você
  useEffect(() => {
    if (focusMe === 0 || !me) return;
    focusedOn.current = { targetId };
    placed.current = 'me';
    map.flyTo([me.lat, me.lng], ME_ZOOM, { duration: 0.8 });
  }, [focusMe]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
};

// Zoom atual (para trocar pinos por bolinhas quando está longe)
const ZoomWatcher: React.FC<{ onZoom: (z: number) => void }> = ({ onZoom }) => {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => { onZoom(map.getZoom()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
};

// Avisa para onde o mapa está olhando (para saber se saiu da área baixada)
const CenterWatcher: React.FC<{ onCenter: (lat: number, lng: number) => void }> = ({ onCenter }) => {
  useMapEvents({ moveend: e => { const c = e.target.getCenter(); onCenter(c.lat, c.lng); } });
  return null;
};

/* ───────────── tela ───────────── */

const EstablishmentsMapView: React.FC<MapViewProps> = ({ receipts, establishments, onPatchEstablishment, onEditEstablishment, onAddEstablishment, onBack }) => {
  const namer = useStoreNames();
  const light = useIsLight();

  /* localização do aparelho */
  const [me, setMe] = useState<LatLng | null>(null);
  const [loc, setLoc] = useState<{ status: 'idle' | 'loading' | 'ok' | 'denied' | 'error'; msg: string }>({ status: 'idle', msg: '' });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [focusMe, setFocusMe] = useState(0);
  const locate = useCallback(async (focus = false) => {
    setLoc({ status: 'loading', msg: '' });
    try {
      const p = await getCurrentPosition();
      if (!alive.current) return;
      setMe(p); setLoc({ status: 'ok', msg: '' });
      if (focus) setFocusMe(n => n + 1);
    } catch (e: any) {
      if (!alive.current) return;
      const msg = String(e?.message || 'Não consegui obter sua localização.');
      setLoc({ status: /negada/i.test(msg) ? 'denied' : 'error', msg });
    }
  }, []);
  useEffect(() => { locate(false); }, [locate]);

  /* endereços -> coordenadas (uma vez por loja; o resultado fica guardado no cadastro) */
  const [geo, setGeo] = useState({ running: false, done: 0, total: 0 });
  const geoRunning = useRef(false);
  const pending = useMemo(() => establishments.filter(needsGeocoding), [establishments]);
  useEffect(() => {
    if (pending.length === 0 || geoRunning.current) return;
    geoRunning.current = true;
    setGeo({ running: true, done: 0, total: pending.length });
    let done = 0;
    geocodeMissingEstablishments(pending, (est, patch) => {
      done += 1;
      if (alive.current) setGeo({ running: true, done, total: pending.length });
      onPatchEstablishment(est, patch);
    }).finally(() => { geoRunning.current = false; if (alive.current) setGeo(g => ({ ...g, running: false })); });
  }, [pending.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /* lojas com posição, somando o que foi gasto em cada uma */
  const agg = useMemo(() => {
    const m = new Map<string, { spent: number; visits: number; last: string }>();
    receipts.forEach(r => {
      const k = storeKey(r.cnpj, r.establishmentName);
      const a = m.get(k) || { spent: 0, visits: 0, last: '' };
      a.spent += r.totalAmount || 0; a.visits += 1; if ((r.date || '') > a.last) a.last = r.date || '';
      m.set(k, a);
    });
    return m;
  }, [receipts]);
  const stores: MapStore[] = useMemo(() => {
    return establishments
      .filter(e => e.geocodeStatus === 'found' && typeof e.latitude === 'number' && typeof e.longitude === 'number')
      .map(e => {
        const a = agg.get(storeKey(e.cnpj, e.originalName)) || { spent: 0, visits: 0, last: '' };
        const lat = e.latitude as number, lng = e.longitude as number;
        return {
          id: `${e.cnpj}|${e.originalName}`,
          est: e,
          name: namer.nameOf(e.originalName, e.cnpj),
          address: fullAddress(e.address, e.city),
          lat, lng,
          spent: a.spent, visits: a.visits, lastDate: a.last,
          km: me ? haversineKm(me, { lat, lng }) : null,
          approx: !!e.geocodeApprox,
        };
      });
  }, [establishments, agg, namer, me]);

  const sorted = useMemo(
    () => [...stores].sort((a, b) => (a.km !== null && b.km !== null ? a.km - b.km : b.spent - a.spent)),
    [stores]
  );
  const nearestId = me && sorted.length ? sorted[0].id : null;
  const notFound = useMemo(() => establishments.filter(e => e.geocodeStatus === 'not_found'), [establishments]);

  /* mapa salvo no aparelho */
  const mapPoints = useMemo<[number, number][]>(
    () => [...stores.map(s => [s.lat, s.lng] as [number, number]), ...(me ? [[me.lat, me.lng] as [number, number]] : [])],
    [stores, me]
  );
  const maps = useOfflineMaps(mapPoints);
  const [viewCenter, setViewCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [zoom, setZoom] = useState(12);
  const outside = maps.useVector && !!maps.opened && !!viewCenter && !maps.opened.covers(viewCenter.lat, viewCenter.lng);

  /* loja escolhida e rota */
  // O mapa abre livre: nenhuma loja escolhida, nenhuma rota. A loja (e a rota até ela) só vale depois que a pessoa toca numa;
  // tocar de novo na mesma, ou no X do cartão, desfaz a escolha, tira a rota e volta para a visão livre ao redor de você.
  const [manual, setManual] = useState<{ id: string | null } | null>(null);
  const selectedId = manual ? manual.id : null;
  const selected = useMemo(() => stores.find(s => s.id === selectedId) || null, [stores, selectedId]);
  // a loja que a pessoa tocou move o mapa e traça a rota
  const picked = selected;
  const [focus, setFocus] = useState({ lat: 0, lng: 0, zoom: 16, n: 0 });
  const [route, setRoute] = useState<{ status: 'idle' | 'loading' | 'ok' | 'error'; data: RouteResult | null }>({ status: 'idle', data: null });

  const meKey = me ? `${me.lat.toFixed(4)},${me.lng.toFixed(4)}` : '';
  useEffect(() => {
    if (!selected || !me) { setRoute({ status: 'idle', data: null }); return; }
    const ctrl = new AbortController();
    setRoute({ status: 'loading', data: null });
    // pequena espera: se a "mais perto" mudar de novo em seguida (outra loja acabou de ser localizada), não gasta uma rota à toa
    const timer = setTimeout(() => {
      fetchRoute(me, { lat: selected.lat, lng: selected.lng }, ctrl.signal)
        .then(data => { if (!ctrl.signal.aborted) setRoute({ status: 'ok', data }); })
        .catch(() => { if (!ctrl.signal.aborted) setRoute({ status: 'error', data: null }); });
    }, 600);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [selected?.id, selected?.lat, selected?.lng, meKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* lojas do mapa (OpenStreetMap): ver, ligar a uma das minhas, adicionar, e mover o pino de uma loja */
  const [showPois, setShowPois] = useState(() => { try { return localStorage.getItem('eukasconta_map_pois') === '1'; } catch { return false; } });
  const toggleShowPois = () => setShowPois(v => { const n = !v; try { localStorage.setItem('eukasconta_map_pois', n ? '1' : '0'); } catch { /* ok */ } return n; });
  const [view, setView] = useState<{ bbox: Bbox; zoom: number } | null>(null);
  const [moving, setMoving] = useState<{ id: string; lat: number; lng: number } | null>(null);
  const [selectedPoi, setSelectedPoi] = useState<Poi | null>(null);
  const [pickerFor, setPickerFor] = useState<Poi | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(t);
  }, [notice]);

  const poiOpts = { archive: maps.opened?.archive ?? null, archiveZoom: maps.opened?.maxzoom, online: maps.online };
  const poiZoomOk = !!view && view.zoom >= 14;
  const viewPois = usePois((showPois || !!moving) && poiZoomOk ? view!.bbox : null, poiOpts);
  const pinCenter = moving ? { lat: moving.lat, lng: moving.lng } : selected ? { lat: selected.lat, lng: selected.lng } : null;
  const pinPois = usePois(pinCenter ? boxAround(pinCenter.lat, pinCenter.lng, moving ? 500 : 700) : null, poiOpts, 250);

  // o lugar do mapa que parece ser a loja escolhida, quando o pino está longe dele
  const suggestion = useMemo(() => {
    if (!selected || moving || selected.est.geocodeManual) return null;
    const s = suggestPoi([selected.est.originalName, selected.est.aliasName || '', selected.name], { lat: selected.lat, lng: selected.lng }, pinPois.pois, 600);
    if (!s || s.meters < 40) return null;
    if (dismissed.includes(`${selected.id}|${plain(s.poi.name)}`)) return null;
    return s;
  }, [selected, moving, pinPois.pois, dismissed]);

  const storePins = useMemo(() => stores.map(s => ({ lat: s.lat, lng: s.lng })), [stores]);
  const shownPois = useMemo(() => viewPois.pois.filter(p => p.id !== suggestion?.poi.id), [viewPois.pois, suggestion]);
  const nearToMove = useMemo(() => (moving ? poisNear(moving, pinPois.pois, 400, 5) : []), [moving, pinPois.pois]);

  const placeStore = (st: MapStore, lat: number, lng: number, message: string) => {
    onPatchEstablishment(st.est, { latitude: lat, longitude: lng, geocodeStatus: 'found', geocodedAt: Date.now(), geocodeApprox: undefined, geocodeManual: true });
    setNotice(message);
  };
  const startMove = () => {
    if (!selected) return;
    setSelectedPoi(null);
    setMoving({ id: selected.id, lat: selected.lat, lng: selected.lng });
    mapBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });   // o mapa e os botões Salvar/Cancelar ficam à vista
  };
  const saveMove = () => {
    const st = moving && stores.find(s => s.id === moving.id);
    if (st && moving) placeStore(st, Number(moving.lat.toFixed(6)), Number(moving.lng.toFixed(6)), `Posição de “${st.name}” atualizada.`);
    setMoving(null);
  };
  const movedBy = moving ? (() => { const st = stores.find(s => s.id === moving.id); return st ? distanceM(st.lat, st.lng, moving.lat, moving.lng) : 0; })() : 0;
  const dismissSuggestion = () => {
    if (!selected || !suggestion) return;
    const next = [...dismissed, `${selected.id}|${plain(suggestion.poi.name)}`];
    setDismissed(next); writeDismissed(next);
  };
  const acceptSuggestion = () => {
    if (!selected || !suggestion) return;
    placeStore(selected, suggestion.poi.lat, suggestion.poi.lng, `“${selected.name}” agora está em “${suggestion.poi.name}”, onde o mapa mostra.`);
  };
  const onPoiPick = (p: Poi) => {
    if (moving) { setMoving(m => (m ? { ...m, lat: p.lat, lng: p.lng } : m)); return; }
    setSelectedPoi(p);
  };
  // a loja minha que já está neste lugar (nome parecido e perto, ou praticamente em cima)
  const mineAt = (p: Poi) => {
    const hit = stores.find(s => {
      const d = distanceM(s.lat, s.lng, p.lat, p.lng);
      return d <= 15 || (d <= 60 && nameMatch([s.est.originalName, s.est.aliasName || '', s.name], p.name) >= 0.5);
    });
    return hit ? { name: hit.name } : null;
  };
  const pickable: PickableStore[] = useMemo(
    () => establishments.map(e => {
      const st = stores.find(s => s.est === e);
      return { est: e, name: namer.nameOf(e.originalName, e.cnpj), address: fullAddress(e.address, e.city), lat: st ? st.lat : null, lng: st ? st.lng : null };
    }),
    [establishments, stores, namer]
  );
  const associate = (poi: Poi, target: PickableStore) => {
    onPatchEstablishment(target.est, { latitude: poi.lat, longitude: poi.lng, geocodeStatus: 'found', geocodedAt: Date.now(), geocodeApprox: undefined, geocodeManual: true });
    setPickerFor(null); setSelectedPoi(null);
    setManual({ id: `${target.est.cnpj}|${target.est.originalName}` });
    setNotice(`“${target.name}” agora está em “${poi.name}”.`);
  };
  const addPoiAsStore = (p: Poi) => {
    if (!onAddEstablishment) return;
    const dup = establishments.find(e => !digits(e.cnpj) && plain(e.originalName) === plain(p.name));
    if (dup) { setNotice(`“${p.name}” já está nas suas lojas.`); setSelectedPoi(null); return; }
    // cidade e estado: os da loja sua mais perto (até 25 km)
    let city = '', state = '', best = 25000;
    stores.forEach(s => { const d = distanceM(s.lat, s.lng, p.lat, p.lng); if (d < best && s.est.city) { best = d; city = s.est.city || ''; state = s.est.state || ''; } });
    onAddEstablishment({ cnpj: '', originalName: p.name, address: p.address || '', city, state, latitude: p.lat, longitude: p.lng, geocodeStatus: 'found', geocodedAt: Date.now(), geocodeManual: true });
    setSelectedPoi(null);
    setManual({ id: `|${p.name}` });
    setNotice(`“${p.name}” entrou nas suas lojas.`);
  };

  const mapBox = useRef<HTMLDivElement>(null);
  const pick = (id: string) => {
    setMoving(null); setSelectedPoi(null);
    if (id === selectedId) { setManual({ id: null }); return; }
    setManual({ id });
    mapBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* busca de estabelecimento (logo abaixo do mapa) */
  const searchItems: SearchableStore[] = useMemo(() => establishments.map(e => {
    const id = `${e.cnpj}|${e.originalName}`;
    const st = stores.find(x => x.est === e);
    const a = agg.get(storeKey(e.cnpj, e.originalName));
    return {
      id, name: namer.nameOf(e.originalName, e.cnpj), original: e.originalName || '', alias: e.aliasName || '',
      address: e.address || '', city: e.city || '', cnpj: e.cnpj || '',
      km: st ? st.km : null, spent: a?.spent ?? 0, visits: a?.visits ?? 0, located: !!st,
    };
  }), [establishments, stores, agg, namer]);
  const searchPoisPool = useMemo(() => [...viewPois.pois, ...pinPois.pois], [viewPois.pois, pinPois.pois]);
  const searchPickStore = (id: string) => {
    const st = stores.find(x => x.id === id);
    if (!st) return;
    setMoving(null); setSelectedPoi(null);
    const already = manual?.id === id;
    setManual({ id });
    mapBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (already) setFocus(f => ({ lat: st.lat, lng: st.lng, zoom: 16, n: f.n + 1 }));
  };
  const searchPickPoi = (p: Poi) => {
    setMoving(null);
    setSelectedPoi(p);
    mapBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setFocus(f => ({ lat: p.lat, lng: p.lng, zoom: 17, n: f.n + 1 }));
  };

  const retryNotFound = () => {
    notFound.forEach(e => onPatchEstablishment(e, { geocodeStatus: undefined, geocodedAt: undefined }));
  };

  const allPoints: [number, number][] = stores.map(s => [s.lat, s.lng]);
  const center: [number, number] = allPoints[0] || [-14.235, -51.925]; // centro do Brasil enquanto nada foi localizado
  const links = selected ? navigationLinks({ lat: selected.lat, lng: selected.lng }) : null;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 pb-20" data-testid="map-view">
      <div className="flex items-center gap-4 mb-5 md:mb-8">
        <button onClick={onBack} aria-label="Voltar" className="w-11 h-11 md:w-14 md:h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-luxury-gold transition-all shadow-xl shrink-0">
          <ChevronLeft className="w-6 h-6 md:w-7 md:h-7" />
        </button>
        <div className="min-w-0">
          <span className="text-[11px] text-zinc-500 uppercase tracking-[0.1em] font-bold block mb-1">Onde você compra</span>
          <h2 className="text-2xl md:text-4xl font-serif text-white tracking-tighter uppercase truncate">Mapa</h2>
        </div>
      </div>

      {geo.running && (
        <div className="flex items-start gap-3 mb-3 px-4 py-3 rounded-2xl bg-luxury-gold/10 border border-luxury-gold/20 text-luxury-gold text-xs font-bold" data-testid="map-geocoding">
          <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-px" />
          <span>Localizando as lojas pelo endereço do cupom ({Math.min(geo.done + 1, geo.total)}/{geo.total}). Uma por vez, para respeitar o serviço gratuito do OpenStreetMap; cada loja só é buscada uma vez.</span>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-3 mb-3 px-4 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-500 text-xs font-bold" data-testid="map-notice" role="status">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
          <span className="flex-1 min-w-0">{notice}</span>
        </div>
      )}

      {(loc.status === 'denied' || loc.status === 'error') && (
        <div className="flex items-center gap-3 mb-3 px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-zinc-400" data-testid="map-loc-msg">
          <LocateFixed className="w-4 h-4 shrink-0 text-zinc-500" />
          <span className="flex-1 min-w-0">{loc.status === 'denied' ? 'Sem permissão de localização: não sei qual loja está mais perto. Libere a localização do app nas configurações do celular.' : loc.msg}</span>
          <button onClick={() => locate(true)} className="shrink-0 px-3 py-2 rounded-xl bg-luxury-gold/10 border border-luxury-gold/25 text-luxury-gold font-bold">Tentar de novo</button>
        </div>
      )}

      <div ref={mapBox} className="bg-zinc-950 border border-white/5 rounded-[1.75rem] md:rounded-[2.5rem] overflow-hidden shadow-2xl relative scroll-mt-20">
        <div className={`h-[340px] md:h-[520px] w-full relative z-0 ${!light && !(maps.useVector && maps.opened) ? 'map-dark' : ''}`} data-testid="map-canvas">
          <MapContainer center={center} zoom={stores.length ? 12 : 4} zoomSnap={0.25} scrollWheelZoom style={{ width: '100%', height: '100%', background: light ? '#f4f4f5' : '#09090b' }}>
            {/* espera ler o que está salvo antes de escolher a base: evita pedir imagens online à toa */}
            {!maps.savedLoaded ? null : maps.useVector && maps.opened ? (
              <OfflineVectorLayer archive={maps.opened.archive} dark={!light} maxDataZoom={maps.opened.maxzoom} />
            ) : (
              <TileLayer
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                maxZoom={19}
              />
            )}
            <CenterWatcher onCenter={(lat, lng) => setViewCenter({ lat, lng })} />
            <ZoomWatcher onZoom={setZoom} />
            <ViewWatcher onView={(bbox, z) => setView({ bbox, zoom: z })} />
            <MapTap enabled={!!moving} onTap={(lat, lng) => setMoving(m => (m ? { ...m, lat, lng } : m))} />
            <Framer me={me} target={picked ? { lat: picked.lat, lng: picked.lng } : null} path={picked ? route.data?.path || null : null} all={allPoints} targetId={picked?.id || null} focusMe={focusMe} focus={focus} />
            {route.data && (
              <>
                <Polyline positions={route.data.path} pathOptions={{ color: light ? '#ffffff' : '#000000', weight: 9, opacity: 0.75, lineCap: 'round', lineJoin: 'round' }} />
                <Polyline positions={route.data.path} pathOptions={{ color: '#D4AF37', weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round' }} />
              </>
            )}
            {(showPois || !!moving) && poiZoomOk && (
              <PoiMarkers pois={shownPois} light={light} activeId={selectedPoi?.id} hideNear={storePins} onPick={onPoiPick} />
            )}
            {suggestion && <PoiMarkers pois={[suggestion.poi]} light={light} activeId={suggestion.poi.id} onPick={onPoiPick} />}
            {selectedPoi && !moving && !(showPois && poiZoomOk && shownPois.some(p => p.id === selectedPoi.id)) && (
              <PoiMarkers pois={[selectedPoi]} light={light} activeId={selectedPoi.id} onPick={onPoiPick} />
            )}
            {moving && (() => {
              const st = stores.find(x => x.id === moving.id);
              return st ? <Polyline positions={[[st.lat, st.lng], [moving.lat, moving.lng]]} pathOptions={{ color: '#F2D36B', weight: 3, dashArray: '6 8', opacity: 0.9 }} /> : null;
            })()}
            {moving && (
              <Marker
                position={[moving.lat, moving.lng]} draggable icon={pinIcon(true, false, false, light)} zIndexOffset={3000}
                eventHandlers={{ dragend: e => { const ll = (e.target as L.Marker).getLatLng(); setMoving(m => (m ? { ...m, lat: ll.lat, lng: ll.lng } : m)); } }}
              />
            )}
            {stores.filter(s => !(moving && moving.id === s.id)).map(s => (
              <Marker
                key={s.id}
                position={[s.lat, s.lng]}
                icon={pinIcon(s.id === selectedId, s.id === nearestId, zoom < 14, light)}
                zIndexOffset={s.id === selectedId ? 1000 : s.id === nearestId ? 500 : 0}
                eventHandlers={{ click: () => { if (!moving) { setSelectedPoi(null); setManual({ id: s.id }); } } }}
              />
            ))}
            {me && <Marker position={[me.lat, me.lng]} icon={meIcon} zIndexOffset={2000} interactive={false} />}
          </MapContainer>

          <button
            onClick={() => locate(true)} disabled={loc.status === 'loading'} aria-label="Usar minha localização" data-testid="map-locate"
            className="absolute top-3 right-3 z-[1000] w-11 h-11 rounded-2xl bg-black/70 backdrop-blur border border-white/15 text-luxury-gold flex items-center justify-center shadow-xl active:scale-95 disabled:opacity-60"
          >
            {loc.status === 'loading' ? <Loader2 className="w-5 h-5 animate-spin" /> : <LocateFixed className="w-5 h-5" />}
          </button>

          <button
            onClick={toggleShowPois} aria-label="Mostrar as lojas do mapa" aria-pressed={showPois} data-testid="map-pois-toggle" data-on={showPois ? 'true' : 'false'}
            className={`absolute top-[64px] right-3 z-[1000] w-11 h-11 rounded-2xl backdrop-blur border flex items-center justify-center shadow-xl active:scale-95 ${showPois ? 'bg-luxury-gold text-black border-luxury-gold' : 'bg-black/70 text-luxury-gold border-white/15'}`}
          >
            {showPois && viewPois.status === 'loading' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Store className="w-5 h-5" />}
          </button>

          {(showPois || moving) && (
            <div className={`absolute ${moving ? 'bottom-[60px]' : 'bottom-14'} left-3 z-[1000] max-w-[78%] px-3 py-1.5 rounded-full bg-black/75 backdrop-blur border border-white/15 text-[11px] font-bold text-zinc-200 shadow-xl`} data-testid="map-pois-hint">
              {!poiZoomOk ? 'Aproxime o mapa para ver as lojas'
                : viewPois.status === 'loading' ? 'Procurando lojas…'
                : viewPois.status === 'error' ? 'Sem internet e sem mapa salvo: não há lojas para mostrar'
                : `${shownPois.length} ${shownPois.length === 1 ? 'loja' : 'lojas'} no mapa${viewPois.origin === 'salvo' ? ' (do mapa salvo)' : ''}`}
            </div>
          )}

          {moving && (
            <div className="absolute bottom-3 left-3 right-3 z-[1000] grid grid-cols-2 gap-2" data-testid="map-move-bar">
              <button onClick={() => setMoving(null)} data-testid="map-move-cancel"
                className="h-11 rounded-2xl bg-black/80 backdrop-blur border border-white/20 text-zinc-100 text-sm font-bold shadow-xl active:scale-[0.98] transition-transform">Cancelar</button>
              <button onClick={saveMove} data-testid="map-move-save"
                className="h-11 rounded-2xl bg-luxury-gold text-black text-sm font-bold shadow-xl active:scale-[0.98] transition-transform">Salvar posição</button>
            </div>
          )}

          {maps.opened && !moving && (
            <button
              onClick={() => maps.setSource(maps.source === 'auto' ? 'saved' : maps.source === 'saved' ? 'online' : 'auto')}
              data-testid="map-source-chip" data-mode={maps.useVector ? 'saved' : 'online'} data-source={maps.source}
              className="absolute bottom-3 left-3 z-[1000] max-w-[70%] flex items-center gap-1.5 pl-3 pr-3.5 h-9 rounded-full bg-black/75 backdrop-blur border border-white/15 text-[11px] font-bold text-luxury-gold shadow-xl active:scale-95"
            >
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{
                maps.source === 'auto'
                  ? (maps.useVector ? (outside ? 'Sem internet · fora da área salva' : 'Sem internet · mapa salvo') : 'OpenStreetMap online · automático')
                  : maps.source === 'saved'
                    ? (outside ? 'Fora da área salva · ver online' : 'Mapa salvo no celular · fixo')
                    : 'OpenStreetMap online · fixo'
              }</span>
            </button>
          )}
        </div>
      </div>

      {/* Buscar estabelecimento: as lojas das suas compras e as do mapa que já carregaram */}
      {!moving && (
        <MapStoreSearch
          stores={searchItems} pois={searchPoisPool} selectedId={selectedId} isMine={p => !!mineAt(p)}
          onPickStore={searchPickStore} onPickPoi={searchPickPoi}
          onEditStore={onEditEstablishment ? (id => { const e = establishments.find(x => `${x.cnpj}|${x.originalName}` === id); if (e) onEditEstablishment(e); }) : undefined}
          showingPois={showPois}
        />
      )}

      {/* Uma loja que o mapa mostra (toque no ícone) */}
      {selectedPoi && !moving && (
        <PoiCard
          poi={selectedPoi}
          mine={mineAt(selectedPoi)}
          fromMeM={me ? distanceM(me.lat, me.lng, selectedPoi.lat, selectedPoi.lng) : null}
          onClose={() => setSelectedPoi(null)}
          onAdd={onAddEstablishment ? () => addPoiAsStore(selectedPoi) : undefined}
          onAssociate={() => setPickerFor(selectedPoi)}
        />
      )}

      {/* A loja escolhida: distância, tempo e atalho para o app de navegação */}
      {selected && links && (
        <div className="mt-4 rounded-3xl border border-luxury-gold/30 bg-luxury-gold/[0.07] p-4 md:p-5" data-testid="map-selected">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-luxury-gold/15 border border-luxury-gold/25 flex items-center justify-center shrink-0"><Store className="w-5 h-5 text-luxury-gold" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-white leading-tight truncate" data-testid="map-selected-name">{selected.name}</p>
              {selected.address && <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{selected.address}</p>}
            </div>
            {onEditEstablishment && (
              <button onClick={() => onEditEstablishment(selected.est)} aria-label="Editar dados da loja" data-testid="map-edit-store"
                className="shrink-0 -mt-1 w-9 h-9 rounded-xl flex items-center justify-center text-zinc-500 hover:text-luxury-gold hover:bg-white/5 active:bg-white/10">
                <Pencil className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => { setMoving(null); setManual({ id: null }); }} aria-label="Fechar e tirar a rota" data-testid="map-clear"
              className="shrink-0 -mr-1 -mt-1 w-9 h-9 rounded-xl flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/5 active:bg-white/10">
              <X className="w-5 h-5" />
            </button>
          </div>

          {moving && moving.id === selected.id ? (
            <div className="mt-3" data-testid="map-move-panel">
              <p className="text-sm text-zinc-200 leading-snug">Arraste o pino ou toque no mapa onde a loja fica. Toque numa loja do mapa para colocar o pino nela.</p>
              <p className="text-xs text-zinc-500 mt-1 tabular-nums" data-testid="map-move-delta">
                {movedBy < 5 ? 'Na posição de antes' : `${formatDistance(movedBy / 1000)} de onde estava`}
              </p>
              {nearToMove.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2" data-testid="map-move-pois">
                  {nearToMove.map(n => (
                    <button key={n.poi.id} onClick={() => setMoving(m => (m ? { ...m, lat: n.poi.lat, lng: n.poi.lng } : m))} data-testid="map-move-poi"
                      className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-[11px] font-bold text-zinc-200 active:scale-95 max-w-full truncate">
                      {n.poi.name} · {formatDistance(n.meters / 1000)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {suggestion && (
                <div className="mt-3 rounded-2xl border border-luxury-gold/30 bg-luxury-gold/10 px-3.5 py-3" data-testid="map-suggest">
                  <p className="text-xs text-zinc-200 leading-snug">
                    O mapa mostra <b className="text-white">{suggestion.poi.name}</b> a <b className="text-white">{formatDistance(suggestion.meters / 1000)}</b> do pino. Parece ser esta loja: o pino pode estar fora do lugar.
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button onClick={acceptSuggestion} data-testid="map-suggest-accept"
                      className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-luxury-gold text-black text-xs font-bold active:scale-[0.98] transition-transform">Mover para lá</button>
                    <button onClick={dismissSuggestion} data-testid="map-suggest-dismiss"
                      className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/5 border border-white/10 text-zinc-200 text-xs font-bold active:scale-[0.98] transition-transform">Agora não</button>
                  </div>
                </div>
              )}
              <button onClick={startMove} data-testid="map-move-start"
                className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/5 border border-luxury-gold/50 text-zinc-100 text-sm font-bold active:scale-[0.98] transition-transform">
                <Move className="w-4 h-4 text-luxury-gold" /> Mover marcador
              </button>
          <div className="mt-3 text-sm" data-testid="map-route-info">
            {!me && <span className="text-zinc-400">Libere sua localização para traçar a rota até aqui.</span>}
            {me && route.status === 'loading' && <span className="inline-flex items-center gap-2 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /> Traçando a rota…</span>}
            {me && route.status === 'ok' && route.data && (
              <span className="inline-flex items-center gap-2 font-bold text-luxury-gold tabular-nums">
                <Car className="w-4 h-4" /> {formatDistance(route.data.distanceM / 1000)} · {formatDuration(route.data.durationS)} de carro
              </span>
            )}
            {me && route.status === 'error' && (
              <span className="text-zinc-400">Não consegui traçar a rota agora ({selected.km !== null ? `${formatDistance(selected.km)} em linha reta` : 'sem distância'}). Abra no app de navegação:</span>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={() => openExternal(links.google)} data-testid="map-open-google"
              className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-luxury-gold text-black text-xs font-bold active:scale-[0.98] transition-transform">
              <Navigation className="w-4 h-4" /> Google Maps
            </button>
            <button onClick={() => openExternal(links.waze)} data-testid="map-open-waze"
              className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/5 border border-white/10 text-zinc-200 text-xs font-bold active:scale-[0.98] transition-transform">
              <Navigation className="w-4 h-4" /> Waze
            </button>
          </div>
            </>
          )}
        </div>
      )}

      <OfflineMapCard maps={maps} hasPoints={mapPoints.length > 0} />

      {pickerFor && (
        <StorePickerSheet poi={pickerFor} stores={pickable} onPick={t => associate(pickerFor, t)} onClose={() => setPickerFor(null)} />
      )}

      {/* Lojas das suas compras, da mais perto para a mais longe */}
      {sorted.length > 0 && (
        <section className="mt-6" aria-label="Lojas das suas compras">
          <div className="flex items-center justify-between gap-3 mb-3 px-1 min-h-[28px]">
            <h3 className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold" data-testid="map-list-title">
              {me ? 'Lojas das suas compras, da mais perto' : 'Lojas das suas compras'}
            </h3>
            {me && nearestId && selectedId !== nearestId && (
              <button onClick={() => { setMoving(null); setSelectedPoi(null); setManual({ id: nearestId }); mapBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} data-testid="map-back-nearest"
                className="shrink-0 px-3 py-1.5 rounded-xl bg-luxury-gold/10 border border-luxury-gold/25 text-luxury-gold text-[11px] font-bold active:scale-95">
                Ir para a mais perto
              </button>
            )}
          </div>
          <div className="space-y-2" data-testid="map-list">
            {sorted.map((s, i) => {
              const active = s.id === selectedId;
              return (
                <button
                  key={s.id} onClick={() => pick(s.id)} data-testid="map-store" data-active={active ? 'true' : 'false'}
                  className={`w-full text-left rounded-2xl border px-4 py-3 flex items-center gap-3 transition-colors ${active ? 'border-luxury-gold/40 bg-luxury-gold/10' : 'border-white/5 bg-white/[0.03] hover:bg-white/5'}`}
                >
                  <MapPin className={`w-4 h-4 shrink-0 ${active ? 'text-luxury-gold' : 'text-zinc-600'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white truncate">{s.name}</p>
                    <p className="text-[11px] text-zinc-500 truncate">
                      {s.visits} {s.visits === 1 ? 'compra' : 'compras'} · {brl(s.spent)}{s.lastDate ? ` · última ${dayMonth(s.lastDate)}` : ''}
                    </p>
                    {s.approx && <p className="text-[10px] text-amber-500/80 truncate" data-testid="map-store-approx">Posição aproximada: centro da cidade</p>}
                  </div>
                  {s.km !== null && (
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold tabular-nums text-luxury-gold">{formatDistance(s.km)}</p>
                      <p className="text-[10px] text-zinc-600">{i === 0 ? 'mais perto' : 'em linha reta'}</p>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {!geo.running && stores.length === 0 && (
        <div className="mt-6 p-6 rounded-3xl bg-white/[0.02] border border-white/5 text-center" data-testid="map-empty">
          <MapPin className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm font-bold text-zinc-300">Nenhuma loja localizada ainda</p>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">O mapa usa o endereço que vem no cupom. Escaneie um cupom com endereço, ou confira o endereço da loja em Estúdio.</p>
        </div>
      )}

      {notFound.length > 0 && (
        <div className="mt-6 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h4 className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold">Sem localização encontrada ({notFound.length})</h4>
            <button onClick={retryNotFound} disabled={geo.running}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-[11px] font-bold hover:border-luxury-gold/40 transition-all disabled:opacity-40">
              <RefreshCw className={`w-3.5 h-3.5 ${geo.running ? 'animate-spin' : ''}`} /> Tentar de novo
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {notFound.map(e => (
              onEditEstablishment ? (
                <button key={`${e.cnpj}|${e.originalName}`} onClick={() => onEditEstablishment(e)} data-testid="map-notfound-edit"
                  className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/5 text-[11px] text-zinc-400 font-bold truncate max-w-[220px] hover:border-luxury-gold/40 hover:text-luxury-gold">
                  {namer.nameOf(e.originalName, e.cnpj)}
                </button>
              ) : (
                <span key={`${e.cnpj}|${e.originalName}`} className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/5 text-[11px] text-zinc-400 font-bold truncate max-w-[220px]">
                  {namer.nameOf(e.originalName, e.cnpj)}
                </span>
              )
            ))}
          </div>
        </div>
      )}

      <p className="mt-6 px-1 text-[10px] text-zinc-600 leading-relaxed">
        Mapa © contribuidores do OpenStreetMap · endereços por Nominatim · rotas de carro por OSRM, calculadas só quando você escolhe uma loja.
      </p>
    </div>
  );
};

export default EstablishmentsMapView;
