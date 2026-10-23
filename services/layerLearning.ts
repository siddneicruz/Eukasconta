import { Receipt } from '../types';
import { LayerIndex, LayerNode, REST_LABEL, leafFor, pinKey } from './categoryLayers';
import { catKey, properCase } from './textFormat';
import { fold } from './itemSearch';

/* Aprender com o que a pessoa já fixou (camadas 3 e 4) e sugerir o mesmo para o que ficou sem grupo/item.

   Quando ela diz "CEBOLA KG vai em Bulbos › Cebola", isso fica guardado como fixação (layerPins.ts). Aqui o app lê essas
   fixações como exemplos: "CEBOLA ROXA KG", que ainda está em "Outros itens", ganha a sugestão do mesmo lugar.
   Dois caminhos, do mais barato ao mais caro:
     1) padrão: palavras das descrições fixadas (sem IA, na hora);
     2) IA: o que sobrar vai para a IA escolhida no app, com a estrutura da categoria e as fixações como exemplos.
   Nada muda sozinho: tudo vira sugestão que a pessoa confere e aplica. */

/** Descrição de compra que ainda não caiu num grupo/item de verdade ("Outros itens" ou nenhum). */
export interface Unplaced {
  category: string;       // "Hortifruti - Legumes"
  description: string;    // como veio no cupom
  count: number;          // linhas de compra
  total: number;          // R$
}

export interface LayerSuggestion extends Unplaced {
  nodeKey: string;        // g:… / i:… / o:… do destino
  path: string;           // "Hortifruti › Legumes › Bulbos › Cebola Roxa"
  source: 'padrao' | 'ia';
  reason?: string;
}

const UNITS = /^(\d+([.,]\d+)?)?(kg|g|gr|mg|ml|l|lt|un|und|unid|pct|pc|cx|fat|dz|m|cm)$/;
const GENERIC = new Set(['kg', 'un', 'und', 'unid', 'gr', 'pct', 'pc', 'cx', 'fat', 'granel', 'tipo', 'extra', 'novo', 'nova', 'sabor', 'natural', 'tradicional', 'integral', 'grande', 'pequeno', 'medio']);
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'para', 'sem', 'por', 'uma', 'uns']);

/** Palavras que dizem o que o produto é (sem unidade, número, nem palavras soltas como "kg" ou "tipo"). */
export const meaningfulTokens = (s: string): string[] => {
  const out: string[] = [];
  fold(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').forEach(t => {
    if (t.length < 3 || /^\d/.test(t) || UNITS.test(t) || GENERIC.has(t) || STOP.has(t)) return;
    if (!out.includes(t)) out.push(t);
  });
  return out;
};

// o plural mais comum: "cebolas" → "cebola"; basta para comparar palavras do cupom com as do nome do grupo/item
const stem = (t: string): string => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);

const isPlaced = (leaf: LayerNode | null): boolean => !!leaf && !leaf.rest;

/** O caminho do nó como a pessoa lê: "Hortifruti › Legumes › Bulbos › Cebola Roxa". */
export const nodePath = (node: LayerNode): string => {
  const tail = node.rest ? `${node.group} (geral)` : node.level === 4 ? `${node.group} › ${node.label}` : node.label;
  return `${node.cat.split(' - ').join(' › ')} › ${tail}`;
};

/* ───────────────────────── o que ficou sem grupo/item ───────────────────────── */

/** Descrições distintas (por categoria) que ainda não caíram num grupo/item e que a pessoa ainda não fixou. */
export const collectUnplaced = (receipts: Receipt[], idx: LayerIndex): Unplaced[] => {
  if (idx.nodes.length === 0) return [];
  const map = new Map<string, Unplaced>();
  receipts.forEach(r => (r.items || []).forEach(i => {
    const category = String(i.category || '').trim();
    const description = String(i.description || '').trim();
    if (!category || !description) return;
    const ck = catKey(category);
    if (!idx.leavesByCat.has(ck)) return;
    if (idx.pins.has(pinKey(category, description))) return;
    if (isPlaced(leafFor(idx, category, description))) return;
    const k = pinKey(category, description);
    let u = map.get(k);
    if (!u) { u = { category, description, count: 0, total: 0 }; map.set(k, u); }
    u.count += 1;
    u.total += Number(i.totalPrice) || 0;
  }));
  return Array.from(map.values()).sort((a, b) => b.count - a.count || b.total - a.total || a.description.localeCompare(b.description, 'pt-BR'));
};

/* ───────────────────────── 1) padrão das fixações ───────────────────────── */

interface Evidence { nodes: Map<string, { pins: number; sample: string }> }
type PatternIndex = Map<string, Map<string, Evidence>>;   // categoria → palavra → onde as fixações com ela foram parar

const patternCache = new WeakMap<LayerIndex, PatternIndex>();

const patternsOf = (idx: LayerIndex): PatternIndex => {
  const hit = patternCache.get(idx);
  if (hit) return hit;
  const out: PatternIndex = new Map();
  idx.pins.forEach((nodeKey, key) => {
    const node = idx.byKey.get(nodeKey);
    if (!node || !node.leaf) return;
    const [ck, slug] = key.split('\u0001');
    if (!ck || !slug || node.catKey !== ck) return;
    let words = out.get(ck);
    if (!words) { words = new Map(); out.set(ck, words); }
    meaningfulTokens(slug).forEach(t => {
      const w = stem(t);
      let ev = words!.get(w);
      if (!ev) { ev = { nodes: new Map() }; words!.set(w, ev); }
      const cur = ev.nodes.get(nodeKey);
      if (cur) cur.pins += 1; else ev.nodes.set(nodeKey, { pins: 1, sample: slug });
    });
  });
  patternCache.set(idx, out);
  return out;
};

export interface PatternHit { node: LayerNode; via: string }

/** O destino que o padrão das fixações indica para uma descrição, ou nulo quando não há evidência boa.
    Vale a palavra que só levou a um destino: forte se ela está no nome do grupo/item, ou se 2 fixações concordam. */
export const suggestFromPatterns = (idx: LayerIndex, category: string, description: string): PatternHit | null => {
  const words = patternsOf(idx).get(catKey(category));
  if (!words || words.size === 0) return null;
  const votes = new Map<string, { score: number; via: string }>();
  meaningfulTokens(description).forEach(t => {
    const ev = words.get(stem(t));
    if (!ev || ev.nodes.size !== 1) return;                  // palavra que já levou a lugares diferentes: não serve de pista
    const [nodeKey, info] = Array.from(ev.nodes.entries())[0];
    const node = idx.byKey.get(nodeKey);
    if (!node) return;
    const inName = node.alts.some(a => a.tokens.some(x => stem(x) === stem(t)));
    if (!inName && info.pins < 2) return;
    const score = (inName ? 3 : 0) + Math.min(info.pins, 3);
    const cur = votes.get(nodeKey);
    votes.set(nodeKey, { score: (cur?.score || 0) + score, via: cur?.via || info.sample });
  });
  const ranked = Array.from(votes.entries()).sort((a, b) => b[1].score - a[1].score);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0][1].score === ranked[1][1].score) return null;
  const node = idx.byKey.get(ranked[0][0]);
  return node ? { node, via: properCase(ranked[0][1].via) } : null;
};

/** Sugestões só pelo padrão (sem IA), para as descrições sem grupo/item. */
export const patternSuggestions = (unplaced: Unplaced[], idx: LayerIndex): LayerSuggestion[] => {
  const out: LayerSuggestion[] = [];
  unplaced.forEach(u => {
    const hit = suggestFromPatterns(idx, u.category, u.description);
    if (hit) out.push({ ...u, nodeKey: hit.node.key, path: nodePath(hit.node), source: 'padrao', reason: `Como “${hit.via}”` });
  });
  return out;
};

/* ───────────────────────── 2) IA ───────────────────────── */

export type Ask = (prompt: string, opts?: { budgetMs?: number }) => Promise<any>;

export interface RefinePrompt {
  text: string;
  /** número da opção no texto → chave do grupo/item */
  options: Map<number, string>;
  /** número da descrição no texto → a descrição */
  rows: Map<number, Unplaced>;
}

const MAX_OPTIONS = 160;
const MAX_ROWS = 40;
const MAX_EXAMPLES = 14;

/** Exemplos do que a pessoa já escolheu na categoria (descrição → caminho), os mais recentes primeiro não existem: usa os que há. */
const examplesFor = (idx: LayerIndex, ck: string): string[] => {
  const out: string[] = [];
  idx.pins.forEach((nodeKey, key) => {
    if (out.length >= MAX_EXAMPLES) return;
    const [pck, slug] = key.split('\u0001');
    const node = idx.byKey.get(nodeKey);
    if (pck !== ck || !node || !node.leaf) return;
    const tail = node.rest ? `${node.group} (geral)` : node.level === 4 ? `${node.group} › ${node.label}` : node.label;
    out.push(`${slug.toUpperCase()} → ${tail}`);
  });
  return out;
};

export const buildRefinePrompt = (idx: LayerIndex, category: string, batch: Unplaced[]): RefinePrompt => {
  const ck = catKey(category);
  const leaves = (idx.leavesByCat.get(ck) || []).slice(0, MAX_OPTIONS);
  const options = new Map<number, string>();
  const optionLines: string[] = [];
  leaves.forEach((n, i) => {
    options.set(i + 1, n.key);
    const label = n.rest ? `${n.group} (geral)` : n.level === 4 ? `${n.group} › ${n.label}` : n.label;
    optionLines.push(`${i + 1}. ${label}`);
  });
  const rows = new Map<number, Unplaced>();
  const rowLines: string[] = [];
  batch.slice(0, MAX_ROWS).forEach((u, i) => { rows.set(i + 1, u); rowLines.push(`${i + 1}. ${u.description.toUpperCase()}`); });
  const examples = examplesFor(idx, ck);
  const text = `Você ajuda a organizar as compras de mercado de uma pessoa no Brasil.
Os itens abaixo estão na categoria "${category.split(' - ').join(' › ')}" e ainda não têm grupo/item (3ª e 4ª camadas).
Para cada item, escolha o NÚMERO da opção que melhor descreve o produto. Use 0 se nenhuma serve ou se estiver em dúvida. Não invente opções.
Os nomes do cupom vêm cortados e em maiúsculas ("CEBOLA KG", "QJO MUSS FAT").
${examples.length ? `\nO que a pessoa já escolheu aqui (siga o mesmo critério):\n${examples.join('\n')}\n` : ''}
OPÇÕES:
${optionLines.join('\n')}

ITENS:
${rowLines.join('\n')}

Responda só um objeto JSON no formato {"respostas":[{"i":1,"n":12},{"i":2,"n":0}]}, em que "i" é o número do item e "n" o número da opção.`;
  return { text, options, rows };
};

/** Lê a resposta da IA; ignora o que não bate (número fora da lista, item repetido). */
export const parseRefineAnswer = (data: any, prompt: RefinePrompt, idx: LayerIndex): LayerSuggestion[] => {
  const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.respostas) ? data.respostas : (Object.values(data || {}).find(v => Array.isArray(v)) as any[] | undefined) || [];
  const seen = new Set<number>();
  const out: LayerSuggestion[] = [];
  list.forEach(a => {
    const i = Number(a?.i), n = Number(a?.n);
    if (!Number.isFinite(i) || !Number.isFinite(n) || n <= 0 || seen.has(i)) return;
    const row = prompt.rows.get(i);
    const key = prompt.options.get(n);
    const node = key ? idx.byKey.get(key) : undefined;
    if (!row || !node) return;
    seen.add(i);
    out.push({ ...row, nodeKey: node.key, path: nodePath(node), source: 'ia' });
  });
  return out;
};

export interface RefineProgress { done: number; total: number; category: string }

export interface RefineOptions {
  ask: Ask;
  /** quantas categorias perguntar de uma vez (as de mais compras primeiro) */
  maxCategories?: number;
  onProgress?: (p: RefineProgress) => void;
  signal?: { cancelled: boolean };
}

export interface RefineResult { suggestions: LayerSuggestion[]; asked: number; failed: number; lastError?: string; remaining: number }

/** Pergunta à IA, uma categoria por vez, onde há itens sem grupo/item. Erros de uma categoria não derrubam as outras. */
export const refineWithAI = async (unplaced: Unplaced[], idx: LayerIndex, opts: RefineOptions): Promise<RefineResult> => {
  const byCat = new Map<string, Unplaced[]>();
  unplaced.forEach(u => { const k = catKey(u.category); const arr = byCat.get(k); if (arr) arr.push(u); else byCat.set(k, [u]); });
  const groups = Array.from(byCat.values())
    .sort((a, b) => b.reduce((n, u) => n + u.count, 0) - a.reduce((n, u) => n + u.count, 0));
  const max = opts.maxCategories ?? 6;
  const chosen = groups.slice(0, max);
  const suggestions: LayerSuggestion[] = [];
  let failed = 0, asked = 0, lastError: string | undefined;
  for (let g = 0; g < chosen.length; g++) {
    if (opts.signal?.cancelled) break;
    const batch = chosen[g];
    opts.onProgress?.({ done: g, total: chosen.length, category: batch[0].category });
    for (let from = 0; from < batch.length; from += MAX_ROWS) {
      if (opts.signal?.cancelled) break;
      const part = batch.slice(from, from + MAX_ROWS);
      const prompt = buildRefinePrompt(idx, batch[0].category, part);
      if (prompt.options.size === 0) continue;
      try {
        const data = await opts.ask(prompt.text, { budgetMs: 90_000 });
        asked += 1;
        suggestions.push(...parseRefineAnswer(data, prompt, idx));
      } catch (e: any) {
        failed += 1;
        lastError = String(e?.message || e);
      }
    }
  }
  opts.onProgress?.({ done: chosen.length, total: chosen.length, category: '' });
  const remaining = groups.slice(max).reduce((n, g) => n + g.length, 0);
  return { suggestions, asked, failed, lastError, remaining };
};

export { REST_LABEL };
