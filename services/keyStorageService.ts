// BYOK: a chave de IA do usuário fica só no dispositivo dele.
// Isso resolve custo (cada um paga sua própria leitura de cupom) e evita
// o app virar depositário de segredos de terceiros num servidor central.
// Não é um cofre criptográfico "militar" — é armazenamento local do
// dispositivo, equivalente ao que apps de nicho fazem para tokens de API.

export type AiProvider = 'gemini' | 'openai' | 'anthropic' | 'openrouter';

export const ALL_PROVIDERS: AiProvider[] = ['gemini', 'anthropic', 'openrouter', 'openai'];

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini: 'Google Gemini',
  anthropic: 'Anthropic Claude',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
};

const storageKey = (provider: AiProvider) => `eukasconta_byok_${provider}`;

export const saveUserApiKey = (provider: AiProvider, apiKey: string): void => {
  localStorage.setItem(storageKey(provider), apiKey.trim());
};

export const getUserApiKey = (provider: AiProvider): string | null => {
  return localStorage.getItem(storageKey(provider));
};

export const clearUserApiKey = (provider: AiProvider): void => {
  localStorage.removeItem(storageKey(provider));
};

export const hasAnyUserApiKey = (): boolean => {
  return ALL_PROVIDERS.some((p) => Boolean(getUserApiKey(p)));
};

// Provedor ativo: qual IA o app usa para ler cupons quando há mais de uma chave salva.
const ACTIVE_PROVIDER_KEY = 'eukasconta_active_ai_provider';

export const getActiveProvider = (): AiProvider => {
  const stored = localStorage.getItem(ACTIVE_PROVIDER_KEY) as AiProvider | null;
  if (stored && getUserApiKey(stored)) return stored;
  // Sem escolha explícita: usa o primeiro provedor que tiver chave salva.
  const firstWithKey = ALL_PROVIDERS.find((p) => getUserApiKey(p));
  return firstWithKey || 'gemini';
};

export const setActiveProvider = (provider: AiProvider): void => {
  localStorage.setItem(ACTIVE_PROVIDER_KEY, provider);
};

export const getActiveProviderLabel = (): string => PROVIDER_LABELS[getActiveProvider()];

// OpenRouter: um mesmo provedor dá acesso a centenas de modelos, então o usuário escolhe qual usar.
// 'vision' lê o cupom (precisa aceitar imagem); 'text' faz tarefas só de texto, como a auditoria.
export type OpenRouterTask = 'vision' | 'text';

const modelKey = (task: OpenRouterTask) => `eukasconta_openrouter_model_${task}`;

export const getOpenRouterModel = (task: OpenRouterTask): string | null => {
  const v = localStorage.getItem(modelKey(task));
  return v && v.trim() ? v.trim() : null;
};

// Valor vazio volta ao modelo padrão do app.
export const setOpenRouterModel = (task: OpenRouterTask, modelId: string): void => {
  const v = modelId.trim();
  if (v) localStorage.setItem(modelKey(task), v);
  else localStorage.removeItem(modelKey(task));
};
