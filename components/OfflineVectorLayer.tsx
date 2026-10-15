import React, { useEffect } from 'react';
import type L from 'leaflet';
import { useMap } from 'react-leaflet';
import { leafletLayer } from 'protomaps-leaflet';
import type { TileArchive } from '../services/offlineMaps';

/* Mapa vetorial desenhado direto dos arquivos salvos no aparelho (sem rede). Claro/escuro acompanha o tema do app. */
const OfflineVectorLayer: React.FC<{ archive: TileArchive; dark: boolean; maxDataZoom: number }> = ({ archive, dark, maxDataZoom }) => {
  const map = useMap();
  useEffect(() => {
    const layer = leafletLayer({
      url: archive as any,                       // só o getZxy é usado: aceita as várias células juntas
      flavor: dark ? 'dark' : 'light',
      lang: 'pt',
      maxDataZoom,
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
    const gl = layer as unknown as L.Layer;
    gl.addTo(map);
    return () => { map.removeLayer(gl); };
  }, [archive, dark, maxDataZoom, map]);
  return null;
};

export default OfflineVectorLayer;
