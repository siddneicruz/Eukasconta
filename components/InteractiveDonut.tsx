import React, { useRef, useState, useCallback } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Sector, Tooltip } from 'recharts';
import { Eye, EyeOff } from 'lucide-react';

export interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

interface InteractiveDonutProps {
  data: DonutSlice[];
  onSliceClick?: (entry: any) => void;
  innerRadius?: number | string;
  outerRadius?: number | string;
  centerLabel?: string;
  centerValue?: string;
  tooltipContent?: React.ComponentType<any>;
}

// Fatia ativa: "estufa" para fora e ganha um traço fino, em vez do padrão
// do Recharts (que só escurece). A transição é suave porque o Recharts anima
// outerRadius sozinho quando activeIndex muda.
const renderActiveShape = (props: any) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <g>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 10} startAngle={startAngle} endAngle={endAngle} fill={fill} stroke="#000" strokeWidth={2} style={{ filter: `drop-shadow(0 0 12px ${fill}66)` }} />
    </g>
  );
};

const RADIAN = Math.PI / 180;

// Rótulo com linha-guia, no estilo "budge": nome (só a primeira palavra —
// nomes inteiros de departamento não cabem ao redor do anel) fora da fatia,
// ligado por um traço fino. Só ganham rótulo as fatias grandes e afastadas
// umas das outras (ver pickLabeled): rótulo grudado em rótulo não dá pra ler.
const shortName = (name: string) => {
  const w = String(name).trim().split(/\s+/)[0] || '';
  return w.length > 11 ? w.slice(0, 10) + '…' : w;
};

// Escolhe quais fatias recebem nome: maiores primeiro, mínimo de 5% e ao menos
// ~17° de distância angular entre dois rótulos escolhidos.
const pickLabeled = (data: DonutSlice[]): Set<number> => {
  const total = data.reduce((a, d) => a + (d.value > 0 ? d.value : 0), 0);
  const chosen = new Set<number>();
  if (total <= 0) return chosen;
  let acc = 0;
  const mids = data.map(d => { const v = d.value > 0 ? d.value : 0; const mid = ((acc + v / 2) / total) * 360; acc += v; return mid; });
  const order = data.map((_, i) => i).sort((a, b) => data[b].value - data[a].value);
  for (const i of order) {
    if (data[i].value / total < 0.05) break;
    const far = [...chosen].every(j => { const d = Math.abs(mids[i] - mids[j]) % 360; return Math.min(d, 360 - d) >= 17; });
    if (far) chosen.add(i);
  }
  return chosen;
};

const makeOuterLabel = (chosen: Set<number>) => (props: any) => {
  const { cx, cy, midAngle, outerRadius, index, name } = props;
  if (!chosen.has(index)) return null;
  const cos = Math.cos(-midAngle * RADIAN);
  const sin = Math.sin(-midAngle * RADIAN);
  const r0 = Number(outerRadius) + 3;
  const r1 = Number(outerRadius) + 12;
  const x1 = cx + r1 * cos;
  const y1 = cy + r1 * sin;
  const right = cos >= 0;
  return (
    <g className="pointer-events-none">
      <polyline points={`${cx + r0 * cos},${cy + r0 * sin} ${x1},${y1} ${x1 + (right ? 6 : -6)},${y1}`} fill="none" stroke="#71717a" strokeWidth={1} />
      <text x={x1 + (right ? 9 : -9)} y={y1} fill="#d4d4d8" fontSize={11} fontWeight={600} textAnchor={right ? 'start' : 'end'} dominantBaseline="central">
        {shortName(name)}
      </text>
    </g>
  );
};

// Doughnut com dois gestos de verdade:
// - Arrastar (mouse ou dedo) gira o anel inteiro, como girar uma roleta.
// - Tocar numa fatia sem arrastar aciona o drill-down (onSliceClick).
// Um clique só dispara se o ponteiro se moveu pouco desde o toque inicial —
// senão qualquer giro seria também interpretado como clique na fatia.
const InteractiveDonut: React.FC<InteractiveDonutProps> = ({
  data, onSliceClick, innerRadius = '62%', outerRadius = '82%', centerLabel, centerValue, tooltipContent,
}) => {
  const [rotation, setRotation] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);
  const [showLabels, setShowLabels] = useState(false);
  const dragState = useRef<{ startX: number; startY: number; startRotation: number; moved: boolean; centerX: number; centerY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const labelRenderer = React.useMemo(() => makeOuterLabel(pickLabeled(data)), [data]);

  const angleAt = (clientX: number, clientY: number, cx: number, cy: number) =>
    (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
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
  }, [rotation]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragState.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    const angle = angleAt(e.clientX, e.clientY, drag.centerX, drag.centerY);
    setRotation(drag.startRotation + angle);
  }, []);

  const handlePointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  const handleSliceClick = (entry: any) => {
    // Ignora o "clique" gerado no fim de um arraste real.
    if (dragState.current?.moved) return;
    onSliceClick?.(entry);
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <button
        onClick={(e) => { e.stopPropagation(); setShowLabels(s => !s); }}
        title={showLabels ? 'Ocultar nomes' : 'Mostrar nomes'}
        className="absolute top-0 right-0 z-20 p-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-luxury-gold transition-all"
      >
        {showLabels ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
      {(centerLabel || centerValue) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-0">
          {centerLabel && <span className="text-xs tracking-wide text-zinc-400 font-medium mb-1.5">{centerLabel}</span>}
          {centerValue && <span className="text-2xl sm:text-3xl md:text-4xl font-serif text-white tracking-tight">{centerValue}</span>}
          <div className="h-1 w-10 bg-luxury-gold/30 mt-3 rounded-full" />
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%" className="z-10 relative">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={showLabels ? '52%' : innerRadius}
            outerRadius={showLabels ? '68%' : outerRadius}
            paddingAngle={0}
            dataKey="value"
            stroke="none"
            startAngle={90 + rotation}
            endAngle={450 + rotation}
            isAnimationActive={!dragState.current}
            animationDuration={600}
            activeIndex={activeIndex}
            activeShape={renderActiveShape}
            label={showLabels ? labelRenderer : false}
            labelLine={false}
            onMouseEnter={(_, idx) => setActiveIndex(idx)}
            onMouseLeave={() => setActiveIndex(undefined)}
            onClick={(entry) => handleSliceClick(entry)}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} className="cursor-pointer transition-opacity" style={{ outline: 'none' }} />
            ))}
          </Pie>
          {tooltipContent && <Tooltip content={React.createElement(tooltipContent)} />}
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default InteractiveDonut;
