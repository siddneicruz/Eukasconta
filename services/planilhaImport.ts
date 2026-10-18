// Importar a planilha de compras consolidada (.xlsx, aba "Compras Consolidadas": uma linha por item de cupom).
//
// Modo MESCLAR (o único): nada do que a pessoa já tem é apagado nem sobrescrito.
//   - cupom que o app ainda não tem (pelo ID ou por loja + dia + total + hora) → entra;
//   - cupom que já existe → continua como está; só se preenche o que estiver vazio nos itens dele:
//     categoria ("Outros", sem categoria ou fora da lista) e código do produto.
// Funções puras (não leem localStorage nem usam rede), para testar com a planilha de verdade.

import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { Establishment, MasterProduct, Receipt, ReceiptItem } from '../types';
import { cleanCNPJ } from './productNormalization';
import { cleanCode } from './productCodes';
import { applyTxtImport, sameReceipt } from './receiptTextImport';
import { fold } from './itemSearch';

/* ───────────────────────── leitura ───────────────────────── */

export interface PlanilhaItem {
  idx: number;              // posição do item no cupom (1, 2, 3…)
  code: string;
  description: string;
  clean: string;            // descrição higienizada
  brand: string;
  dept: string; cat: string; sub: string; seg: string;
  qty: number; unit: string; unitPrice: number; total: number;
}

export interface PlanilhaReceipt {
  id: string; date: string; time: string; cnpj: string;
  name: string; alias: string; cep: string; city: string; uf: string;
  items: PlanilhaItem[];
  total: number;
}

export interface Planilha { receipts: PlanilhaReceipt[]; rows: number }

const plain = (s: unknown): string => fold(String(s ?? '')).replace(/[^a-z0-9]+/g, ' ').trim();

const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const isoDate = (v: unknown): string => {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const s = String(v ?? '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}` : '';
};

const hhmm = (v: unknown): string => {
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const mins = Math.round(v * 24 * 60);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  const m = String(v ?? '').match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '12:00';
};

const formatCep = (v: unknown): string => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : '';
};

// cabeçalho → coluna. Cada campo aceita alguns nomes (sem acento, minúsculo); o primeiro que casar vale.
const FIELDS: Record<string, string[]> = {
  id: ['id cupom', 'id do cupom'],
  date: ['data'],
  time: ['hora'],
  cnpj: ['cnpj'],
  name: ['estabelecimento', 'loja'],
  alias: ['apelido'],
  cep: ['cep'],
  city: ['cidade'],
  uf: ['uf', 'estado'],
  idx: ['item'],
  code: ['codigo loja', 'codigo'],
  original: ['descricao original'],
  clean: ['descricao higienizada'],
  brand: ['marca'],
  dept: ['departamento'],
  cat: ['categoria'],
  sub: ['subcategoria'],
  seg: ['segmento'],
  qty: ['quantidade'],
  unit: ['unidade'],
  unitPrice: ['preco unitario'],
  total: ['valor total'],
};

const columnsOf = (header: unknown[]): Record<string, number> | null => {
  const heads = header.map(plain);
  const used = new Set<number>();
  const out: Record<string, number> = {};
  // campos mais específicos primeiro, para "cnpj estabelecimento" não ser lido como o nome da loja
  const order = ['id', 'cnpj', 'alias', 'subcategoria', 'sub', 'seg', 'original', 'clean', 'unitPrice', 'total', 'code', 'date', 'time', 'cep', 'city', 'uf', 'idx', 'brand', 'dept', 'cat', 'qty', 'unit', 'name'];
  for (const f of order) {
    const names = FIELDS[f];
    if (!names) continue;
    const i = heads.findIndex((h, k) => !used.has(k) && names.some(n => (f === 'idx' || f === 'uf' || f === 'date' || f === 'time' || f === 'cep' || f === 'cat' || f === 'dept' || f === 'unit' || f === 'cnpj') ? (h === n || h.startsWith(n + ' ')) : h.includes(n)));
    if (i >= 0) { out[f] = i; used.add(i); }
  }
  // "Categoria (2ª Camada)" vira "categoria 2a camada": o campo "cat" casa por prefixo e "sub" por conter
  return out.id !== undefined && out.total !== undefined && out.date !== undefined ? out : null;
};

/** Linhas da aba (a primeira é o cabeçalho) → cupons. Devolve null se não é a planilha de compras consolidada. */
export const parsePlanilhaRows = (rows: unknown[][]): Planilha | null => {
  if (!rows || rows.length < 2) return null;
  const col = columnsOf(rows[0]);
  if (!col) return null;
  const get = (r: unknown[], f: string): unknown => (col[f] === undefined ? '' : r[col[f]]);
  const byId = new Map<string, PlanilhaReceipt>();
  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => c === undefined || c === null || String(c).trim() === '')) continue;
    const id = String(get(r, 'id') || '').trim();
    const date = isoDate(get(r, 'date'));
    if (!id || !date) continue;
    let rc = byId.get(id);
    if (!rc) {
      rc = {
        id, date, time: hhmm(get(r, 'time')), cnpj: cleanCNPJ(String(get(r, 'cnpj') ?? '')),
        name: String(get(r, 'name') ?? '').trim(), alias: String(get(r, 'alias') ?? '').trim(),
        cep: formatCep(get(r, 'cep')), city: String(get(r, 'city') ?? '').trim(), uf: String(get(r, 'uf') ?? '').trim().toUpperCase(),
        items: [], total: 0,
      };
      byId.set(id, rc);
    }
    const qty = num(get(r, 'qty')) || 1;
    const total = num(get(r, 'total'));
    const unitPrice = num(get(r, 'unitPrice')) || (qty ? total / qty : total);
    const original = String(get(r, 'original') ?? '').trim();
    const clean = String(get(r, 'clean') ?? '').trim();
    rc.items.push({
      idx: Math.round(num(get(r, 'idx'))) || rc.items.length + 1,
      code: cleanCode(get(r, 'code')),
      description: original || clean,
      clean,
      brand: String(get(r, 'brand') ?? '').trim(),
      dept: String(get(r, 'dept') ?? '').trim(), cat: String(get(r, 'cat') ?? '').trim(),
      sub: String(get(r, 'sub') ?? '').trim(), seg: String(get(r, 'seg') ?? '').trim(),
      qty, unit: String(get(r, 'unit') ?? '').trim() || 'UN', unitPrice, total,
    });
    rc.total = Math.round((rc.total + total) * 100) / 100;
    count++;
  }
  const receipts = Array.from(byId.values()).filter(r => r.items.length > 0);
  if (receipts.length === 0) return null;
  receipts.forEach(r => r.items.sort((a, b) => a.idx - b.idx));
  return { receipts, rows: count };
};

/** O arquivo parece uma planilha do Excel (.xlsx)? Só olha o nome e o começo do arquivo. */
export const looksLikeXlsx = async (file: File): Promise<boolean> => {
  if (/\.xlsx?$/i.test(file.name)) return true;
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (!(head[0] === 0x50 && head[1] === 0x4b)) return false;
    const Zip = (JSZip as any).default || JSZip;
    const zip = await Zip.loadAsync(await file.arrayBuffer());
    return !!zip.files['xl/workbook.xml'];
  } catch { return false; }
};

/** Lê a aba de compras da planilha. Null: o arquivo não é a planilha de compras consolidada. */
export const readPlanilha = async (file: File): Promise<Planilha | null> => {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const names = wb.SheetNames;
  const ordered = [...names.filter(n => plain(n).includes('compras')), ...names.filter(n => !plain(n).includes('compras'))];
  for (const n of ordered) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false, raw: true });
    const p = parsePlanilhaRows(rows);
    if (p) return p;
  }
  return null;
};

/* ───────────────────────── categoria da planilha → categoria do app ───────────────────────── */

export type CategoryResolver = (dept: string, cat: string) => string;

/** "Limpeza e Casa" + "Limpeza da Cozinha" → a categoria de mesmo nome na lista do app ("" se não existe). */
export const makeCategoryResolver = (categories: string[]): CategoryResolver => {
  const full = new Map<string, string>();
  const byL2 = new Map<string, string[]>();
  categories.forEach(c => {
    full.set(plain(c), c);
    const i = c.indexOf(' - ');
    if (i > 0) { const k = plain(c.slice(i + 3)); const a = byL2.get(k); if (a) a.push(c); else byL2.set(k, [c]); }
  });
  return (dept, cat) => {
    if (!dept && !cat) return '';
    if (!cat) return full.get(plain(dept)) || '';
    const hit = full.get(plain(`${dept} - ${cat}`));
    if (hit) return hit;
    // o departamento mudou de nome (categorias juntadas), mas a categoria continua com o mesmo nome em outro lugar
    const l2 = byL2.get(plain(cat));
    return l2 && l2.length === 1 ? l2[0] : '';
  };
};

/* ───────────────────────── mesclar ───────────────────────── */

const toReceipt = (p: PlanilhaReceipt, resolve: CategoryResolver): Receipt => ({
  id: p.id,
  establishmentName: p.name,
  cnpj: p.cnpj,
  address: '',
  city: p.city,
  state: p.uf,
  date: p.date,
  time: p.time,
  totalAmount: p.total,
  items: p.items.map(it => ({
    description: it.description,
    quantity: it.qty,
    unitPrice: it.unitPrice,
    totalPrice: it.total,
    category: resolve(it.dept, it.cat) || 'Outros',
    unitType: it.unit,
    ...(it.code ? { code: it.code } : {}),
  } as ReceiptItem)),
  scannedAt: new Date().toISOString(),
});

const sameDesc = (a: string, b: string): boolean => {
  const x = plain(a), y = plain(b);
  return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
};

/** Item do cupom que já existe que corresponde ao item da planilha (pela posição, conferida pelo código ou nome). */
const findItem = (ex: Receipt, it: PlanilhaItem, taken: Set<number>): number => {
  const items = ex.items || [];
  const ok = (k: number, strict: boolean): boolean => {
    const c = items[k];
    if (!c || taken.has(k)) return false;
    if (it.code && c.code) return c.code === it.code;
    if (sameDesc(c.description, it.description) || sameDesc(c.description, it.clean)) return true;
    return !strict && Math.abs((c.totalPrice || 0) - it.total) < 0.01 && Math.abs((c.quantity || 0) - it.qty) < 0.0001;
  };
  const pos = it.idx - 1;
  if (ok(pos, false)) return pos;
  for (let k = 0; k < items.length; k++) if (ok(k, true)) return k;
  return -1;
};

export interface Enrichment { receipt: Receipt; categories: number; codes: number }

/** Preenche o que falta num cupom que já existe: categoria vazia/"Outros" e código ausente. Nada é sobrescrito. */
export const enrichReceipt = (ex: Receipt, p: PlanilhaReceipt, resolve: CategoryResolver, valid: Set<string>): Enrichment | null => {
  const taken = new Set<number>();
  const next = (ex.items || []).map(i => ({ ...i }));
  let cats = 0, codes = 0;
  p.items.forEach(it => {
    const k = findItem({ ...ex, items: next }, it, taken);
    if (k < 0) return;
    taken.add(k);
    const cur = next[k];
    const unclassified = !cur.category || cur.category === 'Outros' || !valid.has(cur.category);
    const want = resolve(it.dept, it.cat);
    if (unclassified && want && want !== cur.category) { cur.category = want; cats++; }
    if (!cur.code && it.code) { cur.code = it.code; codes++; }
  });
  if (cats === 0 && codes === 0) return null;
  return { receipt: { ...ex, items: next }, categories: cats, codes };
};

export interface PlanilhaContext {
  establishments: Establishment[];
  masterProducts: MasterProduct[];
  categories: string[];
  existing: Receipt[];
}

export interface PlanilhaOutcome {
  /** cupons novos, já passados pelo cadastro de lojas e de produtos (do mais novo para o mais antigo) */
  added: Receipt[];
  /** cupons que já existiam e ganharam categoria/código (a versão nova, para trocar pelo mesmo id) */
  enriched: Receipt[];
  /** cupons da planilha que já estavam no app e não precisaram de nada */
  unchanged: number;
  /** cupons repetidos dentro da própria planilha */
  repeated: number;
  items: number;
  categoriesFilled: number;
  codesFilled: number;
  /** itens novos sem categoria equivalente na lista do app (ficaram em "Outros") */
  uncategorized: number;
  /** lojas que a planilha traz: nome, apelido, CEP, cidade e UF, para completar o cadastro */
  stores: PlanilhaStore[];
}

export interface PlanilhaStore { cnpj: string; name: string; alias: string; cep: string; city: string; uf: string }

export const mergePlanilha = async (
  plan: Planilha,
  ctx: PlanilhaContext,
  onProgress?: (done: number, total: number) => void,
): Promise<PlanilhaOutcome> => {
  const resolve = makeCategoryResolver(ctx.categories);
  const valid = new Set(ctx.categories);
  const out: PlanilhaOutcome = { added: [], enriched: [], unchanged: 0, repeated: 0, items: 0, categoriesFilled: 0, codesFilled: 0, uncategorized: 0, stores: [] };

  // lojas da planilha (uma por CNPJ, ou por nome quando não tem CNPJ)
  const stores = new Map<string, PlanilhaStore>();
  plan.receipts.forEach(p => {
    const k = p.cnpj || `n:${plain(p.name)}`;
    const cur = stores.get(k);
    if (!cur) stores.set(k, { cnpj: p.cnpj, name: p.name, alias: p.alias, cep: p.cep, city: p.city, uf: p.uf });
    else { if (!cur.alias && p.alias) cur.alias = p.alias; if (!cur.cep && p.cep) cur.cep = p.cep; if (!cur.city && p.city) cur.city = p.city; if (!cur.uf && p.uf) cur.uf = p.uf; }
  });
  out.stores = Array.from(stores.values());

  // quem já existe e quem é novo
  const fresh: { p: PlanilhaReceipt; r: Receipt }[] = [];
  const seenIds = new Set<string>();
  plan.receipts.forEach(p => {
    if (seenIds.has(p.id)) { out.repeated++; return; }
    seenIds.add(p.id);
    const r = toReceipt(p, resolve);
    const ex = ctx.existing.find(e => e.id === p.id) || ctx.existing.find(e => sameReceipt(r, e));
    if (!ex) { fresh.push({ p, r }); return; }
    const en = enrichReceipt(ex, p, resolve, valid);
    if (en) {
      out.enriched.push(en.receipt);
      out.categoriesFilled += en.categories;
      out.codesFilled += en.codes;
    } else out.unchanged++;
  });

  // os novos passam pelo mesmo cadastro de lojas e de produtos de um cupom lido (e já ganham a categoria da planilha)
  if (fresh.length > 0) {
    const applied = await applyTxtImport(fresh.map(f => f.r), { establishments: ctx.establishments, masterProducts: ctx.masterProducts, categories: ctx.categories, existing: ctx.existing }, onProgress);
    const byId = new Map(fresh.map(f => [f.p.id, f.p] as const));
    applied.added.forEach(a => {
      const p = byId.get(a.id);
      if (p) {
        const used = new Set<number>();
        a.items = a.items.map((it, k) => {
          const pi = p.items[k] && (sameDesc(it.description, p.items[k].description) || sameDesc(it.description, p.items[k].clean) || (it.code && it.code === p.items[k].code)) ? p.items[k] : p.items.find((q, j) => !used.has(j) && q.code && q.code === it.code);
          if (!pi) return it;
          const want = resolve(pi.dept, pi.cat);
          const next = { ...it };
          if (want) next.category = want;
          if (!next.code && pi.code) next.code = pi.code;
          return next;
        });
      }
      a.items.forEach(it => { out.items++; if (!it.category || it.category === 'Outros') out.uncategorized++; });
      out.added.push(a);
    });
    out.unchanged += applied.duplicates;   // casou com um cupom que o app já tem (ou com outro da própria planilha)
  }
  out.added.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  return out;
};

/** Completa o cadastro de lojas com o que a planilha traz, sem trocar nada que já esteja preenchido. */
export const mergeStores = (current: Establishment[], stores: PlanilhaStore[], addedReceipts: Receipt[]): { list: Establishment[]; added: number; filled: number } => {
  const list = current.map(e => ({ ...e }));
  let added = 0, filled = 0;
  const nameByCnpj = new Map<string, string>();
  addedReceipts.forEach(r => { const c = cleanCNPJ(r.cnpj); if (c && r.establishmentName) nameByCnpj.set(c, r.establishmentName); });
  stores.forEach(s => {
    const c = cleanCNPJ(s.cnpj);
    const found = list.find(e => (c && cleanCNPJ(e.cnpj) === c) || (!c && !cleanCNPJ(e.cnpj) && plain(e.originalName) === plain(s.name)));
    if (found) {
      let touched = false;
      if (!found.aliasName && s.alias) { found.aliasName = s.alias; touched = true; }
      if (!found.cep && s.cep) { found.cep = s.cep; touched = true; }
      if (!found.city && s.city) { found.city = s.city; touched = true; }
      if (!found.state && s.uf) { found.state = s.uf; touched = true; }
      if (touched) filled++;
      return;
    }
    // loja nova só entra se algum cupom novo é dela (as que só têm cupom repetido já estão no cadastro)
    const usedByAdded = addedReceipts.some(r => (c && cleanCNPJ(r.cnpj) === c) || (!c && !cleanCNPJ(r.cnpj) && plain(r.establishmentName) === plain(s.name)));
    if (!usedByAdded) return;
    const e: Establishment = { cnpj: c, originalName: (c && nameByCnpj.get(c)) || s.name };
    if (s.alias) e.aliasName = s.alias;
    if (s.cep) e.cep = s.cep;
    if (s.city) e.city = s.city;
    if (s.uf) e.state = s.uf;
    list.push(e);
    added++;
  });
  return { list, added, filled };
};
