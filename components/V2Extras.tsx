import React from 'react';
import { ScanLine, PencilLine, ShoppingCart, Map as MapIcon, Target, Bell, Terminal, KeyRound, Info } from 'lucide-react';
import { PDLogo } from './Brand';

// Redesign v2: atalhos redondos do Início e bloco "Aparência e sistema" dos Ajustes.
// Só interface — cada botão chama uma função que já existia no app.

export const HomeShortcuts: React.FC<{
  onScan: () => void; onManual: () => void; onList: () => void; onMap: () => void; onGoals: () => void; onAlerts: () => void; alertCount: number;
}> = ({ onScan, onManual, onList, onMap, onGoals, onAlerts, alertCount }) => {
  const items = [
    { label: 'Escanear', icon: ScanLine, on: onScan, gold: true, t: 'shortcut-scan' },
    { label: 'Lançar', icon: PencilLine, on: onManual, t: 'shortcut-manual' },
    { label: 'Lista', icon: ShoppingCart, on: onList, t: 'shortcut-list' },
    { label: 'Mapa', icon: MapIcon, on: onMap, t: 'shortcut-map' },
    { label: 'Metas', icon: Target, on: onGoals, t: 'shortcut-goals' },
    { label: 'Avisos', icon: Bell, on: onAlerts, badge: alertCount, t: 'shortcut-alerts' },
  ];
  return (
    <div className="md:hidden grid grid-cols-6 gap-1 mb-5" data-testid="home-shortcuts">
      {items.map(it => (
        <button key={it.label} onClick={it.on} data-testid={it.t} className="flex flex-col items-center gap-1.5 min-h-[64px] active:scale-95 transition-transform" aria-label={it.label}>
          <span className={`relative w-12 h-12 rounded-full flex items-center justify-center border ${it.gold ? 'border-transparent text-[#1A1405]' : 'bg-zinc-900 border-white/10 text-luxury-gold'}`}
            style={it.gold ? { background: 'linear-gradient(135deg,#F5DB88,#DDB94B 55%,#B38A2B)' } : undefined}>
            <it.icon className="w-5 h-5" />
            {!!it.badge && it.badge > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#F28468] text-[#1A1405] text-xs font-bold flex items-center justify-center leading-none">{it.badge > 9 ? '9+' : it.badge}</span>}
          </span>
          <span className="text-xs font-medium text-zinc-400">{it.label}</span>
        </button>
      ))}
    </div>
  );
};

type Row = { label: string; icon: React.ElementType; on: () => void; t: string };

export const SettingsQuick: React.FC<{
  theme?: 'dark' | 'light'; setTheme?: (t: 'dark' | 'light') => void;
  onDiagnostics: () => void; onMap: () => void; onList: () => void; onAlerts: () => void;
  isAdmin?: boolean; onMaster?: () => void;
}> = ({ onDiagnostics, onMap, onList, onAlerts, isAdmin, onMaster }) => {
  const rows: Row[] = [
    { label: 'Mapa dos estabelecimentos', icon: MapIcon, on: onMap, t: 'quick-map' },
    { label: 'Lista de compras', icon: ShoppingCart, on: onList, t: 'quick-list' },
    { label: 'Avisos e alertas', icon: Bell, on: onAlerts, t: 'quick-alerts' },
    ...(isAdmin && onMaster ? [{ label: 'Tabela mãe (importar planilha)', icon: KeyRound, on: onMaster, t: 'drawer-master' }] : []),
    { label: 'Diagnóstico', icon: Terminal, on: onDiagnostics, t: 'quick-diag' },
  ];
  return (
    <div className="mb-6 space-y-4" data-testid="settings-quick">
      <div className="rounded-2xl border border-white/10 bg-zinc-900/50 overflow-hidden">
        {rows.map((r, i) => (
          <button key={r.label} onClick={r.on} data-testid={r.t} className={`w-full min-h-[52px] flex items-center gap-3 px-4 text-left active:bg-white/5 ${i ? 'border-t border-white/5' : ''}`}>
            <r.icon className="w-5 h-5 text-luxury-gold shrink-0" />
            <span className="text-sm font-medium text-zinc-200">{r.label}</span>
          </button>
        ))}
      </div>
      <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4 flex items-center gap-4">
        <Info className="w-5 h-5 text-zinc-500 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-200">Sobre o Eu Kasconta</div>
          <div className="text-xs text-zinc-400 mt-0.5">Criado por</div>
        </div>
        <PDLogo className="w-28 ml-auto text-zinc-300 shrink-0" />
      </div>
    </div>
  );
};
