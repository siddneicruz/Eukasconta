
import { GoogleGenAI, Type } from "@google/genai";
import { Receipt } from "../types";
import { diagnostics } from "./diagnosticService";
import { getUserApiKey, getActiveProvider } from "./keyStorageService";
import { parseReceiptWithClaude, askClaudeForJson } from "./anthropicService";
import { parseReceiptWithOpenRouter, askOpenRouterForJson } from "./openrouterService";

// Se o usuário escolheu Claude e tem chave da Anthropic salva, usa o Claude.
const resolveClaudeKey = (): string | null => {
  return getActiveProvider() === 'anthropic' ? getUserApiKey('anthropic') : null;
};

// Se o usuário escolheu OpenRouter (modelos grátis, entre outros) e tem chave salva, usa o OpenRouter.
const resolveOpenRouterKey = (): string | null => {
  return getActiveProvider() === 'openrouter' ? getUserApiKey('openrouter') : null;
};

// Prioriza a chave que o próprio usuário colou nas Configurações (BYOK).
// Só cai para a chave de ambiente (.env.local) se o usuário não configurou a dele.
const resolveGeminiApiKey = (): string | undefined => {
  return getUserApiKey('gemini') || process.env.API_KEY || undefined;
};

export type ErrorCategory = 'NETWORK' | 'AUTH' | 'QUOTA' | 'SAFETY' | 'PARSING' | 'UNKNOWN';

export class GeminiError extends Error {
  public category: ErrorCategory;
  public isRetryable: boolean;
  public originalError?: any;

  constructor(message: string, category: ErrorCategory, isRetryable: boolean, originalError?: any) {
    super(message);
    this.name = 'GeminiError';
    this.category = category;
    this.isRetryable = isRetryable;
    this.originalError = originalError;
  }
}

// O SDK do Gemini devolve o erro como texto JSON cru ({"error":{"code":400,"message":"API key not valid..."}}).
// Aqui ele vira um erro com categoria e mensagem em português, para o Scanner saber o que fazer:
// chave recusada para o lote inteiro (não adianta repetir), limite de uso ou queda de rede.
const classifyGeminiError = (error: any): any => {
  if (error instanceof GeminiError) return error;
  const raw = String(error?.message || error || '');
  const status = Number(error?.status ?? error?.code);
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID|API key expired|UNAUTHENTICATED|PERMISSION_DENIED|"code":\s*40[13]\b/i.test(raw)) {
    return new GeminiError('O Google Gemini recusou a chave (inválida, expirada ou sem permissão). Confira em Config > Sua Chave de IA.', 'AUTH', false, error);
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|"code":\s*429\b/i.test(raw)) {
    return new GeminiError('Limite de uso do Google Gemini atingido. Aguarde um pouco ou use outro provedor.', 'QUOTA', true, error);
  }
  if (/Failed to fetch|NetworkError|ECONN|ENOTFOUND|network request failed/i.test(raw)) {
    return new GeminiError('Sem conexão com o Google Gemini. Verifique a internet.', 'NETWORK', true, error);
  }
  return error; // desconhecido: segue como antes
};

const getSystemInstruction = (categories: string[], establishments: string[]) => `
Você é um auditor fiscal de alta precisão especializado em varejo e gastronomia.
Sua missão é converter imagens de cupons fiscais em JSON perfeitamente estruturado.

ESTABELECIMENTOS CONHECIDOS (Use se houver match):
${establishments.join(', ')}

DIFERENCIAÇÃO DE CATEGORIAS (CRÍTICO):
1. PADARIA: Apenas pães, bolos produzidos na loja, salgados assados e confeitaria de balcão.
2. BOMBONIERE: Chocolates industrializados (Lacta, Nestlé), sorvetes de pote, balas, chicletes e snacks (Doritos, Amendoim).
3. FRIOS: Queijos fatiados e presuntaria.
4. LATICÍNIOS: Leites em caixa, iogurtes e manteigas.
5. PROTEÍNAS: Carnes in natura devem ir para as categorias de animais específicas ("Carne Bovina", "Carne de Aves", etc).

TAXONOMIA OBRIGATÓRIA (Use exatamente um destes itens para o campo 'category'):
${categories.join('\n')}

INSTRUÇÕES TÉCNICAS:
- 'state': Use apenas a sigla (ex: SP, SC).
- 'totalAmount': Deve ser o valor final pago.
- 'items': Extraia descrição, quantidade, tipo de unidade (KG, UN, L), preço unitário e o total do item.

Retorne APENAS o JSON.
`;

const RECEIPT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    establishmentName: { type: Type.STRING },
    receiptNumber: { type: Type.STRING },
    cnpj: { type: Type.STRING },
    address: { type: Type.STRING },
    city: { type: Type.STRING },
    state: { type: Type.STRING, description: "Sigla da UF" },
    date: { type: Type.STRING },
    time: { type: Type.STRING },
    totalAmount: { type: Type.NUMBER },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING },
          quantity: { type: Type.NUMBER },
          unitType: { type: Type.STRING },
          unitPrice: { type: Type.NUMBER },
          totalPrice: { type: Type.NUMBER },
          category: { type: Type.STRING }
        }
      }
    }
  },
  required: ["establishmentName", "totalAmount", "items", "date"]
};

export const parseReceiptImage = async (
    base64Image: string, 
    mimeType: string = 'image/jpeg',
    knownEstablishments: string[] = [],
    availableCategories: string[] = []
): Promise<Partial<Receipt>> => {
  const claudeKey = resolveClaudeKey();
  if (claudeKey) {
    try {
      return await parseReceiptWithClaude(claudeKey, base64Image, mimeType, getSystemInstruction(availableCategories, knownEstablishments));
    } catch (error: any) {
      diagnostics.log('SYSTEM_ERROR', `Falha na API Anthropic: ${error.message}`, 0, error);
      throw error;
    }
  }

  const openRouterKey = resolveOpenRouterKey();
  if (openRouterKey) {
    try {
      return await parseReceiptWithOpenRouter(openRouterKey, base64Image, mimeType, getSystemInstruction(availableCategories, knownEstablishments));
    } catch (error: any) {
      diagnostics.log('SYSTEM_ERROR', `Falha na API OpenRouter: ${error.message}`, 0, error);
      throw error;
    }
  }

  const startTime = performance.now();
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) throw new GeminiError("API Key não configurada. Adicione a sua em Config > Chave IA.", 'AUTH', false);

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { data: base64Image, mimeType } },
          { text: "Analise este cupom e categorize cada item conforme a taxonomia fornecida." }
        ]
      },
      config: {
        systemInstruction: getSystemInstruction(availableCategories, knownEstablishments),
        responseMimeType: "application/json",
        responseSchema: RECEIPT_SCHEMA,
        temperature: 0.1, 
      }
    });

    const executionTime = performance.now() - startTime;
    diagnostics.log('API_CALL', 'Extração OCR e Categorização Inteligente', executionTime);

    const text = response.text || "{}";
    return JSON.parse(text);

  } catch (error: any) {
    diagnostics.log('SYSTEM_ERROR', `Falha na API Gemini: ${error.message}`, 0, error);
    throw classifyGeminiError(error);
  }
};

export const auditCategoriesWithAI = async (
  items: { description: string, category: string }[],
  availableCategories: string[]
): Promise<{ description: string, newCategory: string, reason: string }[]> => {
  // Limit items to avoid token limits (process in chunks if necessary, but for now take top 500 or so)
  // In a real scenario, we might need batching.
  const itemsPayload = items.slice(0, 300).map(i => `${i.description} (Atual: ${i.category})`).join('\n');

  const prompt = `
Você é um auditor de consistência de dados.
Analise a lista de itens abaixo e suas categorias atuais.
Identifique itens que estão CLARAMENTE na categoria errada com base na Taxonomia Mestra fornecida.
Ignore pequenas variações ou ambiguidades. Foque em erros óbvios (ex: "Picanha" em "Limpeza", "Sabão" em "Açougue").

TAXONOMIA MESTRA (Use APENAS estas categorias):
${availableCategories.join('\n')}

ITENS PARA AUDITAR:
${itemsPayload}

Retorne um JSON com a lista de correções no seguinte formato:
[
  { "description": "Descrição do Item", "newCategory": "Nova Categoria Correta", "reason": "Explicação breve" }
]
Retorne apenas o JSON, sem markdown.
`;

  const claudeKey = resolveClaudeKey();
  if (claudeKey) {
    try {
      return JSON.parse(await askClaudeForJson(claudeKey, prompt) || "[]");
    } catch (error: any) {
      console.error("Erro na auditoria AI (Claude):", error);
      return [];
    }
  }

  const openRouterKey = resolveOpenRouterKey();
  if (openRouterKey) {
    // Aqui o erro sobe de propósito: com limite diário dos modelos grátis, devolver lista vazia
    // faria o app dizer "nenhuma inconsistência" quando na verdade a chamada falhou.
    const parsed = JSON.parse(await askOpenRouterForJson(openRouterKey, `${prompt}\n\nObservação: devolva a lista dentro de um objeto, no formato {"correcoes": [ ... ]}.`));
    const list = Array.isArray(parsed) ? parsed : (Object.values(parsed || {}).find(v => Array.isArray(v)) as any[] | undefined) || [];
    return list.filter((c: any) => c && typeof c.description === 'string' && typeof c.newCategory === 'string');
  }

  const apiKey = resolveGeminiApiKey();
  if (!apiKey) throw new GeminiError("API Key não configurada. Adicione a sua em Config > Chave IA.", 'AUTH', false);
  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [{ text: prompt }]
      },
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
      }
    });

    const text = response.text || "[]";
    return JSON.parse(text);
  } catch (error: any) {
    console.error("Erro na auditoria AI:", error);
    return [];
  }
};
