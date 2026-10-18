// Códigos de produto: o que vem impresso na linha do item do cupom e o que o cadastro mestre sabe sobre eles.
//
// Um produto do app (MAE0001…) pode ter, dentro dele:
//   • o código nosso (MAE…), que é a identidade dele no app;
//   • o código do fabricante: o código de barras (EAN/GTIN), igual em qualquer loja;
//   • o código de cada estabelecimento (PLU ou código interno): vale só naquela loja (ou naquela rede).
//
// Com isso, um item cujo nome veio rasurado, cortado ou trocado ainda é reconhecido pelo código.
// Tudo aqui é função pura (não lê localStorage nem chama rede), então dá para testar isolada.

import { MasterProduct } from '../types';
import { cleanDescriptionForMatching } from './descriptionClean';

/* ───────────────────────────── limpeza e tipo do código ───────────────────────────── */

/** Limpa o código lido: maiúsculas, sem espaços, pontos ou traços. "?" marca um dígito ilegível. Vazio se não serve. */
export const cleanCode = (raw: unknown): string => {
  let c = String(raw ?? '').toUpperCase().replace(/[\s.\-_/\\|*#:]/g, '').replace(/[^0-9A-Z?]/g, '');
  if (c.length < 3 || c.length > 20) return '';
  // Leitura de foto troca O por 0 e I/L por 1 dentro de código de barras: só corrige quando o resto é número.
  const letters = (c.match(/[A-Z]/g) || []).length;
  if (c.length >= 8 && letters > 0 && letters <= 2) c = c.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (/^\?+$/.test(c)) return '';
  return c;
};

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/** Confere o dígito verificador (GS1) de um EAN-8, UPC-A, EAN-13 ou GTIN-14. */
export const gtinValid = (digits: string): boolean => {
  if (!/^\d+$/.test(digits) || !GTIN_LENGTHS.has(digits.length)) return false;
  const nums = digits.split('').map(Number);
  const check = nums.pop() as number;
  const sum = nums.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
};

/** Mesmo código de barras com 8, 12, 13 ou 14 dígitos vira sempre 14 (zeros à esquerda). */
export const toGtin14 = (digits: string): string => digits.padStart(14, '0');

// Códigos de barras que começam com 2 (ou 02) são de uso interno da loja (balança, peso variável): não são do fabricante.
const restrictedPrefix = (d: string): boolean =>
  (d.length === 13 && /^0?2/.test(d)) || ((d.length === 12 || d.length === 8) && d[0] === '2');

/**
 * ean     = código de barras do fabricante, com dígito verificador certo
 * store   = código da loja (PLU, interno, balança, alfanumérico)
 * suspect = parece código de barras mas o dígito verificador não fecha: provável erro de leitura
 * partial = tem dígito ilegível ("?")
 */
export type CodeKind = 'ean' | 'store' | 'suspect' | 'partial';

/** Uma mudança nos códigos de um produto, feita pela pessoa na tela (ver ProductCodesPanel). */
export type CodeOp =
  | { kind: 'addEan'; ean: string }
  | { kind: 'removeEan'; ean: string }
  | { kind: 'addStore'; storeKey: string; code: string }
  | { kind: 'removeStore'; storeKey: string; code: string };

export const codeKind = (code: string): CodeKind => {
  if (code.includes('?')) return 'partial';
  if (/^\d+$/.test(code) && GTIN_LENGTHS.has(code.length) && !restrictedPrefix(code)) return gtinValid(code) ? 'ean' : 'suspect';
  return 'store';
};

// Códigos antigos vinham colados no começo da descrição ("7891164028756 REQUEIJAO AURORA"): serve de código também.
export const leadingCode = (description: string): string => {
  const m = String(description || '').trim().match(/^(\d{3,14})\b/);
  return m ? m[1] : '';
};

/* ───────────────────────────── loja ───────────────────────────── */

const plain = (s: string): string =>
  String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Nomes que não identificam loja nenhuma: o código lido nesses cupons não pode ser ligado a uma loja.
const NO_STORE = new Set(['estabelecimento desconhecido', 'geral', 'desconhecido']);

/** Chave estável da loja: CNPJ só com dígitos, ou o nome simplificado ("n:nome") quando não há CNPJ. Vazio se não há como saber. */
export const normStoreKey = (raw: unknown): string => {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^n:./.test(s)) return s;
  const d = s.replace(/\D/g, '');
  if (/^[\d./\-\s]+$/.test(s) && (d.length === 14 || d.length === 11)) return d;
  const p = plain(s);
  return !p || NO_STORE.has(p) ? '' : `n:${p}`;
};

/** A raiz do CNPJ (8 primeiros dígitos) é da empresa: filiais da mesma rede costumam usar os mesmos códigos. */
const rootOf = (storeKey: string): string => (/^\d{14}$/.test(storeKey) ? storeKey.slice(0, 8) : '');

/* ───────────────────────────── códigos dentro do produto ───────────────────────────── */

export const codesOf = (v: string | string[] | undefined | null): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).map(x => String(x).trim()).filter(Boolean);

/** Acrescenta o código da loja ao produto (sem repetir). Um só código continua texto; vários viram lista. */
export const addStoreCode = (m: MasterProduct, storeKey: string, code: string): boolean => {
  if (!storeKey || !code) return false;
  const cur = codesOf(m.establishmentCodes?.[storeKey]);
  if (cur.includes(code)) return false;
  m.establishmentCodes = { ...(m.establishmentCodes || {}) };
  m.establishmentCodes[storeKey] = cur.length === 0 ? code : [...cur, code];
  return true;
};

export const addEan = (m: MasterProduct, ean: string): boolean => {
  const g = toGtin14(ean);
  if ((m.eans || []).some(e => toGtin14(e) === g)) return false;
  m.eans = [...(m.eans || []), ean];
  return true;
};

/** Os códigos de um produto, prontos para mostrar: o nosso, o do fabricante e os de cada loja. */
export const codesOfProduct = (m: MasterProduct): { ours: string; eans: string[]; stores: { storeKey: string; codes: string[] }[] } => ({
  ours: m.code,
  eans: [...(m.eans || [])],
  stores: Object.entries(m.establishmentCodes || {})
    .map(([storeKey, v]) => ({ storeKey, codes: codesOf(v) }))
    .filter(x => x.codes.length > 0),
});

/** A loja mudou de CNPJ ou de nome: os códigos que ela tinha nos produtos passam para a chave nova. */
export const rekeyStoreCodes = (masters: MasterProduct[], fromKeys: string[], toKey: string): MasterProduct[] => {
  const from = new Set(fromKeys.map(normStoreKey).filter(Boolean));
  const to = normStoreKey(toKey);
  if (from.size === 0 || !to) return masters;
  return masters.map(m => {
    const entries = Object.entries(m.establishmentCodes || {});
    if (!entries.some(([k]) => from.has(normStoreKey(k)) && normStoreKey(k) !== to)) return m;
    const next: Record<string, string | string[]> = {};
    const moved: string[] = [];
    entries.forEach(([k, v]) => {
      const nk = normStoreKey(k);
      if (from.has(nk) && nk !== to) moved.push(...codesOf(v)); else next[k] = v;
    });
    const merged = Array.from(new Set([...codesOf(next[to]), ...moved]));
    if (merged.length) next[to] = merged.length === 1 ? merged[0] : merged;
    return { ...m, establishmentCodes: next };
  });
};

/* ───────────────────────────── índice ───────────────────────────── */

export interface CodeIndex {
  byEan: Map<string, MasterProduct>;     // GTIN-14
  byStore: Map<string, MasterProduct>;   // `${loja}|${código}`
  byRoot: Map<string, MasterProduct>;    // `${raiz do CNPJ}|${código}` (mesma rede)
  eans: string[];                        // todos os GTIN-14 conhecidos
  storeCodes: Map<string, { code: string; master: MasterProduct }[]>;   // por loja, para achar código com dígito faltando
}

export const emptyCodeIndex = (): CodeIndex => ({ byEan: new Map(), byStore: new Map(), byRoot: new Map(), eans: [], storeCodes: new Map() });

export const indexEan = (idx: CodeIndex, m: MasterProduct, ean: string): boolean => {
  const g = toGtin14(ean);
  if (idx.byEan.has(g)) return false;
  idx.byEan.set(g, m);
  idx.eans.push(g);
  return true;
};

export const indexStoreCode = (idx: CodeIndex, m: MasterProduct, storeKey: string, code: string): boolean => {
  if (!storeKey || !code) return false;
  const k = `${storeKey}|${code}`;
  if (idx.byStore.has(k)) return false;
  idx.byStore.set(k, m);
  const root = rootOf(storeKey);
  if (root && !idx.byRoot.has(`${root}|${code}`)) idx.byRoot.set(`${root}|${code}`, m);
  const list = idx.storeCodes.get(storeKey) || [];
  list.push({ code, master: m });
  idx.storeCodes.set(storeKey, list);
  return true;
};

export const buildCodeIndex = (masters: MasterProduct[] = []): CodeIndex => {
  const idx = emptyCodeIndex();
  for (const m of masters) {
    (m.eans || []).forEach(e => { const c = cleanCode(e); if (c && /^\d+$/.test(c)) indexEan(idx, m, c); });
    Object.entries(m.establishmentCodes || {}).forEach(([store, v]) => {
      const sk = normStoreKey(store);
      codesOf(v).forEach(c => { const cc = cleanCode(c); if (sk && cc) indexStoreCode(idx, m, sk, cc); });
    });
  }
  return idx;
};

/* ───────────────────────────── achar o produto pelo código ───────────────────────────── */

/** ean/store = código inteiro e conhecido · ean~/store~ = deduzido de um código com defeito (menos certo) */
export type CodeVia = 'ean' | 'store' | 'ean~' | 'store~';

export interface CodeHit { master: MasterProduct; via: CodeVia; code: string }

const distinctMaster = (list: MasterProduct[]): MasterProduct | null => {
  const set = new Set(list);
  return set.size === 1 ? list[0] : null;
};

// Dígitos faltando ("78911640?8756"): procura entre os códigos conhecidos os que casam com o desenho.
const matchPartial = (code: string, storeKey: string, idx: CodeIndex): CodeHit | null => {
  if (code.replace(/\?/g, '').length < 6) return null;   // pouca coisa legível: qualquer código casaria
  const found: { master: MasterProduct; via: CodeVia }[] = [];
  if (/^[\d?]+$/.test(code) && GTIN_LENGTHS.has(code.length)) {
    const re = new RegExp('^' + '0'.repeat(14 - code.length) + code.replace(/\?/g, '\\d') + '$');
    idx.eans.forEach(g => { if (re.test(g)) found.push({ master: idx.byEan.get(g)!, via: 'ean~' }); });
  }
  const reStore = new RegExp('^' + code.replace(/\?/g, '[0-9A-Z]') + '$');
  (idx.storeCodes.get(storeKey) || []).forEach(x => { if (reStore.test(x.code)) found.push({ master: x.master, via: 'store~' }); });
  const m = distinctMaster(found.map(f => f.master));
  return m ? { master: m, via: found.find(f => f.master === m)!.via, code } : null;
};

// Código de barras com o dígito verificador errado: quase sempre é um dígito lido errado (ou dois trocados de lugar).
// Procura um código conhecido a um dígito de distância; só vale se for um só produto.
const matchSuspect = (code: string, idx: CodeIndex): CodeHit | null => {
  const g = toGtin14(code);
  const found: MasterProduct[] = [];
  for (const known of idx.eans) {
    let diff = 0;
    for (let i = 0; i < 14 && diff < 3; i++) if (known[i] !== g[i]) diff++;
    if (diff === 1) { found.push(idx.byEan.get(known)!); continue; }
    if (diff === 2) {
      // dois dígitos vizinhos trocados de lugar
      for (let i = 0; i < 13; i++) {
        if (known[i] !== g[i] && known[i] === g[i + 1] && known[i + 1] === g[i] && known.slice(0, i) === g.slice(0, i) && known.slice(i + 2) === g.slice(i + 2)) { found.push(idx.byEan.get(known)!); break; }
      }
    }
  }
  const m = distinctMaster(found);
  return m ? { master: m, via: 'ean~', code } : null;
};

/**
 * Procura no cadastro o produto que tem este código. Não olha o nome: quem chama decide se o nome combina.
 * Ordem: código de barras conhecido → código da loja → mesma rede → código com defeito.
 */
export const resolveByCode = (rawCode: string, storeKey: string, idx: CodeIndex): CodeHit | null => {
  const code = cleanCode(rawCode);
  if (!code) return null;
  const kind = codeKind(code);

  if (kind === 'ean') {
    const m = idx.byEan.get(toGtin14(code));
    if (m) return { master: m, via: 'ean', code };
  }
  if (kind !== 'partial') {
    const sk = normStoreKey(storeKey);
    if (sk) {
      const own = idx.byStore.get(`${sk}|${code}`);
      if (own) return { master: own, via: 'store', code };
      const root = rootOf(sk);
      const net = root ? idx.byRoot.get(`${root}|${code}`) : undefined;
      if (net) return { master: net, via: 'store', code };
    }
  }
  if (kind === 'partial') return matchPartial(code, normStoreKey(storeKey), idx);
  if (kind === 'suspect') return matchSuspect(code, idx);
  return null;
};

/* ───────────────────────────── nome legível? ───────────────────────────── */

/** O nome lido tem pelo menos uma palavra de verdade (3+ letras, com vogal)? Rasura vira "H?T X" e não passa. */
export const descriptionReadable = (description: string): boolean => {
  const words = String(description || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
  return words.some(w => /[AEIOU]/.test(w));
};

/** Semelhança mínima entre o nome lido e o produto para o código valer. Código de barras inteiro não precisa de nome. */
export const MIN_SIMILARITY: Record<CodeVia, number> = { ean: 0, store: 0.3, 'ean~': 0.5, 'store~': 0.5 };

export interface CodeDecision {
  hit: CodeHit;
  /** semelhança do nome lido com o produto (0 a 1) */
  sim: number;
  /** o nome lido dá para ler? (se não, o código decide sozinho) */
  readable: boolean;
}

/**
 * Decide se o código serve para dizer qual é o produto.
 * Código de barras inteiro e válido vale sozinho. Os outros (da loja, ou lidos com defeito) só valem se o nome lido
 * não contradiz o produto: parecido o bastante, ou rasurado demais para dizer o contrário.
 * `similarity` recebe o nome lido e o produto e devolve de 0 a 1 (quem chama sabe comparar com os apelidos dele).
 */
export const identifyByCode = (
  rawCode: string,
  storeKey: string,
  description: string,
  idx: CodeIndex,
  similarity: (desc: string, m: MasterProduct) => number,
): CodeDecision | null => {
  const hit = resolveByCode(rawCode, storeKey, idx);
  if (!hit) return null;
  const readable = descriptionReadable(description);
  const sim = hit.via === 'ean' || !readable ? 0 : similarity(description, hit.master);
  if (hit.via === 'ean' || !readable || sim >= MIN_SIMILARITY[hit.via]) return { hit, sim, readable };
  return null;
};

/* ───────────────────────────── parecer com um produto ───────────────────────────── */

const wordsOf = (clean: string): string[] => clean.split(' ').filter(w => w.length > 2);

// distância de edição (inserir, tirar ou trocar uma letra), para aceitar "PIMFNTAO" como "PIMENTAO"
const editDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};

// A palavra lida bate com a palavra do produto? Igual, começo (abreviação: FAT = FATIADO), com "?" no lugar de letra
// ilegível, ou com uma letra trocada.
const wordMatches = (w: string, x: string): boolean => {
  if (w === x) return true;
  if (w.length >= 3 && (x.startsWith(w) || (x.length >= 3 && w.startsWith(x)))) return true;
  if (w.includes('?')) {
    const pattern = w.replace(/[^A-Z0-9?]/g, '').replace(/\?/g, '[A-Z0-9]');
    return new RegExp('^' + pattern).test(x);
  }
  const tol = w.length >= 7 ? 2 : w.length >= 4 ? 1 : 0;
  return tol > 0 && editDistance(w, x) <= tol;
};

/**
 * Semelhança "frouxa" (0 a 1) entre o nome lido e um produto que o código já apontou: compara com o nome do produto e
 * com cada nome que já apareceu para ele, e aceita abreviação, letra trocada e "?". `clean` limpa o texto como o app faz
 * para juntar nomes (cleanDescriptionForMatching).
 */
export const looseSimilarity = (description: string, master: MasterProduct): number => {
  const prep = (s: string) => cleanDescriptionForMatching(String(s || '').toUpperCase().replace(/\?/g, '#')).replace(/#/g, '?');
  const clean = prep(description);
  const words = wordsOf(clean);
  if (words.length === 0) return 0;
  let best = 0;
  for (const name of [master.description, ...(master.aliases || [])]) {
    const c = prep(name);
    if (!c) continue;
    if (c === clean) return 1;
    const theirs = wordsOf(c);
    if (theirs.length === 0) continue;
    const set = new Set(theirs);
    let inter = 0;
    words.forEach(w => { if (set.has(w)) inter++; });
    const jaccard = inter / new Set([...words, ...theirs]).size;
    let near = 0;
    words.forEach(w => { if (theirs.some(x => wordMatches(w, x))) near++; });
    best = Math.max(best, jaccard, near / words.length);
  }
  return best;
};

/* ───────────────────────────── código colado no nome ───────────────────────────── */

/** Modelos que ignoram o campo "code" deixam o código na frente do nome ("16059 BATATA MONALISA"): separa os dois. */
export const splitLeadingCode = <T extends { description: string; code?: string }>(item: T): T => {
  if (cleanCode(item.code)) return item;
  const m = String(item.description || '').trim().match(/^(\d{4,14})[\s\-–.:]+(\S.*)$/);
  if (!m || !descriptionReadable(m[2])) return item;
  const code = cleanCode(m[1]);
  return code ? { ...item, code, description: m[2].trim() } : item;
};

/* ───────────────────────────── juntar e editar códigos ───────────────────────────── */

/** Os códigos de dois produtos somados (o primeiro vence na ordem). */
export const mergeCodes = (...ms: MasterProduct[]): { establishmentCodes: Record<string, string | string[]>; eans: string[]; noCodes: string[] } => {
  const probe: MasterProduct = { code: '', description: '', unitType: '', category: '', aliases: [], establishmentCodes: {}, eans: [] };
  ms.forEach(m => {
    (m.eans || []).forEach(e => addEan(probe, e));
    Object.entries(m.establishmentCodes || {}).forEach(([k, v]) => codesOf(v).forEach(c => addStoreCode(probe, k, c)));
  });
  const noCodes = Array.from(new Set(ms.flatMap(m => m.noCodes || [])));
  return { establishmentCodes: probe.establishmentCodes, eans: probe.eans || [], noCodes };
};

/** Os campos de código para espalhar num produto que absorveu outros: `{ ...m, ...mergedCodeFields(m, outro) }`. */
export const mergedCodeFields = (...ms: MasterProduct[]): Pick<MasterProduct, 'establishmentCodes' | 'eans' | 'noCodes'> => {
  const mc = mergeCodes(...ms);
  return { establishmentCodes: mc.establishmentCodes, ...(mc.eans.length ? { eans: mc.eans } : {}), ...(mc.noCodes.length ? { noCodes: mc.noCodes } : {}) };
};

// Código que a pessoa tirou de um produto: o app não o ensina de novo a partir dos cupons antigos.
export const noEanKey = (ean: string): string => `E|${toGtin14(cleanCode(ean))}`;
export const noStoreKey = (storeKey: string, code: string): string => `S|${normStoreKey(storeKey)}|${cleanCode(code)}`;
export const isBlockedCode = (m: MasterProduct, key: string): boolean => (m.noCodes || []).includes(key);

export type CodeEditResult = { ok: true; masters: MasterProduct[] } | { ok: false; error: string };

/** Mexe nos códigos de um produto à mão (adicionar ou tirar), sem deixar o mesmo código em dois produtos. */
export const applyCodeEdit = (masters: MasterProduct[], masterCode: string, op: CodeOp): CodeEditResult => {
  const target = masters.find(m => m.code === masterCode);
  if (!target) return { ok: false, error: 'Produto não encontrado.' };
  const idx = buildCodeIndex(masters);
  const copy = (m: MasterProduct): MasterProduct => ({
    ...m,
    establishmentCodes: { ...(m.establishmentCodes || {}) },
    ...(m.eans ? { eans: [...m.eans] } : {}),
    ...(m.noCodes ? { noCodes: [...m.noCodes] } : {}),
  });
  const next = copy(target);
  const block = (k: string) => { if (!isBlockedCode(next, k)) next.noCodes = [...(next.noCodes || []), k]; };
  const allow = (k: string) => {
    if (!isBlockedCode(next, k)) return;
    next.noCodes = (next.noCodes || []).filter(x => x !== k);
    if (next.noCodes.length === 0) delete next.noCodes;
  };

  if (op.kind === 'addEan') {
    const c = cleanCode(op.ean);
    if (!c || !/^\d+$/.test(c)) return { ok: false, error: 'O código de barras tem só números (8, 12, 13 ou 14).' };
    if (!gtinValid(c)) return { ok: false, error: 'Este código de barras não passa na conferência do último dígito. Veja se digitou certo.' };
    const owner = idx.byEan.get(toGtin14(c));
    if (owner && owner.code !== masterCode) return { ok: false, error: `Este código de barras já é do produto "${owner.description}". Se são o mesmo item, use "Unificar".` };
    addEan(next, c);
    allow(noEanKey(c));
  } else if (op.kind === 'addStore') {
    const c = cleanCode(op.code);
    const sk = normStoreKey(op.storeKey);
    if (!sk) return { ok: false, error: 'Escolha a loja.' };
    if (!c || c.includes('?')) return { ok: false, error: 'Digite o código da loja inteiro.' };
    const owner = idx.byStore.get(`${sk}|${c}`);
    if (owner && owner.code !== masterCode) return { ok: false, error: `Este código já é do produto "${owner.description}" nesta loja. Se são o mesmo item, use "Unificar".` };
    addStoreCode(next, sk, c);
    allow(noStoreKey(sk, c));
  } else if (op.kind === 'removeEan') {
    const g = toGtin14(cleanCode(op.ean));
    next.eans = (next.eans || []).filter(e => toGtin14(cleanCode(e)) !== g);
    if (next.eans.length === 0) delete next.eans;
    block(noEanKey(op.ean));
  } else {
    const sk = normStoreKey(op.storeKey);
    const c = cleanCode(op.code);
    const out: Record<string, string | string[]> = {};
    Object.entries(next.establishmentCodes).forEach(([k, v]) => {
      if (normStoreKey(k) !== sk) { out[k] = v; return; }
      const left = codesOf(v).filter(x => cleanCode(x) !== c);
      if (left.length) out[k] = left.length === 1 ? left[0] : left;
    });
    next.establishmentCodes = out;
    block(noStoreKey(sk, c));
  }
  return { ok: true, masters: masters.map(m => (m === target ? next : m)) };
};
