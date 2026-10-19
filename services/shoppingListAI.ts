import { Receipt, MasterProduct } from '../types';
import { askAiForJson } from './geminiService';
import { Advice, BaseInfo, History, PurchasePlan, analyzeHistory, diffDays, isIso, roundTo, shortDate, stepOf, unitLabel } from './shoppingList';

/* A IA escolhida pela pessoa (Gemini, Claude, OpenRouter...) opina em duas perguntas curtas:
   1) Em qual período de compras vale se basear? (tira festas, viagens, compras fora do comum e diz de quantos em quantos dias se vai ao mercado)
   2) Para cada produto: quanto comprar no período da lista e o que não precisa agora (e, se pedido, quais frutas e verduras estão de época).
   A IA só sugere. Tudo que ela devolve passa por trava (datas dentro do histórico, quantidade limitada ao que a pessoa já comprou)
   e a lista continua sendo montada pelas contas locais, então sem IA ou com a IA fora do ar a lista sai igual, só que sem o refino. */

export type Ask = (prompt: string) => Promise<any>;

/** Os provedores devolvem o erro como um JSON inteiro; aqui sobra só a frase. */
export const errorText = (err: any): string => {
  let m = String(err?.message || err || '').trim();
  try { const j = JSON.parse(m); m = String(j?.error?.message || j?.message || m); } catch { /* já é texto */ }
  return m.replace(/\s+/g, ' ').trim().slice(0, 200) || 'A IA não respondeu.';
};

const MAX_PRODUCTS = 140;

const fmt = (n: number) => (Math.round(n * 100) / 100).toString().replace('.', ',');
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');

/* ───────────────────────── 1) período ───────────────────────── */

export const buildPeriodPrompt = (h: History): string => `Você ajuda um app de gastos pessoais no Brasil a montar a lista de compras do mercado.
Abaixo estão as idas ao mercado da pessoa (data, lojas, número de itens, gasto). Hoje é ${h.today}.

Descubra:
1. O PERÍODO de compras que melhor representa o consumo normal da casa para basear a próxima lista. Deixe de fora idas fora do comum (festa, viagem, compra gigante de estoque, feriado) e dados velhos demais. Use de 4 a 12 idas seguidas quando houver.
2. De quantos em quantos DIAS a pessoa costuma ir ao mercado nesse período (número inteiro entre 3 e 35).

IDAS:
${h.trips.map(t => `- ${t.date} (${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(t.date + 'T12:00:00').getDay()]}) | ${t.stores.slice(0, 2).join(' / ')} | ${t.items} itens | R$ ${money(t.spend)}`).join('\n')}

Responda SOMENTE com um objeto JSON neste formato (as datas devem ser de idas da lista acima):
{"periodo":{"inicio":"AAAA-MM-DD","fim":"AAAA-MM-DD"},"ciclo_dias":7,"observacao":"em até 25 palavras, em português, dizendo o que você entendeu do ritmo de compras"}`;

export interface PeriodAdvice { window?: { from: string; to: string }; cycle?: number; note: string }

export const parsePeriodAnswer = (data: any, h: History): PeriodAdvice => {
  const p = data?.periodo ?? data?.period ?? data ?? {};
  const from = p?.inicio ?? p?.from ?? p?.start;
  const to = p?.fim ?? p?.to ?? p?.end;
  const note = String(data?.observacao ?? data?.nota ?? data?.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);
  const cycleRaw = Math.round(Number(data?.ciclo_dias ?? data?.ciclo ?? data?.cycle));
  const cycle = cycleRaw >= 3 && cycleRaw <= 35 ? cycleRaw : undefined;
  const dates = h.trips.map(t => t.date);
  let window: PeriodAdvice['window'];
  if (isIso(from) && isIso(to) && from <= to && dates.length) {
    const inside = dates.filter(d => d >= from && d <= to);
    // precisa conter ao menos 2 idas (ou a única que existe) e não pode ser um período minúsculo
    if (inside.length >= Math.min(2, dates.length) && diffDays(inside[0], inside[inside.length - 1]) >= (inside.length > 1 ? 6 : 0)) {
      window = { from: inside[0], to: inside[inside.length - 1] };
    }
  }
  return { window, cycle, note };
};

/* ───────────────────────── 2) itens ───────────────────────── */

export interface ItemsContext {
  purchases: PurchasePlan[];
  fruitVeg: boolean;
  month?: number;      // 1..12, para a época das frutas
}

export interface ItemsPrompt { text: string; ids: Map<number, string> }

export const buildItemsPrompt = (h: History, ctx: ItemsContext): ItemsPrompt => {
  const ids = new Map<number, string>();
  const total = ctx.purchases.reduce((s, p) => s + p.days, 0);
  const list = h.products.slice(0, MAX_PRODUCTS);
  const lines = list.map((p, i) => {
    const id = i + 1;
    ids.set(id, p.pid);
    const local = Math.max(0, roundTo(p.rate * total, stepOf(p.unit)));
    return `#${id} ${p.name} | ${p.dept} | unid ${unitLabel(p.unit)} | último preço R$ ${money(p.price)} | comprado em ${p.buys} de ${h.tripCount} idas | ${fmt(p.typical)} por ida | última compra há ${p.daysSince} dias | conta simples para o período: ${fmt(local)}`;
  });
  let seasonal = '';
  if (ctx.fruitVeg) {
    const base = list.length;
    const cand = h.longProducts.filter(p => p.kind !== 'outro').slice(0, 60);
    const rows = cand.map((p, i) => {
      const id = base + i + 1;
      ids.set(id, p.pid);
      return `#${id} ${p.name} (${p.kind === 'fruta' ? 'fruta' : 'verdura/legume'})`;
    });
    if (rows.length) seasonal = `\nFRUTAS E VERDURAS QUE ELA COMPRA (para dizer o que está de época${ctx.month ? ` em ${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][ctx.month - 1]}` : ''}, no Sul do Brasil):\n${rows.join('\n')}\n`;
  }
  const text = `Você ajuda um app de gastos pessoais no Brasil a montar a lista de compras do mercado de uma família.
A lista vai cobrir ${total} dias, em ${ctx.purchases.length} ${ctx.purchases.length === 1 ? 'compra' : 'compras'} (${ctx.purchases.map(p => `${shortDate(p.date)} cobre ${p.days} dias`).join('; ')}).
Abaixo estão os produtos que a pessoa costuma comprar, com o que ela comprou de ${h.window.from} a ${h.window.to} (${h.tripCount} idas ao mercado) e uma conta simples da quantidade para o período.

Revise as quantidades. Só liste um produto se quiser MUDAR algo:
- "qtd": quantidade total a comprar no período inteiro, na mesma unidade do produto (número). Use quando a conta simples parecer errada: produto sazonal, de uso eventual, que dura mais que o período, comprado em quantidade atípica ou que está acabando.
- "manter": false para o que não faz sentido comprar agora (compra única, presente, material de festa, item de uma ocasião). Explique em "motivo", em até 8 palavras.
- Não invente produtos que não estão na lista e não aumente além do que a pessoa realmente consome.

PRODUTOS:
${lines.join('\n')}
${seasonal}
Responda SOMENTE com um objeto JSON neste formato (listas vazias se não houver mudança):
{"itens":[{"id":3,"qtd":4},{"id":9,"manter":false,"motivo":"compra única"}],"epoca":[41,43]}`;
  return { text, ids };
};

const toNumber = (v: unknown): number => {
  if (typeof v === 'number') return v;
  return Number(String(v ?? '').replace(',', '.'));
};

export const parseItemsAnswer = (data: any, ids: Map<number, string>): Advice => {
  const items: NonNullable<Advice['items']> = {};
  const list: any[] = Array.isArray(data) ? data : (data?.itens ?? data?.items ?? []);
  (Array.isArray(list) ? list : []).forEach(x => {
    const pid = ids.get(Math.round(Number(x?.id)));
    if (!pid) return;
    const keep = x?.manter ?? x?.keep;
    const drop = keep === false || String(keep).toLowerCase() === 'false' || String(keep).toLowerCase() === 'não' || String(keep).toLowerCase() === 'nao';
    if (drop) { items[pid] = { drop: String(x?.motivo ?? x?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) }; return; }
    const qty = toNumber(x?.qtd ?? x?.quantidade ?? x?.qty);
    if (Number.isFinite(qty) && qty >= 0) items[pid] = { qty };
  });
  const seasonRaw: any[] = Array.isArray(data?.epoca) ? data.epoca : (Array.isArray(data?.sazonais) ? data.sazonais : []);
  const seasonal = Array.from(new Set(seasonRaw.map(v => ids.get(Math.round(Number(v)))).filter((v): v is string => !!v)));
  return { items, seasonal };
};

/* ───────────────────────── juntando tudo ───────────────────────── */

export interface Consulted {
  history: History;
  advice: Advice;
  info: Pick<BaseInfo, 'source' | 'note' | 'aiError'>;
}

/** Roda as duas perguntas. Qualquer falha devolve o que já deu certo e a mensagem do erro (a lista sai pelas contas locais). */
export const consultAi = async (
  receipts: Receipt[],
  masters: MasterProduct[],
  ctx: ItemsContext,
  opts: { today?: string; ask?: Ask } = {},
): Promise<Consulted> => {
  const ask = opts.ask || askAiForJson;
  let history = analyzeHistory(receipts, masters, { today: opts.today });
  const out: Consulted = { history, advice: {}, info: { source: 'historico' } };
  if (history.empty) return out;

  try {
    const pa = parsePeriodAnswer(await ask(buildPeriodPrompt(history)), history);
    if (pa.window || pa.cycle) {
      history = analyzeHistory(receipts, masters, { today: opts.today, window: pa.window, cycle: pa.cycle });
      out.history = history;
    }
    out.info = { source: 'ia', note: pa.note || undefined };
  } catch (err: any) {
    out.info = { source: 'historico', aiError: errorText(err) };
    return out;
  }

  try {
    const ip = buildItemsPrompt(history, ctx);
    out.advice = parseItemsAnswer(await ask(ip.text), ip.ids);
  } catch (err: any) {
    out.info = { ...out.info, aiError: `A IA definiu o período, mas não refinou os itens: ${errorText(err)}` };
  }
  return out;
};
