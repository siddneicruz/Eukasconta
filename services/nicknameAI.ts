import { Establishment, Receipt } from '../types';
import { askAiForJson } from './geminiService';
import { buildStoreNamer } from './establishmentNames';
import { masterOf, titleCase, isUnidentifiedName } from './textFormat';

/* Apelidos de loja sugeridos pela IA. A IA só sugere: nada muda até a pessoa revisar e aplicar. */

export interface StoreRow {
  id: number;
  name: string;          // nome como veio no cupom
  cnpj: string;
  city: string;
  state: string;
  current: string;       // apelido de hoje ('' se não tem)
  receipts: number;
  spent: number;
  topItems: string[];    // o que mais se comprou lá: ajuda a IA a entender "SC", "ABC" e outras siglas
  topDepts: string[];
  root: string;          // 8 primeiros dígitos do CNPJ: mesma empresa (filiais)
  est: Establishment;
}

const digits = (s: string) => String(s || '').replace(/\D/g, '');

// Lojas com cupom guardado, da que mais gastou para a que menos gastou.
export const collectStoreRows = (establishments: Establishment[], receipts: Receipt[]): StoreRow[] => {
  const namer = buildStoreNamer(establishments);
  const stat = new Map<string, { n: number; spent: number; items: Map<string, number>; depts: Map<string, number> }>();
  receipts.forEach(r => {
    const key = namer.keyOf(r.establishmentName, r.cnpj);
    const s = stat.get(key) || { n: 0, spent: 0, items: new Map(), depts: new Map() };
    s.n += 1; s.spent += Number(r.totalAmount) || 0;
    (r.items || []).forEach(i => {
      const v = Number(i.totalPrice) || 0;
      const d = (i.description || '').trim();
      if (d) s.items.set(d, (s.items.get(d) || 0) + v);
      const dept = masterOf(i.category);
      if (dept) s.depts.set(dept, (s.depts.get(dept) || 0) + v);
    });
    stat.set(key, s);
  });

  const top = (m: Map<string, number>, n: number) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
  const rows: StoreRow[] = [];
  const seen = new Set<string>();
  establishments.forEach(est => {
    const dedupe = `${digits(est.cnpj)}|${est.originalName}`;
    if (seen.has(dedupe) || isUnidentifiedName(est.originalName)) return;
    seen.add(dedupe);
    const s = stat.get(namer.keyOf(est.originalName, est.cnpj));
    if (!s) return; // sem cupom: nada para reconhecer
    const d = digits(est.cnpj);
    rows.push({
      id: 0, name: est.originalName, cnpj: d, city: titleCase(est.city || ''), state: est.state || '',
      current: (est.aliasName || '').trim(), receipts: s.n, spent: s.spent,
      topItems: top(s.items, 3).map(titleCase), topDepts: top(s.depts, 2).map(titleCase),
      root: d.length === 14 ? d.slice(0, 8) : '', est,
    });
  });
  rows.sort((a, b) => b.spent - a.spent);
  rows.forEach((r, i) => { r.id = i + 1; });
  return rows;
};

export const buildNicknamePrompt = (rows: StoreRow[]): string => {
  const lines = rows.map(r => {
    const bits = [
      `id ${r.id}`,
      `nome no cupom: "${r.name}"`,
      r.cnpj ? `cnpj: ${r.cnpj}` : 'sem cnpj',
      [r.city, r.state].filter(Boolean).length ? `local: ${[r.city, r.state].filter(Boolean).join(' - ')}` : '',
      r.current ? `apelido atual: "${r.current}"` : '',
      `${r.receipts} cupom(ns)`,
      r.topDepts.length ? `departamentos: ${r.topDepts.join(', ')}` : '',
      r.topItems.length ? `compras: ${r.topItems.join('; ')}` : '',
    ].filter(Boolean);
    return `- ${bits.join(' | ')}`;
  }).join('\n');

  return `Você ajuda a nomear lojas num app de controle de gastos pessoais no Brasil.
Para cada loja abaixo, dê um APELIDO curto que a pessoa reconheça de bate-pronto.

REGRAS:
- 1 a 3 palavras, Iniciais Maiúsculas, sem LTDA, S.A., ME, EIRELI, filial/F01 nem números de CNPJ.
- Mantenha a marca quando for conhecida (ex.: Havan, Renner, Atacadão, Droga Raia, Fort Atacadista, Riachuelo).
- NUNCA devolva só uma sigla ou abreviação (SC, SP, RS, ABC...). "SC" quase sempre é a UF Santa Catarina ou parte do nome da cidade: troque por algo claro, como o tipo de loja + a cidade ou a palavra que a distingue (ex.: um posto de combustível em São Carlos pode virar "Posto São Carlos").
- Use o que ela vende (departamentos e compras) para entender o tipo de negócio quando o nome for vago.
- Lojas diferentes do mesmo tipo e da mesma cidade precisam de apelidos diferentes; filiais da mesma empresa (mesmos 8 primeiros dígitos do CNPJ) ficam com o MESMO apelido.
- Se o nome é de pessoa (CPF ou nome próprio), use primeiro nome e sobrenome.
- Se o apelido atual já é claro e bom, devolva igual a ele.
- Não invente marca que não esteja no nome. Na dúvida, limpe o nome do cupom e acrescente a cidade.

LOJAS:
${lines}

Responda SOMENTE com um objeto JSON neste formato, com uma entrada para cada id:
{"apelidos":[{"id":1,"apelido":"Posto São Carlos"}]}`;
};

const STATE = /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/i;

// Limpa o que a IA devolveu; vazio quer dizer "sem sugestão aproveitável".
export const cleanAlias = (raw: unknown): string => {
  let a = String(raw ?? '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
  a = a.replace(/\b(ltda\.?|s\.?\/?a\.?|eireli|epp|me)\b\.?$/i, '').trim();
  if (a.length > 32) a = a.slice(0, 32).replace(/\s+\S*$/, '').trim();
  if (a.length < 2 || STATE.test(a)) return '';
  return a.toUpperCase() === a ? titleCase(a) : a;
};

export interface NicknameResult {
  suggestions: Map<number, string>;   // id da linha -> apelido sugerido
  failed: string | null;              // mensagem se algum lote falhou (o que veio antes é aproveitado)
}

const CHUNK = 30;

export const suggestNicknames = async (rows: StoreRow[], onProgress?: (done: number, total: number) => void): Promise<NicknameResult> => {
  const suggestions = new Map<number, string>();
  let failed: string | null = null;
  const chunks: StoreRow[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) chunks.push(rows.slice(i, i + CHUNK));

  for (let c = 0; c < chunks.length; c++) {
    onProgress?.(c, chunks.length);
    try {
      const data = await askAiForJson(buildNicknamePrompt(chunks[c]));
      const list: any[] = Array.isArray(data) ? data : (data?.apelidos || data?.aliases || Object.values(data || {}).find(v => Array.isArray(v)) || []);
      const ids = new Set(chunks[c].map(r => r.id));
      list.forEach(e => {
        const id = Number(e?.id);
        const alias = cleanAlias(e?.apelido ?? e?.alias ?? e?.nome);
        if (ids.has(id) && alias) suggestions.set(id, alias);
      });
    } catch (err: any) {
      failed = String(err?.message || err || 'Falha ao consultar a IA.');
      if (suggestions.size === 0) throw new Error(failed);
      break;
    }
  }
  onProgress?.(chunks.length, chunks.length);

  // filiais da mesma empresa ficam com o mesmo apelido: vale o da loja que mais gastou
  const byRoot = new Map<string, string>();
  rows.forEach(r => { if (r.root && suggestions.has(r.id) && !byRoot.has(r.root)) byRoot.set(r.root, suggestions.get(r.id)!); });
  rows.forEach(r => { if (r.root && byRoot.has(r.root) && suggestions.has(r.id)) suggestions.set(r.id, byRoot.get(r.root)!); });

  return { suggestions, failed };
};
