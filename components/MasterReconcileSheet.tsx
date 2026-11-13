import React, { useMemo, useState } from 'react';
import { X, Link2, Check, Search, ChevronDown } from 'lucide-react';
import { Establishment, Receipt } from '../types';
import type { MasterStore } from '../services/masterService';
import { memberStats, storeKey, MergePlan } from '../services/storeDedupe';
import { rankMasterStores } from '../services/storeResolver';
import { draftOf, StoreDraft } from '../services/establishmentEdit';
import { cleanCNPJ } from '../services/productNormalization';
import { formatCNPJ } from '../services/productNormalization';
import { titleCase } from '../services/textFormat';

interface Props {
  establishments: Establishment[];
  receipts: Receipt[];
  masterStores: MasterStore[];
  onMerge: (plans: MergePlan[]) => void;
  onSave: (prev: Establishment, draft: StoreDraft) => string | null;
  onClose: () => void;
}

const digits = (v?: string) => String(v || '').replace(/\D/g, '');

// Sugestão da tabela mãe com o motivo (CNPJ quase igual, nome, endereço, CEP, cidade)
const suggest = (e: Establishment, masters: MasterStore[]): { cnpj: string; why: string } => {
  const list = rankMasterStores(e, masters);
  const best = list[0];
  if (!best || (list[1] && best.score - list[1].score < 0.15)) return { cnpj: '', why: '' };
  return { cnpj: best.master.cnpj, why: best.reasons.join(' · ') };
};

const plain = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Busca de loja da tabela mãe no tema do app (no lugar da lista nativa do Android).
const StorePicker: React.FC<{ value: string; options: { cnpj: string; label: string }[]; onChange: (cnpj: string) => void }> = ({ value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = options.find(o => o.cnpj === value);
  const shown = useMemo(() => {
    const t = plain(q.trim());
    const d = q.replace(/\D/g, '');
    const list = !t ? options : options.filter(o => plain(o.label).includes(t) || (d.length >= 3 && digits(o.cnpj).includes(d)));
    return list.slice(0, 80);
  }, [q, options]);
  const pick = (c: string) => { onChange(c); setOpen(false); setQ(''); };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="store-picker"
        className={`w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm active:scale-[0.99] transition-transform ${current ? 'border-luxury-gold/50 bg-luxury-gold/10 text-white' : 'border-white/10 bg-white/5 text-zinc-300'}`}>
        <span className="min-w-0 break-words">{current ? current.label : 'Manter como está'}</span>
        <ChevronDown className="w-4 h-4 shrink-0 text-zinc-500" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-full sm:max-w-lg max-h-[85vh] flex flex-col bg-zinc-950 border border-white/10 rounded-t-3xl sm:rounded-3xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                <Search className="w-4 h-4 text-luxury-gold shrink-0" />
                <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar loja ou CNPJ" data-testid="store-picker-search"
                  className="flex-1 min-w-0 bg-transparent outline-none text-sm text-white placeholder:text-zinc-500" />
              </div>
              <button type="button" onClick={() => setOpen(false)} className="p-2 text-zinc-500 hover:text-white" aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-white/5">
              <button type="button" onClick={() => pick('')} className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left text-sm text-zinc-300 active:bg-white/5">
                Manter como está {!value && <Check className="w-4 h-4 text-luxury-gold" />}
              </button>
              {shown.map(o => (
                <button key={o.cnpj} type="button" onClick={() => pick(o.cnpj)} data-testid="store-picker-option"
                  className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left text-sm text-zinc-100 active:bg-white/5">
                  <span className="min-w-0 break-words">{o.label}</span>
                  {o.cnpj === value && <Check className="w-4 h-4 shrink-0 text-luxury-gold" />}
                </button>
              ))}
              {shown.length === 0 && <p className="p-8 text-center text-sm text-zinc-500">Nenhuma loja encontrada.</p>}
              {!q && options.length > 80 && <p className="px-4 py-3 text-[11px] text-zinc-500">Mostrando as 80 primeiras. Digite para buscar entre as {options.length}.</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const MasterReconcileSheet: React.FC<Props> = ({ establishments, receipts, masterStores, onMerge, onSave, onClose }) => {
  const known = useMemo(() => new Set(masterStores.map(m => digits(m.cnpj))), [masterStores]);
  const rows = useMemo(() => {
    const stats = new Map(memberStats(establishments, receipts).map(m => [m.key, m] as const));
    return establishments
      .filter(e => !known.has(digits(e.cnpj)))
      .map(e => ({ e, key: storeKey(e), n: stats.get(storeKey(e))?.receipts ?? 0, sug: suggest(e, masterStores) }))
      .sort((a, b) => (b.sug.cnpj ? 1 : 0) - (a.sug.cnpj ? 1 : 0) || b.n - a.n);
  }, [establishments, receipts, masterStores, known]);
  const options = useMemo(() => [...masterStores].map(m => ({ cnpj: m.cnpj, label: `${m.name || m.legalName || m.cnpj} · ${formatCNPJ(m.cnpj)}` })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')), [masterStores]);
  const [choice, setChoice] = useState<Record<string, string>>(() => Object.fromEntries(rows.map(r => [r.key, r.sug.cnpj])));
  const [msg, setMsg] = useState('');
  const picked = rows.filter(r => choice[r.key]);

  const apply = () => {
    const plans: MergePlan[] = [];
    const errors: string[] = [];
    for (const r of picked) {
      const target = establishments.find(x => digits(x.cnpj) === digits(choice[r.key]));
      if (target) plans.push({ keep: storeKey(target), members: [storeKey(target), r.key] });
      else {
        const err = onSave(r.e, { ...draftOf(r.e), cnpj: cleanCNPJ(choice[r.key]) });
        if (err) errors.push(`${titleCase(r.e.originalName)}: ${err}`);
      }
    }
    if (plans.length) onMerge(plans);
    if (errors.length) { setMsg(errors.join(' · ')); return; }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[250] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md" onClick={onClose} data-testid="master-reconcile">
      <div className="w-full sm:max-w-3xl max-h-[92vh] flex flex-col bg-zinc-950 border border-white/10 rounded-t-3xl sm:rounded-3xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 border-b border-white/10">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2"><Link2 className="w-4 h-4 text-luxury-gold" /> Conferir com a tabela mãe</h3>
            <p className="text-xs text-zinc-500 mt-1">Cadastros cujo CNPJ não existe na tabela mãe (CNPJ lido errado ou sem CNPJ). Escolha a loja certa: os cupons, códigos e dados passam para ela. O que ficar em branco não muda.</p>
          </div>
          <button onClick={onClose} className="p-2 text-zinc-500 hover:text-white" aria-label="Fechar"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-white/5">
          {rows.length === 0 && <p className="p-8 text-center text-sm text-zinc-500">Todas as lojas já batem com a tabela mãe.</p>}
          {rows.map(r => (
            <div key={r.key} className="p-4 grid gap-2 sm:grid-cols-[1fr_1fr] items-center">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-100 break-words">{titleCase(r.e.originalName) || 'Sem nome'}</p>
                <p className="text-[11px] text-zinc-500 font-mono">{formatCNPJ(r.e.cnpj) || 'Sem CNPJ'}{r.e.city ? ` · ${titleCase(r.e.city)}` : ''} · {r.n} {r.n === 1 ? 'cupom' : 'cupons'}</p>
                {r.sug.why && <p className="text-[11px] text-luxury-gold/80 mt-0.5">Sugestão: {r.sug.why}</p>}
              </div>
              <StorePicker value={choice[r.key] || ''} options={options} onChange={c => setChoice(x => ({ ...x, [r.key]: c }))} />
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-white/10 flex items-center gap-3">
          {msg && <p className="text-xs text-red-400 flex-1">{msg}</p>}
          <button onClick={apply} disabled={picked.length === 0} data-testid="master-reconcile-apply" className="ml-auto flex items-center gap-2 px-5 py-3 rounded-xl bg-luxury-gold text-black text-sm font-bold disabled:opacity-40">
            <Check className="w-4 h-4" /> Aplicar {picked.length > 0 ? `(${picked.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
};
export default MasterReconcileSheet;
