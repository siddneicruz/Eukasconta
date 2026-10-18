import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Browser } from '@capacitor/browser';
import { ChevronLeft, MapPin, Loader2, RefreshCw, LocateFixed, Navigation, Car, Store, X, WifiOff } from 'lucide-react';
import { Receipt, Establishment } from '../types';
import { geocodeMissingEstablishments, needsGeocoding } from '../services/geocodingService';
import { fetchRoute, haversineKm, formatDistance, formatDuration, navigationLinks, RouteResult, LatLng } from '../services/routingService';
import { getCurrentPosition } from '../services/cloudService';
import { isNativeApp } from '../services/platform';
import { useStoreNames } from './StoreNamesContext';
import { useOfflineMaps } from '../services/useOfflineMaps';
import OfflineVectorLayer from './OfflineVectorLayer';
import OfflineMapCard from './OfflineMapCard';

interface MapViewProps {
  receipts: Receipt[];
  establishments: Establishment[];
  /** grava o endereço já localizado (ou a falha) no cadastro da loja */
  onPatchEstablishment: (est: Establishment, patch: Partial<Establishment>) => void;
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

const Framer: React.FC<{ me: LatLng | null; target: LatLng | null; path: [number, number][] | null; all: [number, number][]; targetId: string | null; focusMe: number }> = ({ me, target, path, all, targetId, focusMe }) => {
  const map = useMap();
  const didAll = useRef(false);
  const hadTarget = useRef(false);
  // Depois de "minha localização", a rota que chega (ou a loja mais perto que muda) não afasta o mapa de novo:
  // só uma loja escolhida pela pessoa volta a enquadrar tudo.
  const focusedOn = useRef<{ targetId: string | null } | null>(null);
  // loja escolhida / rota pronta: enquadra você + a loja (ou a rota inteira)
  useEffect(() => {
    if (!target) return;
    hadTarget.current = true;
    if (focusedOn.current && focusedOn.current.targetId === targetId) return;
    focusedOn.current = null;
    const pts: [number, number][] = path && path.length > 1 ? path : me ? [[me.lat, me.lng], [target.lat, target.lng]] : [[target.lat, target.lng]];
    if (pts.length === 1) map.setView(pts[0], 15);
    else map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 16 });
  }, [targetId, path, me?.lat, me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  // nada escolhido: mostra todas as lojas (na primeira vez e sempre que a escolha é desfeita)
  useEffect(() => {
    if (target || all.length === 0) return;
    if (didAll.current && !hadTarget.current) return;
    didAll.current = true;
    hadTarget.current = false;
    const pts: [number, number][] = me ? [...all, [me.lat, me.lng]] : all;
    if (pts.length === 1) map.setView(pts[0], 14);
    else map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 15 });
  }, [all.length, target]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Minha localização": fecha o mapa em cima de você
  useEffect(() => {
    if (focusMe === 0 || !me) return;
    focusedOn.current = { targetId };
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

const EstablishmentsMapView: React.FC<MapViewProps> = ({ receipts, establishments, onPatchEstablishment, onBack }) => {
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
  const stores: MapStore[] = useMemo(() => {
    const agg = new Map<string, { spent: number; visits: number; last: string }>();
    receipts.forEach(r => {
      const k = storeKey(r.cnpj, r.establishmentName);
      const a = agg.get(k) || { spent: 0, visits: 0, last: '' };
      a.spent += r.totalAmount || 0; a.visits += 1; if ((r.date || '') > a.last) a.last = r.date || '';
      agg.set(k, a);
    });
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
  }, [establishments, receipts, namer, me]);

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
  // Sem toque seu, vale sempre a loja mais perto (acompanha a lista enquanto as lojas vão sendo localizadas).
  // Tocou numa loja, vale a sua escolha; tocar de novo na mesma, ou no X do cartão, desfaz a escolha e tira a rota.
  const [manual, setManual] = useState<{ id: string | null } | null>(null);
  const selectedId = manual ? manual.id : nearestId;
  const selected = useMemo(() => stores.find(s => s.id === selectedId) || null, [stores, selectedId]);
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
  }, [selected?.id, meKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const mapBox = useRef<HTMLDivElement>(null);
  const pick = (id: string) => {
    if (id === selectedId) { setManual({ id: null }); return; }
    setManual({ id });
    mapBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

      {(loc.status === 'denied' || loc.status === 'error') && (
        <div className="flex items-center gap-3 mb-3 px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-zinc-400" data-testid="map-loc-msg">
          <LocateFixed className="w-4 h-4 shrink-0 text-zinc-500" />
          <span className="flex-1 min-w-0">{loc.status === 'denied' ? 'Sem permissão de localização: não sei qual loja está mais perto. Libere a localização do app nas configurações do celular.' : loc.msg}</span>
          <button onClick={() => locate(true)} className="shrink-0 px-3 py-2 rounded-xl bg-luxury-gold/10 border border-luxury-gold/25 text-luxury-gold font-bold">Tentar de novo</button>
        </div>
      )}

      <div ref={mapBox} className="bg-zinc-950 border border-white/5 rounded-[1.75rem] md:rounded-[2.5rem] overflow-hidden shadow-2xl relative scroll-mt-20">
        <div className={`h-[340px] md:h-[520px] w-full relative z-0 ${!light && !(maps.useVector && maps.opened) ? 'map-dark' : ''}`} data-testid="map-canvas">
          <MapContainer center={center} zoom={stores.length ? 12 : 4} scrollWheelZoom style={{ width: '100%', height: '100%', background: light ? '#f4f4f5' : '#09090b' }}>
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
            <Framer me={me} target={selected ? { lat: selected.lat, lng: selected.lng } : null} path={route.data?.path || null} all={allPoints} targetId={selected?.id || null} focusMe={focusMe} />
            {route.data && (
              <>
                <Polyline positions={route.data.path} pathOptions={{ color: light ? '#ffffff' : '#000000', weight: 9, opacity: 0.75, lineCap: 'round', lineJoin: 'round' }} />
                <Polyline positions={route.data.path} pathOptions={{ color: '#D4AF37', weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round' }} />
              </>
            )}
            {stores.map(s => (
              <Marker
                key={s.id}
                position={[s.lat, s.lng]}
                icon={pinIcon(s.id === selectedId, s.id === nearestId, zoom < 14, light)}
                zIndexOffset={s.id === selectedId ? 1000 : s.id === nearestId ? 500 : 0}
                eventHandlers={{ click: () => setManual({ id: s.id }) }}
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

          {maps.opened && (
            <button
              onClick={() => maps.setSource(maps.useVector ? 'online' : 'saved')} data-testid="map-source-chip" data-mode={maps.useVector ? 'saved' : 'online'}
              className="absolute bottom-3 left-3 z-[1000] max-w-[70%] flex items-center gap-1.5 pl-3 pr-3.5 h-9 rounded-full bg-black/75 backdrop-blur border border-white/15 text-[11px] font-bold text-luxury-gold shadow-xl active:scale-95"
            >
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{maps.useVector ? (outside ? 'Fora da área salva · ver online' : 'Mapa salvo no celular') : 'Mapa online · usar o salvo'}</span>
            </button>
          )}
        </div>
      </div>

      {/* A loja escolhida: distância, tempo e atalho para o app de navegação */}
      {selected && links && (
        <div className="mt-4 rounded-3xl border border-luxury-gold/30 bg-luxury-gold/[0.07] p-4 md:p-5" data-testid="map-selected">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-luxury-gold/15 border border-luxury-gold/25 flex items-center justify-center shrink-0"><Store className="w-5 h-5 text-luxury-gold" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-white leading-tight truncate" data-testid="map-selected-name">{selected.name}</p>
              {selected.address && <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{selected.address}</p>}
            </div>
            <button onClick={() => setManual({ id: null })} aria-label="Fechar e tirar a rota" data-testid="map-clear"
              className="shrink-0 -mr-1 -mt-1 w-9 h-9 rounded-xl flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/5 active:bg-white/10">
              <X className="w-5 h-5" />
            </button>
          </div>

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
        </div>
      )}

      <OfflineMapCard maps={maps} hasPoints={mapPoints.length > 0} />

      {/* Lojas das suas compras, da mais perto para a mais longe */}
      {sorted.length > 0 && (
        <section className="mt-6" aria-label="Lojas das suas compras">
          <div className="flex items-center justify-between gap-3 mb-3 px-1 min-h-[28px]">
            <h3 className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold" data-testid="map-list-title">
              {me ? 'Lojas das suas compras, da mais perto' : 'Lojas das suas compras'}
            </h3>
            {me && nearestId && selectedId !== nearestId && (
              <button onClick={() => setManual(null)} data-testid="map-back-nearest"
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
              <span key={`${e.cnpj}|${e.originalName}`} className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/5 text-[11px] text-zinc-400 font-bold truncate max-w-[220px]">
                {namer.nameOf(e.originalName, e.cnpj)}
              </span>
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
