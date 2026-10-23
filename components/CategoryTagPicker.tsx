import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { CompareOption } from '../services/categoryCompare';
import { isSelectable } from '../services/categoryPick';

/* Escolher a categoria por etiquetas, camada por camada: departamento → categoria → grupo → item.
   Tocar numa etiqueta que tem divisões abaixo mostra as etiquetas da camada seguinte (o caminho fica em cima, e dá para
   voltar tocando nele); tocar numa que não tem mais nada abaixo escolhe na hora. Em qualquer camada dá para escolher ali
   mesmo ("Usar …"), sem descer até o fim. O resultado é o mesmo da escolha pela árvore de pastas. */

interface Props {
  options: CompareOption[];
  /** id da escolha de agora (departamento, categoria, grupo ou item) */
  selectedId: string;
  onChoose: (id: string) => void;
  testId?: string;
}

const chip = 'inline-flex items-center gap-1 min-h-[38px] px-3.5 rounded-full border text-[13px] font-semibold leading-tight text-left active:opacity-80 transition-colors max-w-full';

const CategoryTagPicker: React.FC<Props> = ({ options, selectedId, onChoose, testId = 'tag-picker' }) => {
  const byId = useMemo(() => new Map(options.map(o => [o.id, o] as const)), [options]);
  const kids = useMemo(() => {
    const m = new Map<string, CompareOption[]>();
    options.forEach(o => {
      if (o.kind === 'rest') return;
      const k = o.parent ?? '';
      const arr = m.get(k);
      if (arr) arr.push(o); else m.set(k, [o]);
    });
    m.forEach(arr => arr.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')));
    return m;
  }, [options]);

  // de quem a escolha de agora descende (do departamento até ela)
  const chain = useMemo(() => {
    const out: string[] = [];
    let cur = byId.get(selectedId);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) { out.unshift(cur.id); seen.add(cur.id); cur = cur.parent ? byId.get(cur.parent) : undefined; }
    return out;
  }, [byId, selectedId]);

  // camadas abertas em cima (sem a escolha em si): as etiquetas mostradas são as irmãs dela, com a escolha marcada
  const [open, setOpen] = useState<string[]>(() => chain.slice(0, -1));
  useEffect(() => { setOpen(chain.slice(0, -1)); }, [chain]);

  const parentId = open.length ? open[open.length - 1] : '';
  const shown = kids.get(parentId) || [];
  const head = parentId ? byId.get(parentId) : undefined;
  const headKids = head ? (kids.get(head.id) || []).length : 0;
  const canUseHead = !!head && isSelectable(head, headKids);

  const tap = (o: CompareOption) => {
    const sub = kids.get(o.id) || [];
    if (sub.length > 0) setOpen([...open, o.id]);
    else onChoose(o.id);
  };

  return (
    <div data-testid={testId} className="space-y-2">
      {open.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" data-testid={`${testId}-crumbs`}>
          <button type="button" onClick={() => setOpen([])} data-testid={`${testId}-root`}
            className="h-8 px-2.5 rounded-full text-[12px] font-semibold text-zinc-400 border border-white/10 active:opacity-80">Início</button>
          {open.map((id, i) => {
            const o = byId.get(id);
            if (!o) return null;
            return (
              <React.Fragment key={id}>
                <ChevronRight className="w-3 h-3 text-luxury-gold/70 shrink-0" aria-hidden />
                <button type="button" onClick={() => setOpen(open.slice(0, i))} data-testid={`${testId}-crumb`}
                  className="h-8 px-2.5 rounded-full text-[12px] font-semibold text-zinc-200 border border-white/15 bg-white/5 active:opacity-80 max-w-[11rem] truncate">{o.label}</button>
              </React.Fragment>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 max-h-[13.5rem] overflow-y-auto pr-0.5" role="group" aria-label="Escolha uma etiqueta" data-testid={`${testId}-chips`}>
        {canUseHead && head && (
          <button type="button" onClick={() => onChoose(head.id)} data-testid={`${testId}-use`}
            className={`${chip} ${selectedId === head.id ? 'bg-luxury-gold text-black border-luxury-gold' : 'border-dashed border-luxury-gold/60 text-luxury-gold'}`}>
            {selectedId === head.id ? <Check className="w-3.5 h-3.5 shrink-0" /> : null}
            <span className="truncate">Usar {head.label}</span>
          </button>
        )}
        {shown.map(o => {
          const sub = (kids.get(o.id) || []).length;
          const picked = o.id === selectedId;
          const onPath = chain.includes(o.id) && !picked;
          return (
            <button key={o.id} type="button" onClick={() => tap(o)} data-testid={`${testId}-chip`} data-id={o.id} aria-pressed={picked}
              className={`${chip} ${picked ? 'bg-luxury-gold text-black border-luxury-gold' : onPath ? 'border-luxury-gold/70 text-zinc-100 bg-luxury-gold/10' : 'border-white/10 text-zinc-200 bg-white/[0.03]'}`}>
              {picked ? <Check className="w-3.5 h-3.5 shrink-0" /> : null}
              <span className="break-words">{o.label}</span>
              {sub > 0 && <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-60" aria-hidden />}
            </button>
          );
        })}
        {shown.length === 0 && <p className="text-[12px] text-zinc-500 px-1 py-2">Nada mais abaixo.</p>}
      </div>
    </div>
  );
};

export default CategoryTagPicker;
