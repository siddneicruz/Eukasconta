import { Establishment, Receipt } from '../types';
import { askAiForJson } from './geminiService';
import { titleCase } from './textFormat';
import { formatCNPJ } from './productNormalization';
import {
  StoreGroup, StoreMember, Unit, buildUnits, candidateBlocks, conflicts, groupId, pickKeep, validDocument,
} from './storeDedupe';

/* Revisão com IA das lojas repetidas. As regras (storeDedupe.ts) já juntaram o que é certo; aqui a IA olha só os
   cadastros que têm algo em comum (palavra do nome, raiz do CNPJ, endereço) e diz quais são a MESMA loja física.
   A IA só sugere: as respostas passam por travas (cidades ou endereços diferentes nunca se juntam) e nada muda
   até a pessoa conferir e juntar. */

const MAX_BLOCKS = 25;

const digits = (s: string) => String(s || '').replace(/\D/g, '');

const topItems = (receipts: Receipt[]): Map<string, string[]> => {
  const spend = new Map<string, Map<string, number>>();
  receipts.forEach(r => {
    const k = `${digits(r.cnpj)}|${r.establishmentName}`;
    const m = spend.get(k) || new Map<string, number>();
    (r.items || []).forEach(i => { const d = (i.description || '').trim(); if (d) m.set(d, (m.get(d) || 0) + (Number(i.totalPrice) || 0)); });
    spend.set(k, m);
  });
  const out = new Map<string, string[]>();
  spend.forEach((m, k) => out.set(k, Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => titleCase(e[0]))));
  return out;
};

const line = (u: Unit, items: Map<string, string[]>): string => {
  const e = u.rep.est;
  const d = digits(e.cnpj);
  const place = [titleCase(e.city || ''), e.state || ''].filter(Boolean).join(' - ');
  const more = u.members.filter(m => m !== u.rep).map(m => `"${m.est.originalName}"`);
  const bits = [
    `id ${u.id}`,
    `nome no cupom: "${e.originalName}"`,
    d ? `cnpj: ${formatCNPJ(d)}${validDocument(d) ? '' : ' (dígitos não conferem: pode ter sido lido errado)'}` : 'sem cnpj',
    place ? `local: ${place}` : '',
    e.address ? `endereço: "${e.address}"` : '',
    `${u.members.reduce((s, m) => s + m.receipts, 0)} cupom(ns)`,
    items.get(u.rep.key)?.length ? `compras: ${items.get(u.rep.key)!.join('; ')}` : '',
    more.length ? `já reunido com (mesma loja): ${more.join('; ')}` : '',
  ].filter(Boolean);
  return `- ${bits.join(' | ')}`;
};

export const buildDedupePrompt = (block: Unit[], items: Map<string, string[]> = new Map()): string => `Você ajuda a limpar o cadastro de lojas de um app de gastos pessoais no Brasil.
Os cupons são lidos por foto, então a MESMA loja física aparece várias vezes: nome escrito de jeitos diferentes (LTDA, F01, filial, cidade no fim, abreviações), CNPJ lido com um dígito errado ou sem CNPJ.
Diga quais das lojas abaixo são a MESMA loja física (a mesma unidade, no mesmo endereço).

REGRAS:
- Mesmo CNPJ = mesma loja.
- CNPJs diferentes com os mesmos 8 primeiros dígitos são filiais da mesma empresa: lojas DIFERENTES, a menos que o endereço seja o mesmo.
- Cidades diferentes = lojas diferentes. Endereços diferentes = lojas diferentes (mesmo que a rede seja a mesma).
- Lojas de nomes diferentes que só dividem o endereço (shopping, galeria) são diferentes.
- Um nome sem CNPJ pode ser a mesma loja de outra com CNPJ se o nome é o mesmo ou é uma abreviação clara dele na mesma cidade.
- Na dúvida, NÃO junte. Cada id entra em no máximo um grupo e todo grupo tem 2 ou mais ids.
- "motivo" em até 12 palavras, em português.

LOJAS:
${block.map(u => line(u, items)).join('\n')}

Responda SOMENTE com um objeto JSON neste formato (grupos: [] se nenhuma for repetida):
{"grupos":[{"ids":[1,4],"motivo":"mesmo nome e mesmo endereço"}]}`;

export interface AiAnswerGroup { ids: number[]; reason: string }

export const parseDedupeAnswer = (data: any, block: Unit[]): AiAnswerGroup[] => {
  const list: any[] = Array.isArray(data) ? data : (data?.grupos || data?.groups || Object.values(data || {}).find(v => Array.isArray(v)) || []);
  const valid = new Set(block.map(u => u.id));
  const used = new Set<number>();
  const out: AiAnswerGroup[] = [];
  list.forEach(g => {
    const raw: any[] = Array.isArray(g) ? g : (g?.ids || g?.lojas || []);
    const ids = Array.from(new Set(raw.map(Number))).filter(id => valid.has(id) && !used.has(id));
    if (ids.length < 2) return;
    ids.forEach(id => used.add(id));
    out.push({ ids, reason: String((Array.isArray(g) ? '' : (g?.motivo ?? g?.reason)) ?? '').replace(/\s+/g, ' ').trim().slice(0, 140) });
  });
  return out;
};

/** Transforma o que a IA respondeu em grupos, já com as travas: o que dá conflito (cidade ou endereço diferente) fica de fora. */
export const groupsFromAnswer = (answer: AiAnswerGroup[], block: Unit[]): StoreGroup[] => {
  const byId = new Map(block.map(u => [u.id, u] as const));
  const out: StoreGroup[] = [];
  answer.forEach(a => {
    const units = a.ids.map(id => byId.get(id)!).filter(Boolean)
      .sort((x, y) => y.members.reduce((s, m) => s + m.receipts, 0) - x.members.reduce((s, m) => s + m.receipts, 0));
    const chosen: Unit[] = [];
    units.forEach(u => {
      if (chosen.every(c => c.members.every(x => u.members.every(y => !conflicts(x, y))))) chosen.push(u);
    });
    if (chosen.length < 2) return;
    const members: StoreMember[] = chosen.flatMap(u => u.members);
    const keep = pickKeep(members);
    const rule = new Set(chosen.flatMap(u => u.group?.reasons || []));
    out.push({
      id: groupId(members), keep: keep.key, confidence: 'media', source: 'ia',
      members: members.sort((x, y) => (x.key === keep.key ? -1 : y.key === keep.key ? 1 : y.receipts - x.receipts)),
      reasons: [`IA: ${a.reason || 'parecem ser a mesma loja'}`, ...Array.from(rule)],
    });
  });
  return out;
};

/** Junta o que a IA achou com o que as regras já tinham: o grupo da IA vale no lugar dos grupos das regras que ele engloba. */
export const mergeAiGroups = (ruleGroups: StoreGroup[], aiGroups: StoreGroup[]): StoreGroup[] => {
  const covered = new Set(aiGroups.flatMap(g => g.members.map(m => m.key)));
  const kept = ruleGroups.filter(g => !g.members.some(m => covered.has(m.key)));
  return [...kept, ...aiGroups].sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'alta' ? -1 : 1));
};

export interface AiReview {
  groups: StoreGroup[];        // lista final (regras + IA)
  asked: number;               // quantas lojas foram para a IA
  found: number;               // grupos novos que a IA achou
  failed: string | null;       // mensagem se algum bloco falhou (o que veio antes é aproveitado)
  skipped: number;             // blocos que ficaram de fora pelo limite
}

export const reviewWithAI = async (
  establishments: Establishment[],
  receipts: Receipt[],
  ruleGroups: StoreGroup[],
  opts: { ask?: (prompt: string) => Promise<any>; onProgress?: (done: number, total: number) => void } = {},
): Promise<AiReview> => {
  const ask = opts.ask || askAiForJson;
  const blocks = candidateBlocks(buildUnits(establishments, receipts, ruleGroups));
  const run = blocks.slice(0, MAX_BLOCKS);
  const items = topItems(receipts);
  const found: StoreGroup[] = [];
  let failed: string | null = null;
  let asked = 0;
  for (let i = 0; i < run.length; i++) {
    opts.onProgress?.(i, run.length);
    try {
      const data = await ask(buildDedupePrompt(run[i], items));
      asked += run[i].length;
      found.push(...groupsFromAnswer(parseDedupeAnswer(data, run[i]), run[i]));
    } catch (err: any) {
      failed = String(err?.message || err || 'Falha ao consultar a IA.');
      if (found.length === 0 && i === 0) throw new Error(failed);
      break;
    }
  }
  opts.onProgress?.(run.length, run.length);
  return { groups: mergeAiGroups(ruleGroups, found), asked, found: found.length, failed, skipped: Math.max(0, blocks.length - run.length) };
};
