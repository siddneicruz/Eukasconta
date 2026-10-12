import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RotateCw, Smartphone, X, Maximize2, Minus, Plus } from 'lucide-react';

interface PhoneFrameProps {
  onExit: () => void;
}

// Tamanhos em pixels lógicos (CSS), que é o que o navegador do celular usa
// para o layout — não a resolução física da tela.
const DEVICES = [
  { id: 'poco-x7-pro', label: 'Poco X7 Pro', detail: '6,67" · 1220×2712', width: 393, height: 873 },
  { id: 'iphone-15', label: 'iPhone 15', detail: '6,1" · 1179×2556', width: 390, height: 844 },
  { id: 'android-compacto', label: 'Android compacto', detail: 'ex: Galaxy A15', width: 360, height: 800 },
  { id: 'android-grande', label: 'Android grande', detail: 'ex: Pixel 8 Pro', width: 412, height: 915 },
];

const BEZEL = 12;
const PREFS_KEY = 'eukasconta_emulator_prefs';

type Orientation = 'portrait' | 'landscape';

const loadPrefs = (): { deviceId: string; orientation: Orientation; zoom: number | 'fit' } => {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { deviceId: 'poco-x7-pro', orientation: 'portrait', zoom: 'fit', ...JSON.parse(raw) };
  } catch { /* preferências corrompidas: usa o padrão */ }
  return { deviceId: 'poco-x7-pro', orientation: 'portrait', zoom: 'fit' };
};

// Simulador: carrega o próprio app num iframe com o viewport exato do
// aparelho. Girar troca largura e altura do iframe sem recarregar, então o
// app reage como um celular de verdade girando (sem perder a tela atual).
const PhoneFrame: React.FC<PhoneFrameProps> = ({ onExit }) => {
  const initial = loadPrefs();
  const [deviceId, setDeviceId] = useState(initial.deviceId);
  const [orientation, setOrientation] = useState<Orientation>(initial.orientation);
  const [zoom, setZoom] = useState<number | 'fit'>(initial.zoom);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 800, h: 800 });

  const device = DEVICES.find(d => d.id === deviceId) || DEVICES[0];
  const vw = orientation === 'portrait' ? device.width : device.height;
  const vh = orientation === 'portrait' ? device.height : device.width;
  const frameW = vw + BEZEL * 2;
  const frameH = vh + BEZEL * 2;

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ deviceId, orientation, zoom }));
  }, [deviceId, orientation, zoom]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // "Ajustar": aproveita toda a área disponível (pode passar de 100%).
  const fitScale = Math.max(0.2, Math.min((stage.w - 32) / frameW, (stage.h - 32) / frameH));
  const scale = zoom === 'fit' ? fitScale : zoom;

  const stepZoom = (delta: number) => {
    const current = zoom === 'fit' ? fitScale : zoom;
    setZoom(Math.round(Math.min(3, Math.max(0.3, current + delta)) * 10) / 10);
  };

  const src = `${window.location.pathname}?frame=1`;

  return (
    <div className="fixed inset-0 z-[500] bg-zinc-950 flex flex-col lg:flex-row overflow-hidden">
      {/* Palco: o aparelho ocupa todo o espaço disponível */}
      <div ref={stageRef} className="flex-1 min-w-0 min-h-0 flex items-center justify-center overflow-auto">
        <div className="shrink-0" style={{ width: frameW * scale, height: frameH * scale }}>
          <div
            className="rounded-[2.75rem] bg-black shadow-2xl overflow-hidden transition-[width,height] duration-300"
            style={{
              width: frameW,
              height: frameH,
              border: `${BEZEL}px solid #27272a`,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            <iframe
              key={deviceId}
              src={src}
              title="Simulador de celular"
              style={{ width: vw, height: vh, border: 0, display: 'block' }}
            />
          </div>
        </div>
      </div>

      {/* Painel lateral de controles */}
      <aside className="shrink-0 w-full lg:w-72 border-t lg:border-t-0 lg:border-l border-white/10 bg-black/60 p-5 flex flex-col gap-6 overflow-y-auto max-h-[45vh] lg:max-h-none">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Smartphone className="w-4 h-4 text-luxury-gold" />
            <span className="text-[11px] font-bold uppercase tracking-widest">Simulador</span>
          </div>
          <button onClick={onExit} className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-all" title="Sair do simulador">
            <X className="w-4 h-4" />
          </button>
        </div>

        <section className="flex flex-col gap-2">
          <h4 className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-600">Aparelho</h4>
          {DEVICES.map(d => (
            <button
              key={d.id}
              onClick={() => setDeviceId(d.id)}
              className={`text-left px-4 py-3 rounded-xl border transition-all ${deviceId === d.id ? 'bg-luxury-gold/10 border-luxury-gold/50' : 'bg-white/[0.02] border-white/5 hover:border-white/20'}`}
            >
              <div className={`text-[11px] font-bold uppercase tracking-wider ${deviceId === d.id ? 'text-luxury-gold' : 'text-zinc-300'}`}>{d.label}</div>
              <div className="text-[10px] text-zinc-600 mt-0.5">{d.detail} · {d.width}×{d.height}</div>
            </button>
          ))}
        </section>

        <section className="flex flex-col gap-2">
          <h4 className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-600">Orientação</h4>
          <button
            onClick={() => setOrientation(o => (o === 'portrait' ? 'landscape' : 'portrait'))}
            className="flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/10 text-zinc-200 text-[10px] font-bold uppercase tracking-widest hover:border-luxury-gold/50 transition-all"
          >
            <RotateCw className="w-4 h-4 text-luxury-gold" />
            Girar · {orientation === 'portrait' ? 'Retrato' : 'Paisagem'}
          </button>
          <div className="text-[10px] text-zinc-600 text-center">Viewport atual: {vw}×{vh}</div>
        </section>

        <section className="flex flex-col gap-2">
          <h4 className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-600">Zoom</h4>
          <div className="flex items-center gap-2">
            <button onClick={() => stepZoom(-0.1)} className="p-3 rounded-xl bg-white/5 border border-white/10 text-zinc-300 hover:text-white" title="Diminuir"><Minus className="w-4 h-4" /></button>
            <div className="flex-1 text-center text-sm font-bold text-white">{Math.round(scale * 100)}%</div>
            <button onClick={() => stepZoom(0.1)} className="p-3 rounded-xl bg-white/5 border border-white/10 text-zinc-300 hover:text-white" title="Aumentar"><Plus className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setZoom('fit')}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all ${zoom === 'fit' ? 'bg-luxury-gold text-black border-luxury-gold' : 'bg-white/5 border-white/10 text-zinc-400'}`}
            >
              <Maximize2 className="w-3.5 h-3.5" /> Ajustar
            </button>
            <button
              onClick={() => setZoom(1)}
              className={`py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all ${zoom === 1 ? 'bg-luxury-gold text-black border-luxury-gold' : 'bg-white/5 border-white/10 text-zinc-400'}`}
            >
              100%
            </button>
          </div>
        </section>

        <p className="mt-auto text-[10px] leading-relaxed text-zinc-600">
          Layout real de celular: o app roda com o viewport do aparelho. Clique do mouse equivale ao toque; a câmera abre o seletor de arquivos no PC. Os dados são os mesmos do app normal.
        </p>

        <button
          onClick={onExit}
          className="py-3 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-[10px] font-bold uppercase tracking-widest hover:bg-red-500/20 hover:text-red-300 transition-all"
        >
          Sair do simulador
        </button>
      </aside>
    </div>
  );
};

export default PhoneFrame;
