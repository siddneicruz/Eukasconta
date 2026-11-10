import React, { useState } from 'react';
import {
  ShoppingCart, Croissant, Beef, Apple, UtensilsCrossed, Pill, Dumbbell, Fuel, Shirt, Hammer, PawPrint, Plug, Wrench, Store, ChevronDown,
} from 'lucide-react';

/* "Onde você gasta": ranking das lojas do período. Cada linha tem o ícone do tipo de loja, o nome, o tipo com a
   fatia do total, o valor e uma barra fina na proporção da loja que mais gastou. Tocar numa loja filtra o painel
   por ela (de novo, solta). Substitui o gráfico de barras, que cortava nomes e valores na tela pequena. */

export interface StoreRow {
  key: string;      // identidade da loja (a mesma do filtro do painel)
  label: string;    // nome para mostrar
  type: string;     // tipo da loja ("Mercado", "Posto de Combustível"...) ou ''
  value: number;
  muted?: boolean;  // loja sem identificação: sem destaque de cor
}

const brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const iconFor = (type: string): React.ComponentType<{ className?: string; strokeWidth?: number }> => {
  const t = (type || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/padaria/.test(t)) return Croissant;
  if (/acougue|peixaria/.test(t)) return Beef;
  if (/hortifruti/.test(t)) return Apple;
  if (/mercado/.test(t)) return ShoppingCart;
  if (/farmac/.test(t)) return Pill;
  if (/posto|combust/.test(t)) return Fuel;
  if (/restaurante|lanchonete/.test(t)) return UtensilsCrossed;
  if (/academia/.test(t)) return Dumbbell;
  if (/roupa|calcado/.test(t)) return Shirt;
  if (/casa|constru/.test(t)) return Hammer;
  if (/pet/.test(t)) return PawPrint;
  if (/eletr/.test(t)) return Plug;
  if (/servic/.test(t)) return Wrench;
  return Store;
};

interface Props {
  rows: StoreRow[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  initial?: number;
}

const StoreRanking: React.FC<Props> = ({ rows, selectedKey, onSelect, initial = 5 }) => {
  const [all, setAll] = useState(false);
  if (!rows.length) return <p className="text-xs text-zinc-500 py-6 text-center">Nenhuma compra no período.</p>;

  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  const max = Math.max(...rows.map(r => r.value), 1);
  // a loja escolhida aparece sempre, mesmo fora das primeiras
  const shown = all ? rows : rows.filter((r, i) => i < initial || r.key === selectedKey);

  return (
    <div data-testid="store-ranking">
      <ul className="divide-y divide-white/5">
        {shown.map(r => {
          const Icon = iconFor(r.type);
          const active = selectedKey === r.key;
          const pct = (r.value / total) * 100;
          return (
            <li key={r.key}>
              <button type="button" onClick={() => onSelect(active ? null : r.key)} aria-pressed={active} data-testid="store-row" data-store={r.key}
                className={`w-full text-left flex items-center gap-3 py-3 px-1 -mx-1 rounded-xl transition-colors active:bg-white/[0.04] ${active ? 'bg-luxury-gold/10' : ''}`}>
                <span className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center border ${active ? 'border-luxury-gold/50 bg-luxury-gold/10' : 'border-white/10 bg-white/5'}`}>
                  <Icon className={`w-5 h-5 ${r.muted ? 'text-zinc-500' : 'text-luxury-gold'}`} strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[14px] font-semibold text-zinc-100 tracking-tight">{r.label}</span>
                    <span className="shrink-0 text-[14px] font-bold text-white tabular-nums">{brl0.format(r.value)}</span>
                  </span>
                  <span className="flex items-center justify-between gap-3 mt-0.5">
                    <span className="truncate text-xs text-zinc-400">{r.type || 'Sem tipo'}</span>
                    <span className="shrink-0 text-xs text-zinc-400 tabular-nums">{pct < 1 ? '<1' : Math.round(pct)}%</span>
                  </span>
                  <span className="block mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
                    <span className="block h-full rounded-full"
                      style={{ width: `${Math.max((r.value / max) * 100, 2)}%`, background: r.muted ? '#71717a' : 'linear-gradient(90deg, #A67C0A, #DDB94B)' }} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length > initial && (
        <button type="button" onClick={() => setAll(a => !a)} data-testid="store-more"
          className="mt-2 w-full h-10 flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold text-luxury-gold/90 hover:text-luxury-gold active:bg-white/5 transition-colors">
          {all ? 'Mostrar menos' : `Mostrar todas (${rows.length})`}
          <ChevronDown className={`w-4 h-4 transition-transform ${all ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  );
};

export default StoreRanking;
