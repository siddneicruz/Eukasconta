// Lojas repetidas: o mesmo estabelecimento aparece várias vezes no cadastro porque o cupom é lido por foto
// ("COMPRETUDO SUPERMERCADO LTDA F01", "Compretudo Supermercado Ltda-F01"), o CNPJ vem com um dígito errado ou nem vem.
//
// Aqui fica a parte SEM IA: acha os grupos de cadastros que são a mesma loja, escolhe qual fica e junta
// (cupons, códigos de produto e dados passam para a loja que fica). Tudo função pura, testável sem tela.
// A IA (storeDedupeAI.ts) só entra depois, para os casos que as regras não resolvem.
//
// Regras, da mais forte para a mais fraca:
//   1. mesmo CNPJ                                          → mesma loja (alta)
//   2. mesmo nome (sem LTDA, F01, filial, cidade), um deles sem CNPJ, mesma cidade → mesma loja (alta)
//   3. CNPJs diferentes, mesmo nome e MESMO endereço        → CNPJ lido errado (alta se só um confere nos dígitos
//      verificadores, senão média)
//   4. nome parecido (um contido no outro) na mesma cidade, um deles sem CNPJ → média
// Nunca junta: cidades diferentes, filiais (CNPJ com a mesma raiz e endereço diferente) nem lojas de nomes diferentes
// que só dividem o endereço (shopping).

import { Establishment, MasterProduct, Receipt } from '../types';
import { cleanCNPJ } from './productNormalization';
import { isUnidentifiedName } from './textFormat';
import { rekeyStoreCodes } from './productCodes';

/* ───────────────────────────── texto ───────────────────────────── */

const fold = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const UFS = new Set(['ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to']);
const LEGAL = new Set(['ltda', 'ltd', 'me', 'epp', 'eireli', 'sa', 'cia', 'mei', 'ss']);
const BRANCH = new Set(['filial', 'fil', 'matriz']);
const GRAMMAR = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'na', 'no', 'nas', 'nos', 'com']);
// palavras que descrevem o tipo de empresa e não ajudam a distinguir uma loja da outra
const GENERIC = new Set([
  'super', 'supermercado', 'supermercados', 'mercado', 'mercados', 'mercadinho', 'comercio', 'comercial', 'industria', 'industrial',
  'cooperativa', 'cooperativas', 'coop', 'regional', 'agroindustrial', 'loja', 'lojas', 'distribuidora', 'representacoes',
  'empreendimentos', 'servicos', 'produtos', 'administradora', 'importacao', 'exportacao', 'participacoes', 'grupo', 'rede',
  'alimentos', 'alimenticios', 'alimentacao', 'shopping', 'centro', 'center',
]);
// nome que é só o tipo do negócio: não dá para dizer que duas lojas assim são a mesma
const TYPE_WORDS = new Set(['posto', 'farmacia', 'drogaria', 'padaria', 'pizzaria', 'restaurante', 'lanchonete', 'acougue', 'bar', 'cafe', 'sorveteria', 'hamburgueria', 'churrascaria', 'mercearia', 'auto', 'moto', 'pecas', 'gas']);

const baseTokens = (name: string): string[] => {
  let s = fold(name).replace(/&/g, ' ').replace(/\bs\.?\s*\/?\s*a\.?(?=\s|$|\W)/g, ' sa ');
  const raw = s.split(/[^a-z0-9]+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (LEGAL.has(t) || BRANCH.has(t) || GRAMMAR.has(t)) continue;
    if (/^f\d{1,3}$/.test(t)) continue;                        // F01
    if ((t === 'loja' || t === 'filial' || t === 'fil') && /^\d+$/.test(raw[i + 1] || '')) { i++; continue; }
    out.push(t);
  }
  return out;
};

/** Nome sem LTDA, F01, filial e outros enfeites: "COMPRETUDO SUPERMERCADO LTDA - F01" -> "compretudo supermercado". */
export const nameKey = (name: string): string => baseTokens(name).join(' ');

const cityTokens = (city: string | undefined): string[] => fold(city).split(/[^a-z0-9]+/).filter(t => t && !GRAMMAR.has(t));

/** Palavras que identificam a loja: sem tipo de empresa genérico, sem a cidade e sem UF. */
export const coreTokens = (e: Pick<Establishment, 'originalName' | 'city'>): string[] => {
  const city = new Set(cityTokens(e.city));
  return Array.from(new Set(baseTokens(e.originalName).filter(t => t.length > 1 && !GENERIC.has(t) && !city.has(t) && !UFS.has(t))));
};

const lev1 = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
};

// "compretudo" ≈ "compretodo" (erro de leitura); "atacadao" ≈ "atacad" não conta (curto demais)
const tokEq = (a: string, b: string): boolean =>
  a === b || (a.length >= 6 && b.length >= 6 && lev1(a, b)) || (Math.min(a.length, b.length) >= 6 && (a.startsWith(b) || b.startsWith(a)));

const hasEq = (list: string[], t: string): boolean => list.some(x => tokEq(x, t));

export type NameRel = 'igual' | 'contido' | 'parecido' | null;

export const nameRelation = (a: string[], b: string[]): NameRel => {
  if (a.length === 0 || b.length === 0) return null;
  const common = a.filter(t => hasEq(b, t)).length;
  const commonB = b.filter(t => hasEq(a, t)).length;
  if (common === a.length && commonB === b.length) return 'igual';
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  if (small.every(t => hasEq(big, t)) && small.some(t => t.length >= 5)) return 'contido';
  const union = a.length + b.length - Math.min(common, commonB);
  if (Math.min(common, commonB) >= 2 && Math.min(common, commonB) / union >= 0.6) return 'parecido';
  return null;
};

/* ───────────────────────────── CNPJ ───────────────────────────── */

const digits = (s: unknown): string => String(s ?? '').replace(/\D/g, '');
// 14 (CNPJ) ou 11 (CPF); outro tamanho é leitura errada do cupom
const idOf = (s: unknown): string => { const d = digits(s); return d.length === 14 || d.length === 11 ? d : ''; };

/** Confere os dígitos verificadores do CNPJ (14) ou do CPF (11). */
export const validDocument = (raw: unknown): boolean => {
  const d = digits(raw);
  if (/^(\d)\1+$/.test(d)) return false;
  if (d.length === 14) {
    const calc = (len: number) => {
      const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const sum = w.reduce((s, x, i) => s + x * Number(d[i]), 0) % 11;
      return sum < 2 ? 0 : 11 - sum;
    };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }
  if (d.length === 11) {
    const calc = (len: number) => {
      let sum = 0;
      for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
      const r = (sum * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
  }
  return false;
};

/* ───────────────────────────── endereço e cidade ───────────────────────────── */

type Compat = 'igual' | 'diferente' | 'desconhecida';

const cityKey = (e: Pick<Establishment, 'city'>): string => {
  const k = cityTokens(e.city).join(' ');
  return UFS.has(k) ? '' : k;      // "SC" sozinho não é cidade
};
const cityCompat = (a: Establishment, b: Establishment): Compat => {
  const x = cityKey(a), y = cityKey(b);
  if (!x || !y) return 'desconhecida';
  return x === y ? 'igual' : 'diferente';
};

const STREET_NOISE = new Set(['avenida', 'av', 'rua', 'r', 'travessa', 'tv', 'rodovia', 'rod', 'estrada', 'est', 'alameda', 'al', 'praca', 'pca', 'br', 'sc', 'km']);
const addrParts = (e: Pick<Establishment, 'address'>): { street: string[]; number: string } => {
  const first = String(e.address ?? '').split(/\s*[-–]?\s*CEP\b/i)[0];
  const segs = first.split(',').map(s => s.trim());
  const street = fold(segs[0]).split(/[^a-z0-9]+/).filter(t => t && !STREET_NOISE.has(t));
  const number = (segs[1] || '').match(/\d+/)?.[0] ?? '';
  return { street, number };
};
/** 'igual' só quando rua e número batem; sem endereço dos dois lados não dá para saber. */
const addressCompat = (a: Establishment, b: Establishment): Compat => {
  const x = addrParts(a), y = addrParts(b);
  if (x.street.length === 0 || y.street.length === 0) return 'desconhecida';
  const same = x.street.every(t => hasEq(y.street, t)) && y.street.every(t => hasEq(x.street, t));
  if (!same) return 'diferente';
  if (x.number && y.number) return x.number === y.number ? 'igual' : 'diferente';
  return !x.number && !y.number ? 'igual' : 'desconhecida';    // os dois "s/nº" na mesma rua
};

/* ───────────────────────────── cadastro ───────────────────────────── */

/** Identidade da loja no cadastro: CNPJ (só dígitos) + nome do cupom. */
export const storeKey = (e: Pick<Establishment, 'cnpj' | 'originalName'>): string => `${cleanCNPJ(e.cnpj)}|${e.originalName}`;

export interface StoreMember {
  est: Establishment;
  key: string;
  receipts: number;
  spent: number;
  first: string;
  last: string;
  cnpjOk: boolean;      // CNPJ/CPF com dígitos verificadores certos
}

export interface StoreGroup {
  id: string;
  members: StoreMember[];
  keep: string;                         // storeKey da loja que fica
  confidence: 'alta' | 'media';
  reasons: string[];
  source: 'regra' | 'ia';
  aiConfirmed?: boolean;
}

export const memberStats = (establishments: Establishment[], receipts: Receipt[]): StoreMember[] => {
  const stat = new Map<string, { n: number; spent: number; dates: string[] }>();
  receipts.forEach(r => {
    const k = `${cleanCNPJ(r.cnpj)}|${r.establishmentName}`;
    const s = stat.get(k) || { n: 0, spent: 0, dates: [] };
    s.n += 1; s.spent += Number(r.totalAmount) || 0; if (r.date) s.dates.push(r.date);
    stat.set(k, s);
  });
  const seen = new Set<string>();
  const out: StoreMember[] = [];
  establishments.forEach(est => {
    const key = storeKey(est);
    if (seen.has(key)) return;
    seen.add(key);
    const s = stat.get(key);
    const dates = s ? [...s.dates].sort() : [];
    out.push({
      est, key, receipts: s?.n ?? 0, spent: s?.spent ?? 0, first: dates[0] || '', last: dates[dates.length - 1] || '',
      cnpjOk: validDocument(est.cnpj),
    });
  });
  return out;
};

const hash = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};
export const groupId = (members: Pick<StoreMember, 'key'>[]): string => `g${hash(members.map(m => m.key).sort().join('\n'))}`;

/** Qual cadastro fica: o de CNPJ certo, depois o que tem CNPJ, depois o que tem mais cupons e mais dados. */
export const pickKeep = (members: StoreMember[]): StoreMember => {
  const score = (m: StoreMember) => [
    m.cnpjOk ? 1 : 0,
    idOf(m.est.cnpj) ? 1 : 0,
    m.receipts,
    (m.est.address ? 1 : 0) + (typeof m.est.latitude === 'number' ? 1 : 0) + (m.est.aliasName?.trim() ? 1 : 0),
  ];
  return [...members].sort((a, b) => {
    const x = score(a), y = score(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i];
    return a.key.localeCompare(b.key);
  })[0];
};

/* ───────────────────────────── regras ───────────────────────────── */

export interface Relation { strength: 'alta' | 'media'; reason: string; differentIds: boolean }

interface Prof { m: StoreMember; d: string; core: string[]; full: string; vague: boolean }

const profile = (m: StoreMember): Prof => {
  const core = coreTokens(m.est);
  const full = nameKey(m.est.originalName);
  const vague = core.length === 0 || (core.length === 1 && (TYPE_WORDS.has(core[0]) || core[0].length < 4));
  return { m, d: idOf(m.est.cnpj), core, full, vague };
};

export const relate = (pa: Prof, pb: Prof): Relation | null => {
  const a = pa.m.est, b = pb.m.est;
  if (pa.d && pa.d === pb.d) return { strength: 'alta', reason: 'Mesmo CNPJ', differentIds: false };
  const city = cityCompat(a, b);
  const rel = pa.full && pa.full === pb.full ? 'igual' : nameRelation(pa.core, pb.core);

  if (pa.d && pb.d) {
    if (rel !== 'igual' || city === 'diferente' || pa.vague || pb.vague) return null;
    if (addressCompat(a, b) !== 'igual') return null;            // endereço diferente ou sem endereço: pode ser filial
    if (pa.m.cnpjOk !== pb.m.cnpjOk) return { strength: 'alta', reason: 'Mesmo nome e endereço; um dos CNPJs foi lido errado', differentIds: true };
    return { strength: 'media', reason: 'Mesmo nome e endereço, mas CNPJ diferente', differentIds: true };
  }

  // pelo menos um sem CNPJ
  if (city === 'diferente') return null;
  if (rel === 'igual') {
    if (pa.vague || pb.vague) return pa.full === pb.full && city === 'igual' ? { strength: 'media', reason: 'Mesmo nome, um sem CNPJ', differentIds: false } : null;
    return city === 'igual'
      ? { strength: 'alta', reason: pa.d || pb.d ? 'Mesmo nome, um deles sem CNPJ' : 'Mesmo nome e cidade', differentIds: false }
      : { strength: 'media', reason: 'Mesmo nome, cidade não informada em um deles', differentIds: false };
  }
  if ((rel === 'contido' || rel === 'parecido') && city === 'igual' && !pa.vague && !pb.vague) {
    return { strength: 'media', reason: 'Nome parecido na mesma cidade', differentIds: false };
  }
  return null;
};

/** Cadastros com o mesmo nome e cidade só se juntam se a união não misturar CNPJs diferentes sem motivo. */
export const findStoreGroups = (establishments: Establishment[], receipts: Receipt[]): StoreGroup[] => {
  const members = memberStats(establishments, receipts).filter(m => !isUnidentifiedName(m.est.originalName));
  const profs = members.map(profile);
  const n = profs.length;

  interface Edge { i: number; j: number; rel: Relation }
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const rel = relate(profs[i], profs[j]);
    if (rel) edges.push({ i, j, rel });
  }
  edges.sort((x, y) => (x.rel.strength === y.rel.strength ? 0 : x.rel.strength === 'alta' ? -1 : 1));

  // união de componentes; um cadastro sem CNPJ não pode servir de ponte entre dois CNPJs diferentes
  const parent = profs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const ids = profs.map(p => new Set(p.d ? [p.d] : []));
  const reasons = profs.map(() => new Set<string>());
  const strong = profs.map(() => true);
  edges.forEach(({ i, j, rel }) => {
    const a = find(i), b = find(j);
    if (a === b) { reasons[a].add(rel.reason); if (rel.strength === 'media') strong[a] = false; return; }
    const union = new Set([...ids[a], ...ids[b]]);
    if (union.size > 1 && ids[a].size > 0 && ids[b].size > 0 && !rel.differentIds) return;
    parent[b] = a;
    ids[b].forEach(x => ids[a].add(x));
    reasons[b].forEach(x => reasons[a].add(x));
    reasons[a].add(rel.reason);
    strong[a] = strong[a] && strong[b] && rel.strength === 'alta';
  });

  const byRoot = new Map<number, number[]>();
  profs.forEach((_, i) => { const r = find(i); const arr = byRoot.get(r); if (arr) arr.push(i); else byRoot.set(r, [i]); });
  const groups: StoreGroup[] = [];
  byRoot.forEach((idx, root) => {
    if (idx.length < 2) return;
    const ms = idx.map(i => members[i]);
    const keep = pickKeep(ms);
    groups.push({ id: groupId(ms), members: ms.sort((a, b) => (a.key === keep.key ? -1 : b.key === keep.key ? 1 : b.receipts - a.receipts)), keep: keep.key, confidence: strong[root] ? 'alta' : 'media', reasons: Array.from(reasons[root]), source: 'regra' });
  });
  // alta primeiro; depois as que mais mexem em cupons
  const weight = (g: StoreGroup) => g.members.reduce((s, m) => s + m.receipts, 0);
  return groups.sort((a, b) => (a.confidence === b.confidence ? weight(b) - weight(a) : a.confidence === 'alta' ? -1 : 1));
};

/** Quantos cadastros sobrariam a menos se todos os grupos fossem juntados. */
export const removableCount = (groups: StoreGroup[]): number => groups.reduce((s, g) => s + g.members.length - 1, 0);

/* ───────────────────────────── candidatos para a IA ───────────────────────────── */

/** Há motivo para a IA olhar estas duas lojas juntas? (palavra em comum, mesma raiz de CNPJ ou mesmo endereço) */
export const looseLink = (a: StoreMember, b: StoreMember): boolean => {
  if (cityCompat(a.est, b.est) === 'diferente' && !(idOf(a.est.cnpj) && idOf(a.est.cnpj) === idOf(b.est.cnpj))) return false;
  const da = idOf(a.est.cnpj), db = idOf(b.est.cnpj);
  if (da && db && da.length === 14 && db.length === 14 && da.slice(0, 8) === db.slice(0, 8)) return true;
  // "posto", "farmácia" e afins aparecem em qualquer loja do ramo: não são motivo para comparar
  const ca = coreTokens(a.est).filter(t => !TYPE_WORDS.has(t)), cb = coreTokens(b.est).filter(t => !TYPE_WORDS.has(t));
  if (ca.some(t => t.length >= 5 && hasEq(cb, t))) return true;
  return addressCompat(a.est, b.est) === 'igual' && ca.some(t => t.length >= 4 && cb.some(u => u.length >= 4 && u.slice(0, 4) === t.slice(0, 4)));
};

export interface Unit { id: number; members: StoreMember[]; rep: StoreMember; group?: StoreGroup }

/** Cada grupo achado pelas regras vira uma unidade só (fica o cadastro que ia ficar); os demais cadastros, uma unidade cada. */
export const buildUnits = (establishments: Establishment[], receipts: Receipt[], groups: StoreGroup[]): Unit[] => {
  const all = memberStats(establishments, receipts).filter(m => !isUnidentifiedName(m.est.originalName));
  const inGroup = new Map<string, StoreGroup>();
  groups.forEach(g => g.members.forEach(m => inGroup.set(m.key, g)));
  const units: Unit[] = [];
  const done = new Set<string>();
  all.forEach(m => {
    if (done.has(m.key)) return;
    const g = inGroup.get(m.key);
    if (g) {
      g.members.forEach(x => done.add(x.key));
      const rep = g.members.find(x => x.key === g.keep) || g.members[0];
      units.push({ id: 0, members: g.members, rep, group: g });
    } else {
      done.add(m.key);
      units.push({ id: 0, members: [m], rep: m });
    }
  });
  return units;
};

/** Conjuntos de unidades que têm algo em comum, para perguntar à IA um conjunto de cada vez (no máximo `cap` por pergunta). */
export const candidateBlocks = (units: Unit[], cap = 30): Unit[][] => {
  const n = units.length;
  const parent = units.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (find(i) === find(j)) continue;
    const linked = units[i].members.some(a => units[j].members.some(b => looseLink(a, b)));
    if (linked) parent[find(j)] = find(i);
  }
  const by = new Map<number, Unit[]>();
  units.forEach((u, i) => { const r = find(i); const arr = by.get(r); if (arr) arr.push(u); else by.set(r, [u]); });
  const blocks: Unit[][] = [];
  by.forEach(arr => {
    if (arr.length < 2) return;
    arr.sort((a, b) => nameKey(a.rep.est.originalName).localeCompare(nameKey(b.rep.est.originalName)));
    for (let i = 0; i < arr.length; i += cap) { const part = arr.slice(i, i + cap); if (part.length >= 2) blocks.push(part); }
  });
  blocks.forEach(b => b.forEach((u, i) => { u.id = i + 1; }));
  return blocks;
};

/** Duas lojas que a IA mandou juntar, mas que as regras de segurança não deixam: cidades diferentes ou endereços diferentes. */
export const conflicts = (a: StoreMember, b: StoreMember): boolean => {
  const da = idOf(a.est.cnpj), db = idOf(b.est.cnpj);
  if (da && da === db) return false;
  if (cityCompat(a.est, b.est) === 'diferente') return true;
  if (da && db && addressCompat(a.est, b.est) === 'diferente') return true;
  return false;
};

/* ───────────────────────────── juntar ───────────────────────────── */

export interface MergePlan { keep: string; members: string[] }   // storeKey de cada cadastro (inclui o que fica)

export interface Redirect { cnpj: string; name: string }
export type Redirects = Record<string, Redirect>;

export interface MergeOutcome {
  establishments: Establishment[];
  receipts: Receipt[];
  masters: MasterProduct[];
  redirects: Redirects;
  groups: number;            // grupos juntados
  removed: number;           // cadastros que deixaram de existir
  receiptsChanged: number;   // cupons que passaram para a loja que ficou
}

const geoRank = (e: Establishment): number =>
  typeof e.latitude !== 'number' || typeof e.longitude !== 'number' ? 0 : e.geocodeManual ? 3 : e.geocodeApprox ? 1 : 2;

const GEO_FIELDS = ['latitude', 'longitude', 'geocodeStatus', 'geocodedAt', 'geocodeApprox', 'geocodeManual', 'geocodeVersion'] as const;

/** O cadastro que fica completa o que estiver vazio com o dos repetidos (apelido, endereço, cidade, UF, CEP e a melhor posição). */
export const mergeFields = (keeper: Establishment, others: Establishment[]): Establishment => {
  const out: Establishment = { ...keeper };
  others.forEach(o => {
    if (!out.aliasName?.trim() && o.aliasName?.trim()) out.aliasName = o.aliasName;
    if (!out.address && o.address) out.address = o.address;
    if (!out.city && o.city) out.city = o.city;
    if (!out.state && o.state) out.state = o.state;
    if (!out.cep && o.cep) out.cep = o.cep;
    if (geoRank(o) > geoRank(out)) {
      GEO_FIELDS.forEach(f => { delete (out as any)[f]; if ((o as any)[f] !== undefined) (out as any)[f] = (o as any)[f]; });
    }
  });
  return out;
};

const redirectKey = (cnpj: string, name: string): string => `${cleanCNPJ(cnpj)}|${name}`;

export const applyMergePlans = (
  plans: MergePlan[],
  establishments: Establishment[],
  receipts: Receipt[],
  masters: MasterProduct[] = [],
  redirects: Redirects = {},
): MergeOutcome => {
  let ests = establishments;
  let recs = receipts;
  let ms = masters;
  let red: Redirects = { ...redirects };
  let groups = 0, removed = 0, receiptsChanged = 0;

  plans.forEach(plan => {
    const byKey = new Map(ests.map(e => [storeKey(e), e] as const));
    const members = Array.from(new Set(plan.members)).map(k => byKey.get(k)).filter((e): e is Establishment => !!e);
    if (members.length < 2) return;
    const keeper = members.find(e => storeKey(e) === plan.keep) || members[0];
    const others = members.filter(e => e !== keeper);

    // CNPJ da loja que fica: o dela; sem CNPJ, adota o (certo) de um dos repetidos
    const withId = others.filter(o => idOf(o.cnpj));
    const adopt = withId.find(o => validDocument(o.cnpj)) || withId[0];
    const finalCnpj = idOf(keeper.cnpj) ? cleanCNPJ(keeper.cnpj) : (adopt ? cleanCNPJ(adopt.cnpj) : cleanCNPJ(keeper.cnpj));
    const canon: Redirect = { cnpj: finalCnpj, name: keeper.originalName };
    const nextKeeper = { ...mergeFields(keeper, others), cnpj: finalCnpj };

    const memberIds = new Set(members.map(storeKey));
    const memberCnpjs = new Set(members.map(e => cleanCNPJ(e.cnpj)).filter(Boolean));
    const outsiders = new Set(ests.filter(e => !memberIds.has(storeKey(e))).map(e => cleanCNPJ(e.cnpj)).filter(Boolean));

    recs = recs.map(r => {
      const c = cleanCNPJ(r.cnpj);
      const hit = memberIds.has(`${c}|${r.establishmentName}`) || (!!c && memberCnpjs.has(c) && !outsiders.has(c));
      if (!hit || (c === canon.cnpj && r.establishmentName === canon.name)) return r;
      receiptsChanged += 1;
      return { ...r, cnpj: canon.cnpj, establishmentName: canon.name };
    });

    ests = ests.filter(e => !others.includes(e)).map(e => (e === keeper ? nextKeeper : e));
    removed += others.length;
    groups += 1;

    members.forEach(m => {
      if (m === keeper && finalCnpj === cleanCNPJ(keeper.cnpj)) return;
      const key = redirectKey(m.cnpj, m.originalName);
      if (key !== redirectKey(canon.cnpj, canon.name)) red[key] = canon;
      ms = rekeyStoreCodes(ms, [m.cnpj, m.originalName], canon.cnpj || canon.name);
    });
    // quem já apontava para um cadastro que sumiu passa a apontar para o que ficou
    Object.keys(red).forEach(k => {
      const t = red[k];
      if (memberIds.has(redirectKey(t.cnpj, t.name)) && redirectKey(t.cnpj, t.name) !== redirectKey(canon.cnpj, canon.name)) red[k] = canon;
    });
  });

  return { establishments: ests, receipts: recs, masters: ms, redirects: red, groups, removed, receiptsChanged };
};

/* ───────────────────────────── lembrar o que foi juntado ───────────────────────────── */

export const STORE_MERGES_KEY = 'eukasconta_store_merges';

export const loadRedirects = (): Redirects => {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_MERGES_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
};
export const saveRedirects = (r: Redirects): void => {
  try {
    if (Object.keys(r).length === 0) localStorage.removeItem(STORE_MERGES_KEY);
    else localStorage.setItem(STORE_MERGES_KEY, JSON.stringify(r));
  } catch { /* sem armazenamento: a junção já foi feita nos cupons */ }
};

/** Cupom novo que chega com o nome antigo (a leitura da foto repete a grafia) entra direto na loja que ficou. */
export const applyRedirects = (receipts: Receipt[], redirects: Redirects): { receipts: Receipt[]; changed: number } => {
  if (Object.keys(redirects).length === 0) return { receipts, changed: 0 };
  let changed = 0;
  const out = receipts.map(r => {
    let cnpj = cleanCNPJ(r.cnpj), name = r.establishmentName;
    for (let step = 0; step < 4; step++) {
      const t = redirects[redirectKey(cnpj, name)];
      if (!t || (t.cnpj === cnpj && t.name === name)) break;
      cnpj = t.cnpj; name = t.name;
    }
    if (cnpj === cleanCNPJ(r.cnpj) && name === r.establishmentName) return r;
    changed += 1;
    return { ...r, cnpj, establishmentName: name };
  });
  return { receipts: changed ? out : receipts, changed };
};

/** A loja que ficou mudou de nome ou CNPJ (edição): os avisos guardados passam a apontar para a identidade nova. */
export const retargetRedirects = (redirects: Redirects, from: Redirect, to: Redirect): Redirects => {
  const fk = redirectKey(from.cnpj, from.name), tk = redirectKey(to.cnpj, to.name);
  if (fk === tk) return redirects;
  let changed = false;
  const out: Redirects = {};
  Object.entries(redirects).forEach(([k, t]) => {
    if (redirectKey(t.cnpj, t.name) === fk) { out[k] = { cnpj: cleanCNPJ(to.cnpj), name: to.name }; changed = true; }
    else out[k] = t;
  });
  return changed ? out : redirects;
};
