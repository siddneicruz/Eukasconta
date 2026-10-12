import React from 'react';
import { Calendar, ChevronRight } from 'lucide-react';
import { Receipt } from '../types';
import { titleCase } from '../services/textFormat';

interface ReceiptRowProps {
  receipt: Receipt;
  onClick?: (receipt: Receipt) => void;
  amountOverride?: number;
  amountSubLabel?: string;
}

// Substitui o antigo card de ~160px de altura (data+valor, nome, divisor,
// hora+"ver cupom" — 4 blocos empilhados) por uma única linha compacta:
// ícone, data e estabelecimento à esquerda; valor e hora à direita.
// O objetivo é caber bem mais linhas por tela no celular, sem perder nenhuma
// informação que já era mostrada. `amountOverride` permite mostrar o valor
// só daquela categoria/produto dentro do cupom, em vez do total do cupom.
const ReceiptRow: React.FC<ReceiptRowProps> = ({ receipt, onClick, amountOverride, amountSubLabel }) => (
  <div
    onClick={() => onClick?.(receipt)}
    className="flex items-center gap-3 px-4 py-3 bg-black/60 border border-white/10 rounded-xl hover:border-luxury-gold/30 transition-all cursor-pointer group"
  >
    <div className="w-9 h-9 rounded-lg bg-black border border-white/5 flex items-center justify-center text-zinc-500 group-hover:text-luxury-gold shrink-0">
      <Calendar className="w-4 h-4" />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-sm text-zinc-100 font-semibold line-clamp-2 break-words group-hover:text-luxury-gold transition-colors font-sans leading-snug">
        {titleCase(receipt.establishmentName)}
      </p>
      <span className="text-xs text-zinc-500 tabular-nums">
        {receipt.date.split('-').reverse().join('/')} · {receipt.time || '12:00'}
        {amountSubLabel && <span className="text-zinc-400 hidden sm:inline"> · {amountSubLabel}</span>}
      </span>
    </div>
    <div className="flex items-center gap-1 shrink-0">
      <span className="text-sm font-sans font-bold text-white tabular-nums">
        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amountOverride ?? receipt.totalAmount)}
      </span>
      <ChevronRight className="w-3.5 h-3.5 text-zinc-700 group-hover:text-luxury-gold transition-colors" />
    </div>
  </div>
);

export default ReceiptRow;
