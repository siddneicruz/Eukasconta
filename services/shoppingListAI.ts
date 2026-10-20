import { Receipt, MasterProduct } from '../types';
import { askAiForJson } from './geminiService';
import { Advice, BaseInfo, History, PurchasePlan, analyzeHistory, diffDays, isIso, roundTo, shortDate, stepOf, unitLabel } from './shoppingList';
import { Emit, StepId, secs } from './shoppingProgress';
import { getActiveProvider, getUserApiKey } from './keyStorageService';
import { testOpenRouterKey } from './openrouterService';

/* A IA escolhida pela pessoa (Gemini, Claude, OpenRouter...) opina em duas perguntas curtas:
   1) Em qual período de compras vale se basear? (tira festas, viagens, compras fora do comum e diz de quantos em quantos dias se vai ao mercado)
   2) Para cada produto: quanto comprar no período da lista e o que não precisa agora (e, se pedido, quais frutas e verduras estão de época).
   A IA só sugere. Tudo que ela devolve passa por trava (datas dentro do histórico, quantidade limitada ao que a pessoa já comprou)
   e a lista continua sendo montada pelas contas locais, então sem IA ou com a IA fora do ar a lista sai igual, só que sem o refino. */

export type Ask = (prompt: string, opts?: { budgetMs?: number }) => Promise<any>;

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

export const buildPeriodPrompt = (h: History, fixed = false): string => `Você ajuda um app de gastos pessoais no Brasil a montar a lista de compras do mercado.
Abaixo estão as idas ao mercado da pessoa (data, lojas, número de itens, gasto). Hoje é ${h.today}.

Descubra:
1. ${fixed
  ? `O período já foi escolhido pela pessoa (${h.window.from} a ${h.window.to}). Repita-o em "periodo", sem mudar.`
  : 'O PERÍODO de compras que melhor representa o consumo normal da casa para basear a próxima lista. Deixe de fora idas fora do comum (festa, viagem, compra gigante de estoque, feriado) e dados velhos demais. Use de 4 a 12 idas seguidas quando houver.'}
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

/** Quanto esperar a IA em cada etapa. Os modelos grátis às vezes ficam minutos na fila: melhor seguir sem ela do que travar. */
export interface Limits { connectMs: number; periodMs: number; itemsMs: number }
export const DEFAULT_LIMITS: Limits = { connectMs: 8_000, periodMs: 50_000, itemsMs: 90_000 };

class Stop extends Error {
  constructor(public kind: 'skip' | 'timeout', message: string) { super(message); }
}

/** Espera `p` por no máximo `ms`; `skip` (o toque em "Seguir sem a IA") encerra a espera na hora. */
const limited = <T>(p: Promise<T>, ms: number, skip: Promise<void> | undefined, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Stop('timeout', `${what} não respondeu em ${secs(ms)}.`)), ms);
    skip?.then(() => { clearTimeout(timer); reject(new Stop('skip', 'Você pediu para seguir sem a IA.')); });
    p.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });

export interface Link { ok: boolean; message: string }

/** Confere a ligação com o provedor escolhido. No OpenRouter consulta a chave (não gasta pedido grátis); nos demais, vê se há chave. */
export const checkLink = async (): Promise<Link> => {
  const provider = getActiveProvider();
  const key = getUserApiKey(provider);
  if (!key) return { ok: false, message: 'Nenhuma chave de IA salva. Adicione em Config > Chave IA.' };
  if (provider === 'openrouter') return testOpenRouterKey(key);
  if (provider === 'anthropic') return { ok: true, message: 'Chave do Claude encontrada.' };
  if (provider === 'gemini') return { ok: true, message: 'Chave do Gemini encontrada.' };
  return { ok: false, message: 'Este provedor ainda não faz a lista. Escolha Claude, Gemini ou OpenRouter em Config > Chave IA.' };
};

export const describeHistory = (h: History): string =>
  `${h.tripCount} ${h.tripCount === 1 ? 'ida ao mercado' : 'idas ao mercado'} de ${shortDate(h.window.from)} a ${shortDate(h.window.to)} · ciclo de ${h.cycle} dias · ${h.products.length} produtos`;

export interface ConsultOptions {
  today?: string;
  ask?: Ask;
  /** conferência da ligação (os testes trocam por uma falsa) */
  link?: () => Promise<Link>;
  /** andamento para o painel */
  emit?: Emit;
  /** resolve quando a pessoa toca em "Seguir sem a IA" */
  skip?: Promise<void>;
  limits?: Partial<Limits>;
  /** rótulo do provedor para as frases do registro */
  label?: string;
  /** período maior escolhido pela pessoa (dias): a IA não o encurta, só diz o ritmo */
  lookbackDays?: number;
}

/** Roda as etapas da IA, contando cada passo no painel. Qualquer falha devolve o que já deu certo e a mensagem do erro (a lista sai pelas contas locais). */
export const consultAi = async (
  receipts: Receipt[],
  masters: MasterProduct[],
  ctx: ItemsContext,
  opts: ConsultOptions = {},
): Promise<Consulted> => {
  const ask = opts.ask || askAiForJson;
  const link = opts.link || checkLink;
  const label = opts.label || 'a IA';
  const lim: Limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const emit: Emit = opts.emit || (() => {});
  const step = (id: StepId, status: 'run' | 'done' | 'skip' | 'fail', detail?: string) => emit({ kind: 'step', step: id, status, detail });
  const log = (text: string) => emit({ kind: 'log', text });
  const skipAll = (from: 'conexao' | 'periodo' | 'itens', why: string) => {
    const order = ['conexao', 'periodo', 'itens'] as const;
    order.slice(order.indexOf(from)).forEach(id => step(id, 'skip', why));
  };

  const fixed = !!opts.lookbackDays && opts.lookbackDays > 0;
  let history = analyzeHistory(receipts, masters, { today: opts.today, lookbackDays: opts.lookbackDays });
  const out: Consulted = { history, advice: {}, info: { source: 'historico' } };
  if (history.empty) return out;

  /* 1) ligação */
  step('conexao', 'run');
  log(`Conectando a ${label}…`);
  const t0 = Date.now();
  try {
    const lk = await limited(link(), lim.connectMs, opts.skip, label);
    if (!lk.ok) {
      step('conexao', 'fail', lk.message);
      log(`Sem ligação com ${label}: ${lk.message}`);
      out.info = { source: 'historico', aiError: lk.message };
      step('analise', 'run'); log('Analisando suas compras…');
      step('analise', 'done', describeHistory(history)); log(describeHistory(history));
      skipAll('periodo', 'Sem ligação com a IA');
      return out;
    }
    step('conexao', 'done', lk.message);
    log(`${label}: ${lk.message}`);
  } catch (err: any) {
    if (err instanceof Stop && err.kind === 'skip') {
      step('conexao', 'skip', 'Seguindo sem a IA');
      log('Você pediu para seguir sem a IA.');
      step('analise', 'run'); step('analise', 'done', describeHistory(history)); log(describeHistory(history));
      skipAll('periodo', 'Seguindo sem a IA');
      return out;
    }
    // sem resposta da conferência: segue e tenta a consulta mesmo assim (ela tem o próprio limite)
    step('conexao', 'done', 'Sem resposta rápida; tentando mesmo assim');
    log(`${label} demorou a responder à conferência (${secs(Date.now() - t0)}). Tentando mesmo assim.`);
  }

  /* 2) análise das compras */
  step('analise', 'run');
  log('Analisando suas compras…');
  step('analise', 'done', describeHistory(history));
  log(describeHistory(history));

  /* 3) período */
  step('periodo', 'run');
  log(`Enviando as ${history.trips.length} idas ao mercado para ${label} escolher o período…`);
  const t1 = Date.now();
  try {
    const pa = parsePeriodAnswer(await limited(ask(buildPeriodPrompt(history, fixed), { budgetMs: lim.periodMs }), lim.periodMs, opts.skip, label), history);
    if ((!fixed && pa.window) || pa.cycle) {
      history = analyzeHistory(receipts, masters, { today: opts.today, window: fixed ? undefined : pa.window, cycle: pa.cycle, lookbackDays: opts.lookbackDays });
      out.history = history;
    }
    out.info = { source: 'ia', note: pa.note || undefined };
    const what = fixed ? `o período que você escolheu (${shortDate(history.window.from)} a ${shortDate(history.window.to)})` : pa.window ? `${shortDate(history.window.from)} a ${shortDate(history.window.to)}` : 'o período já usado';
    step('periodo', 'done', `${what} · ciclo de ${history.cycle} dias`);
    log(`${label} respondeu em ${secs(Date.now() - t1)}: ${what}, ciclo de ${history.cycle} dias${pa.note ? ` — ${pa.note}` : ''}`);
  } catch (err: any) {
    if (err instanceof Stop && err.kind === 'skip') {
      step('periodo', 'skip', 'Seguindo sem a IA');
      log('Você pediu para seguir sem a IA.');
      skipAll('itens', 'Seguindo sem a IA');
      return out;
    }
    const msg = err instanceof Stop ? err.message : errorText(err);
    out.info = { source: 'historico', aiError: msg };
    step('periodo', 'fail', msg);
    log(`Falhou depois de ${secs(Date.now() - t1)}: ${msg}`);
    log('Sigo só com as suas compras.');
    skipAll('itens', 'A IA não respondeu');
    return out;
  }

  /* 4) itens */
  step('itens', 'run');
  const ip = buildItemsPrompt(history, ctx);
  log(`Enviando ${ip.ids.size} produtos para ${label} revisar as quantidades…`);
  const t2 = Date.now();
  try {
    out.advice = parseItemsAnswer(await limited(ask(ip.text, { budgetMs: lim.itemsMs }), lim.itemsMs, opts.skip, label), ip.ids);
    const adj = Object.values(out.advice.items || {});
    const changed = adj.filter(a => a.qty != null).length;
    const dropped = adj.filter(a => a.drop != null).length;
    const season = (out.advice.seasonal || []).length;
    const parts = [`${changed} ${changed === 1 ? 'quantidade ajustada' : 'quantidades ajustadas'}`, `${dropped} ${dropped === 1 ? 'item fora' : 'itens fora'} da lista`];
    if (ctx.fruitVeg) parts.push(`${season} ${season === 1 ? 'fruta/verdura de época' : 'frutas/verduras de época'}`);
    step('itens', 'done', parts.join(' · '));
    log(`${label} respondeu em ${secs(Date.now() - t2)}: ${parts.join(', ')}.`);
  } catch (err: any) {
    if (err instanceof Stop && err.kind === 'skip') {
      step('itens', 'skip', 'Seguindo sem a IA');
      log('Você pediu para seguir sem a IA. Fica o período que ela escolheu.');
      return out;
    }
    const msg = err instanceof Stop ? err.message : errorText(err);
    out.info = { ...out.info, aiError: `A IA definiu o período, mas não refinou os itens: ${msg}` };
    step('itens', 'fail', msg);
    log(`Falhou depois de ${secs(Date.now() - t2)}: ${msg}`);
  }
  return out;
};
