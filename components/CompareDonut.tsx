import React, { useMemo, useRef } from 'react';
import { PieChart as PieChartIcon } from 'lucide-react';
import { useElementWidth } from '../services/chartFormat';

/* Donut da comparação: uma fatia por categoria escolhida, com o total no centro e, afastados do anel, o nome,
   o valor e o percentual de cada uma. Os percentuais somam sempre 100. Os rótulos ficam dos dois lados, ligados à
   fatia por uma linha, e se afastam uns dos outros para não se cobrirem. */

export interface DonutItem { id: string; label: string; color: string; total: number }

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

/** Percentuais inteiros que somam 100 (maior resto). */
export const percentsOf = (totals: number[]): number[] => {
  const sum = totals.reduce((s, t) => s + t, 0);
  if (sum <= 0) return totals.map(() => 0);
  const raw = totals.map(t => (t / sum) * 100);
  const base = raw.map(Math.floor);
  let rest = 100 - base.reduce((s, v) => s + v, 0);
  raw.map((v, i) => ({ i, d: v - base[i] })).sort((a, b) => b.d - a.d).forEach(({ i }) => { if (rest > 0) { base[i] += 1; rest -= 1; } });
  return base;
};

const polar = (cx: number, cy: number, r: number, a: number) => ({ x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) });
const arc = (cx: number, cy: number, R: number, r: number, a0: number, a1: number): string => {
  const big = a1 - a0 > Math.PI ? 1 : 0;
  const p0 = polar(cx, cy, R, a0), p1 = polar(cx, cy, R, a1), q1 = polar(cx, cy, r, a1), q0 = polar(cx, cy, r, a0);
  return `M${p0.x},${p0.y} A${R},${R} 0 ${big} 1 ${p1.x},${p1.y} L${q1.x},${q1.y} A${r},${r} 0 ${big} 0 ${q0.x},${q0.y} Z`;
};

const LABEL_H = 58;

const CompareDonut: React.FC<{ items: DonutItem[]; title?: string; testId?: string }> = ({ items, title = 'Quanto cada uma pesou', testId = 'compare-donut' }) => {
  const box = useRef<HTMLDivElement>(null);
  const W = useElementWidth(box, 320);
  const data = useMemo(() => items.filter(i => i.total > 0).sort((a, b) => b.total - a.total), [items]);
  const pcts = useMemo(() => percentsOf(data.map(d => d.total)), [data]);
  const sum = data.reduce((s, d) => s + d.total, 0);

  const R = Math.min(74, Math.max(44, Math.round(W * 0.155)));
  const r = Math.round(R * 0.7);

  const layout = useMemo(() => {
    let acc = 0;
    const slices = data.map((d, i) => {
      const a0 = (acc / sum) * Math.PI * 2;
      acc += d.total;
      const a1 = (acc / sum) * Math.PI * 2;
      const mid = (a0 + a1) / 2;
      return { ...d, pct: pcts[i], a0, a1, mid, right: Math.sin(mid) >= 0 };
    });
    const perSide = Math.max(slices.filter(s => s.right).length, slices.filter(s => !s.right).length, 1);
    const H = Math.max(2 * R + 56, perSide * (LABEL_H + 6) + 12);
    const cy = H / 2;
    const place = (side: typeof slices) => {
      const rows = side.map(s => ({ s, y: polar(0, cy, R + 14, s.mid).y }));
      rows.sort((a, b) => a.y - b.y);
      rows.forEach((row, i) => { if (i > 0) row.y = Math.max(row.y, rows[i - 1].y + LABEL_H + 6); });
      const over = rows.length ? rows[rows.length - 1].y + LABEL_H / 2 - (H - 4) : 0;
      if (over > 0) rows.forEach(row => { row.y -= over; });
      for (let i = rows.length - 1; i > 0; i--) rows[i - 1].y = Math.min(rows[i - 1].y, rows[i].y - LABEL_H - 6);
      const under = rows.length ? 4 - (rows[0].y - LABEL_H / 2) : 0;
      if (under > 0) rows.forEach(row => { row.y += under; });
      return rows;
    };
    return { slices, H, cy, rightRows: place(slices.filter(s => s.right)), leftRows: place(slices.filter(s => !s.right)) };
  }, [data, pcts, sum, R]);

  if (data.length === 0) return null;
  const cx = W / 2;
  const labelW = Math.max(60, W / 2 - R - 28);

  const lead = (s: typeof layout.slices[number], y: number) => {
    const p0 = polar(cx, layout.cy, R + 2, s.mid), p1 = polar(cx, layout.cy, R + 12, s.mid);
    const ex = s.right ? cx + R + 22 : cx - R - 22;
    return `M${p0.x},${p0.y} L${p1.x},${p1.y} L${ex},${y}`;
  };

  return (
    <div className="mt-3 pt-3 border-t border-white/5" data-testid={testId}>
      <p className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5 mb-1"><PieChartIcon className="w-3.5 h-3.5 text-luxury-gold" /> {title}</p>
      <div ref={box} className="relative w-full" style={{ height: layout.H }}>
        <svg width={W} height={layout.H} className="absolute inset-0" role="img" aria-label={`Divisão do gasto entre ${data.length} categorias`}>
          {layout.slices.map(s => (
            data.length === 1
              ? <circle key={s.id} cx={cx} cy={layout.cy} r={(R + r) / 2} fill="none" stroke={s.color} strokeWidth={R - r} opacity={0.9} />
              : <path key={s.id} d={arc(cx, layout.cy, R, r, s.a0 + 0.012, s.a1 - 0.012)} fill={s.color} opacity={0.92} data-testid="donut-slice" />
          ))}
          {[...layout.rightRows, ...layout.leftRows].map(({ s, y }) => (
            <path key={`l-${s.id}`} d={lead(s, y)} fill="none" stroke={s.color} strokeWidth={1} opacity={0.7} />
          ))}
          {layout.slices.filter(s => s.pct >= 8 && data.length > 1).map(s => {
            const p = polar(cx, layout.cy, (R + r) / 2, s.mid);
            return <text key={`p-${s.id}`} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700} fill="#fff" style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.25)', strokeWidth: 2 }}>{s.pct}%</text>;
          })}
        </svg>
        <div className="absolute flex flex-col items-center justify-center text-center pointer-events-none" style={{ left: cx - r + 2, top: layout.cy - r + 2, width: 2 * r - 4, height: 2 * r - 4 }}>
          <span className="text-[10px] text-zinc-500 leading-none">Total</span>
          <span className="mt-1 text-[10.5px] whitespace-nowrap font-serif font-bold text-white tabular-nums leading-tight" data-testid="donut-total">{brl(sum)}</span>
        </div>
        {[...layout.rightRows.map(r2 => ({ ...r2, side: 'r' as const })), ...layout.leftRows.map(r2 => ({ ...r2, side: 'l' as const }))].map(({ s, y, side }) => (
          <div key={`t-${s.id}`} data-testid="donut-label"
            className={`absolute ${side === 'r' ? 'text-left' : 'text-right'}`}
            style={{ top: y - LABEL_H / 2, height: LABEL_H, width: labelW, ...(side === 'r' ? { left: cx + R + 26 } : { left: cx - R - 26 - labelW }) }}>
            <p className="text-[11px] font-semibold leading-tight text-zinc-200 line-clamp-2" style={{ wordBreak: 'break-word' }}>{s.label}</p>
            <p className="mt-0.5 text-[12px] font-bold leading-tight tabular-nums" style={{ color: s.color }}>{s.pct === 0 ? '<1' : s.pct}%</p>
            <p className="text-[11px] leading-tight tabular-nums text-zinc-400">{brl(s.total)}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CompareDonut;
