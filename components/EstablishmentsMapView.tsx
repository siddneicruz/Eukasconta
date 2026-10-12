import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { ChevronLeft, MapPin, Loader2, RefreshCw } from 'lucide-react';
import { Receipt, Establishment } from '../types';
import { geocodeMissingEstablishments } from '../services/geocodingService';

interface EstablishmentsMapViewProps {
  receipts: Receipt[];
  establishments: Establishment[];
  onUpdateEstablishments: (establishments: Establishment[]) => void;
  onBack: () => void;
  onSelectEstablishment?: (name: string) => void;
}

// Pino em forma de gota, cor e tamanho conforme o valor gasto naquele
// estabelecimento — em vez do ícone padrão azul do Leaflet, que destoaria
// completamente da identidade visual do app.
const buildPinIcon = (size: number, highlight: boolean) => {
  const px = Math.round(size);
  const color = highlight ? '#D4AF37' : '#997B28';
  return L.divIcon({
    className: '',
    html: `
      <div style="width:${px}px;height:${px}px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.6));">
        <svg viewBox="0 0 24 24" width="${px}" height="${px}">
          <path d="M12 0C6.5 0 2 4.5 2 10c0 7.5 10 14 10 14s10-6.5 10-14c0-5.5-4.5-10-10-10z" fill="${color}" stroke="#000" stroke-width="0.5"/>
          <circle cx="12" cy="10" r="4" fill="#000" fill-opacity="0.55"/>
        </svg>
      </div>`,
    iconSize: [px, px],
    iconAnchor: [px / 2, px],
    popupAnchor: [0, -px],
  });
};

// Recentraliza o mapa quando o conjunto de pontos muda (ex: primeira
// geocodificação concluída), sem exigir que o usuário arraste manualmente.
const FitBounds: React.FC<{ points: [number, number][] }> = ({ points }) => {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
    }
  }, [points.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
};

const EstablishmentsMapView: React.FC<EstablishmentsMapViewProps> = ({
  receipts, establishments, onUpdateEstablishments, onBack, onSelectEstablishment,
}) => {
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const spendByEstablishment = useMemo(() => {
    const agg: Record<string, number> = {};
    receipts.forEach(r => { agg[r.establishmentName] = (agg[r.establishmentName] || 0) + r.totalAmount; });
    return agg;
  }, [receipts]);

  const pending = useMemo(
    () => establishments.filter(e => !e.geocodeStatus && (e.address || e.city)),
    [establishments]
  );

  const runGeocoding = async () => {
    if (pending.length === 0 || isGeocoding) return;
    setIsGeocoding(true);
    setProgress({ done: 0, total: pending.length });
    let done = 0;
    let current = establishments;
    await geocodeMissingEstablishments(pending, (cnpj, patch) => {
      current = current.map(e => (e.cnpj === cnpj ? { ...e, ...patch } : e));
      done += 1;
      setProgress({ done, total: pending.length });
      onUpdateEstablishments(current);
    });
    setIsGeocoding(false);
  };

  useEffect(() => {
    runGeocoding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const located = establishments.filter(e => e.geocodeStatus === 'found' && e.latitude && e.longitude);
  const notFound = establishments.filter(e => e.geocodeStatus === 'not_found');
  const maxSpend = Math.max(1, ...located.map(e => spendByEstablishment[e.originalName] || 0));
  const points: [number, number][] = located.map(e => [e.latitude!, e.longitude!]);
  const center: [number, number] = points[0] || [-14.235, -51.925]; // centro do Brasil, se nada geocodificado ainda

  return (
    <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 pb-20">
      <div className="flex items-center gap-4 mb-6 md:mb-10">
        <button onClick={onBack} className="w-11 h-11 md:w-14 md:h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-luxury-gold transition-all shadow-xl shrink-0">
          <ChevronLeft className="w-6 h-6 md:w-7 md:h-7" />
        </button>
        <div className="min-w-0">
          <span className="text-[10px] text-zinc-500 uppercase tracking-[0.4em] font-bold block mb-1">Geolocalização</span>
          <h2 className="text-2xl md:text-4xl font-serif text-white tracking-tighter uppercase truncate">Mapa de Compras</h2>
        </div>
      </div>

      {isGeocoding && (
        <div className="flex items-center gap-3 mb-4 px-5 py-3 rounded-2xl bg-luxury-gold/10 border border-luxury-gold/20 text-luxury-gold text-[11px] font-bold">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          Localizando estabelecimentos ({progress.done}/{progress.total})… um por vez, para respeitar o serviço gratuito do OpenStreetMap.
        </div>
      )}

      <div className="bg-zinc-950 border border-white/5 rounded-[2rem] md:rounded-[2.5rem] overflow-hidden shadow-2xl relative">
        <div className="h-[380px] md:h-[560px] w-full relative z-0">
          <MapContainer center={center} zoom={points.length ? 12 : 4} scrollWheelZoom style={{ width: '100%', height: '100%', background: '#09090b' }}>
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
              maxZoom={19}
            />
            <FitBounds points={points} />
            {located.map(est => {
              const spend = spendByEstablishment[est.originalName] || 0;
              const size = 26 + (spend / maxSpend) * 26; // 26px a 52px conforme o gasto
              return (
                <Marker
                  key={est.cnpj}
                  position={[est.latitude!, est.longitude!]}
                  icon={buildPinIcon(size, spend === maxSpend)}
                  eventHandlers={{ click: () => onSelectEstablishment?.(est.originalName) }}
                >
                  <Popup>
                    <div style={{ fontFamily: 'Inter, sans-serif', minWidth: 160 }}>
                      <strong style={{ display: 'block', marginBottom: 4 }}>{est.aliasName || est.originalName}</strong>
                      <span style={{ color: '#71717a', fontSize: 11 }}>{est.address}{est.city ? `, ${est.city}` : ''}{est.state ? ` - ${est.state}` : ''}</span>
                      <div style={{ marginTop: 6, fontWeight: 700 }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(spend)}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>
      </div>

      <div className="mt-6 flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
        <div className="flex items-center gap-2 text-[10px] text-zinc-600 uppercase tracking-widest font-bold">
          <MapPin className="w-3.5 h-3.5 text-luxury-gold" /> {located.length} localizado(s)
          {notFound.length > 0 && <span className="text-zinc-700">· {notFound.length} sem endereço reconhecido</span>}
        </div>
        {(pending.length > 0 || notFound.length > 0) && (
          <button
            onClick={() => {
              // Permite tentar de novo os "não encontrados" (ex: depois de
              // corrigir o endereço do estabelecimento em Config).
              onUpdateEstablishments(establishments.map(e => (e.geocodeStatus === 'not_found' ? { ...e, geocodeStatus: undefined } : e)));
              setTimeout(runGeocoding, 0);
            }}
            disabled={isGeocoding}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-[10px] font-bold uppercase tracking-widest hover:border-luxury-gold/40 transition-all disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isGeocoding ? 'animate-spin' : ''}`} /> Tentar localizar novamente
          </button>
        )}
      </div>

      {notFound.length > 0 && (
        <div className="mt-6 p-5 rounded-2xl bg-white/[0.02] border border-white/5">
          <h4 className="text-[9px] uppercase tracking-[0.3em] text-zinc-600 font-bold mb-3">Sem localização encontrada</h4>
          <div className="flex flex-wrap gap-2">
            {notFound.map(e => (
              <span key={e.cnpj} className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/5 text-[10px] text-zinc-400 font-bold uppercase truncate max-w-[220px]">
                {e.aliasName || e.originalName}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default EstablishmentsMapView;
