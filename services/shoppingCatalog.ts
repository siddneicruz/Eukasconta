import type { History, MeatClass, Product } from './shoppingList';
import { stripAccentsUpper } from './productPriceStats';

/* Catálogo de frutas, verduras, legumes e carnes de churrasco.
   Serve para escolher o que entra na cesta da semana e no churrasco MESMO o que a pessoa nunca comprou.
   O que ela já comprou aparece primeiro, com o preço da última compra; o resto vem daqui, sem preço (ela informa).
   Aqui ficam só dados e contas (sem tela), para poder testar. */

export type CatGroup = 'fruta' | 'verdura' | 'carne';
export type CatClass = MeatClass | 'extra';

export interface CatalogItem {
  id: string;
  name: string;
  group: CatGroup;
  cls?: CatClass;           // carnes: tipo (bovina, linguiça, frango, suína) ou "extra" (pão de alho, carvão...)
  unit: 'KG' | 'UN';
  typical: number;          // quanto se leva numa semana / num churrasco
  match: RegExp;            // como esse item aparece nos cupons (sem acento, em maiúsculas)
  not?: RegExp;
}

type Row = [name: string, unit: 'KG' | 'UN', typical: number, match: RegExp, not?: RegExp];

// A ordem importa: o mais específico vem antes do genérico ("Batata doce" antes de "Batata"), porque cada produto
// do histórico só vale para um item do catálogo.
const FRUTAS: Row[] = [
  ['Banana prata', 'KG', 1.2, /BANANA.*PRATA|PRATA.*BANANA/],
  ['Banana nanica', 'KG', 1.2, /BANANA.*(NANICA|CAVENDISH)|NANICA/],
  ['Banana da terra', 'KG', 1, /BANANA.*TERRA/],
  ['Maçã fuji', 'KG', 1, /MACA.*FUJI|FUJI/],
  ['Maçã gala', 'KG', 1, /MACA.*GALA|GALA/],
  ['Maçã verde', 'KG', 0.8, /MACA.*VERDE|GRANNY/],
  ['Laranja pera', 'KG', 2, /LARANJA.*PERA/],
  ['Laranja lima', 'KG', 1.5, /LARANJA.*LIMA/],
  ['Laranja bahia', 'KG', 2, /LARANJA.*(BAHIA|UMBIGO)/],
  ['Mexerica (tangerina)', 'KG', 1.5, /MEXERICA|TANGERINA|PONKAN|BERGAMOTA/],
  ['Limão tahiti', 'KG', 0.5, /LIMAO/],
  ['Mamão papaia', 'KG', 1, /MAMAO.*PAPAIA|PAPAIA/],
  ['Mamão formosa', 'KG', 1.5, /MAMAO/],
  ['Melancia', 'KG', 3, /MELANCIA/],
  ['Melão', 'KG', 1.5, /MELAO/],
  ['Abacaxi', 'UN', 1, /ABACAXI/],
  ['Uva', 'KG', 0.8, /\bUVA\b|\bUVAS\b/],
  ['Manga', 'KG', 1, /MANGA/],
  ['Pera', 'KG', 0.8, /\bPERA\b/, /LARANJA/],
  ['Morango (bandeja)', 'UN', 2, /MORANGO/],
  ['Kiwi', 'KG', 0.5, /KIWI/],
  ['Goiaba', 'KG', 0.8, /GOIABA/],
  ['Maracujá', 'KG', 0.6, /MARACUJA/],
  ['Abacate', 'KG', 1, /ABACATE/],
  ['Ameixa', 'KG', 0.6, /AMEIXA/],
  ['Pêssego', 'KG', 0.6, /PESSEGO/],
  ['Nectarina', 'KG', 0.6, /NECTARINA/],
  ['Caqui', 'KG', 0.8, /CAQUI/],
  ['Coco verde', 'UN', 1, /\bCOCO\b/],
  ['Figo', 'KG', 0.4, /\bFIGO/],
  ['Lichia', 'KG', 0.5, /LICHIA/],
  ['Pitaya', 'KG', 0.6, /PITAYA/],
  ['Cereja', 'KG', 0.4, /CEREJA/],
  ['Acerola', 'KG', 0.4, /ACEROLA/],
  ['Mirtilo (bandeja)', 'UN', 1, /MIRTILO|BLUEBERRY/],
  ['Framboesa (bandeja)', 'UN', 1, /FRAMBOESA/],
  ['Amora (bandeja)', 'UN', 1, /AMORA/],
];

const VERDURAS: Row[] = [
  ['Tomate cereja (bandeja)', 'UN', 1, /TOMATE.*CEREJA/],
  ['Tomate italiano', 'KG', 1, /TOMATE/],
  ['Cebola roxa', 'KG', 0.5, /CEBOLA.*ROXA|ROXA.*CEBOLA/],
  ['Cebola', 'KG', 1, /CEBOLA\b/],
  ['Alho', 'KG', 0.2, /\bALHO\b/, /PORO/],
  ['Batata doce', 'KG', 1, /BATATA.*DOCE/],
  ['Batata inglesa', 'KG', 2, /BATATA/],
  ['Cenoura', 'KG', 1, /CENOURA/],
  ['Beterraba', 'KG', 0.7, /BETERRABA/],
  ['Abobrinha', 'KG', 0.8, /ABOBRINHA/],
  ['Abóbora cabotiá', 'KG', 1, /ABOBORA/],
  ['Chuchu', 'KG', 0.8, /CHUCHU/],
  ['Pepino', 'KG', 0.6, /PEPINO/],
  ['Pimentão verde', 'KG', 0.4, /PIMENTAO.*VERDE/],
  ['Pimentão vermelho', 'KG', 0.4, /PIMENTAO.*VERMELH/],
  ['Pimentão amarelo', 'KG', 0.4, /PIMENTAO.*AMAREL/],
  ['Berinjela', 'KG', 0.6, /BERINJELA/],
  ['Brócolis', 'UN', 1, /BROCOLIS/],
  ['Couve-flor', 'UN', 1, /COUVE.*FLOR/],
  ['Couve (maço)', 'UN', 1, /COUVE/],
  ['Repolho roxo', 'UN', 1, /REPOLHO.*ROXO/],
  ['Repolho', 'UN', 1, /REPOLHO/],
  ['Alface crespa', 'UN', 1, /ALFACE.*CRESPA/],
  ['Alface americana', 'UN', 1, /ALFACE.*AMERICANA/],
  ['Alface roxa', 'UN', 1, /ALFACE.*ROXA/],
  ['Alface lisa', 'UN', 1, /ALFACE/],
  ['Rúcula (maço)', 'UN', 1, /RUCULA/],
  ['Agrião (maço)', 'UN', 1, /AGRIAO/],
  ['Espinafre (maço)', 'UN', 1, /ESPINAFRE/],
  ['Almeirão (maço)', 'UN', 1, /ALMEIRAO/],
  ['Cheiro-verde (maço)', 'UN', 1, /CHEIRO.*VERDE/],
  ['Salsinha (maço)', 'UN', 1, /SALSA\b|SALSINHA/],
  ['Cebolinha (maço)', 'UN', 1, /CEBOLINHA/],
  ['Coentro (maço)', 'UN', 1, /COENTRO/],
  ['Hortelã (maço)', 'UN', 1, /HORTELA/],
  ['Manjericão (maço)', 'UN', 1, /MANJERICAO/],
  ['Vagem', 'KG', 0.4, /VAGEM/],
  ['Milho verde (espigas)', 'UN', 3, /MILHO/],
  ['Mandioca (aipim)', 'KG', 1, /MANDIOCA|AIPIM|MACAXEIRA/],
  ['Inhame', 'KG', 0.8, /INHAME/],
  ['Quiabo', 'KG', 0.4, /QUIABO/],
  ['Gengibre', 'KG', 0.1, /GENGIBRE/],
  ['Rabanete (maço)', 'UN', 1, /RABANETE/],
  ['Ervilha torta', 'KG', 0.3, /ERVILHA/],
  ['Aspargo (maço)', 'UN', 1, /ASPARGO/],
  ['Cogumelo (bandeja)', 'UN', 1, /COGUMELO|CHAMPIGNON|SHIITAKE|SHIMEJI/],
];

// carnes: [nome, unidade, quanto leva, como aparece no cupom, tipo]
type MRow = [name: string, unit: 'KG' | 'UN', typical: number, match: RegExp, cls: CatClass, not?: RegExp];
const CARNES: MRow[] = [
  ['Picanha', 'KG', 1, /PICANHA/, 'bovina'],
  ['Fraldinha', 'KG', 1, /FRALDINHA/, 'bovina'],
  ['Maminha', 'KG', 1, /MAMINHA/, 'bovina'],
  ['Alcatra', 'KG', 1, /ALCATRA/, 'bovina'],
  ['Contrafilé', 'KG', 1, /CONTRA ?FILE/, 'bovina'],
  ['Costela bovina', 'KG', 2, /COSTELA/, 'bovina', /SUIN|PORCO|MINGA/],
  ['Cupim', 'KG', 1.5, /CUPIM/, 'bovina'],
  ['Entrecot', 'KG', 1, /ENTRECOT/, 'bovina'],
  ['Vazio', 'KG', 1, /\bVAZIO\b/, 'bovina'],
  ['Ancho', 'KG', 1, /ANCHO/, 'bovina'],
  ['Bavete', 'KG', 1, /BAVETE/, 'bovina'],
  ['Rib eye', 'KG', 1, /RIB ?EYE/, 'bovina'],
  ['T-bone', 'KG', 1, /T ?BONE/, 'bovina'],
  ['Filé mignon', 'KG', 1, /FILE MIGNON|MIGNON/, 'bovina'],
  ['Coxão mole', 'KG', 1, /COXAO MOLE/, 'bovina'],
  ['Acém', 'KG', 1, /ACEM/, 'bovina'],
  ['Linguiça de frango', 'KG', 0.8, /LINGUI.*FRANGO/, 'linguica'],
  ['Linguiça toscana', 'KG', 1, /TOSCANA/, 'linguica'],
  ['Linguiça calabresa', 'KG', 0.8, /CALABRESA/, 'linguica'],
  ['Linguiça cuiabana', 'KG', 0.8, /CUIABANA/, 'linguica'],
  ['Salsichão', 'KG', 0.6, /SALSICH/, 'linguica'],
  ['Coxa e sobrecoxa de frango', 'KG', 1.5, /\bCOXAS?\b|SOBRECOXAS?/, 'frango'],
  ['Coração de frango', 'KG', 0.5, /CORACAO/, 'frango'],
  ['Asinha de frango', 'KG', 1, /\bASAS?\b|ASINHA/, 'frango'],
  ['Tulipa de frango', 'KG', 1, /TULIPA/, 'frango'],
  ['Peito de frango', 'KG', 1, /PEITO.*FRANGO|FRANGO.*PEITO/, 'frango'],
  ['Costelinha suína', 'KG', 1.5, /COSTELINHA|COSTELA SUIN/, 'suina'],
  ['Pernil suíno', 'KG', 1.5, /PERNIL/, 'suina'],
  ['Bisteca suína', 'KG', 1, /BISTECA/, 'suina'],
  ['Copa lombo', 'KG', 1, /COPA LOMBO/, 'suina'],
  ['Panceta', 'KG', 0.8, /PANCETA|TOUCINHO/, 'suina'],
  ['Lombo suíno', 'KG', 1, /LOMBO/, 'suina'],
  ['Pão de alho', 'UN', 1, /PAO DE ALHO/, 'extra'],
  ['Queijo coalho', 'UN', 1, /COALHO/, 'extra'],
  ['Carvão', 'UN', 1, /CARVAO/, 'extra'],
  ['Sal grosso', 'UN', 1, /SAL GROSSO/, 'extra'],
];

const slug = (s: string) => stripAccentsUpper(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const CATALOG: CatalogItem[] = [
  ...FRUTAS.map<CatalogItem>(([name, unit, typical, match, not]) => ({ id: `C:fruta:${slug(name)}`, name, group: 'fruta', unit, typical, match, not })),
  ...VERDURAS.map<CatalogItem>(([name, unit, typical, match, not]) => ({ id: `C:verdura:${slug(name)}`, name, group: 'verdura', unit, typical, match, not })),
  ...CARNES.map<CatalogItem>(([name, unit, typical, match, cls, not]) => ({ id: `C:carne:${slug(name)}`, name, group: 'carne', cls, unit, typical, match, not })),
];

export const GROUP_LABEL: Record<CatGroup, string> = { fruta: 'Frutas', verdura: 'Verduras e legumes', carne: 'Carnes do churrasco' };
export const CLASS_LABEL: Record<CatClass, string> = { bovina: 'Bovina', linguica: 'Linguiça', frango: 'Frango', suina: 'Suína', extra: 'Extras' };
export const CLASS_ORDER: CatClass[] = ['bovina', 'linguica', 'frango', 'suina', 'extra'];

/** Um item da lista de escolha: o que a pessoa já comprou (com preço) ou o que vem só do catálogo. */
export interface PoolItem {
  id: string;
  name: string;
  group: CatGroup;
  cls: CatClass | null;
  unit: string;
  price: number;
  priceDate: string;
  bought: boolean;
  buys: number;
  product: Product;
}

const dept = (g: CatGroup) => (g === 'carne' ? 'Açougue' : 'Hortifruti');
const category = (g: CatGroup) => (g === 'fruta' ? 'Hortifruti - Frutas' : g === 'verdura' ? 'Hortifruti - Legumes' : 'Açougue - Carnes');

/** O item do catálogo como se fosse um produto (sem preço: nunca comprado). */
export const catalogProduct = (c: CatalogItem): Product => ({
  pid: c.id, name: c.name, dept: dept(c.group), category: category(c.group), unit: c.unit, price: 0, priceDate: '', store: '',
  buys: 0, qty: 0, typical: c.typical, rate: 0, freq: 0, gap: null, daysSince: 0, lastDate: '',
  kind: c.group === 'fruta' ? 'fruta' : c.group === 'verdura' ? 'verdura' : 'outro',
  meat: c.group === 'carne' && c.cls && c.cls !== 'extra' ? c.cls : null, packKg: null, score: 50,
});

const byUse = (a: Product, b: Product) => b.buys - a.buys || (b.lastDate > a.lastDate ? 1 : b.lastDate < a.lastDate ? -1 : 0) || a.name.localeCompare(b.name, 'pt-BR');
const hits = (c: CatalogItem, name: string) => c.match.test(name) && !(c.not && c.not.test(name));
const EXTRA_RE = /PAO DE ALHO|COALHO|CARVAO|SAL GROSSO/;

/** Produtos do histórico (12 meses) que cabem no grupo. */
const candidates = (h: History, group: CatGroup): Product[] => {
  if (group === 'fruta') return h.longProducts.filter(p => p.kind === 'fruta');
  if (group === 'verdura') return h.longProducts.filter(p => p.kind === 'verdura');
  return h.longProducts.filter(p => p.meat || EXTRA_RE.test(stripAccentsUpper(p.name)));
};

/** Tudo o que dá para escolher num grupo: primeiro o que a pessoa já comprou, depois o resto do catálogo. */
export const buildPool = (h: History, group: CatGroup): PoolItem[] => {
  const mine = candidates(h, group).sort(byUse);
  const items = CATALOG.filter(c => c.group === group);
  const used = new Set<string>();
  const clsOf = new Map<string, CatClass>();      // pid -> tipo (pelo catálogo, para o que o histórico não classifica)
  const taken = new Set<string>();                // itens do catálogo que o histórico já cobre
  items.forEach(c => {
    const p = mine.find(x => !used.has(x.pid) && hits(c, stripAccentsUpper(x.name)));
    if (p) { used.add(p.pid); taken.add(c.id); if (c.cls) clsOf.set(p.pid, c.cls); }
  });
  const out: PoolItem[] = mine.map(p => ({
    id: p.pid, name: p.name, group,
    cls: group === 'carne' ? (p.meat ?? clsOf.get(p.pid) ?? 'extra') : null,
    unit: p.unit, price: p.price, priceDate: p.priceDate, bought: true, buys: p.buys, product: p,
  }));
  items.filter(c => !taken.has(c.id)).forEach(c => {
    out.push({ id: c.id, name: c.name, group, cls: c.cls ?? null, unit: c.unit, price: 0, priceDate: '', bought: false, buys: 0, product: catalogProduct(c) });
  });
  return out;
};

/** Ids escolhidos -> itens, na mesma ordem. O que sumiu do histórico (mais de 12 meses) é ignorado. */
export const resolveIds = (h: History, ids: string[] | undefined, group: CatGroup): PoolItem[] => {
  if (!ids || !ids.length) return [];
  const byId = new Map(buildPool(h, group).map(i => [i.id, i]));
  return ids.map(id => byId.get(id)).filter((x): x is PoolItem => !!x);
};

/** Busca por nome em todo o catálogo, só o que a pessoa NUNCA comprou (o resto o histórico já acha). */
export const searchCatalog = (h: History, query: string, limit = 6): PoolItem[] => {
  const q = stripAccentsUpper(query).replace(/\s+/g, ' ').trim();
  if (q.length < 2) return [];
  const tokens = q.split(' ');
  const never: PoolItem[] = [];
  (['fruta', 'verdura', 'carne'] as CatGroup[]).forEach(g => buildPool(h, g).filter(i => !i.bought).forEach(i => never.push(i)));
  return never.filter(i => { const f = stripAccentsUpper(i.name); return tokens.every(t => f.includes(t)); }).slice(0, limit);
};

/* — sorteio — */

/** Número pseudo-aleatório repetível (mulberry32): a mesma semente dá o mesmo sorteio. */
export const rng = (seed: number) => {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const shuffled = <T,>(list: T[], seed: number): T[] => {
  const a = [...list];
  const r = rng(seed);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/** `want` itens para a semana `week` (0, 1, 2...): uma janela que anda pelo cardápio sorteado, sem repetir na semana
    e passando por todos antes de repetir. Se o cardápio cabe inteiro, vai tudo. */
export const weekPick = <T,>(menu: T[], want: number, week: number): T[] => {
  if (want <= 0 || !menu.length) return [];
  if (menu.length <= want) return menu;
  return Array.from({ length: want }, (_, k) => menu[(week * want + k) % menu.length]);
};

export const seedFrom = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
