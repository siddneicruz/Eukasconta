import React, { useMemo, useState } from 'react';
import { X, Link2, Check } from 'lucide-react';
import { Establishment, Receipt } from '../types';
import type { MasterStore } from '../services/masterService';
import { cnpjGap, coreTokens, memberStats, nameRelation, storeKey, MergePlan } from '../services/storeDedupe';
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
const tokensOf = (name: string, city?: string) => coreTokens({ originalName: name, city: city || '' } as any);

// Procura na tabela mãe a loja que este cadastro deve ser: CNPJ quase igual (dígito trocado) ou nome igual/contido na mesma cidade.
const suggest = (e: Establishment, masters: MasterStore[]): string => {
  const d = digits(e.cnpj);
  if (d.length >= 11) {
    let best: { cnpj: string; gap: number } | null = null;
    for (const m of masters) {
      const g = cnpjGap(d, m.cnpj);
      if (g !== null && g <= 2 && (!best || g < best.gap)) best = { cnpj: m.cnpj, gap: g };
    }
    if (best) return best.cnpj;
  }
  const mine = tokensOf(e.originalName, e.city);
  if (mine.length === 0) return '';
  const hits = masters.filter(m => {
    if (m.city && e.city && m.city.toLowerCase() !== e.city.toLowerCase()) return false;
    const rel = nameRelation(mine, tokensOf(m.legalName || m.name, m.city));
    return rel === 'igual' || rel === 'contido';
  });
  return hits.length === 1 ? hits[0].cnpj : '';
};

const MasterReconcileSheet: React.FC<Props> = ({ establishments, receipts, masterStores, onMerge, onSave, onClose }) => {
  const known = useMemo(() => new Set(masterStores.map(m => digits(m.cnpj))), [masterStores]);
  const rows = useMemo(() => {
    const stats = new Map(memberStats(establishments, receipts).map(m => [m.key, m] as const));
    return establishments
      .filter(e => !known.has(digits(e.cnpj)))
      .map(e => ({ e, key: storeKey(e), n: stats.get(storeKey(e))?.receipts ?? 0, sug: suggest(e, masterStores) }))
      .sort((a, b) => (b.sug ? 1 : 0) - (a.sug ? 1 : 0) || b.n - a.n);
  }, [establishments, receipts, masterStores, known]);
  const options = useMemo(() => [...masterStores].map(m => ({ cnpj: m.cnpj, label: `${m.name || m.legalName || m.cnpj} · ${formatCNPJ(m.cnpj)}` })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')), [masterStores]);
  const [choice, setChoice] = useState<Record<string, string>>(() => Object.fromEntries(rows.map(r => [r.key, r.sug])));
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
                <p className="text-[11px] text-zinc-500 font-mono">{formatCNPJ(r.e.cnpj) || 'Sem CNPJ'}{r.e.city ? ` · ${titleCase(r.e.city)}` : ''} · {r.n} {r.n === 1 ? 'cupom' : 'cupons'}{r.sug ? ' · sugestão automática' : ''}</p>
              </div>
              <select value={choice[r.key] || ''} onChange={e => setChoice(c => ({ ...c, [r.key]: e.target.value }))} className="w-full bg-black border border-white/10 rounded-lg px-2 py-2 text-sm text-zinc-200 focus:border-luxury-gold outline-none">
                <option value="">Manter como está</option>
                {options.map(o => <option key={o.cnpj} value={o.cnpj}>{o.label}</option>)}
              </select>
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
