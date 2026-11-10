import React, { useRef, useState } from 'react';
import { Camera, X, Sparkles } from 'lucide-react';
import { MAX_PHOTOS, ProductDraft, emptyDraft, readProductPhotos, shrinkPhoto, submitProduct } from '../services/productPhotoAI';
import { gtinValid } from '../services/productCodes';
import { barcodeFromPhoto } from '../services/barcodeScan';
import { Sheet } from './ShoppingSheets';

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

  const add = async (f?: File) => {
    if (!f || photos.length >= MAX_PHOTOS) return;
    setMsg('');
    try {
      const p = await shrinkPhoto(f);
      setPhotos(a => [...a, p]);
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
      setRead(true);
    } catch (e: any) { setMsg(e?.message || 'A IA não conseguiu ler as fotos. Preencha à mão.'); setRead(true); }
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
              <img src={p.url} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
              <button type="button" aria-label="Remover foto" onClick={() => { setPhotos(a => a.filter((_, j) => j !== i)); setRead(false); }} className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center"><X className="w-3.5 h-3.5 text-white" /></button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <button type="button" onClick={() => fileRef.current?.click()} data-testid="photo-add" className="w-20 h-20 rounded-xl border border-dashed border-white/20 flex flex-col items-center justify-center text-zinc-400 text-[11px] gap-1"><Camera className="w-5 h-5" />Foto {photos.length + 1}/{MAX_PHOTOS}</button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { void add(e.target.files?.[0]); e.target.value = ''; }} />
        {photos.length > 0 && !read && (
          <button type="button" onClick={analyse} disabled={busy} data-testid="photo-analyse" className="mt-3 w-full h-12 rounded-xl bg-luxury-gold text-black text-[14px] font-bold flex items-center justify-center gap-2 disabled:opacity-50"><Sparkles className="w-4 h-4" />{busy ? 'Lendo as fotos…' : 'Ler com IA'}</button>
        )}
        {msg && <p className="text-[12px] text-amber-300 mt-2">{msg}</p>}

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
