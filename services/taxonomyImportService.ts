// Lê e gera planilhas de taxonomia (4 níveis: Departamento > Categoria >
// Subcategoria > Item) direto no navegador, sem precisar de servidor.
import type * as XLSXTypes from 'xlsx';
let XLSX: typeof XLSXTypes;
const loadXlsx = async (): Promise<void> => { if (!XLSX) XLSX = await import('xlsx'); };   // só carrega quando alguém importa ou baixa uma planilha
import { TaxonomyNode, TaxonomySource } from '../types';
import { slugify } from './taxonomyService';
import { generateId } from './idUtils';
import { downloadFile } from './nativeFiles';

// Nomes de coluna aceitos por nível (minúsculo, sem acento) — flexível o
// bastante pra aceitar variações de cabeçalho sem obrigar um nome exato.
const HEADER_ALIASES: Record<number, string[]> = {
  1: ['departamento', 'n1', 'categoria mestre'],
  2: ['categoria', 'n2'],
  3: ['subcategoria', 'n3'],
  4: ['item', 'n4', 'produto'],
};

const normalizeHeader = (h: string) =>
  h.toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const findColumn = (headers: string[], level: number): number => {
  const aliases = HEADER_ALIASES[level];
  return headers.findIndex(h => aliases.some(a => normalizeHeader(h).includes(a)));
};

export class TaxonomyImportError extends Error {}

// Converte a primeira planilha do arquivo em nós de taxonomia. Espera 4
// colunas (Departamento/Categoria/Subcategoria/Item, em qualquer ordem e
// com nomes parecidos) e uma linha por item — exatamente o formato do
// modelo baixado por downloadTaxonomyTemplate().
export const parseTaxonomyWorkbook = async (file: File): Promise<TaxonomyNode[]> => {
  await loadXlsx();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames.find(n => normalizeHeader(n).includes('taxonomia')) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

  if (rows.length < 2) throw new TaxonomyImportError('Planilha vazia ou sem linhas de dados.');

  const headers = rows[0].map(String);
  const colIndex = {
    1: findColumn(headers, 1),
    2: findColumn(headers, 2),
    3: findColumn(headers, 3),
    4: findColumn(headers, 4),
  };
  // Só Departamento e Categoria são obrigatórios; Subcategoria e Item são opcionais (caminhos de 2, 3 ou 4 camadas).
  const missing = [1, 2].filter(l => colIndex[l as 1 | 2] === -1);
  if (missing.length > 0) {
    throw new TaxonomyImportError(
      `Não encontrei as colunas de nível ${missing.join(', ')}. Use o modelo (Departamento, Categoria, Subcategoria, Item).`
    );
  }
  const cell = (row: any[], idx: number) => (idx >= 0 && row[idx] ? String(row[idx]).trim() : '');

  const nodes: TaxonomyNode[] = [];
  let lastNames: Record<number, string | null> = { 1: null, 2: null, 3: null };
  let lastIds: Record<number, string | null> = { 1: null, 2: null, 3: null };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c === undefined || c === null || String(c).trim() === '')) continue;

    const n1 = cell(row, colIndex[1]);
    const n2 = cell(row, colIndex[2]);
    const n3 = cell(row, colIndex[3]);
    const n4 = n3 ? cell(row, colIndex[4]) : ''; // item sem subcategoria não entra
    if (!n1 || !n2) continue; // precisa de Departamento e Categoria

    if (n1 !== lastNames[1]) {
      const id = generateId();
      nodes.push({ id, parentId: null, level: 1, name: n1, slug: slugify(n1), sourceType: TaxonomySource.SYSTEM, isCustomized: false, lastUpdated: Date.now() });
      lastIds[1] = id; lastNames[1] = n1;
      lastNames[2] = null; lastNames[3] = null;
    }
    if (n2 !== lastNames[2]) {
      const id = generateId();
      nodes.push({ id, parentId: lastIds[1], level: 2, name: n2, slug: slugify(n2), sourceType: TaxonomySource.SYSTEM, isCustomized: false, lastUpdated: Date.now() });
      lastIds[2] = id; lastNames[2] = n2;
      lastNames[3] = null;
    }
    if (!n3) { lastNames[3] = null; continue; }
    if (n3 !== lastNames[3]) {
      const id = generateId();
      nodes.push({ id, parentId: lastIds[2], level: 3, name: n3, slug: slugify(n3), sourceType: TaxonomySource.SYSTEM, isCustomized: false, lastUpdated: Date.now() });
      lastIds[3] = id; lastNames[3] = n3;
    }
    if (n4) nodes.push({ id: generateId(), parentId: lastIds[3], level: 4, name: n4, slug: slugify(n4), sourceType: TaxonomySource.SYSTEM, isCustomized: false, lastUpdated: Date.now() });
  }

  if (nodes.length === 0) throw new TaxonomyImportError('Nenhuma linha válida encontrada na planilha.');
  return nodes;
};

// Gera e baixa um modelo .xlsx com as 4 colunas esperadas e um exemplo,
// pronto pra o usuário preencher e reimportar.
export const downloadTaxonomyTemplate = async () => {
  await loadXlsx();
  const data = [
    ['Departamento', 'Categoria', 'Subcategoria', 'Item'],
    ['Açougue', 'Carne Bovina', 'Cortes Nobres', 'Picanha'],
    ['Açougue', 'Carne Bovina', 'Cortes Nobres', 'Filé Mignon'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Taxonomia');
  void downloadFile(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'modelo-taxonomia-eukasconta.xlsx');
};
