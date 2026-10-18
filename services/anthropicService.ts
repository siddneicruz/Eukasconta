// Leitura de cupons com Claude (Anthropic), usando a chave do próprio usuário (BYOK).
// A chamada sai direto do dispositivo para api.anthropic.com. O cabeçalho
// "anthropic-dangerous-direct-browser-access" é exigido pela Anthropic para
// chamadas vindas de navegador/app; aqui é aceitável porque a chave pertence
// ao próprio usuário e fica só no aparelho dele (nunca é uma chave da casa).

import { Receipt } from '../types';
import { diagnostics } from './diagnosticService';
import { GeminiError } from './geminiService';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-5';

// Mesmo formato do RECEIPT_SCHEMA do Gemini, escrito em JSON Schema padrão.
const RECEIPT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    establishmentName: { type: 'string' },
    receiptNumber: { type: 'string' },
    cnpj: { type: 'string' },
    address: { type: 'string' },
    city: { type: 'string' },
    state: { type: 'string', description: 'Sigla da UF' },
    date: { type: 'string' },
    time: { type: 'string' },
    totalAmount: { type: 'number' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          code: { type: 'string', description: 'Código do produto impresso na linha do item: código de barras (8 a 14 dígitos) ou código interno da loja, só os caracteres do código, sem espaços. Use ? no lugar de um dígito ilegível. Vazio se a linha não tem código.' },
          quantity: { type: 'number' },
          unitType: { type: 'string' },
          unitPrice: { type: 'number' },
          totalPrice: { type: 'number' },
          category: { type: 'string' },
        },
      },
    },
  },
  required: ['establishmentName', 'totalAmount', 'items', 'date'],
};

const mapHttpError = async (res: Response): Promise<GeminiError> => {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || '';
  } catch { /* corpo sem JSON */ }

  if (res.status === 401 || res.status === 403) {
    return new GeminiError(`Chave da Anthropic inválida ou sem permissão. ${detail}`, 'AUTH', false);
  }
  if (res.status === 400 && /credit|billing|balance/i.test(detail)) {
    return new GeminiError(`Conta Anthropic sem créditos. Adicione saldo em console.anthropic.com. ${detail}`, 'QUOTA', false);
  }
  if (res.status === 429) {
    return new GeminiError(`Limite de uso da Anthropic atingido. Tente em instantes. ${detail}`, 'QUOTA', true);
  }
  if (res.status >= 500) {
    return new GeminiError(`Serviço da Anthropic instável (${res.status}). ${detail}`, 'NETWORK', true);
  }
  return new GeminiError(`Erro da Anthropic (${res.status}): ${detail}`, 'UNKNOWN', false);
};

const callAnthropic = async (apiKey: string, body: Record<string, unknown>) => {
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, ...body }),
    });
  } catch (err) {
    throw new GeminiError('Sem conexão com a Anthropic. Verifique a internet.', 'NETWORK', true, err);
  }
  if (!res.ok) throw await mapHttpError(res);
  return res.json();
};

export const parseReceiptWithClaude = async (
  apiKey: string,
  base64Image: string,
  mimeType: string,
  systemInstruction: string
): Promise<Partial<Receipt>> => {
  const startTime = performance.now();

  // Ferramenta "forçada": obriga o Claude a devolver exatamente o JSON do schema,
  // em vez de texto livre que precisaria ser limpo antes do JSON.parse.
  const data = await callAnthropic(apiKey, {
    max_tokens: 8000,
    temperature: 0.1,
    system: systemInstruction,
    tools: [{
      name: 'registrar_cupom',
      description: 'Registra os dados estruturados extraídos do cupom fiscal.',
      input_schema: RECEIPT_JSON_SCHEMA,
    }],
    tool_choice: { type: 'tool', name: 'registrar_cupom' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
        { type: 'text', text: 'Analise este cupom e categorize cada item conforme a taxonomia fornecida.' },
      ],
    }],
  });

  diagnostics.log('API_CALL', 'Extração OCR via Claude', performance.now() - startTime);

  const toolBlock = (data.content || []).find((b: any) => b.type === 'tool_use');
  if (!toolBlock?.input) {
    throw new GeminiError('O Claude não retornou dados estruturados do cupom.', 'PARSING', true);
  }
  return toolBlock.input as Partial<Receipt>;
};

// Chamada de texto simples (usada pela auditoria de categorias).
export const askClaudeForJson = async (apiKey: string, prompt: string): Promise<string> => {
  const data = await callAnthropic(apiKey, {
    max_tokens: 8000,
    temperature: 0.1,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = (data.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
  return text.replace(/```json|```/g, '').trim();
};
