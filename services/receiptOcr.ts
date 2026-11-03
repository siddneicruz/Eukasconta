import { Receipt, ReceiptItem } from '../types';
import { cleanCode } from './productCodes';
import { NfceQr } from './nfceQr';

/* Leitura do cupom impresso por reconhecimento de texto NO CELULAR (sem IA, sem créditos, sem internet).
   A foto é lida com o Tesseract (arquivos em /ocr, dentro do próprio app) e o texto é interpretado por regras fixas.
   Nada é aceito sem conferência: a soma dos itens tem de fechar com o total do cupom, e o código de barras tem de ter
   o dígito verificador certo. Quando não fecha, o cupom NÃO entra; vai para a leitura por IA ou fica para o humano. */

export interface CupomOcr { ok: boolean; receipt: Receipt | null; notes: string[]; text: string }

const UNITS = new Set(['UNID', 'UN', 'UND', 'UNI', 'KG', 'PC', 'PCT', 'CX', 'LT', 'L', 'ML', 'G', 'M', 'FD', 'DZ', 'BD', 'SC']);

const money = (s: string): number | null => {
  const t = String(s || '').replace(/[^\d.,]/g, '');
  if (!t) return null;
  let n: number;
  if (/,\d{1,3}$/.test(t)) n = Number(t.replace(/\./g, '').replace(',', '.'));
  else if (/\.\d{2}$/.test(t)) n = Number(t.replace(/,/g, ''));
  else n = Number(t.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const qtyNum = (s: string): number | null => {
  const t = String(s || '').replace(/[^\d.,]/g, '');
  if (!t) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** GTIN-8/12/13/14 com dígito verificador certo. */
export const gtinOk = (c: string): boolean => {
  if (!/^\d+$/.test(c) || ![8, 12, 13, 14].includes(c.length)) return false;
  let s = 0;
  for (let i = 0; i < c.length - 1; i++) s += Number(c[c.length - 2 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (s % 10)) % 10 === Number(c[c.length - 1]);
};

/** Troca letras que o OCR confunde com números, só em códigos que já são quase só números. */
const fixDigits = (t: string): string => {
  const digits = (t.match(/\d/g) || []).length;
  if (digits < t.length - 2) return t;
  return t.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
};

export const parseCupomOcr = (raw: string, qr?: NfceQr | null): CupomOcr => {
  const text = String(raw || '').replace(/\r/g, '');
  const notes: string[] = [];
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  const items: ReceiptItem[] = [];
  let firstItemLine = -1;
  lines.forEach((line, idx) => {
    const tk = line.split(' ');
    if (tk.length < 5) return;
    const code = fixDigits(tk[0]);
    if (!/^\d{4,14}$/.test(code)) return;
    let u = -1;
    for (let i = tk.length - 2; i >= 2; i--) { if (UNITS.has(tk[i].toUpperCase().replace(/[^A-Z]/g, ''))) { u = i; break; } }
    if (u < 0) return;
    const qty = qtyNum(tk[u - 1]);
    const unit = money(tk[u + 1] || '');
    if (qty === null || unit === null) return;
    let total = money(tk[u + 2] || '');
    const desc = tk.slice(1, u - 1).filter(t => /[A-Za-z0-9]/.test(t)).join(' ').replace(/[‘’'`´¢|]+$/g, '').trim();
    if (!desc) return;
    if (firstItemLine < 0) firstItemLine = idx;
    const calc = r2(qty * unit);
    if (total === null || Math.abs(total - calc) > 0.011) {
      // total ilegível ou diferente de quantidade × unitário: vale a conta (o desconto, se houver, aparece em linha própria)
      if (total !== null) notes.push(`"${desc.slice(0, 24)}": total lido ${total.toFixed(2)} ≠ ${calc.toFixed(2)}; usei a conta.`);
      total = calc;
    }
    const item: ReceiptItem = { description: desc, quantity: qty, unitPrice: unit, totalPrice: total, category: 'Outros', unitType: tk[u].toUpperCase().replace(/[^A-Z]/g, '').replace(/^UNI?D?$/, 'UN') };
    if (code.length <= 7) item.code = cleanCode(code) || undefined as any;
    else if (gtinOk(code)) item.code = code;
    else notes.push(`"${desc.slice(0, 24)}": código ${code} não confere (dígito verificador); não guardei o código.`);
    if (!item.code) delete (item as any).code;
    items.push(item);
  });
  if (items.length === 0) return { ok: false, receipt: null, notes: ['Não achei linhas de item (código, descrição, quantidade, unidade, valores).'], text };

  const totalLine = lines.find(l => /VALOR\s*TOTAL/i.test(l) && /\d[.,]\d{2}/.test(l)) || lines.find(l => /TOTAL\s*R\$/i.test(l) && /\d[.,]\d{2}/.test(l)) || '';
  const tm = totalLine.match(/(\d{1,3}(?:\.\d{3})*[.,]\d{2})\s*$/) || totalLine.match(/(\d+[.,]\d{2})/);
  const grand = tm ? money(tm[1]) : null;
  const sum = r2(items.reduce((s, i) => s + i.totalPrice, 0));
  let ok = true;
  if (grand === null) { ok = false; notes.push('Não consegui ler o valor total do cupom.'); }
  else if (Math.abs(grand - sum) > 0.02) { ok = false; notes.push(`A soma dos itens (R$ ${sum.toFixed(2)}) não fecha com o total do cupom (R$ ${grand.toFixed(2)}).`); }

  const cntLine = lines.find(l => /QUANTIDADE\s+TOTAL\s+DE\s+ITENS/i.test(l)) || '';
  const cm = cntLine.match(/(\d{1,3})\s*$/);
  if (cm && Number(cm[1]) !== items.length && Number(cm[1]) > 0) { ok = false; notes.push(`O cupom diz ${cm[1]} itens e li ${items.length}.`); }

  const em = text.match(/Emiss\S*\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}))?/i) || text.match(/(\d{2})\/(\d{2})\/(20\d{2})\s+(\d{2}:\d{2})/);
  if (!em) { ok = false; notes.push('Não achei a data de emissão.'); }
  const date = em ? `${em[3]}-${em[2]}-${em[1]}` : '';
  const time = em?.[4] || '12:00';
  if (qr && date && date.slice(0, 7) !== qr.month) { ok = false; notes.push(`A data lida (${date}) não bate com o mês da chave do QR (${qr.month}).`); }

  const cn = text.match(/CNPJ:?\s*([\d.\s/-]{14,22})/i);
  const cnpjOcr = cn ? cn[1].replace(/\D/g, '') : '';
  const cnpj = qr?.cnpj || cnpjOcr;
  if (qr && cnpjOcr && cnpjOcr.length === 14 && cnpjOcr !== qr.cnpj) notes.push('O CNPJ lido na foto difere do da chave do QR; usei o do QR.');
  if (!cnpj) { ok = false; notes.push('Não achei o CNPJ da loja.'); }

  const name = (lines[0] && !/CNPJ/i.test(lines[0]) ? lines[0] : '').replace(/\s+/g, ' ').trim();
  const no = qr?.number || (text.match(/N[úu]mero:?\s*(\d{1,9})/i) || [])[1];
  const key = qr?.key || ((text.replace(/\s/g, '').match(/(\d{44})/) || [])[1] ?? '');
  const receipt: Receipt = {
    id: key || `ocr-${cnpj}-${date}-${time}-${(grand ?? sum).toFixed(2)}`,
    establishmentName: name, cnpj, address: '', city: '', state: qr?.uf || '', date, time, totalAmount: grand ?? sum, items,
    scannedAt: new Date().toISOString(),
  };
  if (no) receipt.receiptNumber = String(no);
  void firstItemLine;
  return { ok, receipt, notes, text };
};

/* ───────────────────────── foto → texto (Tesseract, tudo local) ───────────────────────── */

let workerP: Promise<any> | null = null;
const base = () => ((import.meta as any).env?.BASE_URL as string | undefined) || '/';

const getWorker = async () => {
  if (!workerP) {
    workerP = (async () => {
      const { createWorker } = await import('tesseract.js');
      const b = base();
      const w = await createWorker('eng', 1, {
        workerPath: `${b}ocr/worker.min.js`,
        corePath: `${b}ocr/tesseract-core-simd-lstm.wasm.js`,
        langPath: `${b}ocr/lang`,
        gzip: true,
        cacheMethod: 'none',
      } as any);
      await w.setParameters({ tessedit_pageseg_mode: '6' as any, preserve_interword_spaces: '1' });
      return w;
    })().catch(e => { workerP = null; throw e; });
  }
  return workerP;
};

/** Reduz a foto (cupom é comprido), passa para cinza e aumenta o contraste: ajuda o texto térmico desbotado. */
const prepare = async (file: File): Promise<Blob> => {
  const bmp = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    let lo = 255, hi = 0;
    const g = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < d.data.length; i += 4, p++) { const v = (d.data[i] * 0.299 + d.data[i + 1] * 0.587 + d.data[i + 2] * 0.114) | 0; g[p] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = Math.max(40, hi - lo);
    for (let i = 0, p = 0; i < d.data.length; i += 4, p++) { const v = Math.max(0, Math.min(255, ((g[p] - lo) * 255) / span)); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; }
    ctx.putImageData(d, 0, 0);
    return await new Promise<Blob>(res => c.toBlob(b => res(b || file), 'image/png'));
  } finally { bmp.close?.(); }
};

export const ocrImage = async (file: File): Promise<string> => {
  const w = await getWorker();
  const { data } = await w.recognize(await prepare(file));
  return String(data?.text || '');
};
