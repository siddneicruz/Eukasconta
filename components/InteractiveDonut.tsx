import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Sector } from 'recharts';
import { titleCase, shortLabels } from '../services/textFormat';

export interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

interface InteractiveDonutProps {
  data: DonutSlice[];
  onSliceClick?: (entry: any) => void;
  centerLabel?: string;
  centerValue?: string;
}

// Fatia ativa: "estufa" para fora e ganha um traço fino, em vez do padrão
// do Recharts (que só escurece). A transição é suave porque o Recharts anima
// outerRadius sozinho quando activeIndex muda.
const renderActiveShape = (props: any) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <g>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 8} startAngle={startAngle} endAngle={endAngle} fill={fill} stroke="#000" strokeWidth={2} style={{ filter: `drop-shadow(0 0 12px ${fill}66)` }} />
    </g>
  );
};

const RADIAN = Math.PI / 180;

// Rótulo com linha-guia, no estilo "budge": nome (só a primeira palavra —
// nomes inteiros de departamento não cabem ao redor do anel) fora da fatia,
// ligado por um traço fino. Só ganham rótulo as fatias grandes e afastadas
// umas das outras (ver pickLabeled): rótulo grudado em rótulo não dá pra ler.
const LABEL_FONT_PX = 11;
// Primeira palavra; só quando dois nomes dariam o mesmo rótulo ("Carne Bovina"/"Carne Suína")
// entra a segunda, aí cabe um pouco mais.
const clipLabel = (l: string) => {
  const max = l.includes(' ') ? 12 : 9;
  return l.length > max ? l.slice(0, max - 1).trim() + '…' : l;
};
const buildLabels = (data: DonutSlice[]): string[] => shortLabels(data.map(d => String(d.name))).map(clipLabel);

// Distâncias do rótulo a partir da borda do anel (px): traço radial, cotovelo horizontal e folga até o texto.
const RADIAL = 10, ELBOW = 5, GAP = 3;
const LABEL_REACH = RADIAL + ELBOW + GAP;

// Largura real do texto do rótulo (canvas), para o anel saber quanto espaço lateral reservar.
let measureCtx: CanvasRenderingContext2D | null = null;
const textWidth = (t: string): number => {
  try {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    if (measureCtx) {
      measureCtx.font = `600 ${LABEL_FONT_PX}px Inter, system-ui, sans-serif`;
      return measureCtx.measureText(t).width;
    }
  } catch { /* sem canvas: usa a estimativa */ }
  return t.length * 7.2;
};

// Fatias que podem ganhar nome: a partir de 1,5% do total, maiores primeiro (no máximo 18).
const labelCandidates = (data: DonutSlice[], total: number): number[] =>
  data.map((_, i) => i)
    .filter(i => total > 0 && data[i].value / total >= 0.015)
    .sort((a, b) => data[b].value - data[a].value)
    .slice(0, 18);

// Escolhe os nomes que realmente cabem: percorre as fatias da maior para a menor e só aceita o nome
// se a caixa dele (na posição atual do anel) estiver dentro da área e não encostar em outro nome já
// aceito. Refeito a cada giro, então o espaço livre é sempre aproveitado.
const LABEL_H = 13;
const planLabels = (data: DonutSlice[], labels: string[], candidates: number[], total: number, rotation: number, w: number, h: number, outer: number): Set<number> => {
  const chosen = new Set<number>();
  if (total <= 0 || w <= 0 || h <= 0) return chosen;
  const cx = w / 2, cy = h / 2, r1 = outer + RADIAL;
  let acc = 0;
  const mids = data.map(d => { const v = d.value > 0 ? d.value : 0; const m = 90 + rotation + ((acc + v / 2) / total) * 360; acc += v; return m; });
  const placed: { l: number; r: number; t: number; b: number }[] = [];
  for (const i of candidates) {
    const cos = Math.cos(-mids[i] * RADIAN), sin = Math.sin(-mids[i] * RADIAN);
    const x1 = cx + r1 * cos, y1 = cy + r1 * sin;
    const right = cos >= 0;
    const tw = textWidth(labels[i]);
    const l = right ? x1 + ELBOW + GAP : x1 - ELBOW - GAP - tw;
    const r = l + tw, t = y1 - LABEL_H / 2, b = y1 + LABEL_H / 2;
    if (l < 1 || r > w - 1 || t < 0 || b > h) continue;
    if (placed.some(q => l < q.r + 4 && r > q.l - 4 && t < q.b + 1 && b > q.t - 1)) continue;
    placed.push({ l, r, t, b });
    chosen.add(i);
  }
  return chosen;
};

const makeOuterLabel = (chosen: Set<number>, labels: string[]) => (props: any) => {
  const { cx, cy, midAngle, outerRadius, index } = props;
  if (!chosen.has(index)) return null;
  const cos = Math.cos(-midAngle * RADIAN);
  const sin = Math.sin(-midAngle * RADIAN);
  const r0 = Number(outerRadius) + 2;
  const r1 = Number(outerRadius) + RADIAL;
  const x1 = cx + r1 * cos;
  const y1 = cy + r1 * sin;
  const right = cos >= 0;
  return (
    <g className="pointer-events-none">
      <polyline points={`${cx + r0 * cos},${cy + r0 * sin} ${x1},${y1} ${x1 + (right ? ELBOW : -ELBOW)},${y1}`} fill="none" stroke="#71717a" strokeWidth={1} />
      <text x={x1 + (right ? ELBOW + GAP : -(ELBOW + GAP))} y={y1} fill="#d4d4d8" fontSize={LABEL_FONT_PX} fontWeight={600} textAnchor={right ? 'start' : 'end'} dominantBaseline="central">
        {labels[index]}
      </text>
    </g>
  );
};

// Doughnut com dois gestos de verdade:
// - Arrastar (mouse ou dedo) gira o anel inteiro, como girar uma roleta.
// - Tocar numa fatia sem arrastar aciona o drill-down (onSliceClick).
// Um clique só dispara se o ponteiro se moveu pouco desde o toque inicial —
// senão qualquer giro seria também interpretado como clique na fatia.
//
// Os nomes ficam sempre à mostra. Para eles caberem inteiros, o tamanho do anel
// é calculado pela largura real disponível menos a largura do maior nome
// escolhido (no celular o anel fica menor; no computador, com espaço, cresce).
const InteractiveDonut: React.FC<InteractiveDonutProps> = ({
  data, onSliceClick, centerLabel, centerValue,
}) => {
  const [rotation, setRotation] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const dragState = useRef<{ startX: number; startY: number; startRotation: number; moved: boolean; centerX: number; centerY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Último tipo de ponteiro usado. No toque o navegador dispara "mouseenter" DEPOIS que o dedo sai,
  // o que deixaria a fatia/etiqueta presa na tela; por isso o toque é tratado à parte.
  const pointerType = useRef<string>('mouse');
  const total = useMemo(() => data.reduce((a, d) => a + (d.value > 0 ? d.value : 0), 0), [data]);

  // Fatia sob o dedo: lê o elemento desenhado naquele ponto (cada fatia é um grupo .recharts-pie-sector, na ordem dos dados).
  const sliceAt = (x: number, y: number): number | undefined => {
    const g = document.elementFromPoint(x, y)?.closest('.recharts-pie-sector');
    if (!g || !g.parentElement) return undefined;
    const i = Array.prototype.indexOf.call(g.parentElement.children, g);
    return i >= 0 && i < data.length ? i : undefined;
  };

  const candidates = useMemo(() => labelCandidates(data, total), [data, total]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setBox(prev => (prev.w === Math.round(r.width) && prev.h === Math.round(r.height)) ? prev : { w: Math.round(r.width), h: Math.round(r.height) });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const labels = useMemo(() => buildLabels(data), [data]);

  // Raio do anel em px: cabe na altura (com folga para rótulos em cima/embaixo) e na largura
  // (descontando o alcance do rótulo e o maior nome); furo proporcional.
  const geom = useMemo(() => {
    if (box.w <= 0 || box.h <= 0) return null;
    // espaço lateral pensado nos 8 maiores nomes (os que mais importam); nomes mais largos que isso só entram se couberem
    const widest = candidates.slice(0, 8).reduce((m, i) => Math.max(m, textWidth(labels[i])), 0);
    const sidePad = LABEL_REACH + widest + 6;
    const outer = Math.max(40, Math.min(box.w / 2 - sidePad, box.h / 2 - 22));
    return { outer, inner: outer * 0.7 };
  }, [box, candidates, labels]);

  const chosen = useMemo(
    () => geom ? planLabels(data, labels, candidates, total, rotation, box.w, box.h, geom.outer) : new Set<number>(),
    [data, labels, candidates, total, rotation, box, geom]);
  const labelRenderer = useMemo(() => makeOuterLabel(chosen, labels), [chosen, labels]);

  // Texto do centro: cabe dentro do furo (nunca vaza para o anel).
  const holeW = geom ? geom.inner * 2 * 0.84 : 0;
  const valueFont = geom && centerValue
    ? Math.max(13, Math.min(geom.inner >= 110 ? 28 : 22, holeW / (Math.max(centerValue.length, 4) * 0.6)))
    : 18;

  const angleAt = (clientX: number, clientY: number, cx: number, cy: number) =>
    (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerType.current = e.pointerType || 'mouse';
    if (e.pointerType === 'touch') setActiveIndex(sliceAt(e.clientX, e.clientY));
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startRotation: rotation - angleAt(e.clientX, e.clientY, cx, cy),
      moved: false,
      centerX: cx,
      centerY: cy,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, [rotation, data]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragState.current;
    if (!drag) return;
    if (e.pointerType === 'touch') setActiveIndex(sliceAt(e.clientX, e.clientY));
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    const angle = angleAt(e.clientX, e.clientY, drag.centerX, drag.centerY);
    setRotation(drag.startRotation + angle);
  }, [data]);

  const handlePointerUp = useCallback((e?: React.PointerEvent) => {
    dragState.current = null;
    // dedo levantado: a etiqueta some (no mouse ela segue o "passar por cima")
    if (e && e.pointerType === 'touch') setActiveIndex(undefined);
  }, []);

  const handleSliceClick = (entry: any) => {
    // Ignora o "clique" gerado no fim de um arraste real.
    if (dragState.current?.moved) return;
    onSliceClick?.(entry);
  };

  const active = activeIndex !== undefined ? data[activeIndex] : undefined;
  const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <div className="relative w-full h-full">
      {/* Área do gráfico: deixa uma faixa livre embaixo para a etiqueta (ela nunca cobre o anel) */}
      <div
        ref={containerRef}
        className="absolute inset-x-0 top-0 bottom-12 touch-none select-none outline-none [&_*]:!outline-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {(centerLabel || centerValue) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-0">
            {centerLabel && <span className="text-[11px] tracking-wide text-zinc-400 font-medium mb-1 whitespace-nowrap">{centerLabel}</span>}
            {centerValue && <span className="font-serif text-white tracking-tight leading-none whitespace-nowrap" style={{ fontSize: valueFont }}>{centerValue}</span>}
            <div className="h-1 w-8 bg-luxury-gold/30 mt-2.5 rounded-full" />
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%" className="z-10 relative">
          <PieChart accessibilityLayer={false}>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={geom ? geom.inner : '42%'}
              outerRadius={geom ? geom.outer : '60%'}
              paddingAngle={0}
              dataKey="value"
              stroke="none"
              startAngle={90 + rotation}
              endAngle={450 + rotation}
              isAnimationActive={!dragState.current}
              animationDuration={600}
              activeIndex={activeIndex}
              activeShape={renderActiveShape}
              label={labelRenderer}
              labelLine={false}
              onMouseEnter={(_, idx) => { if (pointerType.current !== 'touch') setActiveIndex(idx); }}
              onMouseLeave={() => { if (pointerType.current !== 'touch') setActiveIndex(undefined); }}
              onClick={(entry) => handleSliceClick(entry)}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} className="cursor-pointer transition-opacity" style={{ outline: 'none' }} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Faixa fixa embaixo: nome, valor e % da fatia, só enquanto o dedo/mouse está sobre ela */}
      <div className="absolute inset-x-0 bottom-0 h-11 flex items-center justify-center pointer-events-none px-2" aria-live="polite" data-testid="donut-info">
        {active && (
          <div className="flex items-center gap-2.5 max-w-full bg-zinc-900/95 border border-white/10 rounded-full pl-3 pr-4 py-2 shadow-lg animate-in fade-in duration-150">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: active.color }} />
            <span className="text-[13px] font-semibold text-luxury-gold truncate min-w-0">{titleCase(active.name)}</span>
            <span className="text-[13px] font-semibold text-white tabular-nums shrink-0">{fmtBRL.format(active.value)}</span>
            {total > 0 && <span className="text-xs text-zinc-400 tabular-nums shrink-0">{fmtPct.format((active.value / total) * 100)}%</span>}
          </div>
        )}
      </div>
    </div>
  );
};

export default InteractiveDonut;
