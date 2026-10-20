// Leitura de cupons e tarefas de texto via OpenRouter, com a chave do próprio usuário (BYOK).
// A chamada sai direto do dispositivo para openrouter.ai; a chave nunca passa por servidor nosso.
//
// Por que existe lógica de "reserva" aqui: os modelos gratuitos do OpenRouter entram e saem do
// catálogo com frequência e têm limite de uso (20 pedidos/min; 50/dia, ou 1000/dia com créditos
// comprados). Então, em vez de falhar no primeiro erro, o app tenta o modelo escolhido pelo
// usuário, depois uma lista de reservas, e por fim o roteador automático "openrouter/free".

import { Receipt } from '../types';
import { diagnostics } from './diagnosticService';
import { GeminiError } from './geminiService';
import { getOpenRouterModel } from './keyStorageService';

const BASE_URL = 'https://openrouter.ai/api/v1';

// Roteador oficial que escolhe sozinho um modelo grátis compatível com o pedido (imagem, JSON...).
export const FREE_ROUTER = 'openrouter/free';

// Modelos grátis com leitura de imagem confirmada no catálogo em out/2026.
export const DEFAULT_VISION_MODELS = [
  'thinkingmachines/inkling:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
];

// Modelos grátis só de texto, para a auditoria de categorias.
export const DEFAULT_TEXT_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'apodex/apodex-1.1-mini:free',
];

// Modelos grátis geram devagar (o Inkling faz ~35 tokens/s: um cupom de 30 itens leva cerca de 1 minuto).
// Por isso não há um limite curto fixo: o app acompanha a resposta em tempo real e só desiste de um modelo
// quando ele para de dar sinal de vida. O Scanner espera até SCAN_LIMIT_OPENROUTER_MS por cupom.
export const SCAN_LIMIT_OPENROUTER_MS = 210_000;
// Ajustável só para testes automáticos.
export const TIMING = {
  firstTokenMs: 60_000,   // até o 1º pedaço de texto (fila, leitura da imagem, "pensar")
  idleMs: 25_000,         // sem texto novo depois de começar a responder
  perAttemptMs: 150_000,  // teto de um único modelo
  totalMs: 190_000,       // teto de todos os modelos juntos, por cupom
  minLeftMs: 8_000,       // com menos tempo que isso, nem tenta o próximo modelo
};
const MAX_CANDIDATES = 4;

const RECEIPT_FORMAT_HINT = `Responda SOMENTE com um objeto JSON válido (sem markdown, sem comentários, sem texto antes ou depois), neste formato:
{
  "establishmentName": "nome do estabelecimento",
  "receiptNumber": "número do cupom",
  "cnpj": "CNPJ do estabelecimento",
  "address": "endereço",
  "city": "cidade",
  "state": "UF com 2 letras",
  "date": "AAAA-MM-DD",
  "time": "HH:MM",
  "totalAmount": 0.00,
  "items": [
    { "description": "nome do item como impresso, sem o código", "code": "código impresso na linha do item (de barras ou da loja), só os caracteres, ? no dígito ilegível, \"\" se não houver", "eggCount": 0, "quantity": 1, "unitType": "UN", "unitPrice": 0.00, "totalPrice": 0.00, "category": "um item exato da taxonomia" }
  ]
}
Use números JSON com ponto decimal (12.5, não "12,50"). Se um dado não aparecer no cupom, use "" (texto) ou 0 (número).
Se o nome de um item estiver rasurado ou cortado, escreva só o que dá para ler, com ? nas letras ilegíveis; não invente.
Em \"eggCount\" (só para ovos) escreva quantos ovos vêm na embalagem se a linha disser (30 OVOS, C/20, DUZIA = 12); se não disser, 0. Não adivinhe.
Escreva o JSON compacto, numa única linha, sem quebras de linha nem indentação: isso encurta a resposta e acelera a leitura.`;

/* ───────────────────────────── JSON tolerante ───────────────────────────── */

// Modelos pequenos costumam devolver JSON dentro de cercas ```json, com texto em volta ou
// com vírgula sobrando. Esta função recupera o JSON nesses casos e devolve null se não houver.
export const extractJson = (raw: string): any | null => {
  if (!raw) return null;
  let text = raw.replace(/```(?:json)?/gi, '').trim();

  const tryParse = (s: string) => {
    try { return JSON.parse(s); } catch { /* tenta limpar */ }
    try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
  };

  const direct = tryParse(text);
  if (direct !== null) return direct;

  // Pega do primeiro { ou [ até o último } ou ] correspondente.
  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  const start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) return null;
  const closer = text[start] === '{' ? '}' : ']';
  const end = text.lastIndexOf(closer);
  if (end <= start) return null;
  return tryParse(text.slice(start, end + 1));
};

// Aceita o cupom na raiz ou embrulhado ({ "cupom": {...} }) e confirma o mínimo necessário.
const normalizeReceipt = (parsed: any): Partial<Receipt> | null => {
  if (!parsed || typeof parsed !== 'object') return null;
  let obj = parsed;
  if (!Array.isArray(obj.items)) {
    const inner = Object.values(obj).find((v: any) => v && typeof v === 'object' && Array.isArray((v as any).items));
    if (inner) obj = inner;
  }
  if (!Array.isArray(obj.items) || obj.items.length === 0) return null;
  return obj as Partial<Receipt>;
};

/* ───────────────────────────── chamada HTTP ───────────────────────────── */

type Fail = { fatal: boolean; error: GeminiError; status?: number };

const httpFail = async (res: Response, model: string): Promise<Fail> => {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || '';
  } catch { /* sem corpo JSON */ }
  const s = res.status;
  if (s === 401) return { fatal: true, status: s, error: new GeminiError('Chave do OpenRouter inválida ou revogada. Gere outra em openrouter.ai/settings/keys.', 'AUTH', false) };
  if (s === 402) return { fatal: true, status: s, error: new GeminiError(`O OpenRouter pediu créditos para este modelo (${model}). Use um modelo com final ":free" ou adicione saldo.`, 'QUOTA', false) };
  // Cota diária dos modelos grátis é da conta, não do modelo: tentar outro modelo só gastaria mais pedidos.
  if (s === 429 && /per[- ]day/i.test(detail)) {
    return { fatal: true, status: s, error: new GeminiError('A cota diária grátis do OpenRouter acabou (50 pedidos por dia; 1000 com 10 créditos comprados). Ela renova amanhã. Use outro provedor ou adicione créditos.', 'QUOTA', false) };
  }
  if (s === 429) return { fatal: false, status: s, error: new GeminiError(`Limite de uso do OpenRouter atingido em ${model}. ${detail}`.trim(), 'QUOTA', true) };
  if (s === 404) return { fatal: false, status: s, error: new GeminiError(`Modelo indisponível no OpenRouter: ${model}. Ele pode ter saído do catálogo grátis.`, 'UNKNOWN', true) };
  if (s === 408 || s >= 500) return { fatal: false, status: s, error: new GeminiError(`OpenRouter instável (${s}) em ${model}. ${detail}`.trim(), 'NETWORK', true) };
  return { fatal: false, status: s, error: new GeminiError(`Erro do OpenRouter (${s}) em ${model}: ${detail}`.trim(), 'UNKNOWN', false) };
};

// Texto da resposta: a API pode devolver string ou lista de partes.
const readContent = (message: any): string => {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join('\n');
  return '';
};

interface CallOptions {
  model: string;
  messages: any[];
  maxTokens: number;
  timeoutMs: number;
  lean?: boolean; // sem parâmetros opcionais, para modelos que rejeitam response_format/reasoning
}

// O OpenRouter às vezes responde com o erro dentro do corpo (ou no meio do streaming).
const embeddedFail = (embedded: any, model: string): Fail => {
  const code = Number(embedded?.code);
  const msg = embedded?.message || 'erro do provedor';
  if (code === 401) return { fatal: true, error: new GeminiError('Chave do OpenRouter inválida ou revogada.', 'AUTH', false) };
  if (code === 402) return { fatal: true, error: new GeminiError(`O OpenRouter pediu créditos para ${model}.`, 'QUOTA', false) };
  if (code === 429 && /per[- ]day/i.test(String(msg))) {
    return { fatal: true, status: 429, error: new GeminiError('A cota diária grátis do OpenRouter acabou (50 pedidos por dia; 1000 com 10 créditos comprados). Ela renova amanhã. Use outro provedor ou adicione créditos.', 'QUOTA', false) };
  }
  return {
    fatal: false, status: code || undefined,
    error: new GeminiError(`${model}: ${msg}`, code === 429 ? 'QUOTA' : 'UNKNOWN', true),
  };
};

// A resposta chega em pedaços (streaming). Assim dá para distinguir "modelo lento, mas escrevendo" de
// "modelo travado": só se desiste quando não vem texto novo por TIMING.idleMs.
const callOnce = async (apiKey: string, o: CallOptions): Promise<{ text: string; model: string } | Fail> => {
  const ctrl = new AbortController();
  let abortWhy: 'first' | 'idle' | 'cap' | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number, why: 'first' | 'idle') => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { abortWhy = why; ctrl.abort(); }, ms);
  };
  const hardCap = setTimeout(() => { abortWhy = 'cap'; ctrl.abort(); }, o.timeoutMs);
  arm(Math.min(TIMING.firstTokenMs, o.timeoutMs), 'first');

  const body: Record<string, unknown> = {
    model: o.model,
    messages: o.messages,
    temperature: 0.1,
    max_tokens: o.maxTokens,
    stream: true,
  };
  if (!o.lean) {
    body.response_format = { type: 'json_object' };
    // Modelos grátis de raciocínio podem gastar o limite de tokens "pensando" e devolver resposta vazia.
    // Em modelos pagos (Claude, por exemplo) isso ligaria o "pensar" e cobraria tokens a mais, então só vale para os grátis.
    if (o.model.endsWith(':free') || o.model === FREE_ROUTER) body.reasoning = { effort: 'low', exclude: true };
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let text = '';
  let modelUsed = o.model;
  const timeoutFail = (): Fail => {
    const secs = Math.round(o.timeoutMs / 1000);
    const msg = abortWhy === 'first' ? `${o.model} não começou a responder a tempo.`
      : abortWhy === 'idle' ? `${o.model} parou de responder no meio.`
      : `${o.model} demorou mais de ${secs}s.`;
    return { fatal: false, error: new GeminiError(msg, 'NETWORK', true) };
  };

  try {
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://eukasconta.app',
          'X-Title': 'Eukasconta',
        },
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') return timeoutFail();
      return { fatal: false, error: new GeminiError('Sem conexão com o OpenRouter. Verifique a internet.', 'NETWORK', true, err) };
    }

    if (!res.ok) return await httpFail(res, o.model);

    const ctype = res.headers.get('content-type') || '';
    if (!res.body || !ctype.includes('text/event-stream')) {
      // Resposta comum em JSON (o provedor ignorou o streaming).
      let data: any;
      try { data = await res.json(); } catch (err: any) {
        if (err?.name === 'AbortError') return timeoutFail();
        return { fatal: false, error: new GeminiError(`Resposta ilegível de ${o.model}.`, 'PARSING', true, err) };
      }
      const embedded = data?.error || data?.choices?.[0]?.error;
      if (embedded) return embeddedFail(embedded, o.model);
      const plain = readContent(data?.choices?.[0]?.message).trim();
      if (!plain) return { fatal: false, error: new GeminiError(`${o.model} devolveu resposta vazia.`, 'PARSING', true) };
      return { text: plain, model: data?.model || o.model };
    }

    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finish = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        // Linhas ": OPENROUTER PROCESSING" são só sinal de que a conexão está viva.
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let chunk: any;
        try { chunk = JSON.parse(payload); } catch { continue; }

        if (chunk?.model) modelUsed = chunk.model;
        const choice = chunk?.choices?.[0];
        const embedded = chunk?.error || choice?.error;
        if (embedded) return embeddedFail(embedded, o.model);

        const delta = choice?.delta;
        const piece = readContent(delta);
        if (piece) { text += piece; arm(TIMING.idleMs, 'idle'); }
        else if (delta?.reasoning || delta?.reasoning_details) arm(TIMING.idleMs, 'idle'); // está "pensando"
        if (choice?.finish_reason) finish = choice.finish_reason;
      }
    }

    text = text.trim();
    if (!text) return { fatal: false, error: new GeminiError(`${o.model} devolveu resposta vazia.`, 'PARSING', true) };
    if (finish === 'length') {
      return { fatal: false, error: new GeminiError(`${o.model} cortou a resposta no meio (cupom muito longo para o limite do modelo).`, 'PARSING', true) };
    }
    return { text, model: modelUsed };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      // Já escreveu algo e travou no fim? Devolve o que veio; quem chamou confere se o JSON está completo.
      if (abortWhy === 'idle' && text.trim()) return { text: text.trim(), model: modelUsed };
      return timeoutFail();
    }
    return { fatal: false, error: new GeminiError(`Conexão com ${o.model} interrompida.`, 'NETWORK', true, err) };
  } finally {
    if (timer) clearTimeout(timer);
    clearTimeout(hardCap);
    try { await reader?.cancel(); } catch { /* já encerrado */ }
  }
};

const isFail = (r: any): r is Fail => r && typeof r === 'object' && 'error' in r;

// Percorre os modelos candidatos até um devolver algo que passe em `accept`.
const runWithFallback = async <T>(
  apiKey: string,
  candidates: string[],
  build: (model: string) => Omit<CallOptions, 'model' | 'timeoutMs'>,
  accept: (text: string) => T | null,
  task = 'ler este cupom',
  totalMs: number = TIMING.totalMs,
): Promise<{ value: T; model: string }> => {
  const started = Date.now();
  const failures: Fail[] = [];
  const list = Array.from(new Set(candidates.filter(Boolean))).slice(0, MAX_CANDIDATES);

  for (const model of list) {
    const remaining = totalMs - (Date.now() - started);
    if (remaining < TIMING.minLeftMs) break;
    const timeoutMs = Math.min(TIMING.perAttemptMs, remaining);

    let result = await callOnce(apiKey, { ...build(model), model, timeoutMs });

    // Erro 400 costuma ser parâmetro opcional que o modelo não aceita: repete uma vez, sem eles.
    if (isFail(result) && result.status === 400 && !result.fatal) {
      const left = totalMs - (Date.now() - started);
      if (left >= TIMING.minLeftMs) result = await callOnce(apiKey, { ...build(model), model, timeoutMs: Math.min(TIMING.perAttemptMs, left), lean: true });
    }

    if (isFail(result)) {
      if (result.fatal) throw result.error;
      failures.push(result);
      continue;
    }

    const value = accept(result.text);
    if (value !== null) return { value, model: result.model };
    failures.push({ fatal: false, error: new GeminiError(`${model} não devolveu o JSON esperado.`, 'PARSING', true) });
  }

  if (failures.length > 0 && failures.every(f => f.status === 429)) {
    throw new GeminiError(
      'Limite dos modelos grátis do OpenRouter atingido (20 pedidos por minuto e 50 por dia; 1000 por dia com créditos comprados). Aguarde um pouco ou use outro provedor.',
      'QUOTA', true,
    );
  }
  // Lista o que aconteceu com cada modelo, para dar para ver se foi lentidão, fila, indisponibilidade...
  const last = failures[failures.length - 1];
  const what = failures.length > 0 ? failures.map(f => f.error.message).join(' | ') : 'tempo esgotado antes de tentar.';
  throw new GeminiError(
    `Nenhum modelo do OpenRouter conseguiu ${task} (${failures.length} de ${list.length} tentado(s)). ${what}`,
    last?.error.category || 'NETWORK', true, last?.error,
  );
};

/* ───────────────────────────── API pública ───────────────────────────── */

export const parseReceiptWithOpenRouter = async (
  apiKey: string,
  base64Image: string,
  mimeType: string,
  systemInstruction: string,
): Promise<Partial<Receipt>> => {
  const startTime = performance.now();
  const primary = getOpenRouterModel('vision') || DEFAULT_VISION_MODELS[0];
  // O Nemotron Nano Omni vive fora do ar (disponibilidade de 40% a 55% no catálogo): fica por último.
  const candidates = [primary, DEFAULT_VISION_MODELS[0], FREE_ROUTER, ...DEFAULT_VISION_MODELS.slice(1)];

  const { value, model } = await runWithFallback(
    apiKey,
    candidates,
    () => ({
      maxTokens: 8000,
      messages: [
        { role: 'system', content: systemInstruction },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            { type: 'text', text: `Analise este cupom e categorize cada item conforme a taxonomia fornecida.\n\n${RECEIPT_FORMAT_HINT}` },
          ],
        },
      ],
    }),
    (text) => normalizeReceipt(extractJson(text)),
  );

  diagnostics.log('API_CALL', `Extração OCR via OpenRouter (${model})`, performance.now() - startTime);
  return value;
};

// Tarefas de texto (auditoria de categorias). Devolve o JSON já validado, como texto.
// `budgetMs`: tempo máximo de todas as tentativas juntas (sem ele, o mesmo teto da leitura de cupons).
export const askOpenRouterForJson = async (apiKey: string, prompt: string, budgetMs?: number): Promise<string> => {
  const startTime = performance.now();
  const primary = getOpenRouterModel('text') || DEFAULT_TEXT_MODELS[0];
  const candidates = [primary, ...DEFAULT_TEXT_MODELS, FREE_ROUTER];

  const { value, model } = await runWithFallback(
    apiKey,
    candidates,
    () => ({ maxTokens: 8000, messages: [{ role: 'user', content: prompt }] }),
    (text) => {
      const parsed = extractJson(text);
      return parsed === null ? null : JSON.stringify(parsed);
    },
    'responder',
    budgetMs && budgetMs > 0 ? budgetMs : TIMING.totalMs,
  );

  diagnostics.log('API_CALL', `Texto via OpenRouter (${model})`, performance.now() - startTime);
  return value;
};

/* ───────────────────────────── teste de chave ───────────────────────────── */

// Consulta /key: não gasta nenhum pedido dos modelos e ainda mostra a cota grátis do dia.
export const testOpenRouterKey = async (apiKey: string): Promise<{ ok: boolean; message: string }> => {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/key`, { headers: { authorization: `Bearer ${apiKey}` } });
  } catch {
    return { ok: false, message: 'Sem conexão com o OpenRouter. Verifique a internet.' };
  }
  if (res.status === 401) return { ok: false, message: 'Chave recusada pelo OpenRouter (inválida ou revogada). Gere outra em openrouter.ai/settings/keys.' };
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* sem corpo */ }
    return { ok: false, message: `OpenRouter respondeu ${res.status}. ${detail}`.trim() };
  }
  let quota = '';
  try {
    const q = (await res.json())?.data?.free_model_daily_requests;
    if (q && typeof q.used === 'number' && typeof q.limit === 'number') {
      quota = ` Hoje: ${q.used} de ${q.limit} pedidos grátis usados.`;
    }
  } catch { /* corpo inesperado: o teste continua válido */ }
  return { ok: true, message: `Chave do OpenRouter funcionando.${quota}` };
};

/* ───────────────────────────── catálogo de modelos ───────────────────────────── */

export interface FreeModel {
  id: string;
  name: string;
  context: number;
  vision: boolean;
}

// Busca a lista pública do OpenRouter e separa os modelos gratuitos. Não exige chave.
export const fetchFreeModels = async (): Promise<FreeModel[]> => {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/models`);
  } catch (err) {
    throw new GeminiError('Não consegui acessar a lista do OpenRouter. Verifique a internet.', 'NETWORK', true, err);
  }
  if (!res.ok) throw new GeminiError(`OpenRouter respondeu ${res.status} ao listar modelos.`, 'NETWORK', true);
  const json = await res.json();
  return filterFreeModels(json?.data);
};

export const filterFreeModels = (data: any): FreeModel[] => {
  if (!Array.isArray(data)) return [];
  const isZero = (v: any) => v === undefined || v === null || Number(v) === 0;
  const out: FreeModel[] = [];
  for (const m of data) {
    if (!m?.id) continue;
    const p = m.pricing || {};
    const free = String(m.id).endsWith(':free') || (Number(p.prompt) === 0 && Number(p.completion) === 0 && isZero(p.image));
    if (!free) continue;
    const arch = m.architecture || {};
    const outputs: string[] = arch.output_modalities || (typeof arch.modality === 'string' ? [arch.modality.split('->')[1] || ''] : []);
    if (!outputs.some(x => String(x).includes('text'))) continue; // descarta rerank, embeddings, imagem...
    const inputs: string[] = arch.input_modalities || (typeof arch.modality === 'string' ? (arch.modality.split('->')[0] || '').split('+') : []);
    out.push({
      id: String(m.id),
      name: String(m.name || m.id),
      context: Number(m.context_length) || 0,
      vision: inputs.includes('image'),
    });
  }
  return out.sort((a, b) => Number(b.vision) - Number(a.vision) || b.context - a.context || a.name.localeCompare(b.name));
};
