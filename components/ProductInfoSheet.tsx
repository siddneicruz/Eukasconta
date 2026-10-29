import React, { useEffect, useState } from 'react';
import { X, Loader2, PackageSearch } from 'lucide-react';
import { lookupProductInfo, formatQuantity, ProductInfo } from '../services/productInfoService';
import { MasterProduct } from '../types';

/* Ficha do produto aberta ao tocar no código de barras: o que o app sabe do EAN (marca, peso, NCM…). */

interface Props { ean: string; master?: MasterProduct; onClose: () => void }

const Row: React.FC<{ label: string; value?: string | number }> = ({ label, value }) =>
  value === undefined || value === '' ? null : (
    <div className="flex justify-between gap-4 py-2 border-b border-white/5 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-100 text-right">{value}</span>
    </div>
  );

const ProductInfoSheet: React.FC<Props> = ({ ean, master, onClose }) => {
  const [info, setInfo] = useState<ProductInfo | null | undefined>(undefined);
  useEffect(() => {
    let off = false;
    setInfo(undefined);
    lookupProductInfo(ean).then(r => { if (!off) setInfo(r); });
    return () => { off = true; };
  }, [ean]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  return (
    <div className="fixed inset-x-0 top-0 h-[100dvh] z-[300] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md" onClick={onClose} data-testid="product-info-sheet">
      <div className="w-full sm:max-w-md max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain rounded-t-3xl sm:rounded-3xl bg-zinc-950 border border-white/10 px-5 pt-5 pb-[calc(2rem+env(safe-area-inset-bottom,0px))]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-xs text-zinc-500">Código de barras</p>
            <p className="text-lg font-semibold text-zinc-100 tabular-nums">{ean}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        {info === undefined && (
          <div className="flex items-center gap-2 py-6 text-sm text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /> Buscando informações do produto…</div>
        )}

        {info && (
          <div data-testid="product-info-found">
            {info.imageUrl && <img src={info.imageUrl} alt="" className="w-28 h-28 object-contain rounded-xl bg-white mx-auto mb-3" />}
            <p className="text-base font-semibold text-zinc-100 mb-2">{info.name}</p>
            <Row label="Marca" value={info.brand} />
            <Row label="Peso / volume" value={formatQuantity(info.quantity, info.unit)} />
            <Row label="Categoria" value={info.category} />
            <Row label="NCM" value={info.ncm} />
            <Row label="Unidades por caixa" value={info.unitsPerBox} />
            <p className="mt-2 text-[11px] text-zinc-600">Fonte: {info.source}</p>
          </div>
        )}

        {info === null && (
          <div className="flex items-start gap-3 py-4 text-sm text-zinc-400" data-testid="product-info-missing">
            <PackageSearch className="w-5 h-5 mt-0.5 shrink-0" />
            <p>Não encontrei esse código nos catálogos. Dá para confirmar o produto pela descrição abaixo.</p>
          </div>
        )}

        {master && (
          <div className="mt-4 rounded-xl bg-white/5 p-3">
            <p className="text-xs text-zinc-500 mb-1">No seu cadastro ({master.code})</p>
            <p className="text-sm text-zinc-200">{master.description}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductInfoSheet;
