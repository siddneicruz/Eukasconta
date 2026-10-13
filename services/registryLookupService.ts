// Consulta ao cadastro do próprio app logo depois que a IA lê o cupom.
//
// A IA devolve o que enxerga na foto. Isso varia de uma leitura para outra (nome do mercado
// escrito de jeitos diferentes, um dígito do CNPJ trocado, categoria fora da lista...), e fica
// pior com modelos grátis menores. O cadastro do app, ao contrário, já foi conferido pelo usuário.
// Então, antes de salvar o recibo, o app procura o que já conhece:
//
//   • Estabelecimento: pelo CNPJ. Se achar, usa o nome, endereço, cidade e UF do cadastro.
//     Se o CNPJ lido for inválido ou vazio, tenta achar a loja pelo nome (só se houver uma única
//     candidata clara). Se não achar nada, mantém o que a IA leu.
//   • Itens: pelo catálogo de produtos mestre. Se o item já é conhecido, usa a categoria do catálogo
//     (que reflete as correções feitas pelo usuário). Descrição, quantidade e preços nunca mudam.
//
// Tudo aqui é função pura: não lê localStorage nem chama rede, então dá para testar isolada.

import { Establishment, MasterProduct, Receipt, ReceiptItem } from '../types';
import { cleanDescriptionForMatching } from './productMasterService';
import { ruleCategoryFor } from './categoryRules';
import { cleanCNPJ, formatCNPJ } from './productNormalization';

/* ───────────────────────────── CNPJ ───────────────────────────── */

// Confere os dois dígitos verificadores (módulo 11). Pega a maioria dos erros de leitura
// da IA: com um dígito trocado, a conta quase sempre deixa de fechar.
export const isValidCNPJ = (value: string): boolean => {
  const d = cleanCNPJ(value);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const digit = (len: 12 | 13): number => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return digit(12) === Number(d[12]) && digit(13) === Number(d[13]);
};

/* ───────────────────────────── nomes ───────────────────────────── */

const normalizeName = (name: string): string =>
  (name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[.,;:\-_/\\()&|'"]/g, ' ')
    .replace(/\b(LTDA|EIRELI|EPP|MEI|ME|SA|S A|CIA)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Mantém tokens de 1 caractere: "LOJA 1" e "LOJA 2" (ou "MERCADO A" e "MERCADO B") são lojas diferentes.
const nameTokens = (n: string): string[] => n.split(' ').filter(t => t.length > 0);

// Nome que o Scanner coloca quando a IA não leu nenhum: não serve para procurar nem para cadastrar.
const PLACEHOLDER_NAME = 'ESTABELECIMENTO DESCONHECIDO';
const isPlaceholderName = (name: string): boolean => normalizeName(name) === PLACEHOLDER_NAME;

const jaccard = (a: string[], b: string[]): number => {
  const sa = new Set(a), sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  sa.forEach(t => { if (sb.has(t)) inter++; });
  return inter / new Set([...a, ...b]).size;
};

// Nomes só valem como indício quando são praticamente iguais. Filiais costumam diferir por um
// token ("F01" x "F02"), o que derruba a pontuação e evita juntar lojas diferentes.
const NAME_MATCH_MIN = 0.8;

/* ───────────────────────────── estabelecimento ───────────────────────────── */

export type EstablishmentMatch =
  | { kind: 'cnpj'; establishment: Establishment }
  | { kind: 'name'; establishment: Establishment }
  | { kind: 'none'; cnpjStatus: 'valid' | 'invalid' | 'empty' };

export const findEstablishment = (
  readName: string,
  readCnpj: string,
  registry: Establishment[],
): EstablishmentMatch => {
  const cnpj = cleanCNPJ(readCnpj);

  // 1) CNPJ igual ao de uma loja cadastrada: é a chave mais forte.
  if (cnpj) {
    const hit = registry.find(e => cleanCNPJ(e.cnpj) === cnpj);
    if (hit) return { kind: 'cnpj', establishment: hit };
  }

  // Um CNPJ válido que não está no cadastro é uma loja nova. Não a confundimos com outra pelo nome:
  // redes têm várias filiais com o mesmo nome e CNPJs diferentes.
  const cnpjStatus: 'valid' | 'invalid' | 'empty' = !cnpj ? 'empty' : isValidCNPJ(cnpj) ? 'valid' : 'invalid';
  if (cnpjStatus === 'valid') return { kind: 'none', cnpjStatus };

  // 2) CNPJ vazio ou inválido (provavelmente erro de leitura): procura pelo nome.
  const target = isPlaceholderName(readName) ? '' : normalizeName(readName);
  const tTokens = nameTokens(target);
  if (target && tTokens.length > 0) {
    const scored = registry
      .map(e => {
        const n = normalizeName(e.originalName);
        return { e, score: n === target ? 1 : jaccard(tTokens, nameTokens(n)) };
      })
      .filter(x => x.score >= NAME_MATCH_MIN)
      .sort((a, b) => b.score - a.score);

    // Duas lojas empatadas = ambíguo; melhor não adivinhar.
    if (scored.length === 1 || (scored.length > 1 && scored[0].score > scored[1].score)) {
      return { kind: 'name', establishment: scored[0].e };
    }
  }
  return { kind: 'none', cnpjStatus };
};

/* ───────────────────────────── itens ───────────────────────────── */

export interface MasterIndex {
  byAlias: Map<string, MasterProduct>;
  byStoreCode: Map<string, MasterProduct>; // `${chaveDaLoja}|${códigoDoItem}`
  fuzzy: { master: MasterProduct; clean: string; words: Set<string> }[];
}

// Limite que o app já usa para juntar um item a um produto mestre (productMasterService).
export const ITEM_MATCH_MIN = 0.7;

const wordsOf = (clean: string): string[] => clean.split(' ').filter(w => w.length > 2);

// Prepara o catálogo uma vez por lote de fotos, em vez de limpar o texto de todos os produtos
// para cada item de cada cupom.
export const buildMasterIndex = (masters: MasterProduct[] = []): MasterIndex => {
  const byAlias = new Map<string, MasterProduct>();
  const byStoreCode = new Map<string, MasterProduct>();
  const fuzzy: MasterIndex['fuzzy'] = [];
  for (const m of masters) {
    (m.aliases || []).forEach(a => { const k = (a || '').trim().toUpperCase(); if (k && !byAlias.has(k)) byAlias.set(k, m); });
    Object.entries(m.establishmentCodes || {}).forEach(([store, code]) => {
      if (store && code) byStoreCode.set(`${store}|${code}`, m);
    });
    const clean = cleanDescriptionForMatching(m.description);
    fuzzy.push({ master: m, clean, words: new Set(wordsOf(clean)) });
    // Produto unificado à mão: cada nome que a pessoa juntou também serve de modelo para os próximos cupons.
    if (m.curated) {
      const seen = new Set<string>([clean]);
      (m.aliases || []).forEach(a => {
        const c = cleanDescriptionForMatching(a);
        if (!c || seen.has(c)) return;
        seen.add(c);
        fuzzy.push({ master: m, clean: c, words: new Set(wordsOf(c)) });
      });
    }
  }
  return { byAlias, byStoreCode, fuzzy };
};

// Mesma conta de calculateSimilarity (productMasterService), com o catálogo já preparado.
const similarity = (itemClean: string, itemWords: string[], f: MasterIndex['fuzzy'][number]): number => {
  if (itemClean === f.clean && itemClean.length > 0) return 1;
  if (itemWords.length === 0 || f.words.size === 0) return 0;
  const set = new Set(itemWords);
  let inter = 0;
  set.forEach(w => { if (f.words.has(w)) inter++; });
  const union = new Set([...itemWords, ...f.words]).size;
  return inter / union;
};

export const findMasterProduct = (
  description: string,
  storeKey: string,
  index: MasterIndex,
): { master: MasterProduct; by: 'alias' | 'code' | 'similar' } | null => {
  const raw = (description || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();

  const alias = index.byAlias.get(upper);
  if (alias) return { master: alias, by: 'alias' };

  // Mesmo código impresso no cupom da mesma loja = mesmo produto, mesmo que a descrição varie.
  const codeMatch = raw.match(/^(\d{3,14})\b/);
  if (codeMatch && storeKey) {
    const byCode = index.byStoreCode.get(`${storeKey}|${codeMatch[1]}`);
    if (byCode) return { master: byCode, by: 'code' };
  }

  const clean = cleanDescriptionForMatching(upper);
  const words = wordsOf(clean);
  let best: MasterIndex['fuzzy'][number] | null = null;
  let bestScore = 0;
  for (const f of index.fuzzy) {
    const s = similarity(clean, words, f);
    if (s > bestScore) { bestScore = s; best = f; }
  }
  return best && bestScore >= ITEM_MATCH_MIN ? { master: best.master, by: 'similar' } : null;
};

/* ───────────────────────────── aplicação no recibo ───────────────────────────── */

export interface RegistryContext {
  establishments: Establishment[];
  masterIndex: MasterIndex;
  categories: string[];
}

export interface RegistryResult {
  receipt: Receipt;
  notes: string[];                       // frases para o log do Scanner
  matched: Establishment | null;         // loja do cadastro usada, se houve
  cnpjUsable: boolean;                   // CNPJ final é válido (serve para ensinar o cadastro do lote)
}

const stripKey = (s: string): string => normalizeName(s).replace(/\s+/g, ' ');

export const applyRegistry = (input: Receipt, ctx: RegistryContext): RegistryResult => {
  const notes: string[] = [];
  const receipt: Receipt = { ...input };
  const readName = (input.establishmentName || '').trim();
  const readCnpj = input.cnpj || '';

  /* estabelecimento */
  const found = findEstablishment(readName, readCnpj, ctx.establishments);
  let matched: Establishment | null = null;

  if (found.kind === 'cnpj' || found.kind === 'name') {
    const est = found.establishment;
    matched = est;
    const registeredCnpj = cleanCNPJ(est.cnpj);
    receipt.establishmentName = est.originalName || receipt.establishmentName;
    if (registeredCnpj) receipt.cnpj = registeredCnpj;
    if (est.address) receipt.address = est.address;
    if (est.city) receipt.city = est.city;
    if (est.state) receipt.state = est.state;

    const shown = est.aliasName || est.originalName;
    if (found.kind === 'cnpj') {
      const differs = readName && stripKey(readName) !== stripKey(est.originalName);
      notes.push(`Loja já cadastrada (CNPJ ${formatCNPJ(registeredCnpj)}): ${shown}.${differs ? ` Nome lido na foto: "${readName}".` : ''}`);
    } else {
      notes.push(`CNPJ lido (${readCnpj ? formatCNPJ(readCnpj) : 'vazio'}) não é válido; usei a loja cadastrada "${shown}" pelo nome${registeredCnpj ? ` (CNPJ ${formatCNPJ(registeredCnpj)})` : ''}.`);
    }
  } else if (found.cnpjStatus === 'invalid') {
    notes.push(`Atenção: o CNPJ lido (${readCnpj}) não passa na validação e a loja não está cadastrada. Confira no cupom.`);
  }

  /* itens */
  const storeKey = cleanCNPJ(receipt.cnpj) || receipt.establishmentName || '';
  const canonical = new Map<string, string>();
  ctx.categories.forEach(c => canonical.set(stripKey(c), c));
  const valid = new Set(ctx.categories);

  let known = 0, recategorized = 0, normalizedCats = 0, ruled = 0;
  receipt.items = (input.items || []).map((item: ReceiptItem) => {
    const next: ReceiptItem = { ...item };

    // Categoria fora da lista só por diferença de maiúsculas/acentos: usa a grafia oficial.
    if (next.category && !valid.has(next.category)) {
      const fixed = canonical.get(stripKey(next.category));
      if (fixed) { next.category = fixed; normalizedCats++; }
    }

    const hit = findMasterProduct(next.description, storeKey, ctx.masterIndex);
    if (hit) {
      known++;
      const mc = hit.master.category;
      // Só confia na categoria do catálogo se ela existe na taxonomia atual e é específica.
      if (mc && mc !== 'Outros' && valid.has(mc) && mc !== next.category) {
        next.category = mc;
        recategorized++;
      }
      if (!next.unitType && hit.master.unitType) next.unitType = hit.master.unitType;
    } else {
      // Item novo: carne trabalhada (linguiça, bacon) não entra como corte de carne
      const fixed = ruleCategoryFor(next.description, next.category, ctx.categories);
      if (fixed) { next.category = fixed; ruled++; }
    }
    return next;
  });

  if (receipt.items.length > 0 && known > 0) {
    notes.push(`${known} de ${receipt.items.length} itens já estão no catálogo${recategorized ? `; categoria do catálogo aplicada em ${recategorized}` : ''}.`);
  }
  if (ruled > 0) {
    notes.push(`${ruled} ${ruled === 1 ? 'item de carne trabalhada (linguiça, bacon) foi' : 'itens de carne trabalhada (linguiça, bacon) foram'} para a categoria de embutidos.`);
  }
  if (normalizedCats > 0) {
    notes.push(`${normalizedCats} categoria(s) ajustada(s) para a grafia oficial da taxonomia.`);
  }

  return {
    receipt,
    notes,
    matched,
    cnpjUsable: Boolean(cleanCNPJ(receipt.cnpj)) && isValidCNPJ(receipt.cnpj),
  };
};

// Lojas novas lidas num lote entram no cadastro do próprio lote, para que o 2º cupom da mesma
// loja já encontre o 1º (o cadastro do app só é atualizado depois que o lote inteiro é salvo).
export const learnEstablishment = (registry: Establishment[], r: RegistryResult): void => {
  if (r.matched) return;
  const name = (r.receipt.establishmentName || '').trim();
  const cnpj = cleanCNPJ(r.receipt.cnpj);
  if (!name || isPlaceholderName(name)) return;
  if (cnpj && !r.cnpjUsable) return; // CNPJ suspeito não deve ensinar nada ao lote
  registry.push({
    cnpj: cnpj,
    originalName: name,
    address: r.receipt.address,
    city: r.receipt.city,
    state: r.receipt.state,
  });
};
