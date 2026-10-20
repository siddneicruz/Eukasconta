import React, { useMemo, useState } from 'react';
import { Check, Copy, Trash2 } from 'lucide-react';
import { Receipt } from '../types';
import { DuplicateGroup, duplicateRemovalCount, findDuplicateGroups, loadIgnoredGroups, saveIgnoredGroups } from '../services/receiptDuplicates';
import { titleCase } from '../services/textFormat';
import { Sheet, brl } from './ShoppingSheets';

/* Revisão de cupons repetidos: a mesma compra salva mais de uma vez (a IA lê a mesma foto de um jeito um pouco diferente
   e a checagem antiga só olhava o nome exato da loja). Cada grupo mostra qual cupom fica (o de leitura mais confiável)
   e qual sai; "Manter os dois" tira o grupo da lista. */

interface Props {
  receipts: Receipt[];
  onConfirm: (removeIds: string[]) => void;
  onClose: () => void;
  onIgnoredChange?: (keys: string[]) => void;
}

const dayText = (iso: string) => iso.split('-').reverse().join('/');
const readAt = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `lido ${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const itemsText = (r: Receipt) => { const n = r.items?.length || 0; return n === 0 ? 'sem itens' : `${n} ${n === 1 ? 'item' : 'itens'}`; };

const DuplicateReceiptsSheet: React.FC<Props> = ({ receipts, onConfirm, onClose, onIgnoredChange }) => {
  const [ignored, setIgnored] = useState<string[]>(() => loadIgnoredGroups());
  const groups = useMemo(() => findDuplicateGroups(receipts), [receipts]);
  const visible = groups.filter(g => !ignored.includes(g.key));
  const removeCount = duplicateRemovalCount(visible);

  const setIgn = (key: string, on: boolean) => {
    const next = on ? [...ignored, key] : ignored.filter(k => k !== key);
    setIgnored(next); saveIgnoredGroups(next); onIgnoredChange?.(next);
  };
  const ignoredGroups = groups.filter(g => ignored.includes(g.key));

  const footer = (
    <div className="pb-1">
      <p className="text-[11px] text-zinc-400 mb-2 leading-snug tabular-nums" data-testid="dup-summary" aria-live="polite">
        {removeCount === 0 ? 'Nenhum cupom para remover.' : `${removeCount} ${removeCount === 1 ? 'cupom sai' : 'cupons saem'}; os que ficam não mudam. Antes disso eu guardo um ponto de restauração.`}
      </p>
      <button type="button" data-testid="dup-confirm" disabled={removeCount === 0} onClick={() => onConfirm(visible.flatMap(g => g.remove.map(x => x.receipt.id)))}
        className="w-full h-12 rounded-xl bg-luxury-gold text-black text-[14px] font-bold active:opacity-80 disabled:opacity-40 flex items-center justify-center gap-2">
        <Trash2 className="w-4 h-4" /> {removeCount === 0 ? 'Remover' : `Remover ${removeCount} ${removeCount === 1 ? 'repetido' : 'repetidos'}`}
      </button>
    </div>
  );

  const card = (g: DuplicateGroup, off: boolean) => (
    <li key={g.key} data-testid="dup-group" data-key={g.key} data-off={off ? 'true' : 'false'} className={`rounded-2xl border border-white/10 bg-white/[0.03] p-3 ${off ? 'opacity-60' : ''}`}>
      <div className="flex items-baseline gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-zinc-100 truncate">{titleCase(g.keep.establishmentName) || 'Sem nome'}</p>
          <p className="text-[11px] text-zinc-500 tabular-nums">{dayText(g.keep.date)}{g.keep.time && g.keep.time !== '12:00' ? ` · ${g.keep.time.slice(0, 5)}` : ''}</p>
        </div>
        <span className="text-[14px] font-serif font-bold text-white tabular-nums shrink-0">{brl(g.keep.totalAmount)}</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        <li className="flex items-start gap-2 text-[12px]" data-testid="dup-keep">
          <span className="shrink-0 w-[3.25rem] text-center rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-bold uppercase py-0.5 flex items-center justify-center gap-0.5"><Check className="w-3 h-3" strokeWidth={3} />Fica</span>
          <span className="text-zinc-300 tabular-nums truncate">{itemsText(g.keep)}{readAt(g.keep.scannedAt) ? ` · ${readAt(g.keep.scannedAt)}` : ''}</span>
        </li>
        {g.remove.map(x => (
          <li key={x.receipt.id} className="flex items-start gap-2 text-[12px]" data-testid="dup-remove">
            <span className={`shrink-0 w-[3.25rem] text-center rounded-full text-[10px] font-bold uppercase py-0.5 ${off ? 'bg-white/10 text-zinc-400' : 'bg-rose-500/15 text-rose-400'}`}>{off ? 'Fica' : 'Sai'}</span>
            <span className="text-zinc-400 tabular-nums leading-snug min-w-0">{itemsText(x.receipt)}{readAt(x.receipt.scannedAt) ? ` · ${readAt(x.receipt.scannedAt)}` : ''}{x.reason !== 'sem itens' ? ` · ${x.reason}` : ''}</span>
          </li>
        ))}
      </ul>
      <button type="button" data-testid={off ? 'dup-undo-ignore' : 'dup-ignore'} onClick={() => setIgn(g.key, !off)}
        className="mt-2 h-8 -ml-1 px-2 text-[12px] font-semibold text-zinc-500 active:text-luxury-gold">{off ? 'Voltar a tratar como repetido' : 'Manter os dois'}</button>
    </li>
  );

  return (
    <Sheet title="Cupons repetidos" subtitle="A mesma compra salva mais de uma vez." onClose={onClose} testId="dup-sheet" tall footer={footer}>
      {groups.length === 0 ? (
        <div className="py-10 text-center" data-testid="dup-empty">
          <Copy className="w-6 h-6 mx-auto text-zinc-600 mb-2" />
          <p className="text-[13px] text-zinc-400">Nenhum cupom repetido por aqui.</p>
        </div>
      ) : (
        <>
          <p className="text-[12px] text-zinc-400 mb-2 leading-snug" data-testid="dup-intro">
            {visible.length === 0 ? 'Você escolheu manter todos os grupos.' : `${visible.length} ${visible.length === 1 ? 'compra aparece' : 'compras aparecem'} mais de uma vez. Fica o cupom com a leitura mais confiável (itens com a conta certa).`}
          </p>
          <ul className="space-y-2 mb-3" data-testid="dup-list">{visible.map(g => card(g, false))}</ul>
          {ignoredGroups.length > 0 && (
            <>
              <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-500 font-bold mb-2">Mantidos os dois</p>
              <ul className="space-y-2 mb-2" data-testid="dup-ignored-list">{ignoredGroups.map(g => card(g, true))}</ul>
            </>
          )}
        </>
      )}
    </Sheet>
  );
};

export default DuplicateReceiptsSheet;
