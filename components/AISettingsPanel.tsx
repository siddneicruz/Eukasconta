import React, { useState, useEffect } from 'react';
import { KeyRound, Eye, EyeOff, Check, Trash2, ExternalLink, ShieldCheck, Loader2, Zap, CircleCheck, RefreshCw, Info } from 'lucide-react';
import { AiProvider, getUserApiKey, saveUserApiKey, clearUserApiKey, getActiveProvider, setActiveProvider, getOpenRouterModel, setOpenRouterModel } from '../services/keyStorageService';
import { testApiKey } from '../services/keyTestService';
import { fetchFreeModels, FreeModel, DEFAULT_VISION_MODELS, DEFAULT_TEXT_MODELS } from '../services/openrouterService';

const PROVIDERS: { id: AiProvider; label: string; helpUrl: string; placeholder: string; available: boolean }[] = [
  { id: 'gemini', label: 'Google Gemini', helpUrl: 'https://aistudio.google.com/apikey', placeholder: 'AIzaSy...', available: true },
  { id: 'openai', label: 'OpenAI', helpUrl: 'https://platform.openai.com/api-keys', placeholder: 'sk-...', available: false },
  { id: 'anthropic', label: 'Anthropic (Claude)', helpUrl: 'https://console.anthropic.com/settings/keys', placeholder: 'sk-ant-...', available: true },
  { id: 'openrouter', label: 'OpenRouter', helpUrl: 'https://openrouter.ai/settings/keys', placeholder: 'sk-or-v1-...', available: true },
];

const AISettingsPanel: React.FC = () => {
  const [selectedProvider, setSelectedProvider] = useState<AiProvider>('gemini');
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [active, setActive] = useState<AiProvider>(getActiveProvider());
  const [testState, setTestState] = useState<{ status: 'idle' | 'testing' | 'ok' | 'fail'; message?: string }>({ status: 'idle' });
  const [storedKeys, setStoredKeys] = useState<Record<AiProvider, string | null>>({
    gemini: null,
    openai: null,
    anthropic: null,
    openrouter: null,
  });

  // OpenRouter: modelo de cada tarefa (vazio = padrão do app) e catálogo de modelos grátis.
  const [visionModel, setVisionModel] = useState(getOpenRouterModel('vision') || '');
  const [textModel, setTextModel] = useState(getOpenRouterModel('text') || '');
  const [catalog, setCatalog] = useState<FreeModel[] | null>(null);
  const [catalogState, setCatalogState] = useState<{ status: 'idle' | 'loading' | 'ok' | 'fail'; message?: string }>({ status: 'idle' });

  const refreshStoredKeys = () => {
    setStoredKeys({
      gemini: getUserApiKey('gemini'),
      openai: getUserApiKey('openai'),
      anthropic: getUserApiKey('anthropic'),
      openrouter: getUserApiKey('openrouter'),
    });
  };

  useEffect(() => {
    refreshStoredKeys();
  }, []);

  useEffect(() => {
    setKeyInput('');
    setShowKey(false);
    setTestState({ status: 'idle' });
  }, [selectedProvider]);

  const handleTest = async () => {
    const key = storedKeys[selectedProvider];
    if (!key) return;
    setTestState({ status: 'testing' });
    const result = await testApiKey(selectedProvider, key);
    setTestState({ status: result.ok ? 'ok' : 'fail', message: result.message });
  };

  const handleLoadCatalog = async () => {
    setCatalogState({ status: 'loading' });
    try {
      const list = await fetchFreeModels();
      setCatalog(list);
      const withVision = list.filter(m => m.vision).length;
      setCatalogState({ status: 'ok', message: `${list.length} modelos grátis encontrados; ${withVision} leem imagem.` });
    } catch (err: any) {
      setCatalogState({ status: 'fail', message: `${err?.message || 'Falha ao buscar a lista.'} Os modelos sugeridos pelo app continuam disponíveis.` });
    }
  };

  const handleMakeActive = () => {
    setActiveProvider(selectedProvider);
    setActive(selectedProvider);
  };

  const handleSave = () => {
    if (!keyInput.trim()) return;
    saveUserApiKey(selectedProvider, keyInput.trim());
    // A chave que acabou de ser salva passa a ser a usada para ler cupons. Sem isso, uma chave antiga
    // (de outro provedor) continuava valendo e a nova ficava guardada sem uso.
    setActiveProvider(selectedProvider);
    setActive(selectedProvider);
    refreshStoredKeys();
    setKeyInput('');
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };

  const handleClear = (provider: AiProvider) => {
    clearUserApiKey(provider);
    refreshStoredKeys();
  };

  const maskKey = (key: string) => {
    if (key.length <= 8) return '••••••••';
    return `${key.slice(0, 4)}${'•'.repeat(Math.min(key.length - 8, 20))}${key.slice(-4)}`;
  };

  const activeProvider = PROVIDERS.find(p => p.id === selectedProvider)!;

  // Modelos pagos que leem imagem, para escolher com um toque. Usam os créditos do OpenRouter.
  const PAID_VISION_OPTIONS = [
    { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5 (pago, o mais barato)' },
    { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5 (pago, mais caro e mais preciso)' },
  ];
  const freeVisionOptions = catalog ? catalog.filter(m => m.vision) : DEFAULT_VISION_MODELS.map(id => ({ id, name: id }));
  const visionOptions = [...PAID_VISION_OPTIONS, ...freeVisionOptions];
  const textOptions = catalog ? catalog : DEFAULT_TEXT_MODELS.map(id => ({ id, name: id }));
  const pickedVision = catalog?.find(m => m.id === visionModel.trim());
  const visionWarning = pickedVision && !pickedVision.vision;

  return (
    <div className="animate-in slide-in-from-bottom-4 duration-500 space-y-6">
      <div className="p-5 md:p-8 bg-white/[0.02] border border-white/5 rounded-[2rem] md:rounded-[2.5rem]">
        <div className="flex items-start justify-between gap-6 mb-8 flex-col md:flex-row md:items-center">
          <div>
            <h3 className="text-xl font-serif text-white uppercase tracking-tight flex items-center gap-3">
              <KeyRound className="w-5 h-5 text-luxury-gold" /> Sua Chave de IA
            </h3>
            <p className="text-zinc-500 text-[11px] uppercase font-bold mt-1 tracking-[0.08em] max-w-md">
              A leitura dos cupons roda com a sua própria conta de IA. A chave fica só neste dispositivo, nunca sai daqui.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:flex bg-black/40 p-1 rounded-2xl border border-white/5 mb-6 md:mb-8 gap-1">
          {PROVIDERS.map(p => (
            <button
              key={p.id}
              onClick={() => p.available && setSelectedProvider(p.id)}
              disabled={!p.available}
              className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-[11px] font-bold uppercase tracking-[0.08em] transition-all whitespace-nowrap shrink-0
                ${selectedProvider === p.id ? 'bg-luxury-gold text-black shadow-lg shadow-luxury-gold/20' : 'text-zinc-500 hover:text-white'}
                ${!p.available ? 'opacity-30 cursor-not-allowed' : ''}`}
            >
              {p.label}{!p.available && ' (em breve)'}{active === p.id && storedKeys[p.id] && ' ●'}
            </button>
          ))}
        </div>

        {storedKeys[selectedProvider] ? (
          <div className="flex items-center justify-between gap-4 bg-emerald-950/10 border border-emerald-900/20 rounded-2xl px-6 py-5 mb-6">
            <div className="flex items-center gap-4">
              <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0" />
              <div>
                <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-[0.08em]">Chave salva — {activeProvider.label}</div>
                <div className="font-mono text-xs text-zinc-400 mt-1">{maskKey(storedKeys[selectedProvider]!)}</div>
              </div>
            </div>
            <button
              onClick={() => handleClear(selectedProvider)}
              className="p-3 text-red-500 hover:bg-red-500/10 rounded-xl transition-all shrink-0"
              title="Remover chave"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ) : null}

        {storedKeys[selectedProvider] && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <button
              onClick={handleTest}
              disabled={testState.status === 'testing'}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-[11px] font-bold uppercase tracking-[0.08em] hover:border-luxury-gold/40 transition-all disabled:opacity-50"
            >
              {testState.status === 'testing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 text-luxury-gold" />}
              Testar chave
            </button>
            {active === selectedProvider ? (
              <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold text-[11px] font-bold uppercase tracking-[0.08em]">
                <CircleCheck className="w-4 h-4" /> Em uso para ler cupons
              </div>
            ) : (
              <button
                onClick={handleMakeActive}
                className="py-3 rounded-xl bg-luxury-gold text-black text-[11px] font-bold uppercase tracking-[0.08em] hover:bg-white transition-all"
              >
                Usar {activeProvider.label}
              </button>
            )}
          </div>
        )}

        {testState.status === 'ok' && (
          <div className="mb-6 px-5 py-4 rounded-xl bg-emerald-950/20 border border-emerald-900/30 text-emerald-400 text-xs">{testState.message}</div>
        )}
        {testState.status === 'fail' && (
          <div className="mb-6 px-5 py-4 rounded-xl bg-red-950/20 border border-red-900/30 text-red-300 text-xs break-words">{testState.message}</div>
        )}

        {selectedProvider === 'openrouter' && storedKeys.openrouter && (
          <div className="rounded-2xl border border-white/5 bg-black/20 p-5 mb-6 space-y-5">
            <div>
              <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-[0.08em] mb-2">Modelo para ler cupons</label>
              <input
                list="or-vision-models"
                value={visionModel}
                onChange={(e) => { setVisionModel(e.target.value); setOpenRouterModel('vision', e.target.value); }}
                onBlur={() => setOpenRouterModel('vision', visionModel)}
                placeholder={DEFAULT_VISION_MODELS[0]}
                spellCheck={false}
                className="w-full bg-black/60 border border-white/10 rounded-xl py-3 px-4 text-xs text-zinc-100 focus:border-luxury-gold/50 outline-none font-mono"
              />
              <datalist id="or-vision-models">
                {visionOptions.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </datalist>
              <p className="text-xs text-zinc-500 mt-2 leading-relaxed">Precisa aceitar imagem. Deixe em branco para usar o padrão do app.</p>
              <p className="text-xs text-zinc-500 mt-2 leading-relaxed">Modelos sem <span className="font-mono">:free</span> (como <span className="font-mono">anthropic/claude-haiku-5.5</span>) gastam seus créditos do OpenRouter. O custo de cada pedido aparece em openrouter.ai/activity.</p>
              {visionWarning && (
                <p className="text-xs text-amber-500 mt-2 leading-relaxed">Este modelo não lê imagem, então não serve para cupons. Escolha outro da lista.</p>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-[0.08em] mb-2">Modelo para auditoria e textos</label>
              <input
                list="or-text-models"
                value={textModel}
                onChange={(e) => setTextModel(e.target.value)}
                onBlur={() => setOpenRouterModel('text', textModel)}
                placeholder={DEFAULT_TEXT_MODELS[0]}
                spellCheck={false}
                className="w-full bg-black/60 border border-white/10 rounded-xl py-3 px-4 text-xs text-zinc-100 focus:border-luxury-gold/50 outline-none font-mono"
              />
              <datalist id="or-text-models">
                {textOptions.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </datalist>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <button
                onClick={handleLoadCatalog}
                disabled={catalogState.status === 'loading'}
                className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-[11px] font-bold uppercase tracking-[0.08em] hover:border-luxury-gold/40 transition-all disabled:opacity-50 shrink-0"
              >
                {catalogState.status === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 text-luxury-gold" />}
                Buscar modelos grátis
              </button>
              {catalogState.message && (
                <p className={`text-xs leading-relaxed ${catalogState.status === 'fail' ? 'text-red-400' : 'text-emerald-500'}`}>{catalogState.message}</p>
              )}
            </div>

            <div className="flex items-start gap-3 pt-4 border-t border-white/5">
              <Info className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
              <div className="text-xs text-zinc-500 leading-relaxed space-y-2">
                <p>Modelos grátis têm limite: 20 pedidos por minuto e 50 por dia (1000 por dia com pelo menos 10 créditos comprados no OpenRouter). Modelos pagos não têm esse limite diário.</p>
                <p>Se o modelo escolhido falhar, o app tenta os de reserva e depois o roteador automático <span className="font-mono">openrouter/free</span>.</p>
                <p>Modelos grátis podem registrar o que é enviado. Um cupom inclui CNPJ e endereço do estabelecimento.</p>
              </div>
            </div>
          </div>
        )}

        {!storedKeys[selectedProvider] && (
          <div className="space-y-4 mb-6">
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={activeProvider.placeholder}
                className="w-full bg-black/60 border border-white/10 rounded-xl py-4 pl-4 pr-32 text-sm text-zinc-100 focus:border-luxury-gold/50 outline-none font-mono"
              />
              <button
                onClick={() => setShowKey(s => !s)}
                className="absolute right-16 top-1/2 -translate-y-1/2 p-2 text-zinc-600 hover:text-white transition-colors"
                title={showKey ? 'Ocultar' : 'Mostrar'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button
                onClick={handleSave}
                disabled={!keyInput.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-2 rounded-lg bg-luxury-gold text-black text-[11px] font-bold uppercase tracking-[0.08em] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white transition-all"
              >
                {savedFlash ? <Check className="w-4 h-4" /> : 'Salvar'}
              </button>
            </div>
            <a
              href={activeProvider.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] font-bold text-zinc-500 hover:text-luxury-gold transition-colors"
            >
              <ExternalLink className="w-3 h-3" /> Gerar chave em {activeProvider.label}
            </a>
          </div>
        )}

        <div className="pt-6 border-t border-white/5 text-[11px] text-zinc-500 uppercase tracking-[0.08em] leading-relaxed">
          Claude (Anthropic), Gemini (Google) e OpenRouter são cobrados pela conta de cada provedor. A Anthropic exige créditos pré-pagos no console; o Gemini tem cota gratuita diária; no OpenRouter, os modelos com final :free não têm custo.
        </div>
      </div>
    </div>
  );
};

export default AISettingsPanel;
