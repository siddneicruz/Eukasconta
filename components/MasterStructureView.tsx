import React, { useMemo, useState } from 'react';
import { ChevronRight, Layers, Lock, ShieldCheck } from 'lucide-react';
import { TaxonomyNode } from '../types';
import { useMasterInfo } from './MasterContext';

/* A Estrutura de Taxonomia quando a tabela mãe vale: todos veem a mesma árvore, só leitura.
   Quem muda é o administrador (planilha ou aprovando sugestões). */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const when = (iso: string | null) => { try { return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''; } catch { return ''; } };

const MasterStructureView: React.FC<{ taxonomy: TaxonomyNode[]; onOpenAdmin?: () => void }> = ({ taxonomy, onOpenAdmin }) => {
  const info = useMasterInfo();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { kids, roots, count } = useMemo(() => {
    const k = new Map<string, TaxonomyNode[]>();
    const top: TaxonomyNode[] = [];
    taxonomy.forEach(n => { if (n.parentId) { const a = k.get(n.parentId); if (a) a.push(n); else k.set(n.parentId, [n]); } else top.push(n); });
    const c = new Map<string, number>();
    const total = (id: string): number => { if (c.has(id)) return c.get(id)!; const ks = k.get(id) || []; const v = ks.reduce((s, x) => s + 1 + total(x.id), 0); c.set(id, v); return v; };
    top.forEach(t => total(t.id));
    return { kids: k, roots: top.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), count: c };
  }, [taxonomy]);
  const toggle = (id: string) => setOpen(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const row = (n: TaxonomyNode, depth: number): React.ReactNode => {
    const ks = (kids.get(n.id) || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const isOpen = open.has(n.id);
    return (
      <li key={n.id}>
        <button type="button" onClick={() => ks.length && toggle(n.id)} aria-expanded={ks.length ? isOpen : undefined} data-testid="mstruct-row" data-level={n.level}
          style={{ paddingLeft: 12 + depth * 18 }}
          className={`w-full flex items-center gap-2 pr-3 min-h-[40px] text-left rounded-xl ${ks.length ? 'active:bg-white/5' : 'cursor-default'}`}>
          {ks.length ? <ChevronRight className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} /> : <span className="w-4 shrink-0" />}
          <span className={`min-w-0 flex-1 truncate ${depth === 0 ? 'text-[14px] font-semibold text-zinc-100' : depth === 1 ? 'text-[13px] font-medium text-zinc-200' : 'text-[13px] text-zinc-300'}`}>{n.name}</span>
          {ks.length > 0 && <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums">{count.get(n.id)}</span>}
        </button>
        {isOpen && ks.length > 0 && <ul>{ks.map(k => row(k, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="bg-black/40 border border-white/5 rounded-[2.5rem] overflow-hidden shadow-2xl" data-testid="mstruct">
      <div className="p-6 sm:p-8 border-b border-white/5 bg-zinc-900/20">
        <h3 className="text-xl font-serif text-white uppercase tracking-tight flex items-center gap-3"><Layers className="w-5 h-5 text-luxury-gold" /> Estrutura de Taxonomia</h3>
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-luxury-gold/30 bg-luxury-gold/[0.05] p-3.5">
          <Lock className="w-4 h-4 text-luxury-gold shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 text-[12.5px] leading-snug text-zinc-300">
            <p className="font-semibold text-zinc-100">Estrutura da tabela mãe, igual para todos os usuários.</p>
            <p className="mt-0.5 text-zinc-400">
              Versão {info.version}{info.publishedAt ? ` · publicada em ${when(info.publishedAt)}` : ''}.{' '}
              {info.isAdmin ? 'Para mudar, edite a planilha e publique.' : 'Para pedir uma categoria nova, use “Sugerir etiqueta” ao categorizar um item.'}
            </p>
            {info.isAdmin && onOpenAdmin && (
              <button type="button" onClick={onOpenAdmin} data-testid="mstruct-admin" className="mt-2.5 inline-flex items-center gap-2 h-9 px-3.5 rounded-lg bg-luxury-gold text-black text-[12px] font-bold active:opacity-80">
                <ShieldCheck className="w-4 h-4" /> Abrir a tabela mãe{info.pending > 0 ? ` (${plural(info.pending, 'sugestão', 'sugestões')})` : ''}
              </button>
            )}
          </div>
        </div>
      </div>
      <ul className="p-3 sm:p-4" data-testid="mstruct-tree">{roots.map(r => row(r, 0))}</ul>
    </div>
  );
};

export default MasterStructureView;
