import jsQR from 'jsqr';
import { Receipt, ReceiptItem } from '../types';
import { cleanCode } from './productCodes';

/* Leitura de cupom pelo QR Code da NFC-e, sem IA e sem token.
   1) o QR Code (da câmera ou da galeria) traz o endereço da consulta da SEFAZ e a chave de 44 dígitos;
   2) a pessoa abre a página da SEFAZ (valida o captcha se pedir), copia o texto e cola no app;
   3) o app lê o texto da página e monta o cupom. */

export interface NfceQr {
  /** texto lido do QR Code */
  raw: string;
  /** endereço da consulta (abre na SEFAZ) */
  url: string;
  /** chave de acesso (44 dígitos) */
  key: string;
  keyValid: boolean;
  uf: string;
  cnpj: string;
  /** AAAA-MM */
  month: string;
  number: string;
}

const UF_BY_CODE: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN',
  '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC',
  '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

/** Dígito verificador da chave (módulo 11) */
export const nfceKeyValid = (key: string): boolean => {
  if (!/^\d{44}$/.test(key)) return false;
  let w = 2, s = 0;
  for (let i = 42; i >= 0; i--) { s += Number(key[i]) * w; w = w === 9 ? 2 : w + 1; }
  const r = s % 11;
  const dv = r < 2 ? 0 : 11 - r;
  return dv === Number(key[43]);
};

export const parseNfceQr = (raw: string): NfceQr | null => {
  const text = String(raw || '').trim();
  if (!text) return null;
  let key = '';
  const p = text.match(/[?&]p=(\d{44})/i) || text.match(/chNFe=(\d{44})/i);
  if (p) key = p[1];
  else { const any = text.replace(/\s/g, '').match(/(\d{44})/); if (any) key = any[1]; }
  if (!key) return null;
  const url = /^https?:\/\//i.test(text) ? text.split(/\s/)[0] : '';
  return {
    raw: text, url, key, keyValid: nfceKeyValid(key), uf: UF_BY_CODE[key.slice(0, 2)] || '',
    cnpj: key.slice(6, 20), month: `20${key.slice(2, 4)}-${key.slice(4, 6)}`, number: String(Number(key.slice(25, 34))),
  };
};

/** Lê o QR Code de uma imagem (foto da câmera ou da galeria). Tenta em tamanhos diferentes porque foto grande ou borrada falha. */
export const decodeQrFromFile = async (file: File): Promise<string | null> => {
  const bmp = await createImageBitmap(file);
  try {
    for (const maxSide of [1600, 1000, 2400, 700]) {
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);
      const hit = jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (hit?.data) return hit.data;
    }
    return null;
  } finally { bmp.close?.(); }
};

/* ───────────────────────── texto da página da SEFAZ ───────────────────────── */

const num = (s: string): number => {
  const n = Number(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export type SefazParse = { ok: true; receipt: Receipt } | { ok: false; reason: string };

/**
 * Lê o texto copiado da página de consulta da NFC-e. As páginas das SEFAZ têm quase o mesmo desenho:
 *   NOME DO PRODUTO (Código: 123456)   Qtde.:1,000   UN: UN   Vl. Unit.: 5,99   Vl. Total 5,99
 * (cada campo pode vir na mesma linha ou em linhas separadas, então o texto é lido como um fluxo só).
 */
export const parseSefazText = (raw: string, qr?: NfceQr | null): SefazParse => {
  const text = String(raw || '').replace(/\r/g, '').replace(/ /g, ' ');
  if (!text.trim()) return { ok: false, reason: 'O texto está vazio.' };
  const flat = text.replace(/[ \t]+/g, ' ');

  const items: ReceiptItem[] = [];
  const re = /([^\n]*?)\s*\(\s*C[óo]digo:?\s*([^)]*?)\s*\)\s*(?:\n|\s)*Qtde\.?(?:\s*total)?:?\s*([\d.,]+)\s*(?:\n|\s)*UN:?\s*([A-Za-z]{1,4})\s*(?:\n|\s)*Vl\.?\s*Unit\.?:?\s*(?:R\$)?\s*([\d.,]+)\s*(?:\n|\s)*Vl\.?\s*Total:?\s*(?:R\$)?\s*([\d.,]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) {
    let desc = m[1].trim();
    if (!desc) {
      // a descrição ficou na linha de cima
      const before = flat.slice(0, m.index).split('\n').map(s => s.trim()).filter(Boolean);
      desc = before[before.length - 1] || '';
    }
    desc = desc.replace(/^\d+\s+(?=\D)/, '').trim();
    if (!desc) continue;
    const qty = num(m[3]) || 1;
    const item: ReceiptItem = {
      description: desc, quantity: qty, unitPrice: num(m[5]), totalPrice: num(m[6]), category: 'Outros', unitType: m[4].toUpperCase(),
    };
    const code = cleanCode(m[2]);
    if (code) item.code = code;
    items.push(item);
  }
  if (items.length === 0) return { ok: false, reason: 'Não achei a lista de itens. Copie a página inteira da nota (Ctrl+A, Ctrl+C) e cole aqui.' };

  const name = (flat.match(/^\s*([^\n]{3,80})\n[^\n]*CNPJ:?\s*[\d./-]{14,18}/i) || [])[1]?.trim() || '';
  const cnpjTxt = (flat.match(/CNPJ:?\s*([\d./-]{14,18})/i) || [])[1]?.replace(/\D/g, '') || '';
  const cnpj = qr?.cnpj || cnpjTxt;
  const em = flat.match(/Emiss[ãa]o:?\s*(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}))?/i);
  const date = em ? `${em[3]}-${em[2]}-${em[1]}` : '';
  const time = em?.[4] || '12:00';
  const tot = flat.match(/Valor\s*(?:total|a pagar)[^\d\n]*R?\$?\s*([\d.,]+)/i);
  const totalAmount = tot ? num(tot[1]) : Number(items.reduce((s, i) => s + i.totalPrice, 0).toFixed(2));
  const key = qr?.key || ((flat.replace(/\s/g, '').match(/(\d{44})/) || [])[1] ?? '');
  if (!date) return { ok: false, reason: 'Não achei a data de emissão no texto.' };

  const receipt: Receipt = {
    id: key || `qr-${cnpj}-${date}-${time}-${totalAmount.toFixed(2)}`,
    establishmentName: name, cnpj, address: '', city: '', state: qr?.uf || '', date, time, totalAmount, items,
    scannedAt: new Date().toISOString(),
  };
  const no = qr?.number || (flat.match(/N[úu]mero:?\s*(\d+)/i) || [])[1];
  if (no) receipt.receiptNumber = String(no);
  return { ok: true, receipt };
};
