import { fold } from './itemSearch';

/* Emoji no lugar do ícone de traço, escolhido pelo nome (do produto ou da categoria).
   - Cada regra: palavras (começo de palavra, sem acento) → emoji [+ um emoji alternativo para Android antigo].
   - As regras de roupa vêm antes das de comida: "blusa manga longa" é roupa, "manga palmer" é a fruta.
   - Um nome de categoria composto ("Hortifruti - Frutas") é lido do último nível para o primeiro. */

type Rule = [words: string, emoji: string, alt?: string];

const RULES: Rule[] = [
  // ── roupas e acessórios ──
  ['blusa blusinha camisa camiseta regata cropped polo', '👚', '👕'],
  ['vestido saia', '👗'], ['calca jeans bermuda short legging', '👖'], ['casaco jaqueta moletom tricot sueter cardigan', '🧥'],
  ['meia', '🧦'], ['cueca calcinha sutia lingerie pijama', '🩲', '👙'], ['biquini maio sunga', '👙'],
  ['tenis', '👟'], ['sandalia chinelo havaianas', '🩴', '👡'], ['sapato sapatilha', '👞'], ['bota', '🥾'], ['bolsa mochila', '👜'],
  ['bone chapeu', '🧢'], ['oculos', '👓'], ['relogio', '⌚'], ['cinto', '👔'], ['gravata', '👔'], ['luva cachecol', '🧤'],
  ['roupa roupas vestuario moda', '👕'], ['calcado calcados', '👟'],
  // ── hortifruti: frutas ──
  ['tomate', '🍅'], ['manga', '🥭'], ['maca', '🍎'], ['banana', '🍌'], ['uva', '🍇'], ['laranja', '🍊'],
  ['limao', '🍋'], ['mexerica tangerina bergamota ponkan', '🍊'], ['melancia', '🍉'], ['melao', '🍈'], ['morango', '🍓'],
  ['abacaxi', '🍍'], ['pera', '🍐'], ['pessego nectarina ameixa damasco', '🍑'], ['cereja', '🍒'], ['kiwi', '🥝'],
  ['coco', '🥥'], ['abacate', '🥑'], ['mamao papaia', '🍈'], ['goiaba maracuja caqui', '🍑'], ['limao', '🍋'], ['mirtilo blueberry', '🫐', '🍇'],
  ['fruta frutas', '🍎'],
  // ── hortifruti: legumes e verduras ──
  ['cebola', '🧅'], ['alho', '🧄'], ['batata_doce', '🍠'], ['batata', '🥔'], ['cenoura', '🥕'], ['milho', '🌽'],
  ['pimentao pimenta', '🌶️'], ['pepino pepininho', '🥒'], ['brocolis couve alface rucula agriao espinafre repolho acelga chicoria', '🥬'],
  ['berinjela', '🍆'], ['abobora abobrinha chuchu', '🎃'], ['cogumelo champignon shimeji', '🍄'], ['mandioca aipim macaxeira inhame', '🥔'],
  ['cheiro_verde salsa cebolinha coentro manjericao hortela', '🌿'], ['beterraba rabanete', '🥕'], ['ervilha vagem', '🫛', '🌱'],
  ['hortifruti verdura verduras legume legumes', '🥬'],
  // ── mercearia ──
  ['feijao lentilha', '🫘', '🌱'], ['grao_de_bico', '🫘', '🌱'], ['arroz', '🍚'], ['macarrao massa espaguete lasanha', '🍝'],
  ['farinha trigo', '🌾'], ['acucar adocante', '🍬'], ['sal', '🧂'], ['oleo azeite', '🫒', '🌿'], ['vinagre', '🍶'],
  ['molho ketchup maionese mostarda', '🥫'], ['atum sardinha conserva enlatado', '🥫'], ['cafe', '☕'], ['cha', '🍵'],
  ['achocolatado chocolate cacau', '🍫'], ['biscoito bolacha cookie', '🍪'], ['bala doce balas pirulito bombom', '🍬'], ['sorvete picole', '🍨'],
  ['pipoca', '🍿'], ['salgadinho snack', '🥨'], ['cereal granola aveia', '🥣'], ['mel', '🍯'], ['geleia', '🍯'], ['amendoim castanha nozes', '🥜'],
  ['mercearia', '🛒'],
  // ── padaria, frios, laticínios ──
  ['pao paes baguete bisnaguinha', '🥖'], ['bolo torta', '🍰'], ['croissant', '🥐'], ['padaria', '🥖'],
  ['leite', '🥛'], ['queijo mussarela mucarela parmesao', '🧀'], ['manteiga margarina', '🧈'], ['iogurte coalhada', '🥛'],
  ['requeijao creme_de_leite', '🥛'], ['presunto peito_de_peru salame', '🥓'], ['ovo ovos', '🥚'], ['frios laticinios', '🧀'],
  // ── carnes e peixes ──
  ['carne bovina picanha alcatra maminha acem patinho coxao contra_file cupim costela', '🥩'], ['bacon linguica salsicha', '🥓'],
  ['frango coxa sobrecoxa asa aves', '🍗'], ['peixe pescado salmao tilapia merluza', '🐟'], ['camarao', '🦐'], ['hamburguer', '🍔'],
  ['suino porco lombo pernil', '🥩'], ['acougue carne carnes', '🥩'],
  // ── bebidas ──
  ['agua_sanitaria', '🧼'],
  ['cerveja chopp', '🍺'], ['vinho', '🍷'], ['whisky vodka cachaca destilado licor', '🥃'], ['refrigerante coca guarana', '🥤'],
  ['suco', '🧃'], ['agua', '💧'], ['energetico isotonico', '🥤'], ['bebida bebidas', '🥤'],
  // ── limpeza, higiene, saúde, casa ──
  ['detergente sabao amaciante desinfetante limpador alvejante', '🧼'], ['limpeza', '🧽'], ['papel_higienico lenco', '🧻'],
  ['shampoo condicionador sabonete creme_dental pasta_de_dente desodorante perfume higiene', '🧴'], ['escova', '🪥', '🧴'], ['fralda', '🍼'],
  ['remedio medicamento farmacia comprimido vitamina', '💊'], ['saude', '💊'], ['cuidados', '🧴'],
  ['pet racao cachorro gato', '🐾'], ['casa utilidades bazar', '🏠'], ['lampada', '💡'], ['pilha bateria', '🔋'],
  // ── outros ──
  ['gasolina etanol diesel combustivel posto', '⛽'], ['transporte uber taxi onibus', '🚌'], ['restaurante lanchonete delivery refeicao', '🍽️'],
  ['livro livraria papelaria caderno', '📚'], ['brinquedo', '🧸'], ['eletronico celular fone carregador', '📱'], ['cigarro tabaco', '🚬'],
];

// regra → expressão: começo de palavra, aceitando plural simples
const COMPILED = RULES.map(([words, emoji, alt]) => {
  const parts = words.split(' ').filter(Boolean).map(w => w.replace(/_/g, ' '));
  const re = new RegExp(`(^|[^a-z])(${parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(s|es)?($|[^a-z])`);
  return { re, emoji, alt };
});

// o navegador/Android consegue desenhar este emoji? (versões antigas mostram um quadrado vazio)
const okCache = new Map<string, boolean>();
const canDraw = (emoji: string): boolean => {
  const hit = okCache.get(emoji); if (hit !== undefined) return hit;
  let ok = true;
  try {
    if (typeof document !== 'undefined') {
      const px = (t: string) => { const c = document.createElement('canvas'); c.width = c.height = 28; const x = c.getContext('2d'); if (!x) return ''; x.font = '22px sans-serif'; x.textBaseline = 'top'; x.fillText(t, 2, 2); return c.toDataURL(); };
      ok = px(emoji) !== px('\u{10FFFD}');   // igual ao "caractere desconhecido" = não tem
    }
  } catch { ok = true; }
  okCache.set(emoji, ok); return ok;
};

const pickDraw = (emoji: string, alt?: string): string | null => canDraw(emoji) ? emoji : (alt && canDraw(alt) ? alt : null);

/** Emoji para um nome de produto/categoria, ou null se nada combina. */
export const emojiFor = (name: string): string | null => {
  const segments = String(name || '').split(' - ').map(s => fold(s)).filter(Boolean).reverse();
  for (const seg of segments) {
    for (const r of COMPILED) if (r.re.test(seg)) { const e = pickDraw(r.emoji, r.alt); if (e) return e; }
  }
  return null;
};
