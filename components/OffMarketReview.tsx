import React, { useMemo, useState } from 'react';
import { X, Check, Plus } from 'lucide-react';
import { Receipt } from '../types';
import { addCustomCategory, offOptions, pinOff } from '../services/offMarket';

/* Gasto fora do mercado: a IA propôs uma categoria para cada item e a pessoa confirma ou troca.
   Cada escolha vira aprendizado neste aparelho: a mesma descrição já cai na categoria certa na próxima leitura.
   Categorias novas criadas aqui ficam só com a pessoa. */
interface Props { receipt: Receipt; onApply: (r: Receipt) => void; onClose: () => void }

const NEW = '__nova__';

const OffMarketReview: React.FC<Props> = ({ receipt, onApply, onClose }) => {
  const [version, setVersion] = useState(0);                         // recarrega a lista depois de criar categoria
  const options = useMemo(() => offOptions(), [version]);
  const pending = useMemo(() => receipt.items.map((it, idx) => ({ it, idx })).filter(x => x.it.offState === 'sugerido'), [receipt]);
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [creating, setCreating] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const current = (idx: number, fallback: string) => choice[idx] ?? fallback;

  const create = (idx: number) => {
    const label = addCustomCategory(draft);
    if (label) { setChoice(c => ({ ...c, [idx]: label })); setVersion(v => v + 1); }
    setCreating(null); setDraft('');
  };

  const apply = () => {
    const items = receipt.items.map((it, idx) => {
      if (it.offState !== 'sugerido') return it;
      const category = current(idx, it.category);
      pinOff(it.description, category);
      return { ...it, category, offState: 'confirmado' as const };
    });
    onApply({ ...receipt, items });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true" data-testid="off-review">
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-3xl bg-[#fbf8ef] border border-[#e6dfc9] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-[#2b2616]">Confirme as categorias</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-1 rounded-full hover:bg-black/5"><X className="w-5 h-5" /></button>
        </div>
        <p className="mt-1 text-sm text-[#5c553c]">
          Estes itens não são de supermercado. A categoria abaixo é uma sugestão: confirme ou troque. Da próxima vez, o mesmo item já cai na categoria que você escolher.
        </p>
        <ul className="mt-3 space-y-3">
          {pending.map(({ it, idx }) => {
            const value = current(idx, it.category);
            const known = options.some(o => o.label === value);
            return (
              <li key={idx} className="rounded-2xl border border-[#e6dfc9] bg-white/60 p-3">
                <div className="flex justify-between gap-2 text-sm text-[#2b2616]">
                  <span className="font-medium break-words min-w-0">{it.description}</span>
                  <span className="shrink-0">R$ {Number(it.totalPrice || 0).toFixed(2).replace('.', ',')}</span>
                </div>
                {creating === idx ? (
                  <div className="mt-2 flex gap-2">
                    <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} maxLength={40} placeholder="Nome da categoria"
                      className="flex-1 min-w-0 rounded-xl border border-[#d9d1b5] bg-white px-3 py-2 text-sm" data-testid="off-new-name" />
                    <button onClick={() => create(idx)} className="rounded-xl bg-[#d9b44a] px-3 text-sm font-semibold text-[#2b2616]">Criar</button>
                  </div>
                ) : (
                  <select
                    value={value}
                    onChange={e => e.target.value === NEW ? (setCreating(idx), setDraft('')) : setChoice(c => ({ ...c, [idx]: e.target.value }))}
                    className="mt-2 w-full rounded-xl border border-[#d9d1b5] bg-white px-3 py-2 text-sm text-[#2b2616]"
                    data-testid={`off-select-${idx}`}
                  >
                    {!known && <option value={value}>{`Sugerida: ${value}`}</option>}
                    {options.map(o => <option key={o.id} value={o.label}>{o.custom ? `★ ${o.name}` : o.name}</option>)}
                    <option value={NEW}>+ Criar categoria nova…</option>
                  </select>
                )}
              </li>
            );
          })}
        </ul>
        <button onClick={apply} data-testid="off-confirm" className="mt-4 w-full flex items-center justify-center gap-2 rounded-2xl bg-[#d9b44a] py-3 font-semibold text-[#2b2616]">
          <Check className="w-5 h-5" /> Confirmar {pending.length === 1 ? 'categoria' : `${pending.length} categorias`}
        </button>
        <p className="mt-2 flex items-center gap-1 text-[11px] text-[#7b7459]"><Plus className="w-3 h-3" /> Categorias que você cria ficam só no seu aparelho.</p>
      </div>
    </div>
  );
};

export default OffMarketReview;
