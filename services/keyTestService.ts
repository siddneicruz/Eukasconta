// Faz uma chamada mínima (poucos tokens) para confirmar que a chave funciona,
// e traduz o erro para algo que o usuário consegue resolver.
import { GoogleGenAI } from '@google/genai';
import { AiProvider } from './keyStorageService';
import { testOpenRouterKey } from './openrouterService';

export const testApiKey = async (provider: AiProvider, apiKey: string): Promise<{ ok: boolean; message: string }> => {
  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 5, messages: [{ role: 'user', content: 'ok' }] }),
      });
      if (res.ok) return { ok: true, message: 'Chave da Anthropic funcionando. Pronto para ler cupons com Claude.' };
      let detail = '';
      try { detail = (await res.json())?.error?.message || ''; } catch { /* sem corpo */ }
      if (res.status === 401) return { ok: false, message: 'Chave recusada pela Anthropic (inválida ou revogada). Gere uma nova em console.anthropic.com.' };
      if (/credit|billing|balance/i.test(detail)) return { ok: false, message: 'A chave é válida, mas a conta está sem créditos. Adicione saldo em console.anthropic.com > Billing.' };
      if (res.status === 429) return { ok: false, message: 'Limite de uso atingido. Aguarde um pouco e teste de novo.' };
      return { ok: false, message: `Anthropic respondeu ${res.status}: ${detail}` };
    }
    if (provider === 'openrouter') return await testOpenRouterKey(apiKey);
    if (provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey });
      await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: 'ok' });
      return { ok: true, message: 'Chave do Gemini funcionando. Pronto para ler cupons.' };
    }
    return { ok: false, message: 'Provedor ainda não suportado.' };
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/API key not valid|API_KEY_INVALID|401|403/i.test(msg)) return { ok: false, message: 'Chave recusada (inválida ou revogada).' };
    if (/Failed to fetch|NetworkError/i.test(msg)) return { ok: false, message: 'Sem conexão com o provedor. Verifique a internet.' };
    return { ok: false, message: msg };
  }
};
