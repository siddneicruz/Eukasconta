import React, { useMemo } from 'react';
import { X, UtensilsCrossed } from 'lucide-react';
import { Receipt } from '../types';
import { useStoreNames } from './StoreNamesContext';
import { planMeals, MEAL_DEPT } from '../services/readyMeals';

interface Props { receipts: Receipt[]; onApply: () => void; onClose: () => void }

/** Mostra o que vai sair das categorias de mercado e ir para "Comer Fora e Delivery" antes de mexer em qualquer cupom. */
const ReadyMealsSheet: React.FC<Props> = ({ receipts, onApply, onClose }) => {
  const namer = useStoreNames();
  const plan = useMemo(() => planMeals(receipts, namer.typeOf, namer.nameOf), [receipts, namer]);
  return (
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose} data-testid="meals-sheet">
      <div className="w-full sm:max-w-lg bg-[#121214] border border-white/10 rounded-t-3xl sm:rounded-3xl p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <h3 className="text-lg font-serif text-white uppercase tracking-tight flex items-center gap-2"><UtensilsCrossed className="w-5 h-5 text-luxury-gold" /> Refeições fora de casa</h3>
          <button onClick={onClose} aria-label="Fechar" className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        {plan.items === 0 ? (
          <p className="text-sm text-zinc-400">Nenhum item de restaurante, lanchonete, bar ou café está fora de “{MEAL_DEPT}”. Está tudo certo.</p>
        ) : (
          <>
            <p className="text-sm text-zinc-300 mb-3">{plan.items} {plan.items === 1 ? 'item' : 'itens'} em {plan.receipts} {plan.receipts === 1 ? 'cupom' : 'cupons'} de lojas de consumo pronto estão com categorias de mercado. Vão para “{MEAL_DEPT}” e saem do histórico de preços dos produtos.</p>
            <ul className="mb-4 divide-y divide-white/5 border border-white/5 rounded-xl overflow-hidden">
              {plan.stores.map(s => <li key={s.name} className="flex justify-between px-3 py-2 text-sm text-zinc-200"><span className="truncate">{s.name}</span><span className="text-zinc-500 shrink-0 ml-3">{s.items}</span></li>)}
            </ul>
            <p className="text-[11px] text-zinc-500 mb-4">Antes de mudar, o app guarda um ponto de restauração. Só mexe em lojas do tipo Restaurante e Lanchonete (e parecidos); o tipo da loja se corrige na tabela mãe.</p>
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-white/10 text-zinc-300 text-sm font-semibold">Cancelar</button>
              <button onClick={() => { onApply(); onClose(); }} data-testid="meals-apply" className="flex-1 py-3 rounded-xl bg-luxury-gold text-black text-sm font-bold">Mover {plan.items} {plan.items === 1 ? 'item' : 'itens'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
export default ReadyMealsSheet;
