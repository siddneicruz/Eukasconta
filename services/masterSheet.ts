// A planilha da tabela mãe: duas abas.
//   Estrutura  → Departamento | Categoria | Grupo | Item   (uma linha por caminho; Grupo e Item podem ficar vazios)
//   Produtos   → Código | Descrição | Unidade | Departamento | Categoria | Grupo | Item
// Lê o arquivo no navegador, valida e só então o administrador publica.
import * as XLSX from 'xlsx';
import { TaxonomyNode } from '../types';
import { properCase } from './textFormat';
import { cleanCode, normStoreKey } from './productCodes';
import type { PublishPayload } from './masterService';

export class MasterSheetError extends Error {}

const plain = (s: unknown): string => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const cell = (v: unknown): string => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
  return String(v).replace(/\s+/g, ' ').trim();
};
const pathKey = (path: string[]) => path.map(p => plain(p)).join('>');

const HEAD: Record<string, string[]> = {
  dept: ['departamento', 'n1'], cat: ['categoria', 'n2'], grp: ['grupo', 'subcategoria', 'n3'], item: ['item', 'n4'],
  code: ['codigo', 'cod'], ean: ['ean', 'gtin', 'codigo de barras'], cnpj: ['cnpj', 'loja cnpj'], store: ['loja', 'estabelecimento'], native: ['codigo na loja', 'codigo da loja', 'codigo nativo', 'codigo loja'], desc: ['descricao', 'produto', 'nome'], unit: ['unidade', 'un', 'unid', 'unit'],
};
const findCol = (headers: string[], keys: string[], used: Set<number>): number => {
  const hs = headers.map(plain);
  let i = hs.findIndex((h, ix) => !used.has(ix) && keys.includes(h));
  if (i < 0) i = hs.findIndex((h, ix) => !used.has(ix) && keys.some(k => h.startsWith(k)));
  if (i >= 0) used.add(i);
  return i;
};
const sheetRows = (wb: XLSX.WorkBook, names: string[]): any[][] | null => {
  const name = wb.SheetNames.find(n => names.includes(plain(n)));
  if (!name) return null;
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, raw: true }) as any[][];
};

export interface ParsedMaster {
  payload: PublishPayload;
  errors: string[];
  warnings: string[];
  counts: { nodes: number; products: number; unmapped: number; eans: number; storeCodes: number };
}

export const parseMasterWorkbook = async (file: File): Promise<ParsedMaster> => {
  let wb: XLSX.WorkBook;
  try { wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }); }
  catch { throw new MasterSheetError('Não consegui abrir esse arquivo. Use um .xlsx.'); }
  const est = sheetRows(wb, ['estrutura', 'taxonomia', 'categorias']);
  if (!est || est.length < 2) throw new MasterSheetError('Não achei a aba "Estrutura" com linhas. Baixe o modelo para ver o formato.');

  const errors: string[] = [], warnings: string[] = [];
  const eh = est[0].map(cell);
  const used = new Set<number>();
  const col = { dept: findCol(eh, HEAD.dept, used), cat: findCol(eh, HEAD.cat, used), grp: findCol(eh, HEAD.grp, used), item: findCol(eh, HEAD.item, used) };
  if (col.dept < 0 || col.cat < 0) throw new MasterSheetError('Na aba "Estrutura" faltam as colunas Departamento e Categoria.');

  const nodes: { path: string[] }[] = [];
  const known = new Set<string>();
  const canon = new Map<string, string[]>();
  const add = (path: string[]) => { const k = pathKey(path); if (!known.has(k)) { known.add(k); canon.set(k, path); nodes.push({ path }); } };
  let last: string[] = ['', '', '', ''];
  for (let r = 1; r < est.length; r++) {
    const row = est[r] || [];
    const got = [col.dept, col.cat, col.grp, col.item].map(c => (c >= 0 ? cell(row[c]) : ''));
    if (got.every(x => !x)) continue;
    // célula vazia acima do que foi preenchido = igual à linha de cima (planilha agrupada)
    const lastFilled = got.reduce((a, v, i) => (v ? i : a), -1);
    const full = got.map((v, i) => (!v && i < lastFilled ? last[i] : v));
    if (full.slice(0, lastFilled + 1).some(v => !v)) { errors.push(`Estrutura, linha ${r + 1}: tem nível preenchido sem o de cima.`); continue; }
    for (let l = 1; l <= lastFilled + 1; l++) add(full.slice(0, l).map(v => properCase(v)));
    last = full.map((v, i) => (i <= lastFilled ? v : ''));
  }
  if (nodes.length === 0) throw new MasterSheetError('A aba "Estrutura" não tem nenhuma categoria válida.');
  nodes.forEach(n => { if (n.path.some(p => p.length > 80)) errors.push(`Nome longo demais: ${n.path[n.path.length - 1].slice(0, 40)}…`); });

  const products: PublishPayload['products'] = [];
  let unmapped = 0;
  const prow = sheetRows(wb, ['produtos', 'produto', 'itens']);
  if (prow && prow.length > 1) {
    const ph = prow[0].map(cell);
    const u2 = new Set<number>();
    const pc = { code: findCol(ph, HEAD.code, u2), desc: findCol(ph, HEAD.desc, u2), unit: findCol(ph, HEAD.unit, u2), ean: findCol(ph, HEAD.ean, u2), dept: findCol(ph, HEAD.dept, u2), cat: findCol(ph, HEAD.cat, u2), grp: findCol(ph, HEAD.grp, u2), item: findCol(ph, HEAD.item, u2) };
    if (pc.code < 0 || pc.desc < 0) throw new MasterSheetError('Na aba "Produtos" faltam as colunas Código e Descrição.');
    const byCode = new Map<string, number>();
    for (let r = 1; r < prow.length; r++) {
      const row = prow[r] || [];
      const code = cell(row[pc.code]).replace(/\s+/g, '');
      const description = cell(row[pc.desc]);
      if (!code && !description) continue;
      if (!code || !description) { warnings.push(`Produtos, linha ${r + 1}: precisa de código e descrição; foi ignorada.`); continue; }
      const raw = [pc.dept, pc.cat, pc.grp, pc.item].map(c => (c >= 0 ? cell(row[c]) : ''));
      const lastFilled = raw.reduce((a, v, i) => (v ? i : a), -1);
      const path = raw.slice(0, lastFilled + 1).map(v => properCase(v));
      if (path.length === 0) { unmapped++; warnings.push(`Produtos, linha ${r + 1}: "${description.slice(0, 40)}" ficou sem categoria.`); }
      else {
        // caminho com buraco ou que não existe na Estrutura: o produto fica no ponto mais fundo que existe (nunca sem categoria, se ao menos o departamento existe)
        let keep = path.findIndex(p => !p); if (keep < 0) keep = path.length;
        while (keep > 0 && !known.has(pathKey(path.slice(0, keep)))) keep--;
        if (keep === path.length) path.splice(0, path.length, ...canon.get(pathKey(path))!);
        else if (keep > 0) {
          const from = path.filter(Boolean).join(' › ');
          path.length = keep; path.splice(0, path.length, ...canon.get(pathKey(path))!);
          warnings.push(`Produtos, linha ${r + 1}: "${from}" não existe na aba Estrutura; o produto ficou em "${path.join(' › ')}".`);
        } else { unmapped++; warnings.push(`Produtos, linha ${r + 1}: "${path.filter(Boolean).join(' › ')}" não existe na aba Estrutura; o produto ficou sem categoria.`); path.length = 0; }
      }
      const unit = pc.unit >= 0 ? cell(row[pc.unit]).toUpperCase() : '';
      const eans = pc.ean >= 0 ? cell(row[pc.ean]).split(/[;,\n]/).map(x => cleanCode(x)).filter(Boolean) : undefined;
      const item: PublishPayload['products'][number] = { code, description, unit: unit || undefined, path, ...(eans ? { eans } : {}) };
      if (byCode.has(code)) { products[byCode.get(code)!] = item; warnings.push(`Produtos, linha ${r + 1}: código ${code} repetido; vale a última linha.`); }
      else { byCode.set(code, products.length); products.push(item); }
    }
  }
  // aba "Códigos das lojas": código mãe | CNPJ | Loja | Código na loja
  let storeCodes = 0;
  const crow = sheetRows(wb, ['codigos das lojas', 'codigos lojas', 'codigos nativos']);
  if (crow && crow.length > 1) {
    const ch = crow[0].map(cell);
    const u3 = new Set<number>();
    const cc = { code: findCol(ch, HEAD.code, u3), cnpj: findCol(ch, HEAD.cnpj, u3), store: findCol(ch, HEAD.store, u3), native: findCol(ch, HEAD.native, u3) };
    if (cc.code < 0 || cc.native < 0 || (cc.cnpj < 0 && cc.store < 0)) {
      warnings.push('Aba de códigos das lojas: faltam colunas (Código, CNPJ ou Loja, Código na loja); foi ignorada.');
    } else {
      const idx = new Map(products.map((p, i) => [p.code, i] as const));
      for (let r = 1; r < crow.length; r++) {
        const row = crow[r] || [];
        const mc = cell(row[cc.code]).replace(/\s+/g, '');
        const native = cleanCode(cell(row[cc.native]));
        if (!mc && !native) continue;
        const key = normStoreKey(cc.cnpj >= 0 && cell(row[cc.cnpj]) ? cell(row[cc.cnpj]) : cell(row[cc.store]));
        const i = idx.get(mc);
        if (i === undefined) { warnings.push(`Códigos das lojas, linha ${r + 1}: o produto ${mc || '(sem código)'} não está na aba Produtos.`); continue; }
        if (!native || !key) { warnings.push(`Códigos das lojas, linha ${r + 1}: precisa de loja (CNPJ ou nome) e código na loja.`); continue; }
        const p = products[i];
        p.stores = p.stores || [];
        if (!p.stores.some(x => x.key === key && x.code === native)) { p.stores.push({ key, name: cc.store >= 0 ? cell(row[cc.store]) || undefined : undefined, code: native }); storeCodes++; }
      }
    }
  }
  const eanCount = products.reduce((n, p) => n + (p.eans?.length || 0), 0);
  const typeRows = sheetRows(wb, ['tipos de loja', 'tipos de estabelecimento', 'tipos']);
  const storeTypes: string[] = [];
  (typeRows || []).slice(1).forEach(r => { const t = properCase(cell(r[0])); if (t && !storeTypes.some(x => plain(x) === plain(t))) storeTypes.push(t); });
  const lojaRows = sheetRows(wb, ['lojas', 'estabelecimentos', 'apelidos']);
  const stores: { cnpj: string; name: string; type: string; address: string; city: string; state: string; cep: string; legalName: string }[] = [];
  if (lojaRows && lojaRows.length > 1) {
    const lh = lojaRows[0].map(cell); const lu = new Set<number>();
    const lc = { cnpj: findCol(lh, ['cnpj'], lu), name: findCol(lh, ['apelido', 'nome'], lu), type: findCol(lh, ['tipo'], lu), legal: findCol(lh, ['razao social', 'razao'], lu), cep: findCol(lh, ['cep'], lu), address: findCol(lh, ['endereco', 'logradouro'], lu), city: findCol(lh, ['cidade', 'municipio'], lu), state: findCol(lh, ['uf', 'estado'], lu) };
    if (lc.cnpj >= 0) lojaRows.slice(1).forEach((r, i) => {
      const d = cell(r[lc.cnpj]).replace(/\D/g, '');
      if (!d) return;
      if (d.length !== 14 && d.length !== 11) { warnings.push(`Aba Lojas, linha ${i + 2}: CNPJ "${cell(r[lc.cnpj])}" não tem 14 números; ignorada.`); return; }
      const type = lc.type >= 0 ? properCase(cell(r[lc.type])) : '';
      if (type && storeTypes.length && !storeTypes.some(x => plain(x) === plain(type))) warnings.push(`Aba Lojas, linha ${i + 2}: o tipo "${type}" não está na aba Tipos de loja.`);
      stores.push({ cnpj: d, name: lc.name >= 0 ? cell(r[lc.name]) : '', type, legalName: lc.legal >= 0 ? cell(r[lc.legal]) : '', cep: lc.cep >= 0 ? cell(r[lc.cep]).replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2') : '',
        address: lc.address >= 0 ? cell(r[lc.address]) : '', city: lc.city >= 0 ? cell(r[lc.city]) : '', state: lc.state >= 0 ? cell(r[lc.state]).toUpperCase() : '' });
    });
  }
  return { payload: { nodes, products, ...(storeTypes.length ? { storeTypes } : {}), ...(stores.length ? { stores } : {}) }, errors, warnings, counts: { nodes: nodes.length, products: products.length, unmapped, eans: eanCount, storeCodes } };
};

export interface MasterDiff { added: string[]; removed: string[]; kept: number }

/** O que muda na estrutura publicada: caminhos novos e caminhos que somem. */
export const diffStructure = (current: TaxonomyNode[], next: PublishPayload['nodes']): MasterDiff => {
  const byId = new Map(current.map(n => [n.id, n] as const));
  const pathOf = (n: TaxonomyNode): string[] => { const out: string[] = []; let c: TaxonomyNode | undefined = n; let g = 0; while (c && g++ < 6) { out.unshift(c.name); c = c.parentId ? byId.get(c.parentId) : undefined; } return out; };
  const have = new Map(current.map(n => { const p = pathOf(n); return [pathKey(p), p.join(' › ')] as const; }));
  const want = new Map(next.map(n => [pathKey(n.path), n.path.join(' › ')] as const));
  const added = [...want].filter(([k]) => !have.has(k)).map(([, v]) => v);
  const removed = [...have].filter(([k]) => !want.has(k)).map(([, v]) => v);
  return { added, removed, kept: want.size - added.length };
};

// ---- gerar a planilha ----

export interface SheetProduct { code: string; description: string; unit?: string; path: string[]; eans?: string[]; stores?: { key: string; name?: string; code: string }[] }

const leafPaths = (nodes: TaxonomyNode[]): string[][] => {
  const byId = new Map(nodes.map(n => [n.id, n] as const));
  const hasKids = new Set<string>();
  nodes.forEach(n => { if (n.parentId) hasKids.add(n.parentId); });
  const pathOf = (n: TaxonomyNode): string[] => { const out: string[] = []; let c: TaxonomyNode | undefined = n; let g = 0; while (c && g++ < 6) { out.unshift(c.name); c = c.parentId ? byId.get(c.parentId) : undefined; } return out; };
  return nodes.filter(n => !hasKids.has(n.id)).map(pathOf).sort((a, b) => a.join('\u0001').localeCompare(b.join('\u0001'), 'pt-BR'));
};

/** Lojas do cadastro deste aparelho que a tabela mãe ainda não tem (por CNPJ/CPF), prontas para entrar na aba Lojas. */
export const storesFromLocal = (
  known: { cnpj: string }[],
  local: { cnpj?: string; originalName?: string; aliasName?: string; type?: string; address?: string; cep?: string; city?: string; state?: string }[],
): { cnpj: string; name: string; type: string; address: string; city: string; state: string; cep: string; legalName: string }[] => {
  const have = new Set(known.map(k => String(k.cnpj).replace(/\D/g, '')));
  const out: ReturnType<typeof storesFromLocal> = [];
  local.forEach(e => {
    const d = String(e.cnpj || '').replace(/\D/g, '');
    if (d.length !== 14 && d.length !== 11) return;
    if (have.has(d)) return;
    have.add(d);
    const raw = String(e.originalName || '').trim();
    out.push({ cnpj: d, name: String(e.aliasName || '').trim(), type: String(e.type || '').trim(), address: String(e.address || '').trim(), city: String(e.city || '').trim(), state: String(e.state || '').trim().toUpperCase(), cep: String(e.cep || '').trim(), legalName: /identificado via ocr/i.test(raw) ? '' : properCase(raw) });
  });
  return out;
};

export const downloadMasterWorkbook = (nodes: TaxonomyNode[], products: SheetProduct[], fileName = 'tabela-mae-eukasconta.xlsx', storeTypes: string[] = [], stores: { cnpj: string; name: string; type: string; address?: string; city?: string; state?: string; cep?: string; legalName?: string }[] = []) => {
  const wb = XLSX.utils.book_new();
  const est = XLSX.utils.aoa_to_sheet([['Departamento', 'Categoria', 'Grupo', 'Item'], ...leafPaths(nodes).map(p => [p[0] || '', p[1] || '', p[2] || '', p[3] || ''])]);
  est['!cols'] = [{ wch: 28 }, { wch: 28 }, { wch: 28 }, { wch: 28 }];
  est['!freeze'] = { xSplit: 0, ySplit: 1 } as any;
  XLSX.utils.book_append_sheet(wb, est, 'Estrutura');
  const sorted = [...products].sort((a, b) => a.path.join('\u0001').localeCompare(b.path.join('\u0001'), 'pt-BR') || a.description.localeCompare(b.description, 'pt-BR'));
  const prod = XLSX.utils.aoa_to_sheet([['Código', 'Descrição', 'Unidade', 'Departamento', 'Categoria', 'Grupo', 'Item', 'EAN'],
    ...sorted.map(p => [p.code, p.description, p.unit || '', p.path[0] || '', p.path[1] || '', p.path[2] || '', p.path[3] || '', (p.eans || []).join('; ')])]);
  prod['!cols'] = [{ wch: 18 }, { wch: 44 }, { wch: 9 }, { wch: 26 }, { wch: 26 }, { wch: 26 }, { wch: 26 }, { wch: 30 }];
  Object.keys(prod).forEach(a => { if (a[0] === 'H' && a !== 'H1' && prod[a] && prod[a].t === 'n') { prod[a].t = 's'; prod[a].v = String(prod[a].v); } });
  // código como texto: o Excel não vira número científico
  Object.keys(prod).forEach(a => { if (a[0] === 'A' && a !== 'A1' && prod[a] && prod[a].t === 'n') { prod[a].t = 's'; prod[a].v = String(prod[a].v); } });
  XLSX.utils.book_append_sheet(wb, prod, 'Produtos');
  const storeRows: string[][] = [];
  sorted.forEach(p => (p.stores || []).forEach(st => storeRows.push([p.code, p.description, /^\d{14}$|^\d{11}$/.test(st.key) ? st.key : '', st.name || (st.key.startsWith('n:') ? st.key.slice(2) : ''), st.code])));
  const lojas = XLSX.utils.aoa_to_sheet([['Código', 'Descrição', 'CNPJ', 'Loja', 'Código na loja'], ...storeRows]);
  lojas['!cols'] = [{ wch: 18 }, { wch: 44 }, { wch: 18 }, { wch: 34 }, { wch: 20 }];
  Object.keys(lojas).forEach(a => { if (/^[ACE]/.test(a) && !/^[ACE]1$/.test(a) && lojas[a] && lojas[a].t === 'n') { lojas[a].t = 's'; lojas[a].v = String(lojas[a].v); } });
  XLSX.utils.book_append_sheet(wb, lojas, 'Códigos das lojas');
  const tipos = XLSX.utils.aoa_to_sheet([['Tipo de estabelecimento'], ...(storeTypes.length ? storeTypes : ['Mercado', 'Restaurante e Lanchonete', 'Farmácia', 'Academia']).map(t => [t])]);
  tipos['!cols'] = [{ wch: 34 }];
  XLSX.utils.book_append_sheet(wb, tipos, 'Tipos de loja');
  const lojasAba = XLSX.utils.aoa_to_sheet([['CNPJ', 'Apelido', 'Razão social', 'Tipo', 'Endereço', 'CEP', 'Cidade', 'UF'], ...[...stores].sort((a, b) => (a.name || a.cnpj).localeCompare(b.name || b.cnpj, 'pt-BR')).map(x => [x.cnpj, x.name, x.legalName || '', x.type, x.address || '', x.cep || '', x.city || '', x.state || ''])]);
  lojasAba['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 40 }, { wch: 26 }, { wch: 48 }, { wch: 11 }, { wch: 22 }, { wch: 6 }];
  Object.keys(lojasAba).forEach(a => { if ((a[0] === 'A' || a[0] === 'F') && !/^[AF]1$/.test(a) && lojasAba[a] && lojasAba[a].t === 'n') { lojasAba[a].t = 's'; lojasAba[a].v = String(lojasAba[a].v); } });
  XLSX.utils.book_append_sheet(wb, lojasAba, 'Lojas');
  const help = XLSX.utils.aoa_to_sheet([
    ['Como usar'],
    ['Lojas: CNPJ, Apelido (como a loja aparece em todos os apps), Razão social, Tipo (um dos da aba Tipos de loja), Endereço, CEP, Cidade e UF. Quem já deu apelido, tipo ou endereço à própria loja no app continua vendo o dele.'],
    ['Tipos de loja: uma linha por tipo (Mercado, Restaurante, Farmácia, Academia...). Ao publicar, a lista passa a ser esta em todos os apps.'],
    ['Estrutura: uma linha por caminho (Departamento, Categoria, Grupo, Item). Grupo e Item podem ficar vazios.'],
    ['Produtos: o código (de barras) identifica o produto. Preencha Departamento, Categoria, Grupo e Item como estão na aba Estrutura.'],
    ['EAN: código de barras do fabricante (vários separados por ponto e vírgula). Códigos das lojas: o código que cada loja imprime no cupom para o produto (CNPJ ou nome da loja). O app usa os dois para reconhecer item rasurado ou mal escrito.'],
    ['Produto sem categoria preenchida fica sem mapa; o app do usuário continua classificando pelo nome.'],
    ['Ao publicar, a estrutura do app de todos passa a ser esta, e os itens com código listado vão para a categoria daqui.'],
  ]);
  help['!cols'] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, help, 'Leia-me');
  XLSX.writeFile(wb, fileName);
};
