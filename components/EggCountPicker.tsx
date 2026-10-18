import React, { useState } from 'react';
import { Egg } from 'lucide-react';
import type { ReceiptItem } from '../types';
import { EGG_SIZES, MAX_EGGS, dozenPrice, eggCountOf, eggsText, isEggItem } from '../services/eggs';

/* Quantos ovos vêm na bandeja. O cupom costuma dizer só "bandeja de ovos"; escolhendo a quantidade o app passa a
   comparar o preço pela dúzia. Aparece só em itens de ovo. */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  item: ReceiptItem;
  onChange: (count: number | undefined) => void;
  /** Quantas outras compras do mesmo item (mesma loja) ainda estão sem a quantidade; 0 esconde o atalho. */
  sameCount?: number;
  onApplySame?: () => void;
  testId?: string;
}

const EggCountPicker: React.FC<Props> = ({ item, onChange, sameCount = 0, onApplySame, testId = 'egg-picker' }) => {
  const [other, setOther] = useState(false);
  const [draft, setDraft] = useState('');
  if (!isEggItem(item)) return null;
  const found = eggCountOf(item);
  // vendido por peso, ou por dúzia: não há o que escolher
  const unit = String(item.unitType || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (/^(KG|KGS|G|GR|GRS|L|LT|ML)$/.test(unit)) return null;
  const fixed = found?.source === 'unit';
  const price = Number(item.unitPrice) > 0 && found ? dozenPrice(item.unitPrice, found.count) : 0;
  const isCustom = Boolean(found) && !(EGG_SIZES as readonly number[]).includes(found!.count);

  const pick = (n: number) => {
    // tocar de novo no que já está escolhido tira a escolha (volta a ler do nome)
    if (found?.source === 'manual' && found.count === n) onChange(undefined);
    else onChange(n);
    setOther(false);
  };
  const confirmOther = () => {
    const n = Math.round(Number(draft.replace(',', '.')));
    if (n >= 1 && n <= MAX_EGGS) { onChange(n); setOther(false); setDraft(''); }
  };

  return (
    <div className="rounded-xl border border-luxury-gold/25 bg-luxury-gold/10 p-2.5 space-y-2" data-testid={testId}>
      <div className="flex items-start gap-2">
        <Egg className="w-4 h-4 text-luxury-gold shrink-0 mt-0.5" />
        <p className="text-xs leading-snug text-zinc-300 min-w-0" data-testid={`${testId}-status`}>
          {found ? (
            <>
              <span className="font-bold text-zinc-100">{eggsText(found.count)}</span>
              {price > 0 && <> · <span className="font-bold text-luxury-gold">{brl.format(price)} a dúzia</span></>}
              {found.source === 'name' && <span className="text-zinc-500"> · lido do nome do item</span>}
              {found.source === 'unit' && <span className="text-zinc-500"> · vendido por dúzia</span>}
            </>
          ) : (
            <span className="text-zinc-200">Quantos ovos vêm na bandeja? Escolha para comparar o preço pela dúzia.</span>
          )}
        </p>
      </div>

      {!fixed && (
        <div className="flex flex-wrap items-center gap-1.5">
          {EGG_SIZES.map(n => {
            const on = found?.count === n;
            return (
              <button key={n} type="button" onClick={() => pick(n)} aria-pressed={on} data-egg-size={n}
                className={`min-w-[44px] h-9 px-3 rounded-full border text-xs font-bold tabular-nums transition-colors ${on ? 'bg-luxury-gold text-black border-luxury-gold' : 'bg-white/5 border-white/10 text-zinc-300 hover:border-luxury-gold/50'}`}>
                {n}
              </button>
            );
          })}
          <button type="button" onClick={() => { setOther(o => !o); setDraft(isCustom && found ? String(found.count) : ''); }} aria-pressed={other || isCustom} data-egg-size="other"
            className={`h-9 px-3 rounded-full border text-xs font-bold transition-colors ${other || isCustom ? 'bg-luxury-gold text-black border-luxury-gold' : 'bg-white/5 border-white/10 text-zinc-300 hover:border-luxury-gold/50'}`}>
            {isCustom && !other && found ? found.count : 'Outro'}
          </button>
        </div>
      )}

      {other && !fixed && (
        <div className="flex items-center gap-2">
          <input type="text" inputMode="numeric" autoFocus value={draft} onChange={e => setDraft(e.target.value.replace(/\D/g, '').slice(0, 3))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmOther(); } }}
            placeholder="Quantidade de ovos" aria-label="Quantidade de ovos na bandeja" data-testid={`${testId}-other`}
            className="flex-1 min-w-0 bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:border-luxury-gold/60" />
          <button type="button" onClick={confirmOther} className="h-9 px-4 rounded-lg bg-luxury-gold text-black text-xs font-bold hover:brightness-110">Salvar</button>
        </div>
      )}

      {found?.source === 'manual' && sameCount > 0 && onApplySame && (
        <button type="button" onClick={onApplySame} data-testid={`${testId}-same`}
          className="text-xs font-bold text-luxury-gold underline underline-offset-2 text-left">
          Usar {found.count} ovos também {sameCount === 1 ? 'na outra compra' : `nas outras ${sameCount} compras`} deste item
        </button>
      )}
    </div>
  );
};

export default EggCountPicker;
