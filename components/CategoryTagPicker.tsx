import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { CompareOption, deptId } from '../services/categoryCompare';
import { isSelectable } from '../services/categoryPick';

/* Escolher a categoria por etiquetas, uma linha por camada: departamento → categoria → grupo → item.
   Cada linha mostra TODAS as etiquetas daquela camada (sem rolagem): o que já está no caminho do item fica em dourado, a
   escolha de agora cheia, e o resto em cinza. Tocar numa etiqueta aplica e abre a camada de baixo; tocar de novo numa
   camada de cima volta para ela. Nos grupos e itens dá para criar uma etiqueta nova (entra na Estrutura de Taxonomia).
   O resultado é o mesmo da escolha pela árvore de pastas. */

interface Props {
  options: CompareOption[];
  /** id da escolha de agora (departamento, categoria, grupo ou item) */
  selectedId: string;
  onChoose: (id: string) => void;
  /** cria uma etiqueta dentro de `parentId` ('c:...' → grupo, 'g:...' → item); devolve o id dela. Sem isto, não há "Nova etiqueta". */
  onCreate?: (parentId: string, name: string) => string | null;
  testId?: string;
}

const CAPTION = ['Departamento', 'Categoria', 'Grupo', 'Item'];
const chipBase = 'inline-flex items-center gap-1 min-h-[38px] px-3.5 rounded-full border text-[13px] font-semibold leading-tight text-left active:opacity-80 transition-colors max-w-full';
const chipState = {
  applied: 'bg-luxury-gold text-black border-luxury-gold',
  path: 'border-luxury-gold/60 text-luxury-gold bg-luxury-gold/10',
  idle: 'border-white/10 text-zinc-400 bg-transparent',
} as const;

const CategoryTagPicker: React.FC<Props> = ({ options, selectedId, onChoose, onCreate, testId = 'tag-picker' }) => {
  const byId = useMemo(() => new Map(options.map(o => [o.id, o] as const)), [options]);
  const kids = useMemo(() => {
    const m = new Map<string, CompareOption[]>();
    options.forEach(o => {
      if (o.kind === 'rest') return;
      const p = o.parent ?? (o.kind === 'cat' ? deptId(o.dept) : null);
      const k = p && byId.has(p) ? p : '';
      const arr = m.get(k);
      if (arr) arr.push(o); else m.set(k, [o]);
    });
    m.forEach(arr => arr.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')));
    return m;
  }, [options, byId]);

  // de quem a escolha de agora descende (do departamento até ela)
  const chain = useMemo(() => {
    const out: string[] = [];
    let cur = byId.get(selectedId);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      out.unshift(cur.id); seen.add(cur.id);
      const p = cur.parent ?? (cur.kind === 'cat' ? deptId(cur.dept) : null);
      cur = p ? byId.get(p) : undefined;
    }
    return out;
  }, [byId, selectedId]);
  const chainKey = chain.join('|');

  // o caminho que está aberto na tela (começa igual à escolha de agora; tocar num departamento sem escolher mexe só nele)
  const [path, setPath] = useState<string[]>(chain);
  useEffect(() => { setPath(chain); }, [chainKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // etiqueta recém-criada: espera ela aparecer na lista (a Estrutura recalcula) e então escolhe
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    if (pending && byId.has(pending)) { const id = pending; setPending(null); onChoose(id); }
  }, [pending, byId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ao descer uma camada, a linha nova vem para a vista (com todos os departamentos a lista fica comprida)
  const lastRow = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => lastRow.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }), 80);
    return () => clearTimeout(t);
  }, [path.length]);

  const [adding, setAdding] = useState<number | null>(null);
  const [name, setName] = useState('');
  const closeAdd = () => { setAdding(null); setName(''); };

  const rows: { d: number; parent: string; sibs: CompareOption[]; canNew: boolean; parentLabel: string }[] = [];
  for (let d = 0; d <= path.length && d < 4; d++) {
    const parent = d === 0 ? '' : path[d - 1];
    const pNode = parent ? byId.get(parent) : undefined;
    if (d > 0 && !pNode) break;
    const sibs = kids.get(parent) || [];
    const canNew = !!onCreate && !!pNode && (pNode.kind === 'cat' || pNode.kind === 'grp');
    if (sibs.length === 0 && !canNew) break;
    rows.push({ d, parent, sibs, canNew, parentLabel: pNode?.label || '' });
  }

  const tap = (o: CompareOption, d: number) => {
    const np = [...path.slice(0, d), o.id];
    setPath(np);
    closeAdd();
    if (o.id === selectedId) return;
    if (isSelectable(o, (kids.get(o.id) || []).length)) onChoose(o.id);
  };

  const create = (parent: string, d: number) => {
    const id = onCreate?.(parent, name);
    if (!id) return;
    setPath([...path.slice(0, d), id]);
    closeAdd();
    setPending(id);
  };

  const last = path.length ? byId.get(path[path.length - 1]) : undefined;
  const needMore = !!last && !isSelectable(last, (kids.get(last.id) || []).length);

  return (
    <div data-testid={testId} className="space-y-2.5">
      {rows.map(({ d, parent, sibs, canNew, parentLabel }) => (
        <div key={d} ref={d === rows.length - 1 ? lastRow : undefined} data-testid={`${testId}-row`} data-level={d + 1}
          className={d > 0 ? 'pl-3 border-l border-luxury-gold/25' : ''} style={d > 1 ? { marginLeft: (d - 1) * 8 } : undefined}>
          <span className="block text-[11px] text-zinc-500 mb-1.5">{CAPTION[d]}</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={CAPTION[d]}>
            {sibs.map(o => {
              const state = o.id === selectedId ? 'applied' : path.includes(o.id) ? 'path' : 'idle';
              const sub = (kids.get(o.id) || []).length;
              return (
                <button key={o.id} type="button" onClick={() => tap(o, d)} data-testid={`${testId}-chip`} data-id={o.id} data-state={state}
                  aria-pressed={state === 'applied'} className={`${chipBase} ${chipState[state]}`}>
                  {state === 'applied' ? <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={3} /> : null}
                  <span className="break-words">{o.label}</span>
                </button>
              );
            })}
            {canNew && adding !== d && (
              <button type="button" onClick={() => { setAdding(d); setName(''); }} data-testid={`${testId}-new`}
                aria-label={`Criar ${d === 2 ? 'grupo' : 'item'} em ${parentLabel}`}
                className={`${chipBase} border-dashed border-luxury-gold/50 text-luxury-gold`}>
                <Plus className="w-3.5 h-3.5 shrink-0" /> Nova etiqueta
              </button>
            )}
            {canNew && adding === d && (
              <form className="flex items-center gap-1.5 w-full" data-testid={`${testId}-new-form`}
                onSubmit={e => { e.preventDefault(); create(parent, d); }}>
                <input autoFocus value={name} onChange={e => setName(e.target.value)} data-testid={`${testId}-new-input`}
                  placeholder={d === 2 ? `Novo grupo em ${parentLabel}` : `Novo item em ${parentLabel}`} maxLength={60}
                  className="min-w-0 flex-1 h-10 rounded-full bg-white/5 border border-luxury-gold/40 px-4 text-[13px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none" />
                <button type="submit" disabled={!name.trim()} data-testid={`${testId}-new-save`}
                  className="shrink-0 h-10 px-4 rounded-full bg-luxury-gold text-black text-[12.5px] font-bold disabled:opacity-40 active:opacity-80">Criar</button>
                <button type="button" onClick={closeAdd} aria-label="Cancelar" data-testid={`${testId}-new-cancel`}
                  className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full border border-white/10 text-zinc-400"><X className="w-4 h-4" /></button>
              </form>
            )}
          </div>
        </div>
      ))}
      {needMore && last && (
        <p className="text-[11.5px] text-zinc-500 leading-snug" data-testid={`${testId}-more`}>Escolha uma categoria de {last.label} para aplicar.</p>
      )}
    </div>
  );
};

export default CategoryTagPicker;
