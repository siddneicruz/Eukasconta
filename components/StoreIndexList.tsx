import React, { useMemo, useRef, useState } from 'react';
import { Pencil, Check, MapPin } from 'lucide-react';
import { Establishment } from '../types';
import { titleCase } from '../services/textFormat';
import { fold } from '../services/itemSearch';
import { formatCNPJ } from '../services/productNormalization';
import { useStoreNames } from './StoreNamesContext';

/* Lista compacta das lojas (celular): uma linha por loja, em ordem alfabética, com a letra de cada bloco e uma barra de
   letras na lateral para pular direto (toque ou arraste o dedo na barra). O lápis abre a edição ali mesmo: apelido e
   o botão para corrigir todos os dados. */

interface Props {
  stores: Establishment[];
  onUpdate: (e: Establishment) => void;
  onEditAll?: (e: Establishment) => void;
}

const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
const keyOf = (e: Establishment) => `${(e.cnpj || '').replace(/\D/g, '')}|${e.originalName}`;
const letterOf = (name: string): string => {
  const c = fold(name).charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
};
const secId = (l: string) => `store-sec-${l === '#' ? 'num' : l}`;

const StoreIndexList: React.FC<Props> = ({ stores, onUpdate, onEditAll }) => {
  // apelido: o que a pessoa escreveu na loja; sem ele, o da tabela mãe (por CNPJ)
  const { aliasOf } = useStoreNames();
  const aliasFor = (e: Establishment): string => (e.aliasName && e.aliasName.trim()) || aliasOf(e.originalName, e.cnpj) || '';
  const nameOf = (e: Establishment): string => aliasFor(e) || titleCase(e.originalName) || 'Sem nome';
  const [openKey, setOpenKey] = useState<string | null>(null);
  // enquanto a loja está aberta para editar, ela fica no lugar de antes (o apelido muda a cada letra e a linha não pode sair andando)
  const [frozen, setFrozen] = useState<{ key: string; name: string } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement | null>());
  const [bubble, setBubble] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const hideTimer = useRef<number | undefined>(undefined);

  const groups = useMemo(() => {
    const m = new Map<string, Establishment[]>();
    const sortName = (e: Establishment) => (frozen && keyOf(e) === frozen.key ? frozen.name : nameOf(e));
    [...stores]
      .sort((a, b) => fold(sortName(a)).localeCompare(fold(sortName(b)), 'pt-BR', { numeric: true }))
      .forEach(e => {
        const l = letterOf(sortName(e));
        const arr = m.get(l);
        if (arr) arr.push(e); else m.set(l, [e]);
      });
    return LETTERS.filter(l => m.has(l)).map(l => ({ letter: l, items: m.get(l)! }));
  }, [stores, frozen, aliasOf]);
  const present = useMemo(() => new Set(groups.map(g => g.letter)), [groups]);
  const showBar = stores.length >= 8;

  const jump = (clientY: number) => {
    const el = barRef.current;
    if (!el || present.size === 0) return;
    const r = el.getBoundingClientRect();
    const i = Math.max(0, Math.min(LETTERS.length - 1, Math.floor(((clientY - r.top) / r.height) * LETTERS.length)));
    // letra sem loja: vai para a próxima que tem (ou a anterior mais próxima, no fim da lista)
    const target = LETTERS.slice(i).find(l => present.has(l)) ?? [...LETTERS.slice(0, i)].reverse().find(l => present.has(l));
    if (!target) return;
    setBubble(target);
    document.getElementById(secId(target))?.scrollIntoView({ block: 'start' });
  };
  const toggleOpen = (est: Establishment) => {
    const k = keyOf(est);
    if (openKey === k) {
      setOpenKey(null); setFrozen(null);
      // ao fechar, a linha pode ir para o lugar certo do apelido novo: mantém ela à vista
      window.setTimeout(() => rowRefs.current.get(k)?.scrollIntoView({ block: 'nearest' }), 0);
    } else {
      setOpenKey(k); setFrozen({ key: k, name: nameOf(est) });
    }
  };
  const endDrag = () => {
    dragging.current = false;
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setBubble(null), 450);
  };

  return (
    <div data-testid="store-index-list">
      <ul className={showBar ? 'pr-5' : ''}>
        {groups.map(g => (
          <li key={g.letter} id={secId(g.letter)} data-letter={g.letter} className="scroll-mt-20">
            <div className="pt-2.5 pb-1 text-[11px] font-bold text-luxury-gold" data-testid="store-letter">{g.letter}</div>
            <ul className="divide-y divide-white/5">
              {g.items.map(est => {
                const k = keyOf(est);
                const open = openKey === k;
                const place = [titleCase(est.city), est.state].filter(Boolean).join(' - ');
                const sub = aliasFor(est) ? titleCase(est.originalName) : place;
                return (
                  <li key={k} ref={el => { rowRefs.current.set(k, el); }} data-testid="store-row" data-open={open ? 'true' : 'false'}>
                    <div className="flex items-center gap-2 min-h-[48px]">
                      <div className="min-w-0 flex-1 py-1.5">
                        <p className="truncate text-[14px] font-semibold text-zinc-100 leading-tight" data-testid="store-name">{nameOf(est)}</p>
                        {sub && <p className="truncate text-[11px] text-zinc-500 leading-tight mt-0.5">{sub}</p>}
                      </div>
                      <button type="button" onClick={() => toggleOpen(est)} aria-expanded={open} data-testid="store-pencil"
                        aria-label={open ? `Fechar a edição de ${nameOf(est)}` : `Editar ${nameOf(est)}`}
                        className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border transition-colors ${open ? 'bg-luxury-gold/15 border-luxury-gold/40 text-luxury-gold' : 'border-transparent text-zinc-500 hover:text-luxury-gold'}`}>
                        {open ? <Check className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                      </button>
                    </div>
                    {open && (
                      <div className="mb-2 rounded-2xl border border-white/5 bg-zinc-900/30 p-3.5 animate-in fade-in duration-150" data-testid="store-editor">
                        <p className="text-xs text-zinc-500 break-words">
                          <span className="tabular-nums">{formatCNPJ(est.cnpj) || 'Pessoa física'}</span>
                          {place && <> · {place}</>}
                        </p>
                        {est.address && (
                          <p className="text-xs text-zinc-600 mt-0.5 break-words flex items-start gap-1" data-testid="store-address"><MapPin className="w-3 h-3 mt-0.5 shrink-0" />{est.address}</p>
                        )}
                        <label className="block mt-3">
                          <span className="block text-xs text-zinc-400 font-medium mb-1.5">Apelido</span>
                          <input type="text" value={est.aliasName || ''} onChange={e => onUpdate({ ...est, aliasName: e.target.value })}
                            placeholder={aliasFor(est) || 'Como você chama esta loja'} data-testid="store-alias"
                            className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-luxury-gold focus:border-luxury-gold/50 outline-none font-semibold placeholder:text-zinc-600 placeholder:font-normal" />
                        </label>
                        {onEditAll && (
                          <button type="button" onClick={() => onEditAll(est)} data-testid="store-edit-open"
                            className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-xs font-bold hover:border-luxury-gold/40 hover:text-luxury-gold transition-colors">
                            <Pencil className="w-3.5 h-3.5" /> Editar todos os dados
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      {showBar && (
        <>
          <div ref={barRef} data-testid="store-letter-bar" aria-label="Pular para a letra"
            className="md:hidden fixed right-0.5 z-40 w-6 flex flex-col justify-between items-center select-none touch-none"
            style={{ top: '5.5rem', bottom: 'calc(5.75rem + env(safe-area-inset-bottom))' }}
            onPointerDown={e => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); window.clearTimeout(hideTimer.current); jump(e.clientY); }}
            onPointerMove={e => { if (dragging.current) jump(e.clientY); }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}>
            {LETTERS.map(l => (
              <span key={l} data-letter={l} className={`text-[10px] leading-none font-semibold ${bubble === l ? 'text-luxury-gold' : present.has(l) ? 'text-zinc-400' : 'text-zinc-700'}`}>{l}</span>
            ))}
          </div>
          {bubble && (
            <div className="md:hidden fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-40 w-16 h-16 rounded-2xl bg-luxury-gold text-black text-3xl font-bold flex items-center justify-center shadow-2xl pointer-events-none" data-testid="store-letter-bubble">{bubble}</div>
          )}
        </>
      )}
    </div>
  );
};

export default StoreIndexList;
