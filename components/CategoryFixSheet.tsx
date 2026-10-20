import React, { useEffect, useMemo, useState } from 'react';
import { Tags, X } from 'lucide-react';
import { FixSection } from '../services/categoryRules';
import { titleCase } from '../services/textFormat';
import CategoryTargetPicker from './CategoryTargetPicker';

/* Revisão de categorias: mostra o que parece estar no lugar errado (ex.: linguiça e bacon em "Carne Suína"),
   deixa trocar o destino e desmarcar o que está certo, e só muda quando a pessoa aplica. */

interface Props {
  sections: FixSection[];
  categories: string[];
  onApply: (mappings: { description: string; newCategory: string }[]) => void;
  onClose: () => void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const CategoryFixSheet: React.FC<Props> = ({ sections, categories, onApply, onClose }) => {
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [targets, setTargets] = useState<Record<string, string>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as Element | null)?.closest?.('[role="combobox"]')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const keyOf = (s: FixSection, desc: string) => `${s.ruleId}|${desc}`;
  const targetOf = (s: FixSection) => targets[s.ruleId] || s.target;

  const chosen = useMemo(() => sections.flatMap(s => s.items
    .filter(i => !off[`${s.ruleId}|${i.desc}`])
    .map(i => ({ description: i.desc, newCategory: targets[s.ruleId] || s.target, count: i.count }))), [sections, off, targets]);
  const buys = chosen.reduce((n, c) => n + c.count, 0);

  return (
    <div className="fixed inset-0 z-[250] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md animate-in fade-in duration-150" onClick={onClose} data-testid="fix-sheet">
      <div role="dialog" aria-modal="true" aria-labelledby="fix-title" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-xl max-h-[92dvh] flex flex-col bg-[#0c0c0e] border border-luxury-gold/30 rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl">
        <div className="flex items-start gap-3 p-5 sm:p-6 border-b border-white/5">
          <div className="shrink-0 w-10 h-10 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold flex items-center justify-center"><Tags className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <h3 id="fix-title" className="text-lg font-serif text-white tracking-tight">Categorias que parecem erradas</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Confira, troque o destino se quiser e aplique. Nada muda antes de você aplicar.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-6">
          {sections.map(s => (
            <section key={s.ruleId} data-testid="fix-section" data-rule={s.ruleId}>
              <div className="px-1">
                <h4 className="text-sm font-semibold text-zinc-100">{s.title}</h4>
                <p className="text-xs text-zinc-500 mt-0.5">{s.note}</p>
              </div>
              <div className="mt-2.5">
                <span className="block text-xs font-semibold text-zinc-400 mb-1.5 px-1">Mover para</span>
                <CategoryTargetPicker value={targetOf(s)} categories={categories} testId="fix-target"
                  onPick={c => setTargets(prev => ({ ...prev, [s.ruleId]: c }))} />
              </div>
              <ul className="mt-2.5 space-y-2">
                {s.items.map(i => {
                  const on = !off[keyOf(s, i.desc)];
                  return (
                    <li key={i.desc}>
                      <label className={`flex items-start gap-3 rounded-2xl border p-3 cursor-pointer transition-colors ${on ? 'border-luxury-gold/30 bg-luxury-gold/[0.04]' : 'border-white/5 bg-white/[0.02] opacity-70'}`} data-testid="fix-row">
                        <input type="checkbox" checked={on} onChange={e => setOff(prev => ({ ...prev, [keyOf(s, i.desc)]: !e.target.checked }))}
                          aria-label={`Mover ${titleCase(i.desc)}`} className="mt-0.5 w-5 h-5 shrink-0 accent-[#D4AF37]" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-zinc-100 leading-snug break-words">{titleCase(i.desc)}</span>
                          <span className="block text-xs text-zinc-500 mt-0.5 break-words">{plural(i.count, 'compra', 'compras')} · hoje em {i.from.join(', ')}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <div className="p-4 sm:p-5 border-t border-white/5 space-y-3">
          <p className="text-xs text-zinc-400 text-center" data-testid="fix-summary">
            {chosen.length === 0 ? 'Marque pelo menos 1 item.' : `${plural(chosen.length, 'item', 'itens')} · ${plural(buys, 'compra', 'compras')} mudam de categoria`}
          </p>
          <div className="flex gap-3">
            <button type="button" disabled={chosen.length === 0} data-testid="fix-apply"
              onClick={() => { onApply(chosen.map(c => ({ description: c.description, newCategory: c.newCategory }))); onClose(); }}
              className="flex-1 py-4 rounded-xl font-bold text-[11px] uppercase tracking-[0.08em] bg-luxury-gold text-black hover:bg-white transition-colors disabled:opacity-40 disabled:hover:bg-luxury-gold">
              {chosen.length === 0 ? 'Mover' : `Mover ${plural(chosen.length, 'item', 'itens')}`}
            </button>
            <button type="button" onClick={onClose} className="w-28 sm:w-36 py-4 rounded-xl bg-white/5 border border-white/10 text-zinc-300 font-bold text-[11px] uppercase tracking-[0.08em] hover:bg-white/10 transition-colors">
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CategoryFixSheet;
