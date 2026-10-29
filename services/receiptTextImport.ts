// Importar cupons em texto (.txt), soltos ou dentro de um .zip.
//
// Lê dois jeitos de cupom:
//   1. o cupom fiscal eletrônico em texto (NFC-e/SAT): "CUPOM FISCAL ELETRONICO", "DATA: 2025-01-09  HORA: 18:45",
//      endereço numa linha só ("RUA X, 389, CENTRO - SÃO CARLOS/SC - CEP: 89885-000") e a "Chave Autenticacao IA";
//   2. o cupom que o próprio app exporta em "Cupons TXT" (nome, endereço, cidade, CNPJ, data "16/10/2026 18:45").
// Em ambos, a coluna CODIGO de cada item vira o código do produto: código de barras do fabricante (EAN) ou código da loja.
// Funções puras: não leem localStorage nem chamam rede, então dá para testar com os arquivos de verdade.

import JSZip from 'jszip';
import { Establishment, MasterProduct, Receipt, ReceiptItem } from '../types';
import { cleanCode, codeKind, normStoreKey } from './productCodes';
import { applyRegistry, buildMasterIndex, learnEstablishment } from './registryLookupService';
import { auditAndRepairReceipt } from './productNormalization';
import { isSameCupom } from './receiptDuplicates';
import { plainText, ufFromCep } from './brGeo';

export type TxtParse = { ok: true; receipt: Receipt } | { ok: false; reason: 'empty' | 'format' | 'noitems' };

const num = (s: string): number => {
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const isRule = (l: string) => /^[=\-_*]{5,}\s*$/.test(l.trim());

// Cupom sem número de extrato vem com 000000
const receiptNo = (s: string): string => {
  const d = String(s || '').trim();
  return /^0*$/.test(d) ? '' : d;
};

const hhmm = (s: string): string => {
  const m = String(s || '').match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '12:00';
};

// Identidade estável de um cupom sem chave: ler o mesmo arquivo de novo gera o mesmo id e não duplica.
const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
};

// "RUA DO COMÉRCIO, 389, CENTRO - SÃO CARLOS/SC - CEP: 89885-000" → endereço, cidade, UF e CEP.
// Lê a cidade e o estado pela direita (o endereço pode ter " - " dentro) e ignora o que vem vazio ("- / -", "- /SC").
export interface AddressLine { address: string; city: string; state: string; cep: string }

export const parseAddressLine = (line: string): AddressLine => {
  let s = String(line || '').replace(/\s+/g, ' ').trim();
  let cep = '';
  const cm = s.match(/\s*-?\s*CEP:?\s*([\d.\-]+)\s*$/i);
  if (cm) { cep = cm[1].replace(/\D/g, ''); s = s.slice(0, cm.index).trim(); }
  let address = s, city = '', state = '';
  const tail = s.match(/\/\s*([A-Za-z]{2})$/);
  if (tail) {
    state = tail[1].toUpperCase();
    const before = s.slice(0, tail.index).trim();
    const cut = before.lastIndexOf(' - ');
    if (cut >= 0) { address = before.slice(0, cut).trim(); city = before.slice(cut + 3).trim(); }
    else if (before.startsWith('-')) { address = ''; city = before.replace(/^-\s*/, '').trim(); }
    else { address = ''; city = before; }
  }
  if (/^[-/\s]*$/.test(address)) address = '';
  if (/^[-/\s]*$/.test(city)) city = '';
  // "SÃO CARLOS" ou "CONCÓRDIA - SC" no lugar da rua: é só a cidade repetida, não endereço
  const pa = plainText(address);
  if (city && (pa === plainText(city) || pa === plainText(`${city} ${state}`))) address = '';
  // O app guarda o CEP no fim do endereço ("… - CEP: 89885-000"); sem rua não há onde pendurá-lo
  if (address && cep.length === 8) address = `${address} - CEP: ${cep.slice(0, 5)}-${cep.slice(5)}`;
  // UF que não combina com o CEP: vale a do CEP ("SÃO CARLOS/SP" com CEP de Santa Catarina)
  const byCep = ufFromCep(cep);
  if (byCep && byCep !== state) state = byCep;
  return { address, city, state, cep };
};

// "SÃO CARLOS - SC | CEP: 89885-000" ou "SÃO CARLOS - SC"
const CITY_B = /^(.+?)\s*-\s*([A-Za-z]{2})\s*(?:\|\s*CEP:?\s*([\d.\-]+))?\s*$/i;

interface Row { code: string; description: string; quantity: number; unit: string; unitPrice: number; total: number }

// "001 7894900701517  Refrigerante Coca-cola Ze     1 UN  12.99   12.99"
const ROW_CODE = /^\s*(\d{1,4})\s+(\S+)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+([A-Za-z]{1,4})\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s*$/;
// sem coluna de código: "001 Refrigerante Coca-cola Ze     1 UN  12.99   12.99"
const ROW_PLAIN = /^\s*(\d{1,4})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+([A-Za-z]{1,4})\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s*$/;

const parseRow = (line: string, hasCodes: boolean): Row | null => {
  if (hasCodes) {
    const m = line.match(ROW_CODE);
    return m ? { code: m[2], description: m[3].trim(), quantity: num(m[4]), unit: m[5].toUpperCase(), unitPrice: num(m[6]), total: num(m[7]) } : null;
  }
  const m = line.match(ROW_PLAIN);
  return m ? { code: '', description: m[2].trim(), quantity: num(m[3]), unit: m[4].toUpperCase(), unitPrice: num(m[5]), total: num(m[6]) } : null;
};

export const parseReceiptText = (raw: string, fileName = ''): TxtParse => {
  const text = String(raw || '').replace(/^﻿/, '').replace(/\r/g, '');
  if (!text.trim()) return { ok: false, reason: 'empty' };
  const lines = text.split('\n');

  const headerIdx = lines.findIndex(l => /^\s*(ITEM|IT)\s+(C[OÓ]DIGO|DESCRI)/i.test(l));
  if (headerIdx < 0) return { ok: false, reason: 'format' };
  const hasCodes = /C[OÓ]DIGO/i.test(lines[headerIdx]);
  const head = lines.slice(0, headerIdx);

  let name = '', cnpj = '', address = '', city = '', state = '', date = '', time = '12:00', number = '', key = '';

  const cnpjAt = head.findIndex(l => /CNPJ\s*:/i.test(l));
  if (cnpjAt >= 0) {
    const m = head[cnpjAt].match(/CNPJ\s*:\s*([\d.\-/ ]+)/i);
    cnpj = m ? m[1].replace(/\D/g, '') : '';
  }

  const dataLine = head.find(l => /\bDATA\s*:\s*\d{4}-\d{2}-\d{2}/i.test(l));
  if (dataLine) {
    // Formato 1
    const m = dataLine.match(/DATA\s*:\s*(\d{4}-\d{2}-\d{2})(?:\s+HORA\s*:\s*([\d:]+))?(?:\s+EXTRATO\s*N[ºo°.]*\s*:?\s*(\S+))?/i);
    if (m) { date = m[1]; time = hhmm(m[2] || ''); number = receiptNo(m[3] || ''); }
    const nonRule = head.map(l => l.trim()).filter(l => l && !isRule(l));
    name = nonRule[0] || '';
    const afterCnpj = cnpjAt >= 0 ? head.slice(cnpjAt + 1).map(l => l.trim()).find(l => l && !isRule(l)) : '';
    if (afterCnpj && !/^(DATA|CUPOM)\b/i.test(afterCnpj)) {
      const a = parseAddressLine(afterCnpj);
      address = a.address; city = a.city; state = a.state;
    }
  } else {
    // Formato 2 (o que o app exporta)
    const dm = head.map(l => l.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}:\d{2}))?/)).find(Boolean);
    if (!dm) return { ok: false, reason: 'format' };
    date = `${dm[3]}-${dm[2]}-${dm[1]}`; time = hhmm(dm[4] || '');
    const nm = head.map(l => l.match(/EXTRATO\s*N[ºo°.]*\s*:?\s*(\S+)/i)).find(Boolean);
    number = receiptNo(nm ? nm[1] : '');
    const body = head.map(l => l.trim()).filter(l => l && !isRule(l));
    const stop = body.findIndex(l => /CNPJ\s*:/i.test(l));
    const top = stop >= 0 ? body.slice(0, stop) : body.slice(0, 3);
    name = top[0] || '';
    if (top.length >= 3) {
      address = top[1];
      const cm = top[2].match(CITY_B);
      if (cm) { city = cm[1].trim(); state = cm[2].toUpperCase(); if (cm[3] && address && !/CEP/i.test(address)) address = `${address} - CEP: ${cm[3]}`; }
    } else if (top.length === 2) {
      const cm = top[1].match(CITY_B);
      if (cm) { city = cm[1].trim(); state = cm[2].toUpperCase(); } else address = top[1];
    }
    if (/^ENDERE[CÇ]O NAO INFORMADO/i.test(address)) address = '';
  }

  const ck = text.match(/Chave\s+Autentica[cç][aã]o[^:]*:\s*([^\s]+)/i);
  key = ck ? ck[1] : '';

  // itens: entre o cabeçalho e a linha "TOTAL R$"
  const items: ReceiptItem[] = [];
  let totalLineIdx = lines.findIndex((l, i) => i > headerIdx && /^\s*TOTAL\s*R\$/i.test(l));
  if (totalLineIdx < 0) totalLineIdx = lines.length;
  for (let i = headerIdx + 1; i < totalLineIdx; i++) {
    const row = parseRow(lines[i], hasCodes);
    if (!row) continue;
    const q = row.quantity > 0 ? row.quantity : 1;
    const code = cleanCode(row.code);
    const item: ReceiptItem = {
      description: row.description,
      quantity: q,
      unitPrice: row.unitPrice,
      totalPrice: row.total,
      category: 'Outros',
      unitType: row.unit || 'UN',
    };
    if (code) item.code = code;
    items.push(item);
  }
  if (items.length === 0) return { ok: false, reason: 'noitems' };

  let total = 0;
  if (totalLineIdx < lines.length) {
    const tm = lines[totalLineIdx].match(/TOTAL\s*R\$\s*([\d.,]+)/i);
    total = tm ? num(tm[1]) : 0;
  }
  if (!(total > 0)) total = Number(items.reduce((s, it) => s + it.totalPrice, 0).toFixed(2));

  const uuid = key.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const id = uuid ? uuid[0].toLowerCase() : `txt-${fnv([cnpj, date, time, total.toFixed(2), number, items.length, items.map(i => i.description).join('|')].join('#'))}`;

  const receipt: Receipt = {
    id,
    establishmentName: name,
    cnpj,
    address,
    city,
    state,
    date: date || (fileName.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '',
    time,
    totalAmount: total,
    items,
    scannedAt: new Date().toISOString(),
  };
  if (number) receipt.receiptNumber = number;
  return { ok: true, receipt };
};

/* ───────────────────────────── arquivos ───────────────────────────── */

export interface TxtFile { name: string; text: string }

/** O arquivo é cupom em texto (um .txt) ou um .zip que só tem .txt? Devolve os textos; null se não for. */
export const readTxtReceipts = async (file: File): Promise<TxtFile[] | null> => {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b;
  if (isZip) {
    const Zip = (JSZip as any).default || JSZip;
    const zip = await Zip.loadAsync(await file.arrayBuffer());
    const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && !/(^|\/)(__MACOSX|\.DS_Store)/.test(n));
    if (names.some(n => /\.json$/i.test(n))) return null;   // backup do app: segue o caminho de sempre
    const txts = names.filter(n => /\.txt$/i.test(n));
    if (txts.length === 0) return null;
    const out: TxtFile[] = [];
    for (const n of txts) out.push({ name: n.split('/').pop() || n, text: await zip.files[n].async('string') });
    return out;
  }
  const text = await file.text();
  const t = text.replace(/^﻿/, '').trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return null;    // JSON
  if (!/(^|\n)\s*(ITEM|IT)\s+(C[OÓ]DIGO|DESCRI)/i.test(text)) return null;
  return [{ name: file.name, text }];
};

export interface TxtBatch {
  receipts: Receipt[];
  /** arquivos lidos */
  files: number;
  /** cupons sem nenhum item (total zerado): não entram */
  empty: number;
  /** arquivos que não são cupom */
  invalid: number;
  /** itens com código de barras do fabricante / com código da loja */
  withEan: number;
  withStoreCode: number;
  items: number;
}

export const parseReceiptTexts = (files: TxtFile[], isEan: (code: string) => boolean): TxtBatch => {
  const batch: TxtBatch = { receipts: [], files: files.length, empty: 0, invalid: 0, withEan: 0, withStoreCode: 0, items: 0 };
  const seen = new Set<string>();
  files.forEach(f => {
    const r = parseReceiptText(f.text, f.name);
    if ('reason' in r) { if (r.reason === 'noitems') batch.empty++; else batch.invalid++; return; }
    if (seen.has(r.receipt.id)) return;     // o mesmo cupom duas vezes dentro do mesmo arquivo
    seen.add(r.receipt.id);
    batch.receipts.push(r.receipt);
    r.receipt.items.forEach(it => {
      batch.items++;
      if (it.code) { if (isEan(it.code)) batch.withEan++; else batch.withStoreCode++; }
    });
  });
  return batch;
};

/* ───────────────────────────── entrada no histórico ───────────────────────────── */

export interface ImportContext {
  establishments: Establishment[];
  masterProducts: MasterProduct[];
  categories: string[];
  /** cupons que o app já tem (para não duplicar) */
  existing: Receipt[];
}

export interface ImportOutcome {
  added: Receipt[];
  duplicates: number;
  /** cupons cuja loja já estava no cadastro (pelo CNPJ) */
  knownStores: number;
  /** itens reconhecidos pelo catálogo de produtos do app */
  knownItems: number;
  /** itens que ficaram sem categoria própria ("Outros") */
  uncategorized: number;
  items: number;
  /** itens com código de barras do fabricante (EAN válido), com código da loja e com um código de barras que não fecha a conta */
  withEan: number;
  withStoreCode: number;
  withSuspectCode: number;
}

const isDefaultTime = (t: string) => !t || t === '12:00';

// Mesmo cupom: mesma chave, ou mesma loja, dia e total (e a hora, quando as duas são conhecidas).
export const sameReceipt = (a: Receipt, b: Receipt): boolean => {
  if (a.id && a.id === b.id) return true;
  // mesma regra tolerante da tela "Cupons repetidos": nome da loja diferente (com/sem filial) ou CNPJ ausente não esconde o repetido
  if (isSameCupom(a, b)) return true;
  if (a.date !== b.date || Math.abs(a.totalAmount - b.totalAmount) >= 0.01) return false;
  const ka = normStoreKey(a.cnpj || a.establishmentName), kb = normStoreKey(b.cnpj || b.establishmentName);
  if (ka && kb ? ka !== kb : a.establishmentName !== b.establishmentName) return false;
  return a.time === b.time || isDefaultTime(a.time) || isDefaultTime(b.time);
};

const breathe = () => new Promise<void>(res => setTimeout(res, 0));

/**
 * Passa os cupons lidos do texto pelo mesmo cadastro que vale para um cupom lido da foto: loja pelo CNPJ, produto pelo
 * código e pelo nome (catálogo). Em lotes, devolvendo o fôlego à tela, porque são centenas de cupons.
 */
export const applyTxtImport = async (
  receipts: Receipt[],
  ctx: ImportContext,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportOutcome> => {
  const out: ImportOutcome = { added: [], duplicates: 0, knownStores: 0, knownItems: 0, uncategorized: 0, items: 0, withEan: 0, withStoreCode: 0, withSuspectCode: 0 };
  const registry = ctx.establishments.map(e => ({ ...e }));
  const masterIndex = buildMasterIndex(ctx.masterProducts);
  const ordered = [...receipts].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  let i = 0;
  for (const r of ordered) {
    const res = applyRegistry(r, { establishments: registry, masterIndex, categories: ctx.categories });
    learnEstablishment(registry, res);
    const a = auditAndRepairReceipt(res.receipt) as Receipt;
    if (ctx.existing.some(ex => sameReceipt(a, ex)) || out.added.some(ex => sameReceipt(a, ex))) out.duplicates++;
    else {
      out.added.push(a);
      if (res.matched) out.knownStores++;
      a.items.forEach(it => {
        out.items++;
        if (!it.category || it.category === 'Outros') out.uncategorized++;
        if (it.code) {
          const k = codeKind(it.code);
          if (k === 'ean') out.withEan++; else if (k === 'suspect') out.withSuspectCode++; else out.withStoreCode++;
        }
      });
      const known = res.notes.map(n => n.match(/^(\d+) de \d+ itens já estão no catálogo/)).find(Boolean);
      if (known) out.knownItems += Number(known[1]);
    }
    if (++i % 15 === 0) { onProgress?.(i, ordered.length); await breathe(); }
  }
  onProgress?.(ordered.length, ordered.length);
  // do mais novo para o mais antigo, como o app guarda os cupons lidos
  out.added.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  return out;
};
