import { askVisionJson } from './geminiService';
import { supabase } from './supabaseClient';

/* Cadastro de produto por fotos (até 3): frente, verso/tabela e código de barras. A IA sugere; a pessoa confere e envia.
   O envio vai para a fila de revisão (product_submissions), nunca direto no catálogo. */

export const MAX_PHOTOS = 3;

export interface ProductDraft {
  barcode: string; brand: string; name: string;
  sizeValue: string; sizeUnit: string;   // peso/volume líquido
  packaging: string;                     // embalagem: garrafa, lata, caixa, pacote...
  units: string;                         // unidades na embalagem (ex.: 12)
  variant: string;                       // sabor/tipo
  dimensions: string;                    // medidas da peça (ex.: 28 x 22 cm): guardanapo, papel toalha, filme, saco…
}
export const emptyDraft = (): ProductDraft => ({ barcode: '', brand: '', name: '', sizeValue: '', sizeUnit: 'g', packaging: '', units: '', variant: '', dimensions: '' });

// Reduz a foto (lado maior 1280 px, JPEG) para caber rápido na IA e no celular.
export const shrinkPhoto = (file: File): Promise<{ b64: string; mime: string; url: string }> => new Promise((ok, fail) => {
  const img = new Image(); const src = URL.createObjectURL(file);
  img.onload = () => {
    const k = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.82);
    URL.revokeObjectURL(src);
    ok({ b64: url.split(',')[1], mime: 'image/jpeg', url });
  };
  img.onerror = () => { URL.revokeObjectURL(src); fail(new Error('Não consegui abrir a foto.')); };
  img.src = src;
});

const PROMPT = `Você recebe de 1 a 3 fotos da MESMA embalagem de um produto de supermercado brasileiro (frente, verso, código de barras).
Leia só o que está impresso; não invente. Devolva APENAS este JSON:
{"barcode":"dígitos do código de barras (8 a 14) ou vazio","brand":"marca","name":"nome do produto sem a marca e sem o peso","variant":"sabor/tipo ou vazio","sizeValue":"número do conteúdo líquido (ex.: 500) ou vazio","sizeUnit":"g, kg, ml, l ou un","packaging":"tipo de embalagem: garrafa, lata, caixa, pacote, saco, pote, bandeja, sachê, tubo, frasco, etc.","units":"unidades dentro do pacote (ex.: 12 para fardo c/12, 50 folhas) ou vazio","dimensions":"medidas de cada peça como impresso, ex.: 28 x 22 cm (guardanapo, papel toalha, saco, filme, esponja…), ou vazio"}
Use vírgula nunca; ponto decimal se precisar. Se não tem certeza de um campo, deixe vazio.`;

export const readProductPhotos = async (photos: { b64: string; mime: string }[]): Promise<ProductDraft> => {
  const r = await askVisionJson(photos.slice(0, MAX_PHOTOS), PROMPT);
  const s = (v: any) => (v == null ? '' : String(v).trim());
  const unit = s(r.sizeUnit).toLowerCase();
  return {
    barcode: s(r.barcode).replace(/\D/g, ''), brand: s(r.brand), name: s(r.name), variant: s(r.variant),
    sizeValue: s(r.sizeValue).replace(',', '.'), sizeUnit: ['g', 'kg', 'ml', 'l', 'un'].includes(unit) ? unit : 'g',
    packaging: s(r.packaging).toLowerCase(), units: s(r.units).replace(/\D/g, ''), dimensions: s(r.dimensions),
  };
};

export const submitProduct = async (d: ProductDraft): Promise<boolean> => {
  try {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('product_submissions').insert({
      user_id: u.user?.id, ean: d.barcode, brand: d.brand, name: d.name, variant: d.variant,
      size_value: d.sizeValue ? Number(d.sizeValue) : null, size_unit: d.sizeUnit, packaging: d.packaging,
      units: d.units ? Number(d.units) : null, dimensions: d.dimensions || null,
    });
    return !error;
  } catch { return false; }
};
