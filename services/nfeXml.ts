import { Receipt, ReceiptItem } from '../types';
import { cleanCode, codeKind } from './productCodes';

/* XML da NFC-e/NF-e ("Baixar documento XML" na página da SEFAZ). Diferente do texto da página, o XML traz o código de barras
   (EAN) de cada item e todos os valores já separados: é o jeito mais seguro de ler um cupom sem IA. */

export type NfeParse = { ok: true; receipt: Receipt } | { ok: false; reason: string };

const num = (s: string | null | undefined): number => {
  const n = Number(String(s ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};

export const parseNfeXml = (xml: string): NfeParse => {
  let doc: Document;
  try { doc = new DOMParser().parseFromString(String(xml || '').replace(/^﻿/, ''), 'application/xml'); }
  catch { return { ok: false, reason: 'Não consegui abrir o arquivo como XML.' }; }
  if (doc.getElementsByTagName('parsererror').length) return { ok: false, reason: 'Esse arquivo não é um XML válido.' };

  const all = (root: ParentNode, name: string): Element[] => Array.from((root as Element | Document).getElementsByTagNameNS('*', name));
  const first = (root: ParentNode | null, name: string): Element | null => (root ? all(root, name)[0] || null : null);
  const txt = (root: ParentNode | null, name: string): string => first(root, name)?.textContent?.trim() || '';

  const inf = first(doc, 'infNFe');
  if (!inf) return { ok: false, reason: 'Não achei uma nota fiscal nesse XML (infNFe).' };
  const key = (inf.getAttribute('Id') || '').replace(/\D/g, '') || txt(doc, 'chNFe');
  const ide = first(inf, 'ide'), emit = first(inf, 'emit'), addr = first(emit, 'enderEmit');

  const when = txt(ide, 'dhEmi') || txt(ide, 'dEmi');
  const dm = when.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!dm) return { ok: false, reason: 'Não achei a data de emissão no XML.' };

  const items: ReceiptItem[] = [];
  for (const det of all(inf, 'det')) {
    const p = first(det, 'prod');
    if (!p) continue;
    const cProd = cleanCode(txt(p, 'cProd'));
    const ean = [txt(p, 'cEAN'), txt(p, 'cEANTrib')].map(cleanCode).find(c => c && codeKind(c) === 'ean');
    const qty = num(txt(p, 'qCom')) || 1;
    const gross = num(txt(p, 'vProd')), disc = num(txt(p, 'vDesc'));
    const item: ReceiptItem = {
      description: txt(p, 'xProd'), quantity: qty, unitPrice: num(txt(p, 'vUnCom')),
      totalPrice: Number((gross - disc).toFixed(2)), category: 'Outros', unitType: (txt(p, 'uCom') || 'UN').toUpperCase(),
    };
    if (ean) { item.code = ean; if (cProd && cProd !== ean) item.storeCode = cProd; }
    else if (cProd) item.code = cProd;
    if (item.description) items.push(item);
  }
  if (items.length === 0) return { ok: false, reason: 'O XML não tem itens.' };

  const cnpj = txt(emit, 'CNPJ');
  const totalNode = first(inf, 'ICMSTot');
  const total = num(txt(totalNode, 'vNF')) || Number(items.reduce((s, i) => s + i.totalPrice, 0).toFixed(2));
  const address = [txt(addr, 'xLgr'), txt(addr, 'nro'), txt(addr, 'xBairro')].filter(Boolean).join(', ');
  const nNF = txt(ide, 'nNF');

  const receipt: Receipt = {
    id: key || `xml-${cnpj}-${dm[1]}${dm[2]}${dm[3]}-${nNF}-${total.toFixed(2)}`,
    establishmentName: txt(emit, 'xFant') || txt(emit, 'xNome'), cnpj, address,
    city: txt(addr, 'xMun'), state: txt(addr, 'UF'),
    date: `${dm[1]}-${dm[2]}-${dm[3]}`, time: dm[4] ? `${dm[4]}:${dm[5]}` : '12:00', totalAmount: total, items,
    scannedAt: new Date().toISOString(),
  };
  if (nNF) receipt.receiptNumber = String(Number(nNF));
  return { ok: true, receipt };
};
