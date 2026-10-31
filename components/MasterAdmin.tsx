import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Download, FileSpreadsheet, Inbox, Loader2, ShieldCheck, Upload, X } from 'lucide-react';
import { Establishment, MasterProduct, TaxonomyNode } from '../types';
import { codesOf, normStoreKey } from '../services/productCodes';
import { useMasterInfo } from './MasterContext';
import { useLayers } from './LayersContext';
import { MasterDiff, MasterSheetError, ParsedMaster, SheetProduct, diffStructure, downloadMasterWorkbook, parseMasterWorkbook } from '../services/masterSheet';
import {
  TaxSuggestion, fetchAllMasterProducts, fetchPendingSuggestions, masterIndex, publishMaster, publishStoreTypes, publishMasterStores, reviewSuggestion,
} from '../services/masterService';
import { leafFor } from '../services/categoryLayers';
import { properCase } from '../services/textFormat';

/* Tela do administrador: baixar a planilha, subir a nova, ver o que muda e publicar para todos; e responder às sugestões. */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const when = (iso: string | null) => { try { return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''; } catch { return ''; } };
const btn = 'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl text-[12.5px] font-bold active:opacity-80 disabled:opacity-40';

const MasterAdmin: React.FC<{ taxonomy: TaxonomyNode[]; masters: MasterProduct[]; establishments: Establishment[]; onToast?: (m: string) => void }> = ({ taxonomy, masters, establishments, onToast }) => {
  const info = useMasterInfo();
  const layers = useLayers();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'' | 'export' | 'read' | 'publish'>('');
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<{ file: string; data: ParsedMaster; diff: MasterDiff } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [sugs, setSugs] = useState<TaxSuggestion[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);

  const loadSugs = useCallback(async () => {
    try { setSugs(await fetchPendingSuggestions()); await info.refreshPending(); } catch (e: any) { setError(e?.message || 'Não consegui ler as sugestões.'); }
  }, [info.refreshPending]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadSugs(); }, [loadSugs]);

  const currentNodes = info.master?.nodes ?? taxonomy;

  const exportSheet = async () => {
    setBusy('export'); setError('');
    try {
      const ix = info.master ? masterIndex(info.master) : null;
      const rows = await fetchAllMasterProducts();
      const out = new Map<string, SheetProduct>();
      rows.forEach(r => {
        const nodePath = r.node_id && ix ? ix.path.get(r.node_id) : undefined;
        const legacy = (r.category || '').split(' - ').map(x => properCase(x)).filter(Boolean).slice(0, 2);
        out.set(r.code, { code: r.code, description: r.description, unit: r.unit_type || undefined, path: nodePath && nodePath.length ? nodePath : legacy });
      });
      // produtos do seu cadastro (com os códigos que o app já aprendeu dos cupons)
      const storeName = (key: string) => {
        const e = establishments.find(x => normStoreKey(x.cnpj) === key || normStoreKey(x.originalName) === key);
        return e ? (e.aliasName || e.originalName) : key.startsWith('n:') ? key.slice(2) : '';
      };
      const addCodes = (p: SheetProduct, eans: string[], stores: [string, string[]][]) => {
        const e = new Set([...(p.eans || []), ...eans]);
        p.eans = [...e];
        const st = [...(p.stores || [])];
        stores.forEach(([key, cs]) => cs.forEach(c => { if (!st.some(x => x.key === key && x.code === c)) st.push({ key, name: storeName(key), code: c }); }));
        p.stores = st;
      };
      masters.forEach(m => {
        let p = out.get(m.code);
        if (!p) {
          const base = (m.category || '').split(' - ').map(x => x.trim()).filter(Boolean).slice(0, 2);
          const leaf = leafFor(layers, m.category, m.description);
          const extra = leaf ? (leaf.rest ? [leaf.group] : leaf.level === 4 ? [leaf.group, leaf.label] : [leaf.label]) : [];
          p = { code: m.code, description: m.description, unit: m.unitType, path: [...base, ...extra] };
          out.set(m.code, p);
        }
        addCodes(p, m.eans || [], Object.entries((m.establishmentCodes || {}) as Record<string, string | string[]>).map(([k, v]) => [k, codesOf(v)] as [string, string[]]));
      });
      // códigos já publicados na tabela mãe
      (info.master?.codes || []).forEach(c => {
        const p = out.get(c.master);
        if (!p) return;
        if (c.kind === 'ean') addCodes(p, [c.code], []); else addCodes(p, [], [[c.storeKey, [c.code]]]);
      });
      downloadMasterWorkbook(currentNodes, [...out.values()], undefined, info.master?.storeTypes || [], info.master?.stores || []);
      onToast?.(`Planilha gerada: ${plural(out.size, 'produto', 'produtos')}, com os códigos de barras e das lojas.`);
    } catch (e: any) { setError(e?.message || 'Não consegui gerar a planilha.'); }
    finally { setBusy(''); }
  };

  const readSheet = async (file: File) => {
    setBusy('read'); setError(''); setParsed(null); setConfirm(false);
    try {
      const data = await parseMasterWorkbook(file);
      setParsed({ file: file.name, data, diff: diffStructure(currentNodes, data.payload.nodes) });
    } catch (e: any) { setError(e instanceof MasterSheetError ? e.message : 'Não consegui ler essa planilha.'); }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  };

  const publish = async () => {
    if (!parsed || parsed.data.errors.length) return;
    setBusy('publish'); setError('');
    try {
      const res = await publishMaster(parsed.data.payload);
      const types = parsed.data.payload.storeTypes;
      if (types && types.length) await publishStoreTypes(types);
      const lojas = parsed.data.payload.stores;
      if (lojas && lojas.length) await publishMasterStores(lojas);
      await info.syncNow(true);
      onToast?.(`Publicado (versão ${res.version}): ${plural(res.nodes_added, 'categoria nova', 'categorias novas')}, ${plural(res.products, 'produto', 'produtos')}.`);
      setParsed(null); setConfirm(false);
    } catch (e: any) { setError(e?.message || 'Não consegui publicar.'); }
    finally { setBusy(''); }
  };

  const review = async (s: TaxSuggestion, approve: boolean) => {
    setWorking(s.id); setError('');
    try {
      await reviewSuggestion(s.id, approve, approve ? names[s.id] : undefined);
      if (approve) await info.syncNow(true);
      await loadSugs();
      onToast?.(approve ? 'Etiqueta aprovada e publicada.' : 'Sugestão recusada.');
    } catch (e: any) { setError(e?.message || 'Não consegui concluir.'); }
    finally { setWorking(null); }
  };

  const nodeCount = info.master?.nodes.length ?? 0;
  const prodCount = info.master?.products.length ?? 0;
  const bad = useMemo(() => !!parsed && parsed.data.errors.length > 0, [parsed]);

  return (
    <div className="space-y-6" data-testid="madmin">
      <div className="bg-black/40 border border-white/5 rounded-[2.5rem] p-5 sm:p-8 shadow-2xl">
        <h3 className="text-lg sm:text-xl font-serif text-white uppercase tracking-tight flex items-center gap-3"><ShieldCheck className="w-5 h-5 text-luxury-gold shrink-0" /> Tabela mãe</h3>
        <p className="text-zinc-400 text-xs mt-1.5 leading-snug" data-testid="madmin-status">
          {info.active
            ? `Versão ${info.version}${info.publishedAt ? `, publicada em ${when(info.publishedAt)}` : ''} · ${plural(nodeCount, 'categoria', 'categorias')} · ${plural(prodCount, 'produto mapeado', 'produtos mapeados')}.`
            : 'Ainda não publicada: cada conta usa a própria estrutura. Baixe a planilha, ajuste e publique.'}
        </p>

        <ol className="mt-5 space-y-3 text-[13px] text-zinc-300">
          <li className="flex gap-3"><span className="shrink-0 w-6 h-6 rounded-full border border-luxury-gold/50 text-luxury-gold text-xs font-bold flex items-center justify-center">1</span>
            <span className="min-w-0 flex-1">Baixe a planilha com a estrutura e todos os produtos já conhecidos (de todos os usuários).</span></li>
          <li className="flex gap-3"><span className="shrink-0 w-6 h-6 rounded-full border border-luxury-gold/50 text-luxury-gold text-xs font-bold flex items-center justify-center">2</span>
            <span className="min-w-0 flex-1">Ajuste no Excel: categorias na aba Estrutura e onde cada produto fica na aba Produtos.</span></li>
          <li className="flex gap-3"><span className="shrink-0 w-6 h-6 rounded-full border border-luxury-gold/50 text-luxury-gold text-xs font-bold flex items-center justify-center">3</span>
            <span className="min-w-0 flex-1">Suba a planilha, confira o que muda e publique. Todos os apps se ajustam sozinhos.</span></li>
        </ol>

        <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
          <button type="button" onClick={exportSheet} disabled={!!busy} data-testid="madmin-export" className={`${btn} flex-1 bg-white/5 border border-white/10 text-zinc-100`}>
            {busy === 'export' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 text-luxury-gold" />} Baixar planilha atual
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy} data-testid="madmin-pick" className={`${btn} flex-1 bg-luxury-gold text-black`}>
            {busy === 'read' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Subir planilha (.xlsx)
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" data-testid="madmin-file" onChange={e => { const f = e.target.files?.[0]; if (f) void readSheet(f); }} />
        </div>
        {error && <p className="mt-3 text-xs text-red-400 leading-snug" data-testid="madmin-error" role="alert">{error}</p>}
      </div>

      {parsed && (
        <div className="bg-black/40 border border-luxury-gold/30 rounded-[2.5rem] p-5 sm:p-8 shadow-2xl" data-testid="madmin-preview">
          <h4 className="text-base font-semibold text-zinc-100 flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-luxury-gold" /> {parsed.file}</h4>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
            {[
              ['Categorias na planilha', parsed.data.counts.nodes], ['Novas', parsed.diff.added.length],
              ['Saem da estrutura', parsed.diff.removed.length], ['Produtos', parsed.data.counts.products],
              ['Produtos sem categoria', parsed.data.counts.unmapped], ['Mantidas', parsed.diff.kept],
              ['Códigos de barras', parsed.data.counts.eans], ['Códigos de loja', parsed.data.counts.storeCodes],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2">
                <dt className="text-zinc-500 text-[11px]">{k}</dt><dd className="text-zinc-100 font-semibold tabular-nums text-sm" data-testid={`madmin-count-${String(k).split(' ')[0].toLowerCase()}`}>{v}</dd>
              </div>
            ))}
          </dl>

          {parsed.data.errors.length > 0 && (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-3" data-testid="madmin-errors">
              <p className="text-xs font-semibold text-red-300 flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> Corrija na planilha antes de publicar</p>
              <ul className="mt-1.5 text-xs text-zinc-300 space-y-1 list-disc pl-4">{parsed.data.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
          {parsed.diff.removed.length > 0 && (
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3" data-testid="madmin-removed">
              <p className="text-xs font-semibold text-amber-300 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {plural(parsed.diff.removed.length, 'caminho sai', 'caminhos saem')} da estrutura de todos</p>
              <ul className="mt-1.5 text-xs text-zinc-300 space-y-0.5">{parsed.diff.removed.slice(0, 8).map((e, i) => <li key={i} className="break-words">{e}</li>)}{parsed.diff.removed.length > 8 && <li className="text-zinc-500">e mais {parsed.diff.removed.length - 8}…</li>}</ul>
            </div>
          )}
          {parsed.data.warnings.length > 0 && (
            <details className="mt-3 text-xs text-zinc-400">
              <summary className="cursor-pointer min-h-[32px] flex items-center" data-testid="madmin-warnings">{plural(parsed.data.warnings.length, 'aviso', 'avisos')}</summary>
              <ul className="mt-1 space-y-1 list-disc pl-4">{parsed.data.warnings.slice(0, 15).map((e, i) => <li key={i} className="break-words">{e}</li>)}</ul>
            </details>
          )}

          <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
            {!confirm ? (
              <button type="button" disabled={bad || !!busy} onClick={() => setConfirm(true)} data-testid="madmin-publish" className={`${btn} flex-1 bg-luxury-gold text-black`}>Publicar para todos</button>
            ) : (
              <button type="button" disabled={bad || !!busy} onClick={publish} data-testid="madmin-confirm" className={`${btn} flex-1 bg-red-600 text-white`}>
                {busy === 'publish' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Confirmar: troca a estrutura de todos os usuários
              </button>
            )}
            <button type="button" onClick={() => { setParsed(null); setConfirm(false); }} className={`${btn} sm:w-36 bg-white/5 border border-white/10 text-zinc-300`}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="bg-black/40 border border-white/5 rounded-[2.5rem] p-5 sm:p-8 shadow-2xl" data-testid="madmin-suggestions">
        <h4 className="text-base font-semibold text-zinc-100 flex items-center gap-2"><Inbox className="w-4 h-4 text-luxury-gold" /> Sugestões dos usuários {sugs.length > 0 && <span className="min-w-[1.4rem] px-1.5 py-0.5 rounded-full bg-luxury-gold text-black text-[11px] font-bold leading-none text-center">{sugs.length}</span>}</h4>
        {sugs.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500">Nenhuma sugestão esperando. Quando um usuário sugerir uma etiqueta nova, ela aparece aqui.</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {sugs.map(s => (
              <li key={s.id} className="rounded-2xl border border-white/5 bg-white/[0.02] p-3.5" data-testid="madmin-sug">
                <p className="text-[12px] text-zinc-400 break-words">{s.parent_path.join(' › ')} ›</p>
                <input value={names[s.id] ?? s.name} onChange={e => setNames(p => ({ ...p, [s.id]: e.target.value }))} aria-label="Nome da etiqueta" data-testid="madmin-sug-name"
                  className="mt-1 w-full h-10 rounded-lg bg-black/60 border border-white/10 px-3 text-sm text-zinc-100 focus:border-luxury-gold/40 outline-none" />
                {s.product_description && <p className="mt-1.5 text-[11.5px] text-zinc-500 break-words">Para o produto: {s.product_description}{s.product_code ? ` (código ${s.product_code})` : ''}</p>}
                <p className="mt-0.5 text-[11px] text-zinc-600">{when(s.created_at)}</p>
                <div className="mt-2.5 flex gap-2">
                  <button type="button" disabled={working === s.id} onClick={() => review(s, true)} data-testid="madmin-approve" className={`${btn} flex-1 h-10 bg-luxury-gold text-black`}>{working === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Aprovar</button>
                  <button type="button" disabled={working === s.id} onClick={() => review(s, false)} data-testid="madmin-reject" className={`${btn} flex-1 h-10 bg-white/5 border border-white/10 text-zinc-300`}>Recusar</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default MasterAdmin;
