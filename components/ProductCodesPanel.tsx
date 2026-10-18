import React, { useMemo, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { MasterProduct } from '../types';
import { CodeOp, codesOfProduct, normStoreKey } from '../services/productCodes';
import { formatCNPJ } from '../services/productNormalization';
import { titleCase } from '../services/textFormat';

/* Os códigos de um produto, num lugar só: o nosso (MAE…), o do fabricante (código de barras) e o de cada loja.
   O app reconhece o produto por qualquer um deles, mesmo quando o nome no cupom sai rasurado. */

export interface StoreOption { key: string; label: string }

interface Props {
  master: MasterProduct;
  stores: StoreOption[];
  /** devolve o texto do erro, ou null quando gravou */
  onEdit?: (op: CodeOp) => string | null;
}

const EAN = '__ean__';

const Chip: React.FC<{ text: string; onRemove?: () => void; testId: string }> = ({ text, onRemove, testId }) => (
  <span data-testid={testId} className="inline-flex items-center gap-1.5 pl-3 pr-1 min-h-[32px] rounded-lg bg-white/5 border border-white/10 text-xs text-zinc-200 tabular-nums">
    {text}
    {onRemove && (
      <button type="button" onClick={onRemove} aria-label={`Tirar o código ${text}`} data-testid="prod-code-remove"
        className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-500 hover:text-red-400">
        <X className="w-3.5 h-3.5" />
      </button>
    )}
  </span>
);

const ProductCodesPanel: React.FC<Props> = ({ master, stores, onEdit }) => {
  const codes = useMemo(() => codesOfProduct(master), [master]);
  const labelOf = (key: string) => {
    const nk = normStoreKey(key);
    const hit = stores.find(s => s.key === nk);
    if (hit) return hit.label;
    return nk.startsWith('n:') ? titleCase(nk.slice(2)) : formatCNPJ(nk);
  };

  const [kind, setKind] = useState<string>(EAN);
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const add = () => {
    if (!onEdit) return;
    const err = kind === EAN ? onEdit({ kind: 'addEan', ean: text }) : onEdit({ kind: 'addStore', storeKey: kind, code: text });
    if (err) setError(err); else { setText(''); setError(''); }
  };
  const remove = (op: CodeOp) => { if (onEdit) { const err = onEdit(op); setError(err || ''); } };

  return (
    <div className="mt-2 rounded-xl border border-white/5 bg-black/40 p-3 space-y-3" data-testid="prod-codes">
      <p className="text-xs text-zinc-500">
        Código nosso <span className="ml-1 font-semibold text-zinc-200 tabular-nums" data-testid="prod-code-ours">{codes.ours}</span>
      </p>

      <div>
        <p className="text-xs text-zinc-400 font-medium mb-1.5">Fabricante (código de barras)</p>
        {codes.eans.length === 0
          ? <p className="text-xs text-zinc-600">Nenhum ainda. O app guarda o código de barras quando ele aparece no cupom.</p>
          : <div className="flex flex-wrap gap-1.5">{codes.eans.map(e => <Chip key={e} text={e} testId="prod-code-ean" onRemove={onEdit ? () => remove({ kind: 'removeEan', ean: e }) : undefined} />)}</div>}
      </div>

      <div>
        <p className="text-xs text-zinc-400 font-medium mb-1.5">Códigos das lojas</p>
        {codes.stores.length === 0
          ? <p className="text-xs text-zinc-600">Nenhum ainda.</p>
          : (
            <ul className="space-y-2">
              {codes.stores.map(s => (
                <li key={s.storeKey} data-testid="prod-code-store">
                  <p className="text-xs text-zinc-500 mb-1">{labelOf(s.storeKey)}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {s.codes.map(c => <Chip key={c} text={c} testId="prod-code-store-chip" onRemove={onEdit ? () => remove({ kind: 'removeStore', storeKey: s.storeKey, code: c }) : undefined} />)}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>

      {onEdit && (
        <div className="pt-2 border-t border-white/5">
          <p className="text-xs text-zinc-400 font-medium mb-1.5">Acrescentar um código</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <select value={kind} onChange={e => { setKind(e.target.value); setError(''); }} data-testid="prod-code-kind" aria-label="De quem é o código"
              className="bg-black/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-zinc-200 focus:border-luxury-gold/50 outline-none sm:w-52">
              <option value={EAN}>Fabricante (código de barras)</option>
              {stores.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <input type="text" value={text} onChange={e => { setText(e.target.value); setError(''); }} onKeyDown={e => { if (e.key === 'Enter') add(); }}
              inputMode={kind === EAN ? 'numeric' : 'text'} placeholder={kind === EAN ? '7891164023317' : 'Código na loja'} aria-label="Código" data-testid="prod-code-input"
              className="flex-1 min-w-0 bg-black/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-zinc-100 tabular-nums focus:border-luxury-gold/50 outline-none placeholder:text-zinc-600" />
            <button type="button" onClick={add} disabled={!text.trim()} data-testid="prod-code-add"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-luxury-gold text-black text-xs font-bold hover:brightness-110 disabled:opacity-40 transition">
              <Plus className="w-4 h-4" /> Acrescentar
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-red-400 leading-snug" role="alert" data-testid="prod-code-error">{error}</p>}
        </div>
      )}
    </div>
  );
};

export default ProductCodesPanel;
