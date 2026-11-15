import React, { useEffect, useRef, useState } from 'react';
import { Camera, X, Sparkles } from 'lucide-react';
import { MAX_PHOTOS, ProductDraft, emptyDraft, readProductPhotos, shrinkPhoto, submitProduct } from '../services/productPhotoAI';
import { gtinValid } from '../services/productCodes';
import { barcodeFromPhoto } from '../services/barcodeScan';
import { Sheet } from './ShoppingSheets';
import { QueuedProduct, queueList, queueRemove, queueSave } from '../services/photoQueue';

/* Cadastrar produto por fotos (até 3): frente, verso/tabela e código de barras. A IA preenche; a pessoa confere. */

interface Props { initialCode?: string; onClose: () => void; onSaved: (code: string, name: string) => void }
interface Photo { b64: string; mime: string; url: string }

const PACKS = ['garrafa', 'lata', 'caixa', 'pacote', 'saco', 'pote', 'frasco', 'bandeja', 'sachê', 'tubo', 'pet', 'vidro', 'outro'];
const UNITS = ['g', 'kg', 'ml', 'l', 'un'];

const ProductPhotoSheet: React.FC<Props> = ({ initialCode = '', onClose, onSaved }) => {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [d, setD] = useState<ProductDraft>({ ...emptyDraft(), barcode: initialCode });
  const [busy, setBusy] = useState(false);
  const [read, setRead] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const localCode = useRef('');
  const slot = useRef<number | null>(null);          // foto que está sendo trocada (null = acrescentar)
  const qid = useRef('q' + Date.now().toString(36));  // este cadastro na fila de pendentes
  const [pending, setPending] = useState<QueuedProduct[]>([]);
  const [failed, setFailed] = useState(false);
  const toPhoto = (q: { b64: string; mime: string }): Photo => ({ ...q, url: `data:${q.mime};base64,${q.b64}` });

  useEffect(() => { void queueList().then(l => setPending(l.filter(x => x.id !== qid.current))); }, []);
  // guarda as fotos no aparelho assim que existirem; some da fila quando a leitura der certo ou a pessoa tirar todas
  useEffect(() => {
    if (photos.length === 0) { void queueRemove(qid.current); return; }
    if (!read || failed) void queueSave({ id: qid.current, photos: photos.map(p => ({ b64: p.b64, mime: p.mime })), barcode: localCode.current || d.barcode, at: Date.now(), error: failed ? msg : undefined });
  }, [photos, failed, read]);

  const resume = (q: QueuedProduct) => {
    void queueRemove(qid.current);
    qid.current = q.id; localCode.current = q.barcode || '';
    setPhotos(q.photos.map(toPhoto)); setD(x => ({ ...x, barcode: q.barcode || x.barcode })); setRead(false); setFailed(false); setMsg('');
    setPending(p => p.filter(x => x.id !== q.id));
  };
  const discard = (q: QueuedProduct) => { void queueRemove(q.id); setPending(p => p.filter(x => x.id !== q.id)); };
  const openCamera = (i: number | null) => { slot.current = i; fileRef.current?.click(); };

  const add = async (f?: File) => {
    const idx = slot.current; slot.current = null;
    if (!f || (idx === null && photos.length >= MAX_PHOTOS)) return;
    setMsg(''); setFailed(false); setRead(false);
    try {
      const p = await shrinkPhoto(f);
      setPhotos(a => (idx !== null && idx < a.length ? a.map((x, j) => (j === idx ? p : x)) : [...a, p]));
      // vai direto para a próxima foto até completar as três (só ao acrescentar, não ao trocar)
      if (idx === null && photos.length + 1 < MAX_PHOTOS) setTimeout(() => openCamera(null), 350);
      // o leitor do celular costuma ser mais certeiro que a IA nos dígitos do código
      const c = await barcodeFromPhoto(f);
      if (c) { localCode.current = c; setD(x => ({ ...x, barcode: c })); }
    } catch (e: any) { setMsg(e?.message || 'Não consegui usar essa foto.'); }
  };

  const analyse = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await readProductPhotos(photos);
      setD(x => ({ ...r, barcode: localCode.current || x.barcode || r.barcode }));
      setRead(true); setFailed(false); void queueRemove(qid.current);
    } catch (e: any) { setMsg((e?.message || 'A IA não conseguiu ler as fotos.') + ' As fotos ficaram guardadas neste aparelho: tente de novo depois ou preencha à mão.'); setRead(true); setFailed(true); }
    finally { setBusy(false); }
  };

  const set = (k: keyof ProductDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD(x => ({ ...x, [k]: e.target.value }));
  const codeOk = d.barcode.length >= 8 && gtinValid(d.barcode);
  const full = [d.name, d.variant, d.brand && `- ${d.brand}`, d.sizeValue && `${d.sizeValue}${d.sizeUnit}`, d.dimensions].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const canSave = codeOk && d.name.trim().length >= 2 && d.brand.trim().length >= 2;

  const save = async () => {
    setBusy(true);
    const ok = await submitProduct(d);
    setBusy(false);
    void queueRemove(qid.current);
    if (!ok) { setMsg('Não consegui enviar agora (sem internet ou sem login). Usei só neste aparelho.'); }
    onSaved(d.barcode, full);
  };

  const field = 'w-full h-11 mt-1 rounded-xl bg-white/5 border border-white/10 px-3 text-[14px] text-white outline-none focus:border-luxury-gold/60';
  return (
    <Sheet title="Cadastrar por fotos" subtitle={`até ${MAX_PHOTOS} fotos`} onClose={onClose} testId="photo-sheet" tall>
      <div className="px-4 pb-4">
        <p className="text-[13px] text-zinc-300">Fotografe a <b>frente</b>, o <b>verso</b> (peso, tabela) e o <b>código de barras</b>. A IA lê e você confere.</p>
        <div className="flex gap-2 mt-3">
          {photos.map((p, i) => (
            <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-white/10">
              <img src={p.url} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" onClick={() => { if (!read || failed) openCamera(i); }} />
              {(!read || failed) && <span className="absolute bottom-0 inset-x-0 text-center text-[9px] bg-black/60 text-white py-0.5 pointer-events-none">tocar p/ trocar</span>}
              <button type="button" aria-label="Remover foto" onClick={() => { setPhotos(a => a.filter((_, j) => j !== i)); setRead(false); setFailed(false); }} className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center"><X className="w-3.5 h-3.5 text-white" /></button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <button type="button" onClick={() => openCamera(null)} data-testid="photo-add" className="w-20 h-20 rounded-xl border border-dashed border-white/20 flex flex-col items-center justify-center text-zinc-400 text-[11px] gap-1"><Camera className="w-5 h-5" />Foto {photos.length + 1}/{MAX_PHOTOS}</button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { void add(e.target.files?.[0]); e.target.value = ''; }} />
        {photos.length > 0 && (!read || failed) && (
          <button type="button" onClick={analyse} disabled={busy} data-testid="photo-analyse" className="mt-3 w-full h-12 rounded-xl bg-luxury-gold text-black text-[14px] font-bold flex items-center justify-center gap-2 disabled:opacity-50"><Sparkles className="w-4 h-4" />{busy ? 'Lendo as fotos…' : failed ? 'Tentar ler de novo' : 'Ler com IA'}</button>
        )}
        {msg && <p className="text-[12px] text-amber-300 mt-2">{msg}</p>}
        {pending.length > 0 && photos.length === 0 && (
          <div className="mt-3 rounded-xl border border-white/10 p-2.5" data-testid="photo-pending">
            <p className="text-[12px] text-zinc-300 font-semibold">Fotos guardadas para ler depois ({pending.length})</p>
            {pending.map(q => (
              <div key={q.id} className="flex items-center gap-2 mt-2">
                <div className="flex gap-1">{q.photos.map((p, i) => <img key={i} src={`data:${p.mime};base64,${p.b64}`} alt="" className="w-10 h-10 rounded-lg object-cover" />)}</div>
                <span className="flex-1 text-[11px] text-zinc-500 truncate">{new Date(q.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{q.barcode ? ` · ${q.barcode}` : ''}</span>
                <button type="button" onClick={() => resume(q)} className="h-8 px-3 rounded-lg bg-luxury-gold/15 text-luxury-gold text-[12px] font-bold">Abrir</button>
                <button type="button" onClick={() => discard(q)} aria-label="Descartar" className="w-8 h-8 flex items-center justify-center text-zinc-500"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}

        {(read || photos.length === 0) && (
          <div className="mt-4 space-y-3">
            <label className="block"><span className="text-[11px] text-zinc-500">Código de barras</span>
              <input value={d.barcode} onChange={e => setD(x => ({ ...x, barcode: e.target.value.replace(/\D/g, '') }))} inputMode="numeric" className={field + ' tabular-nums'} data-testid="photo-code" />
              {d.barcode.length > 0 && !codeOk && <span className="text-[11px] text-red-400">Número inválido: confira os dígitos.</span>}
            </label>
            <label className="block"><span className="text-[11px] text-zinc-500">Marca</span><input value={d.brand} onChange={set('brand')} className={field} data-testid="photo-brand" /></label>
            <label className="block"><span className="text-[11px] text-zinc-500">Produto</span><input value={d.name} onChange={set('name')} className={field} data-testid="photo-name" /></label>
            <label className="block"><span className="text-[11px] text-zinc-500">Sabor / tipo (opcional)</span><input value={d.variant} onChange={set('variant')} className={field} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="text-[11px] text-zinc-500">Peso / volume</span><input value={d.sizeValue} onChange={set('sizeValue')} inputMode="decimal" className={field} data-testid="photo-size" /></label>
              <label className="block"><span className="text-[11px] text-zinc-500">Medida</span><select value={d.sizeUnit} onChange={set('sizeUnit')} className={field}>{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></label>
              <label className="block"><span className="text-[11px] text-zinc-500">Embalagem</span><input list="photo-packs" value={d.packaging} onChange={set('packaging')} className={field} data-testid="photo-pack" /><datalist id="photo-packs">{PACKS.map(p => <option key={p} value={p} />)}</datalist></label>
              <label className="block"><span className="text-[11px] text-zinc-500">Unidades no pacote</span><input value={d.units} onChange={e => setD(x => ({ ...x, units: e.target.value.replace(/\D/g, '') }))} inputMode="numeric" className={field} /></label>
            </div>
            <label className="block"><span className="text-[11px] text-zinc-500">Dimensões (ex.: 28 x 22 cm)</span><input value={d.dimensions} onChange={set('dimensions')} placeholder="largura x altura" className={field} data-testid="photo-dim" /></label>
            {full && <p className="text-[12px] text-zinc-400">Vai aparecer como: <span className="text-zinc-200">{full}</span></p>}
            <button type="button" onClick={save} disabled={!canSave || busy} data-testid="photo-save" className="w-full h-12 rounded-xl bg-luxury-gold text-black text-[14px] font-bold disabled:opacity-40">{busy ? 'Enviando…' : 'Salvar e enviar ao catálogo'}</button>
            <p className="text-[11px] text-zinc-500">O envio passa por revisão antes de entrar no catálogo de todos; neste aparelho já vale na hora.</p>
          </div>
        )}
      </div>
    </Sheet>
  );
};

export default ProductPhotoSheet;
