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
// ligado por um traço fino. Fatias muito pequenas não recebem rótulo, pra
// não virar uma poluição visual de texto grudado.
const renderOuterLabel = (props: any) => {
  const { cx, cy, midAngle, outerRadius, percent, name } = props;
  if (percent < 0.035) return null;
  const radius = Number(outerRadius) + 16;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  const firstWord = String(name).trim().split(' ')[0];
  return (
    <text x={x} y={y} fill="#a1a1aa" fontSize={10} fontWeight={600} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" className="pointer-events-none tracking-tight">
      {firstWord}
    </text>
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
        className="absolute top-0 right-0 z-20 p-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-500 hover:text-luxury-gold transition-all"
      >
        {showLabels ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
      {(centerLabel || centerValue) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-0">
          {centerLabel && <span className="text-[9px] uppercase tracking-[0.4em] text-zinc-500 font-bold mb-2">{centerLabel}</span>}
          {centerValue && <span className="text-3xl md:text-4xl font-serif text-white tracking-tighter">{centerValue}</span>}
          <div className="h-1 w-12 bg-luxury-gold/30 mt-4 rounded-full" />
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%" className="z-10 relative">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={0}
            dataKey="value"
            stroke="none"
            startAngle={90 + rotation}
            endAngle={450 + rotation}
            isAnimationActive={!dragState.current}
            animationDuration={600}
            activeIndex={activeIndex}
            activeShape={renderActiveShape}
            label={showLabels ? renderOuterLabel : false}
            labelLine={showLabels ? { stroke: '#52525b', strokeWidth: 1 } : false}
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
