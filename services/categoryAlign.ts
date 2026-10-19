import { MasterProduct, Receipt, TaxonomyNode } from '../types';
import { fold } from './itemSearch';
import { catKey, deptKey } from './textFormat';
import { Remapper, pathNames, tokensOf } from './taxonomyDedupe';

/* Alinhar as categorias às da Estrutura de Taxonomia.

   A Estrutura (Configurações › Estrutura de Taxonomia) é a lista certa. Os cupons antigos trazem nomes que vieram de outras
   listas ("Despensa - Óleos e Temperos", "Bomboniere", "Carne Bovina - Coxão Mole", "Higiene - Banho e Corpo"...). Aqui:
   1. cada nome que está nas compras é comparado com a Estrutura e recebe a categoria certa, com um nível de confiança;
   2. a pessoa confere, ajusta o que quiser e aplica;
   3. tudo que apontava para o nome antigo passa a apontar para o novo (itens, catálogo, metas, cores, filtros, recortes, fixações);
   4. a escolha fica guardada: cupom novo com o mesmo nome antigo já entra na categoria certa. */

/* ───────────────────────── estrutura como índice ───────────────────────── */

// palavras que querem dizer o mesmo (já sem acento e no singular)
const TOKEN_SYN: Record<string, string> = {
  oral: 'bucal', dental: 'bucal', barba: 'barbear', lacteo: 'laticinio', despensa: 'mercearia', pescado: 'peixe',
};
const norm = (t: string): string => TOKEN_SYN[t] ?? t;

const toks = (s: string): string[] => Array.from(new Set(tokensOf(s).map(norm)));
const keyOf = (s: string): string => toks(s).sort().join(' ');
const SPLIT = /\s+e\s+|\s*[,/&]\s*|\s+ou\s+/i;
const segsOf = (s: string): string[] => s.split(SPLIT).map(keyOf).filter(Boolean);

// famílias de nomes que a pessoa trata como a mesma coisa
const FAMILY_SYN: string[][] = [
  ['cuidado pessoal', 'higiene perfumaria', 'higiene pessoal', 'higiene'],
  ['peixaria', 'peixe'],
];
const famSyn = (key: string): number => FAMILY_SYN.findIndex(g => g.includes(key));

interface Desc { key: string; tok: string[]; segs: string[] }
const descOf = (s: string): Desc => ({ key: keyOf(s), tok: toks(s), segs: segsOf(s) });

export interface AlignTarget {
  id: string;
  level: 1 | 2;
  /** nome do departamento e da categoria, como estão na Estrutura */
  l1: string;
  l2: string | null;
  /** o que o item grava: "Hortifruti - Frutas" (ou só "Hortifruti") */
  path: string;
  key: string;                // catKey(path)
  kids: number;               // categorias dentro (só departamento)
  d1: Desc;
  d2: Desc | null;
}

export interface AlignIndex {
  l1s: AlignTarget[];
  l2s: AlignTarget[];
  byKey: Map<string, AlignTarget>;
  all: AlignTarget[];
}

export const buildAlignIndex = (taxonomy: TaxonomyNode[]): AlignIndex => {
  const l1s: AlignTarget[] = [];
  const l2s: AlignTarget[] = [];
  const kidCount = new Map<string, number>();
  taxonomy.forEach(n => { if (n.level === 2 && n.parentId) kidCount.set(n.parentId, (kidCount.get(n.parentId) || 0) + 1); });
  taxonomy.forEach(n => {
    if (n.level === 1) {
      const l1 = n.name.trim();
      if (!l1) return;
      l1s.push({ id: n.id, level: 1, l1, l2: null, path: l1, key: catKey(l1), kids: kidCount.get(n.id) || 0, d1: descOf(l1), d2: null });
    }
  });
  const l1ById = new Map(l1s.map(t => [t.id, t] as const));
  taxonomy.forEach(n => {
    if (n.level !== 2 || !n.parentId) return;
    const parent = l1ById.get(n.parentId);
    if (!parent) return;
    const l2 = n.name.trim();
    if (!l2) return;
    const path = `${parent.l1} - ${l2}`;
    l2s.push({ id: n.id, level: 2, l1: parent.l1, l2, path, key: catKey(path), kids: 0, d1: parent.d1, d2: descOf(l2) });
  });
  const all = [...l1s, ...l2s];
  const byKey = new Map<string, AlignTarget>();
  all.forEach(t => { if (!byKey.has(t.key)) byKey.set(t.key, t); });
  return { l1s, l2s, byKey, all };
};

/* ───────────────────────── notas de parecença ───────────────────────── */

const subset = (a: string[], b: string[]): boolean => a.length > 0 && a.every(x => b.includes(x));

/** Quanto o nome de departamento `p` combina com o departamento `l` da Estrutura (0 a 100). */
const famScore = (p: Desc, l: Desc): number => {
  if (!p.key || !l.key) return 0;
  if (p.key === l.key) return 100;
  const gp = famSyn(p.key);
  if (gp >= 0 && gp === famSyn(l.key)) return 92;
  if (subset(p.segs, l.segs)) return p.segs.length === l.segs.length ? 100 : 85;
  if (subset(l.segs, p.segs)) return 75;
  if (subset(p.tok, l.tok)) return 70;
  if (subset(l.tok, p.tok)) return 65;
  if (p.segs.some(x => l.segs.includes(x))) return 60;
  return 0;
};

/** Quanto o nome de categoria `p` combina com a categoria `c` da Estrutura (0 a 100). */
const subScore = (p: Desc, c: Desc): number => {
  if (!p.key || !c.key) return 0;
  if (p.key === c.key) return 100;
  if (p.tok.includes('nao') !== c.tok.includes('nao')) return 0;    // "Não Alcoólicas" não é "Alcoólicas"
  if (p.segs.length === c.segs.length && subset(p.segs, c.segs)) return 100;
  if (subset(c.segs, p.segs)) return 88;       // "Queijos e Requeijão" contém "Queijos"
  if (subset(p.segs, c.segs)) return 82;       // "Água" está dentro de "Águas e Sucos"
  if (subset(p.tok, c.tok)) return 78;         // "Bucal" está dentro de "Higiene Bucal"
  if (subset(c.tok, p.tok)) return 72;
  const shared = p.tok.filter(t => c.tok.includes(t)).length;
  if (shared === 0) return 0;
  const jac = shared / new Set([...p.tok, ...c.tok]).size;
  return Math.round(Math.min(68, 30 + 80 * jac));
};

/* ───────────────────────── atalhos de nomes antigos ─────────────────────────
   Nomes de listas antigas que a comparação por palavras não alcança. Cada atalho tem destinos em ordem de preferência; vale o
   primeiro que existe na Estrutura da pessoa (os outros são para quem usa outra versão da lista). */

interface Hint { p0?: RegExp; rest?: RegExp; any?: RegExp; to: string[] }

const HINTS: Hint[] = [
  // sorvete e doces de balcão
  { p0: /^bomboniere/, rest: /sorvete/, to: ['Congelados - Sorvetes e Sobremesas Geladas'] },
  { p0: /^bomboniere|^doces?$/, to: ['Mercearia Doce e Matinais - Doces e Sobremesas', 'Despensa e Grãos - Mercearia Doce'] },
  // despensa / mercearia
  { p0: /^(despensa|mercearia)/, rest: /oleo|azeite|gordura/, to: ['Mercearia Básica - Óleos, Azeites e Gorduras', 'Despensa e Grãos - Mercearia Salgada'] },
  { p0: /^(despensa|mercearia)/, rest: /tempero|condiment|especiaria/, to: ['Mercearia Salgada e Conservas - Temperos e Especiarias', 'Mercearia Básica - Sal e Temperos Básicos', 'Despensa e Grãos - Mercearia Salgada'] },
  { p0: /^(despensa|mercearia)/, rest: /enlatad|conserva/, to: ['Mercearia Salgada e Conservas - Conservas', 'Despensa e Grãos - Mercearia Salgada'] },
  { p0: /^(despensa|mercearia)/, rest: /massa|molho/, to: ['Mercearia Básica - Massas Secas', 'Mercearia Salgada e Conservas - Molhos', 'Despensa e Grãos - Mercearia Salgada'] },
  { p0: /^(despensa|mercearia)/, rest: /arroz/, to: ['Mercearia Básica - Arroz', 'Despensa e Grãos - Mercearia Salgada'] },
  { p0: /^(despensa|mercearia)/, rest: /feijao/, to: ['Mercearia Básica - Feijões e Leguminosas', 'Despensa e Grãos - Mercearia Salgada'] },
  { p0: /^(despensa|mercearia)/, rest: /grao|cereal/, to: ['Mercearia Básica - Grãos, Cereais e Sementes', 'Despensa e Grãos - Mercearia Salgada'] },
  { p0: /^(despensa|mercearia)/, rest: /matinal|cafe|achocolat/, to: ['Mercearia Doce e Matinais - Café', 'Despensa e Grãos - Mercearia Doce'] },
  { p0: /^(despensa|mercearia)/, rest: /farinha|acucar/, to: ['Mercearia Básica - Farinhas e Amidos', 'Despensa e Grãos - Farinhas', 'Mercearia Básica - Açúcares e Adoçantes'] },
  { p0: /^(despensa|mercearia)/, rest: /doce|sobremesa|chocolate/, to: ['Mercearia Doce e Matinais - Doces e Sobremesas', 'Despensa e Grãos - Mercearia Doce'] },
  // padaria
  { p0: /^padaria/, rest: /biscoito|bolacha/, to: ['Mercearia Doce e Matinais - Biscoitos'] },
  { p0: /^padaria/, rest: /bolo|doce|torta/, to: ['Padaria e Confeitaria - Bolos e Tortas', 'Padaria e Confeitaria - Confeitaria'] },
  { p0: /^padaria/, rest: /pao|paes|torrada/, to: ['Padaria e Confeitaria - Pães Industrializados', 'Padaria e Confeitaria - Pães de Produção Própria'] },
  { p0: /^padaria/, rest: /salgad|quiche|lanche/, to: ['Rotisseria e Comida Pronta - Saladas e Sanduíches Prontos', 'Padaria e Confeitaria - Pães de Produção Própria'] },
  // limpeza e casa
  { p0: /^(limpeza|casa|higiene)/, rest: /amaciante|roupa|lavanderia/, to: ['Limpeza e Casa - Lavanderia', 'Limpeza - Cuidados com Roupas'] },
  { p0: /^casa/, rest: /utensilio|ferramenta/, to: ['Utensílios Casa - Ferragens', 'Bazar e Utilidades Domésticas - Casa e Organização'] },
  { p0: /^(limpeza|casa)/, rest: /descartav/, to: ['Limpeza - Descartáveis e Embalagens', 'Bazar e Utilidades Domésticas - Casa e Organização'] },
  { p0: /^(limpeza|casa)/, rest: /cozinha|banheiro/, to: ['Limpeza e Casa - Cozinha e Banheiro', 'Limpeza - Limpeza da Cozinha', 'Limpeza - Limpeza da Casa'] },
  { p0: /^(limpeza|casa)/, rest: /detergente|sabao|desinfetante|alcool|utensilio|vassoura|pano|ferramenta|geral/, to: ['Limpeza e Casa - Cozinha e Banheiro', 'Limpeza - Limpeza da Casa', 'Limpeza - Limpeza da Cozinha', 'Bazar e Utilidades Domésticas - Casa e Organização'] },
  { p0: /^casa/, to: ['Bazar e Utilidades Domésticas - Casa e Organização', 'Limpeza e Casa - Cozinha e Banheiro'] },
  // higiene e farmácia
  { p0: /^(higiene|cuidados? pessoais?|farmacia|saude)/, rest: /bucal|oral|dental|pasta|escova/, to: ['Cuidados Pessoais - Higiene Oral', 'Higiene e Perfumaria - Higiene Bucal'] },
  { p0: /^(higiene|cuidados? pessoais?|farmacia|saude)/, rest: /cabelo|shampoo|condicionador/, to: ['Cuidados Pessoais - Cabelo', 'Higiene e Perfumaria - Cuidados com o Cabelo'] },
  { p0: /^(higiene|cuidados? pessoais?|farmacia|saude)/, rest: /banho|sabonete|corpo/, to: ['Cuidados Pessoais - Banho', 'Higiene e Perfumaria - Cuidados com o Corpo'] },
  { p0: /^(higiene|cuidados? pessoais?|farmacia|saude)/, rest: /intima|papel|algodao|absorvente/, to: ['Higiene e Perfumaria - Higiene Íntima e Pessoal'] },
  { p0: /^(higiene|cuidados? pessoais?|farmacia|saude)/, rest: /barba|depila/, to: ['Higiene e Perfumaria - Barbear e Depilação'] },
  { p0: /^(higiene|cuidados? pessoais?|farmacia|saude)/, rest: /saude|farmacia|remedio/, to: ['Higiene e Perfumaria - Farmácia Básica'] },
  { p0: /^(higiene|cuidados? pessoais?|farmacia|saude)/, rest: /cosmetic|beleza|maquiag/, to: ['Cuidados Pessoais - Cosméticos', 'Higiene e Perfumaria - Cuidados com o Rosto e Maquiagem'] },
  { p0: /^(higiene|cuidados? pessoais?|farmacia|saude)/, rest: /mao|\bpes?\b|unha/, to: ['Cuidados Pessoais - Mãos e Pés'] },
  { p0: /^farmacia/, to: ['Higiene e Perfumaria - Farmácia Básica'] },
  { p0: /^cuidados? pessoais?/, to: ['Cuidados Pessoais - Cosméticos', 'Higiene e Perfumaria - Cuidados com o Rosto e Maquiagem'] },
  // bebidas
  { p0: /^bebida/, rest: /nao alcool/, to: ['Bebidas - Águas e Sucos', 'Bebidas - Sucos e Néctares'] },
  { p0: /^bebida/, rest: /alcool/, to: ['Bebidas - Alcoólicas'] },
  { p0: /^bebida/, rest: /refrigerante/, to: ['Bebidas - Refrigerantes'] },
  { p0: /^bebida/, rest: /agua|suco|cha\b/, to: ['Bebidas - Águas e Sucos', 'Bebidas - Águas', 'Bebidas - Sucos e Néctares'] },
  // refrigerados e laticínios
  { p0: /^refrigerad/, rest: /laticin|ovo|leite/, to: ['Laticínios e Frios - Leites e Derivados', 'Frios e Laticínios - Leites e Bebidas Lácteas Refrigeradas'] },
  { p0: /^refrigerad/, rest: /carne|proteina/, to: ['Açougue e Peixaria - Carne Bovina', 'Açougue - Carne Bovina'] },
  { p0: /^refrigerad/, rest: /congelad|prato/, to: ['Congelados - Pratos Prontos Congelados'] },
  { p0: /^(laticin|frios?)/, rest: /presunto|embutido|^frios?\b/, to: ['Laticínios e Frios - Presuntos e Embutidos', 'Frios e Laticínios - Frios e Embutidos'] },
  { p0: /^(laticin|frios?)/, rest: /leite|iogurte/, to: ['Laticínios e Frios - Leites e Derivados', 'Frios e Laticínios - Leites e Bebidas Lácteas Refrigeradas', 'Frios e Laticínios - Iogurtes e Sobremesas Lácteas'] },
  // bazar
  { p0: /^bazar/, rest: /ferramenta|pilha/, to: ['Bazar e Utilidades Domésticas - Elétricos e Iluminação', 'Utensílios Casa - Ferragens'] },
  { p0: /^bazar/, rest: /cozinha|utilidade/, to: ['Bazar e Utilidades Domésticas - Utensílios de Cozinha'] },
  // vestuário
  { p0: /^vestuario/, rest: /blusa|calca|vestido|peca|camis|roupa|acessorio/, to: ['Vestuário - Roupas'] },
  // carnes e peixes que viraram departamento
  { any: /pescad|peixe/, to: ['Açougue e Peixaria - Pescados e Mar', 'Peixaria - Peixes Frescos', 'Açougue e Peixaria - Peixes Frescos'] },
  { p0: /^carne (de )?ave|^frango|^aves?$/, to: ['Açougue e Peixaria - Carne de Aves', 'Açougue - Aves'] },
  { p0: /^carne bovina|^bovin/, to: ['Açougue e Peixaria - Carne Bovina', 'Açougue - Carne Bovina'] },
  { p0: /^carne suina|^suin/, to: ['Açougue e Peixaria - Carne Suína', 'Açougue - Carne Suína'] },
];

/* ───────────────────────── achar a categoria certa ───────────────────────── */

export type AlignConf = 'igual' | 'alta' | 'media' | 'baixa' | 'nenhuma';

export interface Candidate { target: AlignTarget; score: number; conf: AlignConf; reason: string }

export interface Resolution {
  target: AlignTarget | null;
  conf: AlignConf;
  reason: string;
  /** outras escolhas possíveis, da melhor para a pior (sem a escolhida) */
  alts: AlignTarget[];
}

const NO_CAT = new Set(['', 'outros', 'sem categoria', 'sem categoria definida', 'nao categorizado']);
export const isUncategorized = (cat: string | undefined | null): boolean => NO_CAT.has(fold(cat).trim());

const parts = (raw: string): string[] => String(raw ?? '').split(' - ').map(p => p.trim()).filter(Boolean);

/** Procura "Departamento - Categoria" (como escrito num atalho) na Estrutura: só vale se combinar de verdade. */
const findLabel = (idx: AlignIndex, label: string): AlignTarget | null => {
  const hit = idx.byKey.get(catKey(label));
  if (hit) return hit;
  const [a, b] = label.split(' - ');
  if (!b) return null;
  const da = descOf(a), db = descOf(b);
  let best: AlignTarget | null = null, bestScore = 0;
  idx.l2s.forEach(t => {
    const f = famScore(da, t.d1), s = subScore(db, t.d2!);
    if (f >= 85 && s >= 88 && f + s > bestScore) { best = t; bestScore = f + s; }
  });
  return best;
};

const RANK: Record<AlignConf, number> = { igual: 4, alta: 3, media: 2, baixa: 1, nenhuma: 0 };

/** Qual categoria da Estrutura é a certa para um nome que está nos cupons. `use` (itens por categoria) desempata. */
export const resolveCategory = (raw: string, idx: AlignIndex, use?: Map<string, number>): Resolution => {
  const empty: Resolution = { target: null, conf: 'nenhuma', reason: 'nenhuma categoria da Estrutura combina', alts: [] };
  const ps = parts(raw);
  if (ps.length === 0 || isUncategorized(raw)) return { ...empty, reason: 'sem categoria' };

  // 1. o mesmo nome (só muda caixa, acento, plural)
  const exact = idx.byKey.get(catKey(ps.join(' - ')));
  if (exact) return { target: exact, conf: 'igual', reason: 'já é uma categoria da Estrutura', alts: [] };

  const cands: Candidate[] = [];
  const add = (target: AlignTarget, score: number, conf: AlignConf, reason: string) => {
    const old = cands.find(c => c.target.id === target.id);
    if (old) {
      if (RANK[conf] > RANK[old.conf] || (RANK[conf] === RANK[old.conf] && score > old.score)) { old.score = Math.max(score, old.score); old.conf = conf; old.reason = reason; }
      return;
    }
    cands.push({ target, score, conf, reason });
  };
  const p0 = descOf(ps[0]);
  const restText = ps.slice(1).join(' ');
  const rests = ps.length > 1 ? [descOf(ps[1]), ...(ps.length > 2 ? [descOf(restText)] : [])] : [];

  // 2. mesmo departamento (ou parecido) e categoria parecida
  const fams = idx.l1s.map(t => ({ t, f: famScore(p0, t.d1) })).filter(x => x.f >= 60);
  if (rests.length > 0) {
    fams.forEach(({ t: fam, f }) => {
      idx.l2s.filter(c => c.l1 === fam.l1).forEach(c => {
        const s = Math.max(...rests.map(r => subScore(r, c.d2!)));
        if (s <= 0) return;
        if (f >= 85 && s >= 82) add(c, f + s, 'alta', `"${ps[0]}" é o departamento "${fam.l1}" e "${ps.slice(1).join(' - ')}" combina com "${c.l2}"`);
        else if (f >= 65 && s >= 70) add(c, f + s, 'media', `departamento parecido e categoria parecida com "${c.l2}"`);
        else if (f >= 60 && s >= 100) add(c, f + s, 'media', `a categoria "${c.l2}" é igual e o departamento tem uma palavra em comum com "${fam.l1}"`);
        else if (f >= 65 && s >= 40) add(c, f + s, 'baixa', `parece "${c.l2}"`);
      });
    });
  }

  // 3. o primeiro pedaço já é uma categoria da Estrutura ("Carne Bovina - Coxão Mole" → Açougue e Peixaria - Carne Bovina);
  //    se ele é um departamento da Estrutura, vale o passo 2
  const isDept = fams.some(x => x.f >= 75);
  if (!isDept) idx.l2s.forEach(c => {
    const s = subScore(p0, c.d2!);
    if (s >= 88) add(c, 150 + s, 'alta', `"${ps[0]}" é a categoria "${c.l2}" de "${c.l1}"`);
    else if (s >= 72 && ps.length === 1 && fams.length === 0) add(c, 120 + s, 'media', `"${ps[0]}" lembra a categoria "${c.l2}" de "${c.l1}"`);
  });

  // 4. atalhos para nomes de listas antigas (só quando a comparação acima não bastou)
  const best0 = cands.reduce((m, c) => Math.max(m, RANK[c.conf]), 0);
  if (best0 < RANK.alta) {
    const fp0 = fold(ps[0]), frest = fold(restText), ffull = fold(ps.join(' '));
    for (const h of HINTS) {
      if (h.p0 && !h.p0.test(fp0)) continue;
      if (h.rest && !h.rest.test(frest)) continue;
      if (h.any && !h.any.test(ffull)) continue;
      const hit = h.to.map(l => findLabel(idx, l)).find((x): x is AlignTarget => !!x);
      if (hit) { add(hit, 400, 'media', 'nome de uma lista antiga; esta é a categoria equivalente'); break; }
    }
  }

  // 5. só o departamento combina: a categoria é o próprio departamento
  fams.forEach(({ t: fam, f }) => {
    if (f >= 85 && ps.length === 1) add(fam, f, fam.kids > 0 ? 'media' : 'alta', `"${ps[0]}" é o departamento "${fam.l1}"`);
    else if (f >= 85) add(fam, f - 30, 'baixa', `só o departamento "${fam.l1}" combina`);
    else if (f >= 70 && cands.length === 0) add(fam, f - 40, 'baixa', `lembra o departamento "${fam.l1}"`);
  });

  // 5b. o segundo pedaço é um departamento da Estrutura ("Despensa - Mercearia Salgada" → Mercearia Salgada e Conservas)
  if (cands.length === 0 && rests.length > 0) {
    idx.l1s.forEach(l => {
      const f = famScore(rests[0], l.d1);
      if (f >= 85) add(l, f - 20, 'baixa', `"${ps[1]}" é o departamento "${l.l1}"`);
    });
  }

  // 6. sem departamento: procura a categoria só pelo segundo pedaço ("Casa - Descartáveis")
  if (cands.length === 0 && rests.length > 0) {
    idx.l2s.forEach(c => {
      const s = Math.max(...rests.map(r => subScore(r, c.d2!)));
      if (s >= 82) add(c, s, 'baixa', `"${ps.slice(1).join(' - ')}" lembra a categoria "${c.l2}" de "${c.l1}"`);
    });
  }

  if (cands.length === 0) return empty;
  const useOf = (t: AlignTarget) => use?.get(t.key) || 0;
  cands.sort((a, b) => RANK[b.conf] - RANK[a.conf] || b.score - a.score || useOf(b.target) - useOf(a.target) || a.target.path.length - b.target.path.length);
  const top = cands[0];
  return { target: top.target, conf: top.conf, reason: top.reason, alts: cands.slice(1, 5).map(c => c.target) };
};

/* ───────────────────────── o plano: todos os nomes das compras ───────────────────────── */

export interface AlignRow {
  /** identidade da linha: o nome sem caixa nem acento */
  key: string;
  /** a grafia mais usada nas compras */
  from: string;
  /** todas as grafias exatas que caem aqui */
  variants: string[];
  items: number;
  total: number;
  to: string | null;
  targetKey: string | null;
  conf: AlignConf;
  reason: string;
  alts: { path: string; key: string }[];
  /** já é uma categoria da Estrutura e está escrita igual */
  same: boolean;
  /** veio de uma escolha antiga da pessoa */
  fromAlias?: boolean;
}

export interface AlignPlan {
  rows: AlignRow[];
  /** itens das compras que já estão certos */
  itemsSame: number;
  items: number;
  /** nomes diferentes de categoria que estão fora da Estrutura */
  outside: number;
  counts: Record<AlignConf, number>;
}

export const ALIASES_KEY = 'eukasconta_cat_aliases';
export type Aliases = Record<string, string>;

export const loadAliases = (): Aliases => {
  try {
    const v = JSON.parse(localStorage.getItem(ALIASES_KEY) || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Aliases = {};
    Object.entries(v).forEach(([k, val]) => { if (typeof val === 'string' && val) out[k] = val; });
    return out;
  } catch { return {}; }
};

export const saveAliases = (a: Aliases): void => {
  try { localStorage.setItem(ALIASES_KEY, JSON.stringify(a)); } catch { /* sem armazenamento: a escolha vale só nesta sessão */ }
};

interface Seen { variants: Map<string, number>; items: number; total: number }

export const buildAlignPlan = (
  taxonomy: TaxonomyNode[],
  receipts: Receipt[],
  masters: MasterProduct[] = [],
  aliases: Aliases = {},
  index?: AlignIndex,
): AlignPlan => {
  const idx = index ?? buildAlignIndex(taxonomy);
  const seen = new Map<string, Seen>();
  const touch = (raw: string, items: number, total: number) => {
    const cat = String(raw ?? '').trim();
    if (!cat || isUncategorized(cat)) return;
    const k = catKey(cat);
    let s = seen.get(k);
    if (!s) { s = { variants: new Map(), items: 0, total: 0 }; seen.set(k, s); }
    s.variants.set(String(raw), (s.variants.get(String(raw)) || 0) + items);
    s.items += items; s.total += total;
  };
  receipts.forEach(r => (r.items || []).forEach(i => touch(i.category, 1, Number(i.totalPrice) || 0)));
  masters.forEach(m => touch(m.category, 0, 0));

  const use = new Map<string, number>();
  seen.forEach((s, k) => use.set(k, s.items));

  const rows: AlignRow[] = [];
  let itemsSame = 0, items = 0;
  const counts: Record<AlignConf, number> = { igual: 0, alta: 0, media: 0, baixa: 0, nenhuma: 0 };
  seen.forEach((s, key) => {
    const variants = Array.from(s.variants.entries()).sort((a, b) => b[1] - a[1]).map(([v]) => v);
    const from = variants[0];
    let res = resolveCategory(from, idx, use);
    let fromAlias = false;
    const aliasTo = aliases[key];
    if (aliasTo && res.conf !== 'igual') {
      const t = idx.byKey.get(catKey(aliasTo));
      if (t) { res = { target: t, conf: 'alta', reason: 'escolha sua de antes', alts: res.target && res.target.id !== t.id ? [res.target, ...res.alts] : res.alts }; fromAlias = true; }
    }
    const t = res.target;
    const same = res.conf === 'igual' && !!t && variants.every(v => v.trim() === t.path);
    items += s.items;
    if (same) itemsSame += s.items;
    counts[res.conf] += 1;
    rows.push({
      key, from, variants, items: s.items, total: s.total,
      to: t ? t.path : null, targetKey: t ? t.key : null,
      conf: res.conf, reason: res.reason,
      alts: res.alts.map(a => ({ path: a.path, key: a.key })),
      same, fromAlias,
    });
  });
  rows.sort((a, b) => b.items - a.items || a.from.localeCompare(b.from, 'pt-BR'));
  return { rows, itemsSame, items, outside: rows.filter(r => r.conf !== 'igual').length, counts };
};

/** Linhas que precisam de decisão (mudam o nome ou ficam sem categoria), sem as que só mudam a grafia. */
export const pendingRows = (plan: AlignPlan): AlignRow[] => plan.rows.filter(r => !r.same && r.conf !== 'igual');
/** Linhas que só diferem na grafia (caixa, acento, plural) da categoria certa. */
export const spellingRows = (plan: AlignPlan): AlignRow[] => plan.rows.filter(r => !r.same && r.conf === 'igual');
/** O que vem marcado para aplicar de início: o que tem confiança alta ou média. */
export const defaultAccepted = (plan: AlignPlan): Set<string> =>
  new Set(plan.rows.filter(r => !r.same && r.to && (r.conf === 'igual' || r.conf === 'alta' || r.conf === 'media')).map(r => r.key));

/* ───────────────────────── aplicar nos dados ───────────────────────── */

export interface AlignRemapper extends Remapper {
  /** chaves de filtro/recorte → as novas (um departamento inteiro pode virar várias categorias) */
  keysMany: (keys: string[]) => string[];
  /** fixações de grupo/item ("categoria\u0001descrição" → chave do grupo) acertadas para a categoria nova */
  pins: (pins: Record<string, string>) => Record<string, string>;
}

export interface AlignChoice { key: string; from: string; variants: string[]; to: string }

export const buildAlignRemapper = (plan: AlignPlan, choices: AlignChoice[]): AlignRemapper => {
  const exact = new Map<string, string>();
  const byKey = new Map<string, string>();         // catKey antigo → nome novo
  const keyToKey = new Map<string, string>();      // catKey antigo → catKey novo
  const changed = new Map<string, string>();
  choices.forEach(c => {
    const newKey = catKey(c.to);
    c.variants.forEach(v => { if (v !== c.to) exact.set(v, c.to); });
    if (catKey(c.from) !== newKey || c.variants.some(v => v !== c.to)) {
      byKey.set(catKey(c.from), c.to);
      keyToKey.set(catKey(c.from), newKey);
    }
    if (c.from !== c.to) changed.set(c.from, c.to);
  });
  const chosen = new Set(choices.map(c => c.key));

  const category = (cat: string): string => {
    const raw = String(cat ?? '');
    const hit = exact.get(raw);
    if (hit !== undefined) return hit;
    const k = catKey(raw);
    const viaKey = byKey.get(k);
    return viaKey !== undefined ? viaKey : raw;
  };

  const path = (full: string): string | null => {
    const ps = String(full ?? '').split(' - ').map(p => p.trim()).filter(Boolean);
    if (ps.length === 0) return null;
    for (let n = Math.min(ps.length, 2); n >= 1; n--) {
      if (n === 1 && ps.length > 1) break;
      const head = ps.slice(0, n).join(' - ');
      const to = byKey.get(catKey(head));
      if (to === undefined) continue;
      const tail = ps.slice(n);
      const toDepth = to.split(' - ').length;
      const next = toDepth >= 2 && tail.length > 0 ? `${to} - ${tail.join(' - ')}` : to;
      return next === full ? null : next;
    }
    return null;
  };

  // departamento (chave plana) → o que acontece com as linhas dele
  const rowsOfDept = new Map<string, AlignRow[]>();
  plan.rows.forEach(r => { const d = deptKey(r.from); const a = rowsOfDept.get(d); if (a) a.push(r); else rowsOfDept.set(d, [r]); });
  const toOf = new Map(choices.map(c => [c.key, c.to] as const));

  const keysMany = (keys: string[]): string[] => {
    const out: string[] = [];
    const push = (k: string) => { if (!out.includes(k)) out.push(k); };
    keys.forEach(k => {
      if (!k.includes(':')) {
        // departamento inteiro: o que continua no departamento fica; o que mudou de departamento vira a categoria nova
        const rows = rowsOfDept.get(k);
        if (!rows || rows.length === 0) { push(k); return; }
        let keep = false;
        rows.forEach(r => {
          const to = chosen.has(r.key) ? toOf.get(r.key) : undefined;
          if (to === undefined || deptKey(to) === k) keep = true;
          else push(`c:${catKey(to)}`);
        });
        if (keep) push(k);
        return;
      }
      const kind = k.slice(0, 2);
      const body = k.slice(2);
      if (kind === 'c:') {
        const nk = keyToKey.get(body);
        push(nk !== undefined ? `c:${nk}` : k);
        return;
      }
      // g:, i:, o: → "categoria|grupo|item"
      const bar = body.indexOf('|');
      const ck = bar >= 0 ? body.slice(0, bar) : body;
      const tail = bar >= 0 ? body.slice(bar) : '';
      const nk = keyToKey.get(ck);
      if (nk === undefined) { push(k); return; }
      const dest = byKey.get(ck) || '';
      if (dest.split(' - ').length < 2) return;      // virou só departamento: grupo e item não existem lá
      push(`${kind}${nk}${tail}`);
    });
    return out;
  };

  const pins = (all: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    const later: [string, string][] = [];
    Object.entries(all || {}).forEach(([pk, val]) => {
      const sep = pk.indexOf('\u0001');
      const ck = sep >= 0 ? pk.slice(0, sep) : pk;
      const nk = keyToKey.get(ck);
      if (nk === undefined) { out[pk] = val; return; }
      const dest = byKey.get(ck) || '';
      if (dest.split(' - ').length < 2) return;
      const mapped = keysMany([val])[0];
      if (!mapped) return;
      later.push([`${nk}${sep >= 0 ? pk.slice(sep) : ''}`, mapped]);
    });
    later.forEach(([k, v]) => { if (!(k in out)) out[k] = v; });
    return out;
  };

  return {
    category,
    key: (k: string) => keysMany([k])[0] ?? k,
    path,
    node: (id: string) => id,
    changed,
    keysMany,
    pins,
  };
};

/* ───────────────────────── cupom novo já entra certo ───────────────────────── */

/** O nome que a Estrutura usa para esta categoria, ou o mesmo nome se ela não se encaixa em nada com segurança.
    Só confiança alta ou média, ou uma escolha guardada, mexe no nome. */
export const snapCategory = (raw: string, idx: AlignIndex, aliases: Aliases = {}): string => {
  const cat = String(raw ?? '');
  if (!cat.trim() || isUncategorized(cat)) return cat;
  const k = catKey(cat);
  const own = idx.byKey.get(k);
  if (own) return own.path;
  const a = aliases[k];
  if (a) { const t = idx.byKey.get(catKey(a)); if (t) return t.path; }
  const res = resolveCategory(cat, idx);
  return res.target && (res.conf === 'alta' || res.conf === 'media') ? res.target.path : cat;
};

export const snapReceiptCategories = (receipts: Receipt[], idx: AlignIndex, aliases: Aliases = {}): { receipts: Receipt[]; items: number } => {
  let items = 0;
  const out = receipts.map(r => {
    let touched = false;
    const next = (r.items || []).map(i => {
      const nc = snapCategory(i.category, idx, aliases);
      if (nc === i.category) return i;
      touched = true; items += 1;
      return { ...i, category: nc };
    });
    return touched ? { ...r, items: next } : r;
  });
  return { receipts: items > 0 ? out : receipts, items };
};

/* ───────────────────────── o que está dentro e fora da Estrutura ───────────────────────── */

/** Chaves de departamento e de categoria que existem na Estrutura (para marcar o que está fora nas listas de escolha). */
export const structureKeys = (taxonomy: TaxonomyNode[]): StructureKeys => {
  const byId = new Map(taxonomy.map(n => [n.id, n] as const));
  const depts = new Set<string>(), cats = new Set<string>();
  taxonomy.forEach(n => {
    if (n.level === 1) { depts.add(deptKey(n.name)); cats.add(catKey(n.name)); }
    else if (n.level === 2) {
      const names = pathNames(n, byId);
      if (names.length === 2) cats.add(catKey(names.join(' - ')));
    }
  });
  return { depts, cats };
};

/** Esta categoria (como está num item) existe na Estrutura? */
export const inStructure = (category: string | undefined | null, keys: StructureKeys): boolean => {
  const c = String(category ?? '').trim();
  if (!c) return true;
  if (isUncategorized(c)) return true;
  return keys.cats.has(catKey(c));
};

/** Todas as categorias que a pessoa pode escolher, no formato que o item grava, em ordem alfabética. */
export const structureCategories = (taxonomy: TaxonomyNode[]): string[] => {
  const idx = buildAlignIndex(taxonomy);
  const out: string[] = [];
  idx.l1s.forEach(l1 => {
    const kids = idx.l2s.filter(c => c.l1 === l1.l1);
    if (kids.length === 0) out.push(l1.path);
    else kids.forEach(k => out.push(k.path));
  });
  return Array.from(new Set(out)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
};

/* A Estrutura em uso (como `getActiveLayers`): as listas de escolha marcam o que está fora dela sem receber a taxonomia. */
export interface StructureKeys { depts: Set<string>; cats: Set<string> }
let activeStructure: StructureKeys | null = null;
export const setActiveStructure = (k: StructureKeys | null): void => { activeStructure = k; };
export const getActiveStructure = (): StructureKeys | null => activeStructure;

/** Departamento fora da Estrutura? (sem Estrutura em uso, nada é "fora") */
export const deptOutside = (dept: string, k: StructureKeys | null = activeStructure): boolean => !!k && k.depts.size > 0 && !k.depts.has(deptKey(dept));
/** Categoria ("Departamento - Categoria") fora da Estrutura? */
export const catOutside = (category: string, k: StructureKeys | null = activeStructure): boolean => !!k && k.cats.size > 0 && !k.cats.has(catKey(category));

export const OPEN_ALIGN_EVENT = 'eukasconta-open-align';
/** Pede ao app para abrir a tela "Alinhar categorias" (as listas de escolha avisam o que está fora da Estrutura). */
export const openAlignSheet = (): void => { try { window.dispatchEvent(new Event(OPEN_ALIGN_EVENT)); } catch { /* sem janela */ } };
