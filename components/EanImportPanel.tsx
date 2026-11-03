import React, { useRef, useState } from 'react';
import { Barcode, Loader2, Upload } from 'lucide-react';
import { buildPreview, EanPreview } from '../services/eanImport';
import { callRpc } from '../services/masterService';

const BATCH = 400;

/** Importa o catálogo de EAN (CSV dos fabricantes): confere tudo, mostra o resultado e só então envia ao Supabase em partes. */
const EanImportPanel: React.FC<{ onToast?: (m: string) => void }> = ({ onToast }) => {
  const ref = useRef<HTMLInputElement>(null);
  const [prev, setPrev] = useState<EanPreview | null>(null);
  const [busy, setBusy] = useState<'read' | 'send' | ''>('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy('read'); setError(''); setPrev(null);
    try {
      const list = await Promise.all(Array.from(files).map(async f => ({ name: f.name, text: await f.text() })));
      setPrev(buildPreview(list));
    } catch (e: any) { setError(e?.message || 'Não consegui ler os arquivos.'); }
    finally { setBusy(''); if (ref.current) ref.current.value = ''; }
  };

  const send = async () => {
    if (!prev) return;
    setBusy('send'); setError('');
    try {
      let created = 0;
      for (let i = 0; i < prev.catalog.length; i += BATCH) {
        setProgress(`Catálogo ${Math.min(i + BATCH, prev.catalog.length)} de ${prev.catalog.length}…`);
        const r = await callRpc('ean_import_batch', { p: prev.catalog.slice(i, i + BATCH) });
        created += Number(r?.new || 0);
      }
      for (let i = 0; i < prev.rejects.length; i += 1000) {
        setProgress('Rejeitados…');
        await callRpc('ean_reject_batch', { p: prev.rejects.slice(i, i + 1000) });
      }
      onToast?.(`Catálogo de EAN: ${created} códigos novos, ${prev.catalog.length - created} já existiam.`);
      setPrev(null);
    } catch (e: any) { setError(e?.message || 'O envio falhou. Pode repetir: nada é duplicado.'); }
    finally { setBusy(''); setProgress(''); }
  };

  const src = (prev ? Object.entries(prev.perSource) : []) as [string, { rows: number; ok: number; fixed: number; rejected: number }][];
  return (
    <div className="bg-black/40 border border-white/5 rounded-[2.5rem] p-5 sm:p-8 shadow-2xl" data-testid="ean-import">
      <h3 className="text-lg sm:text-xl font-serif text-white uppercase tracking-tight flex items-center gap-3"><Barcode className="w-5 h-5 text-luxury-gold shrink-0" /> Catálogo de EAN</h3>
      <p className="text-zinc-400 text-xs mt-1.5 leading-snug">Escolha os CSV dos fabricantes (DPCNet, Dispan, Tirol). O app confere o dígito verificador de cada código antes de enviar; o que não passa fica separado para revisão.</p>
      <input ref={ref} type="file" accept=".csv,text/csv" multiple className="hidden" onChange={e => pick(e.target.files)} data-testid="ean-file" />
      <button type="button" onClick={() => ref.current?.click()} disabled={!!busy} className="mt-4 h-11 px-5 rounded-xl border border-white/10 text-zinc-200 text-sm font-semibold flex items-center gap-2 hover:border-luxury-gold/40">
        {busy === 'read' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Escolher CSV
      </button>
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      {prev && (
        <div className="mt-4 text-[13px] text-zinc-300 space-y-2" data-testid="ean-preview">
          <p><strong className="text-white">{prev.catalog.length.toLocaleString('pt-BR')}</strong> códigos válidos e únicos · {prev.withSize.toLocaleString('pt-BR')} com tamanho da embalagem lido da descrição · {prev.rejects.length.toLocaleString('pt-BR')} rejeitados · {prev.conflicts} com descrições diferentes entre fontes (vale a do fabricante de maior prioridade).</p>
          <ul className="text-xs text-zinc-400 space-y-0.5">
            {src.map(([k, v]) => <li key={k}>{k}: {v.rows.toLocaleString('pt-BR')} linhas, {v.ok.toLocaleString('pt-BR')} válidas{v.fixed ? ` (${v.fixed} com zero da frente completado)` : ''}, {v.rejected} rejeitadas</li>)}
            {prev.skipped.map(s => <li key={s} className="text-amber-500">{s}</li>)}
          </ul>
          <button type="button" onClick={send} disabled={busy === 'send'} data-testid="ean-send" className="h-11 px-5 rounded-xl bg-luxury-gold text-black text-sm font-bold flex items-center gap-2">
            {busy === 'send' ? <><Loader2 className="w-4 h-4 animate-spin" /> {progress}</> : 'Enviar ao catálogo'}
          </button>
        </div>
      )}
    </div>
  );
};
export default EanImportPanel;
