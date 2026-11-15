import React from 'react';
import { TrendingUp, ScanLine, PencilLine, ShoppingCart, Map as MapIcon, Target, Bell } from 'lucide-react';

// Redesign v2: atalhos redondos do Início.
// Só interface — cada botão chama uma função que já existia no app.

export const HomeShortcuts: React.FC<{
  onScan: () => void; onManual: () => void; onList: () => void; onMap: () => void; onGoals: () => void; onQuotes: () => void; onAlerts: () => void; alertCount: number;
}> = ({ onScan, onManual, onList, onMap, onGoals, onQuotes, onAlerts, alertCount }) => {
  const items = [
    { label: 'Escanear', icon: ScanLine, on: onScan, gold: true, t: 'shortcut-scan' },
    { label: 'Lançar', icon: PencilLine, on: onManual, t: 'shortcut-manual' },
    { label: 'Lista', icon: ShoppingCart, on: onList, t: 'shortcut-list' },
    { label: 'Mapa', icon: MapIcon, on: onMap, t: 'shortcut-map' },
    { label: 'Metas', icon: Target, on: onGoals, t: 'shortcut-goals' },
    { label: 'Cotação', icon: TrendingUp, on: onQuotes, t: 'shortcut-quotes' },
    { label: 'Avisos', icon: Bell, on: onAlerts, badge: alertCount, t: 'shortcut-alerts' },
  ];
  return (
    <div className="md:hidden grid grid-cols-7 gap-0.5 mb-5" data-testid="home-shortcuts">
      {items.map(it => (
        <button key={it.label} onClick={it.on} data-testid={it.t} className="flex flex-col items-center gap-1.5 min-h-[64px] active:scale-95 transition-transform" aria-label={it.label}>
          <span className={`relative w-11 h-11 rounded-full flex items-center justify-center border ${it.gold ? 'border-transparent text-[#1A1405]' : 'bg-zinc-900 border-white/10 text-luxury-gold'}`}
            style={it.gold ? { background: 'linear-gradient(135deg,#F5DB88,#DDB94B 55%,#B38A2B)' } : undefined}>
            <it.icon className="w-5 h-5" />
            {!!it.badge && it.badge > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#F28468] text-[#1A1405] text-xs font-bold flex items-center justify-center leading-none">{it.badge > 9 ? '9+' : it.badge}</span>}
          </span>
          <span className="text-[10px] font-medium text-zinc-400 max-w-full truncate">{it.label}</span>
        </button>
      ))}
    </div>
  );
};
