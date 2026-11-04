import React, { useRef, useState } from 'react';
import { ScanBarcode, Minus, Plus, Check, Camera } from 'lucide-react';
import { Entry, cartTotal, fmtQty, round3, stepOf, unitLabel, PlanPurchase } from '../services/shoppingList';
import { NearPrices, ScanHit, learnCode, nearbyPrices } from '../services/shoppingScan';
import { barcodeFromPhoto, scanBarcode } from '../services/barcodeScan';
import { Sheet, brl, moneyText, parseMoney } from './ShoppingSheets';

/* Bipar produto durante a compra: lê o código, traz o último preço pago (a pessoa pode ajustar ou informar) e põe no
   carrinho. O total do carrinho aparece sempre no alto, marcado como estimado. */

interface Props {
  purchase: PlanPurchase;
  purchaseLabel: string;
  resolve: (code: string) => ScanHit | null;
  onAdd: (hit: ScanHit, qty: number, price: number) => void;
  onClose: () => void;
}

const ShoppingScanSheet: React.FC<Props> = ({ purchase, purchaseLabel, resolve, onAdd, onClose }) => {
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState('');
  const [cur, setCur] = useState<ScanHit | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);
  const [priceTxt, setPriceTxt] = useState('');
  const [last, setLast] = useState('');
  const photoRef = useRef<HTMLInputElement>(null);
  const [near, setNear] = useState<NearPrices | null>(null);
  const [nearBusy, setNearBusy] = useState(false);
  const [src, setSrc] = useState('');           // de onde veio o preço mostrado
  const askNear = (hit: ScanHit) => {
    setNear(null); setNearBusy(true);
    nearbyPrices(hit).then(r => {
      setNear(r);
      if (r.nearest) { setPriceTxt(moneyText(r.nearest.unit_price)); setSrc(`${r.nearest.establishment_name} · a ${r.nearest.distance_km.toLocaleString('pt-BR')} km · ${r.nearest.observed_on.split('-').reverse().join('/')}`); }
    }).finally(() => setNearBusy(false));
  };

  const inCart: Entry[] = purchase.entries.filter(e => e.cart);
  const noPrice = inCart.filter(e => !(e.price > 0)).length;

  const open = (code: string) => {
    setMsg(''); setLast('');
    const hit = resolve(code);
    if (hit) {
      setCur(hit); setUnknown(null); setQty(stepOf(hit.unit)); setPriceTxt(moneyText(hit.price));
      setSrc(hit.price > 0 ? `seu último preço${hit.store ? ` · ${hit.store}` : ''}${hit.priceDate ? ` · ${hit.priceDate.split('-').reverse().join('/')}` : ''}` : '');
      askNear(hit);
    }
    else { setCur(null); setUnknown(code); setName(''); setQty(1); setPriceTxt(''); setSrc(''); setNear(null); }
  };
  const doScan = async () => {
    setMsg('');
    const r = await scanBarcode();
    if ('code' in r) open(r.code); else if ('error' in r) setMsg(r.error);
  };
  const doTyped = () => { const c = typed.replace(/\D/g, ''); if (c.length < 8) { setMsg('Digite o número todo do código de barras (8 a 14 dígitos).'); return; } open(c); setTyped(''); };
  const doPhoto = async (f?: File) => {
    if (!f) return;
    const c = await barcodeFromPhoto(f);
    if (c) open(c); else setMsg('Não consegui ler o código dessa foto. Digite o número.');
  };

  const unit = cur?.unit || 'UN';
  const step = stepOf(unit);
  const price = parseMoney(priceTxt) ?? 0;
  const confirm = () => {
    const base: ScanHit | null = cur || (unknown && name.trim().length >= 2
      ? { code: unknown, pid: `U:${name.trim().toUpperCase()}`, name: name.trim(), unit: 'UN', dept: 'Outros', category: '', price: 0, priceDate: '', store: '', source: 'aprendido' } : null);
    if (!base) return;
    if (!cur && unknown) learnCode(unknown, name.trim());
    onAdd(base, qty, price);
    setLast(`${base.name} no carrinho${price > 0 ? ` · ${brl(price * qty)}` : ' · sem preço'}`);
    setCur(null); setUnknown(null);
  };

  const editing = cur || unknown;
  return (
    <Sheet title="Bipar produto" subtitle={`Compra de ${purchaseLabel}`} onClose={onClose} testId="shop-scan-sheet">
      <div className="rounded-2xl border border-luxury-gold/30 bg-luxury-gold/[0.06] px-4 py-3 mb-3" data-testid="shop-scan-total">
        <p className="text-[11px] uppercase tracking-wide text-zinc-400">No carrinho · estimado</p>
        <p className="text-[24px] font-serif font-bold text-white tabular-nums leading-tight">{brl(cartTotal(purchase))}</p>
        <p className="text-[11px] text-zinc-500">{inCart.length} {inCart.length === 1 ? 'item' : 'itens'}{noPrice ? ` · ${noPrice} sem preço (não somados)` : ''}</p>
      </div>

      {last && <p className="flex items-center gap-2 text-[12px] text-emerald-400 mb-2" role="status"><Check className="w-4 h-4" /> {last}</p>}

      {!editing && (
        <>
          <button type="button" onClick={doScan} data-testid="shop-scan-go" className="w-full h-12 rounded-xl bg-luxury-gold text-black text-[14px] font-bold flex items-center justify-center gap-2 active:opacity-80"><ScanBarcode className="w-5 h-5" /> Ler código de barras</button>
          <div className="flex gap-2 mt-2">
            <input value={typed} onChange={e => setTyped(e.target.value)} inputMode="numeric" placeholder="ou digite o número do código" aria-label="Código de barras" data-testid="shop-scan-typed"
              className="min-w-0 flex-1 h-11 rounded-xl bg-white/5 border border-white/10 px-3 text-[14px] text-white outline-none focus:border-luxury-gold/60 placeholder:text-zinc-500" />
            <button type="button" onClick={doTyped} className="shrink-0 h-11 px-4 rounded-xl border border-white/15 text-[13px] font-semibold text-zinc-200">Buscar</button>
            <button type="button" onClick={() => photoRef.current?.click()} aria-label="Foto do código" className="shrink-0 w-11 h-11 rounded-xl border border-white/15 text-zinc-300 flex items-center justify-center"><Camera className="w-4 h-4" /></button>
            <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { void doPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        </>
      )}
      {msg && <p className="text-[12px] text-amber-300 mt-2" role="alert">{msg}</p>}

      {editing && (
        <div className="mt-1" data-testid="shop-scan-item">
          {cur ? (
            <>
              <p className="text-[16px] font-semibold text-white leading-snug">{cur.name}</p>
              <p className="text-[11px] text-zinc-500 tabular-nums">{cur.dept} · código {cur.code}</p>
              <p className="text-[12px] mt-1 text-zinc-400" data-testid="shop-scan-source">
                {nearBusy ? 'Procurando o preço mais próximo de você…' : src ? <>Preço de: <span className="text-zinc-200">{src}</span></> : <span className="text-amber-300">Sem preço registrado: informe o preço da etiqueta.</span>}
              </p>
              {near?.error && <p className="text-[11px] text-zinc-500 mt-0.5">{near.error} Usei seu histórico.</p>}
              {near && near.rows.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2" role="group" aria-label="Outros preços por perto">
                  {near.rows.map(r => (
                    <button key={r.establishment_id} type="button" onClick={() => { setPriceTxt(moneyText(r.unit_price)); setSrc(`${r.establishment_name} · a ${r.distance_km.toLocaleString('pt-BR')} km · ${r.observed_on.split('-').reverse().join('/')}`); }}
                      className="px-3 min-h-[34px] rounded-full border border-white/10 text-[11.5px] text-zinc-300 active:bg-white/10">{r.establishment_name.length > 18 ? r.establishment_name.slice(0, 17) + '…' : r.establishment_name} · {brl(r.unit_price)} · {r.distance_km.toLocaleString('pt-BR')} km</button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-[13px] text-zinc-300">Não conheço este código. Confira se o número abaixo é igual ao impresso na embalagem; se a câmera errou algum dígito, corrija aqui.</p>
              <div className="flex gap-2 mt-2">
                <input value={unknown || ''} onChange={e => setUnknown(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="Código lido" data-testid="shop-scan-code"
                  className="min-w-0 flex-1 h-11 rounded-xl bg-white/5 border border-white/10 px-3 text-[15px] text-white tabular-nums outline-none focus:border-luxury-gold/60" />
                <button type="button" onClick={() => { const c = (unknown || '').replace(/\D/g, ''); if (c.length >= 8) open(c); }} data-testid="shop-scan-recheck"
                  className="shrink-0 h-11 px-4 rounded-xl border border-white/15 text-[13px] font-semibold text-zinc-200">Buscar</button>
              </div>
              <button type="button" onClick={() => { setUnknown(null); void doScan(); }} className="mt-2 text-[12px] text-luxury-gold underline underline-offset-2 min-h-[32px]">Ler de novo com a câmera</button>
              <p className="text-[13px] text-zinc-300 mt-2">Se o número está certo, como se chama este produto?</p>
              <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Leite integral 1 L" aria-label="Nome do produto" data-testid="shop-scan-name"
                className="w-full h-12 mt-2 rounded-xl bg-white/5 border border-white/10 px-3 text-[15px] text-white outline-none focus:border-luxury-gold/60 placeholder:text-zinc-500" />
            </>
          )}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <label className="block">
              <span className="text-[11px] text-zinc-500">Preço (R$ por {unitLabel(unit)})</span>
              <input value={priceTxt} onChange={e => setPriceTxt(e.target.value)} inputMode="decimal" placeholder="0,00" aria-label="Preço" data-testid="shop-scan-price"
                className="w-full h-12 mt-1 rounded-xl bg-white/5 border border-white/10 px-3 text-[16px] text-white tabular-nums outline-none focus:border-luxury-gold/60" />
            </label>
            <div>
              <span className="text-[11px] text-zinc-500">Quantidade</span>
              <div className="flex items-center mt-1 h-12 rounded-xl border border-white/10 bg-white/5">
                <button type="button" onClick={() => setQty(q => Math.max(step, round3(q - step)))} aria-label="Diminuir" className="w-12 h-12 flex items-center justify-center text-zinc-300"><Minus className="w-4 h-4" /></button>
                <span className="flex-1 text-center text-[15px] font-semibold text-white tabular-nums" data-testid="shop-scan-qty">{fmtQty(qty, unit)}</span>
                <button type="button" onClick={() => setQty(q => round3(q + step))} aria-label="Aumentar" className="w-12 h-12 flex items-center justify-center text-zinc-300"><Plus className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
          <p className="text-[13px] font-semibold text-white tabular-nums mt-3">Subtotal: {price > 0 ? brl(price * qty) : '—'}</p>
          <div className="grid grid-cols-2 gap-2 mt-3 mb-2">
            <button type="button" onClick={() => { setCur(null); setUnknown(null); }} className="h-12 rounded-xl border border-white/10 text-zinc-300 text-[14px] font-semibold">Cancelar</button>
            <button type="button" onClick={confirm} disabled={!cur && name.trim().length < 2} data-testid="shop-scan-add" className="h-12 rounded-xl bg-luxury-gold text-black text-[14px] font-bold disabled:opacity-40 active:opacity-80">Pôr no carrinho</button>
          </div>
        </div>
      )}
    </Sheet>
  );
};

export default ShoppingScanSheet;
