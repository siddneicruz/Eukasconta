import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Minus, Plus, Search, Check, Trash2, Pencil, Copy, Star } from 'lucide-react';
import { Entry, Group, History, LineCheck, Product, findProducts, fmtQty, round3, stepOf, unitLabel } from '../services/shoppingList';
import { searchCatalog } from '../services/shoppingCatalog';

/* Folhas da lista de compras: editar um item, adicionar item do histórico e confirmar. */

export const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export const parseMoney = (txt: string): number | null => {
  let t = String(txt || '').replace(/[^\d.,]/g, '');
  if (!t) return null;
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
export const moneyText = (n: number | null | undefined): string => (n && n > 0 ? n.toFixed(2).replace('.', ',') : '');

/** Folha de baixo para cima. `tall` = altura fixa (lista rolável); `footer` = barra de ações que fica sempre à vista. */
export const Sheet: React.FC<{ title: string; subtitle?: string; onClose: () => void; testId: string; children: React.ReactNode; tall?: boolean; footer?: React.ReactNode }> = ({ title, subtitle, onClose, testId, children, tall = false, footer }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  // só fecha ao tocar no fundo se o toque COMEÇOU no fundo (um toque que começa na folha e termina fora não fecha)
  const downOnBackdrop = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const open = document.querySelectorAll('[aria-modal="true"]');
      if (open[open.length - 1] !== panelRef.current) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onPointerDown={e => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => { if (e.target === e.currentTarget && downOnBackdrop.current) onClose(); }} data-testid={testId}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className={`w-full sm:max-w-md max-h-[88dvh] ${tall ? 'h-[88dvh]' : ''} flex flex-col bg-[#0c0c0e] border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] shadow-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]`}>
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-serif text-white tracking-tight leading-tight break-words">{title}</h3>
            {subtitle && <p className="text-xs text-zinc-400 mt-0.5 leading-snug">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className={`px-5 pb-2 overflow-y-auto min-h-0 ${tall ? 'flex-1' : ''}`}>{children}</div>
        {footer && <div className="shrink-0 px-5 pt-2 border-t border-white/5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

/* ───────────────────────── editar item ───────────────────────── */

interface ItemSheetProps {
  entry: Entry;
  purchaseLabel: string;
  check?: LineCheck;
  onSave: (qty: number, price: number) => void;
  onRemove: () => void;
  onClose: () => void;
}

export const ItemSheet: React.FC<ItemSheetProps> = ({ entry, purchaseLabel, check, onSave, onRemove, onClose }) => {
  const step = stepOf(entry.unit);
  const [qty, setQty] = useState(entry.qty);
  const [qtyTxt, setQtyTxt] = useState(String(entry.qty).replace('.', ','));
  const [priceTxt, setPriceTxt] = useState(moneyText(entry.price));
  const setBoth = (n: number) => { const v = Math.max(0, round3(n)); setQty(v); setQtyTxt(String(v).replace('.', ',')); };
  const price = parseMoney(priceTxt) || 0;
  return (
    <Sheet title={entry.name} subtitle={`${entry.dept} · ${purchaseLabel}`} onClose={onClose} testId="shop-item-sheet">
      <p className="text-[11px] text-zinc-500 mb-1.5">Quantidade ({unitLabel(entry.unit)})</p>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Diminuir quantidade" onClick={() => setBoth(qty - step)} className="w-12 h-12 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-zinc-200 active:text-luxury-gold"><Minus className="w-5 h-5" /></button>
        <input data-testid="shop-item-qty" inputMode="decimal" value={qtyTxt} aria-label="Quantidade"
          onChange={e => { setQtyTxt(e.target.value); const n = parseMoney(e.target.value); if (n !== null) setQty(n); }}
          className="flex-1 min-w-0 h-12 rounded-xl bg-white/5 border border-white/10 text-center text-[17px] font-semibold text-white tabular-nums outline-none focus:border-luxury-gold/60" />
        <button type="button" aria-label="Aumentar quantidade" onClick={() => setBoth(qty + step)} className="w-12 h-12 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-zinc-200 active:text-luxury-gold"><Plus className="w-5 h-5" /></button>
      </div>

      <p className="text-[11px] text-zinc-500 mt-4 mb-1.5">Preço por {unitLabel(entry.unit)} (R$)</p>
      <input data-testid="shop-item-price" inputMode="decimal" value={priceTxt} onChange={e => setPriceTxt(e.target.value)} placeholder="sem preço" aria-label="Preço"
        className="w-full h-12 rounded-xl bg-white/5 border border-white/10 px-3 text-[16px] text-white tabular-nums outline-none focus:border-luxury-gold/60 placeholder:text-zinc-500" />
      <p className="text-[11px] text-zinc-500 mt-1.5 leading-snug">
        {entry.priceDate ? <>Último preço pago: <span className="text-zinc-300 tabular-nums">{brl(entry.price)}</span> em {entry.priceDate.split('-').reverse().join('/')}{entry.store ? ` · ${entry.store}` : ''}.</> : 'Sem compra anterior no histórico: informe o preço para entrar na soma.'}
      </p>
      {check && check.status !== 'faltou' && check.paidPrice !== null && (
        <p className="text-[11px] text-emerald-400 mt-1 tabular-nums">No cupom: {fmtQty(check.bought || 0, entry.unit)} a {brl(check.paidPrice)}/{unitLabel(entry.unit)}.</p>
      )}

      <p className="text-sm font-semibold text-white tabular-nums mt-4" data-testid="shop-item-total">Subtotal: {price > 0 ? brl(price * qty) : '—'}</p>

      <div className="grid grid-cols-2 gap-2 mt-4 mb-2">
        <button type="button" onClick={onRemove} data-testid="shop-item-remove"
          className="h-12 rounded-xl border border-rose-500/30 text-rose-400 text-[14px] font-semibold flex items-center justify-center gap-1.5 active:bg-rose-500/10"><Trash2 className="w-4 h-4" /> Tirar da lista</button>
        <button type="button" onClick={() => onSave(qty, price)} data-testid="shop-item-save"
          className="h-12 rounded-xl bg-luxury-gold text-black text-[14px] font-bold active:opacity-80">Salvar</button>
      </div>
    </Sheet>
  );
};

/* ───────────────────────── adicionar item ───────────────────────── */

interface AddSheetProps {
  history: History;
  purchaseLabel: string;
  onAdd: (p: Product | null, name: string, group?: Group) => void;
  onClose: () => void;
}

export const AddSheet: React.FC<AddSheetProps> = ({ history, purchaseLabel, onAdd, onClose }) => {
  const [q, setQ] = useState('');
  const [added, setAdded] = useState<string[]>([]);
  const found = findProducts(history, q, 8);
  // o que você nunca comprou, mas existe no catálogo (frutas, verduras e carnes)
  const fresh = searchCatalog(history, q, 5).filter(c => !found.some(f => f.pid === c.id));
  const name = q.trim();
  return (
    <Sheet title="Adicionar item" subtitle={`Entra em ${purchaseLabel}`} onClose={onClose} testId="shop-add-sheet">
      <div className="relative">
        <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input data-testid="shop-add-input" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Procurar no que você já comprou" aria-label="Procurar item"
          className="w-full h-12 rounded-xl bg-white/5 border border-white/10 pl-9 pr-3 text-[15px] text-white outline-none focus:border-luxury-gold/60 placeholder:text-zinc-500" />
      </div>
      <ul className="mt-2 mb-2">
        {found.map(p => {
          const done = added.includes(p.pid);
          return (
            <li key={p.pid}>
              <button type="button" data-testid="shop-add-row" onMouseDown={e => e.preventDefault()} onClick={() => { onAdd(p, p.name); setAdded(a => [...a, p.pid]); }}
                className="w-full text-left flex items-center gap-3 min-h-[56px] px-2 py-2 rounded-2xl hover:bg-white/5 active:bg-white/10">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-zinc-100 truncate">{p.name}</span>
                  <span className="block text-[11px] text-zinc-500 tabular-nums">{p.dept} · última {brl(p.price)}/{unitLabel(p.unit)}</span>
                </span>
                {done ? <Check className="w-5 h-5 text-emerald-400 shrink-0" /> : <Plus className="w-5 h-5 text-luxury-gold shrink-0" />}
              </button>
            </li>
          );
        })}
        {fresh.map(c => {
          const done = added.includes(c.id);
          return (
            <li key={c.id}>
              <button type="button" data-testid="shop-add-catalog" onMouseDown={e => e.preventDefault()} onClick={() => { onAdd(c.product, c.name, c.group === 'carne' ? 'churrasco' : c.group); setAdded(a => [...a, c.id]); }}
                className="w-full text-left flex items-center gap-3 min-h-[56px] px-2 py-2 rounded-2xl hover:bg-white/5 active:bg-white/10">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-zinc-100 truncate">{c.name}</span>
                  <span className="block text-[11px] text-zinc-500 tabular-nums">{c.product.dept} · do catálogo, nunca comprou · sem preço</span>
                </span>
                {done ? <Check className="w-5 h-5 text-emerald-400 shrink-0" /> : <Plus className="w-5 h-5 text-luxury-gold shrink-0" />}
              </button>
            </li>
          );
        })}
        {name.length >= 2 && (
          <li>
            <button type="button" data-testid="shop-add-free" onMouseDown={e => e.preventDefault()} onClick={() => { onAdd(null, name); setAdded(a => [...a, 'U:' + name]); }}
              className="w-full text-left flex items-center gap-3 min-h-[52px] px-2 py-2 rounded-2xl hover:bg-white/5 active:bg-white/10">
              <span className="min-w-0 flex-1 text-[14px] text-zinc-300 truncate">Adicionar “{name}” como item novo</span>
              {added.includes('U:' + name) ? <Check className="w-5 h-5 text-emerald-400 shrink-0" /> : <Plus className="w-5 h-5 text-luxury-gold shrink-0" />}
            </button>
          </li>
        )}
      </ul>
      {name.length >= 2 && !found.length && !fresh.length && <p className="text-[12px] text-zinc-500 pb-2">Nada parecido nos seus cupons dos últimos 12 meses. O item novo entra sem preço: informe depois.</p>}
    </Sheet>
  );
};

/* ───────────────────────── confirmar ───────────────────────── */

export const ConfirmSheet: React.FC<{ title: string; message: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }> = ({ title, message, confirmLabel, onConfirm, onClose }) => (
  <Sheet title={title} onClose={onClose} testId="shop-confirm-sheet">
    <p className="text-[13px] text-zinc-400 leading-snug mb-4">{message}</p>
    <div className="grid grid-cols-2 gap-2 mb-2">
      <button type="button" onClick={onClose} className="h-12 rounded-xl border border-white/10 text-zinc-300 text-[14px] font-semibold">Cancelar</button>
      <button type="button" onClick={onConfirm} data-testid="shop-confirm-ok" className="h-12 rounded-xl bg-rose-500 text-white text-[14px] font-bold active:opacity-80">{confirmLabel}</button>
    </div>
  </Sheet>
);

/* ───────────────────────── renomear ───────────────────────── */

export const RenameSheet: React.FC<{ name: string; onSave: (name: string) => void; onClose: () => void; mode?: 'rename' | 'save' }> = ({ name, onSave, onClose, mode = 'rename' }) => {
  const [txt, setTxt] = useState(name);
  const clean = txt.replace(/\s+/g, ' ').trim();
  const save = () => { if (clean) onSave(clean.slice(0, 60)); };
  return (
    <Sheet title={mode === 'save' ? 'Gravar lista' : 'Nome da lista'} subtitle={mode === 'save' ? 'Escolha um nome para achar esta lista depois, na sua coleção de listas.' : 'Dê um nome para achar esta lista depois.'} onClose={onClose} testId={mode === 'save' ? 'shop-save-sheet' : 'shop-rename-sheet'}>
      <label className="block">
        <span className="sr-only">Nome da lista</span>
        <input type="text" value={txt} onChange={e => setTxt(e.target.value)} maxLength={60} autoFocus data-testid="shop-rename-input"
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
          placeholder="Ex.: Compras do mês"
          className="w-full h-12 rounded-xl bg-white/5 border border-white/10 px-3 text-[16px] text-white outline-none focus:border-luxury-gold/60 placeholder:text-zinc-500" />
      </label>
      <div className="grid grid-cols-2 gap-2 mt-4 mb-2">
        <button type="button" onClick={onClose} className="h-12 rounded-xl border border-white/10 text-zinc-300 text-[14px] font-semibold">Cancelar</button>
        <button type="button" onClick={save} disabled={!clean} data-testid="shop-rename-save" className="h-12 rounded-xl bg-luxury-gold text-black text-[14px] font-bold disabled:opacity-40 active:opacity-80">{mode === 'save' ? 'Gravar' : 'Salvar'}</button>
      </div>
    </Sheet>
  );
};

/* ───────────────────────── menu da lista ───────────────────────── */

export const ListMenuSheet: React.FC<{
  name: string;
  isBase: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onToggleBase: () => void;
  onDelete: () => void;
  onClose: () => void;
}> = ({ name, isBase, onRename, onDuplicate, onToggleBase, onDelete, onClose }) => {
  const Row: React.FC<{ icon: React.ReactNode; label: string; sub?: string; onClick: () => void; testId: string; danger?: boolean }> = ({ icon, label, sub, onClick, testId, danger }) => (
    <button type="button" onClick={onClick} data-testid={testId}
      className={`w-full flex items-center gap-3 min-h-[56px] px-2 rounded-xl text-left active:bg-white/5 ${danger ? 'text-rose-400' : 'text-zinc-100'}`}>
      <span className={`shrink-0 w-9 h-9 rounded-xl border flex items-center justify-center ${danger ? 'border-rose-500/30' : 'border-white/10 text-luxury-gold'}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold leading-tight">{label}</span>
        {sub && <span className="block text-[11.5px] text-zinc-500 leading-snug mt-0.5">{sub}</span>}
      </span>
    </button>
  );
  return (
    <Sheet title={name} onClose={onClose} testId="shop-menu-sheet">
      <div className="space-y-0.5 mb-2">
        <Row icon={<Pencil className="w-4 h-4" />} label="Renomear" onClick={onRename} testId="shop-menu-rename" />
        <Row icon={<Copy className="w-4 h-4" />} label="Duplicar" sub="Uma cópia com o carrinho vazio." onClick={onDuplicate} testId="shop-menu-duplicate" />
        <Row icon={<Star className={`w-4 h-4 ${isBase ? 'fill-current' : ''}`} />} label={isBase ? 'Tirar de lista base' : 'Usar como lista base'}
          sub={isBase ? 'As listas novas deixam de partir dela.' : 'As listas novas podem partir dos itens desta.'} onClick={onToggleBase} testId="shop-menu-base" />
        <Row icon={<Trash2 className="w-4 h-4" />} label="Apagar lista" sub="Só a lista some. Cupons e histórico ficam." onClick={onDelete} testId="shop-menu-delete" danger />
      </div>
    </Sheet>
  );
};
