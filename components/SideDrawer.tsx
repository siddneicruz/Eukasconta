import React from 'react';
import { X, LayoutDashboard, ScanLine, History, BarChart3, Settings, Terminal, Sparkles, Bell } from 'lucide-react';
import { ViewState } from '../types';
import { getActiveProvider } from '../services/keyStorageService';

interface SideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  view: ViewState | 'manual_entry';
  setView: (v: ViewState) => void;
  onOpenDiagnostics: () => void;
}

interface DrawerItem {
  id: ViewState;
  label: string;
  icon: React.ElementType;
}

const SECTIONS: { title: string; items: DrawerItem[] }[] = [
  { title: 'Navegar', items: [
    { id: 'dashboard', label: 'Início', icon: LayoutDashboard },
    { id: 'scanner', label: 'Escanear Cupom', icon: ScanLine },
    { id: 'history', label: 'Histórico', icon: History },
  ]},
  { title: 'Analisar', items: [
    { id: 'reports', label: 'Relatórios', icon: BarChart3 },
    { id: 'alerts', label: 'Avisos e alertas', icon: Bell },
  ]},
  { title: 'Configurar', items: [
    { id: 'settings', label: 'Estúdio', icon: Settings },
  ]},
];

const PROVIDER_LABEL: Record<string, string> = { gemini: 'Google Gemini', anthropic: 'Anthropic Claude', openai: 'OpenAI', openrouter: 'OpenRouter' };

// Menu lateral estilo apps de finanças de referência: cabeçalho com a marca,
// seções agrupadas com título pequeno, item ativo com fundo destacado.
// Não substitui a navegação existente (topo/abas do rodapé) — é um atalho
// rápido que abre por cima de qualquer tela, via o ícone de menu no cabeçalho.
const SideDrawer: React.FC<SideDrawerProps> = ({ isOpen, onClose, view, setView, onOpenDiagnostics }) => {
  const activeProvider = getActiveProvider();

  const go = (id: ViewState) => {
    setView(id);
    onClose();
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-[600] bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <aside
        className={`fixed top-0 left-0 bottom-0 z-[601] w-[85%] max-w-[320px] bg-zinc-950 border-r border-white/10 shadow-2xl transition-transform duration-300 ease-out flex flex-col ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-center justify-between gap-3 p-6 border-b border-white/5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-luxury-gold flex items-center justify-center shadow-lg shrink-0">
              <span className="font-serif font-bold text-black text-lg">PD</span>
            </div>
            <div className="min-w-0">
              <h2 className="font-serif text-base font-bold text-white truncate">Eukasconta</h2>
              <span className="inline-flex items-center gap-1.5 mt-1 px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[9px] font-bold uppercase tracking-widest text-zinc-400">
                <Sparkles className="w-2.5 h-2.5 text-luxury-gold" /> {PROVIDER_LABEL[activeProvider] || activeProvider}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-all shrink-0" aria-label="Fechar menu">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
          {SECTIONS.map(section => (
            <div key={section.title}>
              <h3 className="px-3 mb-2 text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-600">{section.title}</h3>
              <div className="space-y-1">
                {section.items.map(item => {
                  const isActive = view === item.id;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => go(item.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-left ${isActive ? 'bg-luxury-gold/10 text-luxury-gold' : 'text-zinc-300 hover:bg-white/5'}`}
                    >
                      <Icon className={`w-4.5 h-4.5 shrink-0 ${isActive ? 'text-luxury-gold' : 'text-zinc-500'}`} />
                      <span className="text-[13px] font-bold tracking-tight">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-white/5">
          <button
            onClick={() => { onOpenDiagnostics(); onClose(); }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-zinc-500 hover:bg-white/5 hover:text-zinc-300 transition-all"
          >
            <Terminal className="w-4 h-4 shrink-0" />
            <span className="text-[13px] font-bold tracking-tight">Diagnóstico</span>
          </button>
        </div>
      </aside>
    </>
  );
};

export default SideDrawer;
