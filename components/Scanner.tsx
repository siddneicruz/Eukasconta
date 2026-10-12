
import React, { useState, useRef } from 'react';
import { Camera, Upload, ScanLine, Image as ImageIcon, Loader2, AlertCircle, CheckCircle2, RefreshCw, XCircle, Bug, Ban, Keyboard, WifiOff, ShieldAlert, Lock, FileJson, Clock, Download, FileText } from 'lucide-react';
import { parseReceiptImage, GeminiError } from '../services/geminiService';
import { getActiveProvider, getActiveProviderLabel, getUserApiKey, setActiveProvider, PROVIDER_LABELS, AiProvider } from '../services/keyStorageService';
import { Receipt, Establishment, MasterProduct } from '../types';
import { applyRegistry, buildMasterIndex, learnEstablishment } from '../services/registryLookupService';
import { SCAN_LIMIT_OPENROUTER_MS } from '../services/openrouterService';
import { diagnostics } from '../services/diagnosticService';
import { generateId } from '../services/idUtils';
import { downloadFile } from '../services/nativeFiles';

interface ScannerProps {
  onScanComplete: (receipts: Receipt[]) => void;
  onCancel: () => void;
  onManualEntry: () => void; 
  knownEstablishments: string[];
  categories: string[]; 
  // Cadastro do app. Com ele, logo depois da leitura o Scanner procura a loja pelo CNPJ e os itens no catálogo.
  establishments?: Establishment[];
  masterProducts?: MasterProduct[];
}

interface FailedItem {
    file: File;
    error: GeminiError;
}

const resizeImage = (base64Str: string, maxWidth = 1024, quality = 0.85): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    // Timer de segurança para evitar travamento infinito no carregamento da imagem
    const timeout = setTimeout(() => {
        img.src = ""; // Aborta carregamento
        reject(new Error("Tempo limite de processamento de imagem excedido."));
    }, 10000);

    img.onload = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            reject(new Error("Falha ao inicializar contexto de renderização 2D."));
            return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      } catch (e: any) {
        reject(new Error(`Erro técnico no canvas: ${e.message}`));
      }
    };
    
    img.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("O arquivo de imagem está corrompido, vazio ou em formato não suportado pelo navegador."));
    };
    
    img.src = base64Str;
  });
};

const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') resolve(reader.result);
            else reject(new Error("Falha na decodificação binária do arquivo."));
        };
        reader.onerror = () => reject(new Error("Falha na leitura física do arquivo no disco."));
        reader.readAsDataURL(file);
    });
};

const cleanNumber = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    let str = String(val).trim();
    str = str.replace(/O/gi, '0').replace(/l/g, '1').replace(/I/g, '1');
    str = str.replace(/[R$\s]/g, '');
    if (str.includes(',') && str.includes('.')) {
        str = str.replace(/\./g, ''); 
        str = str.replace(',', '.'); 
    } else if (str.includes(',')) {
        str = str.replace(',', '.');
    }
    str = str.replace(/[^0-9.]/g, '');
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
};

const getErrorIcon = (category: string) => {
    switch (category) {
        case 'NETWORK': return <WifiOff className="w-4 h-4 text-red-400" />;
        case 'AUTH': return <Lock className="w-4 h-4 text-red-500" />;
        case 'SAFETY': return <ShieldAlert className="w-4 h-4 text-orange-500" />;
        case 'PARSING': return <FileJson className="w-4 h-4 text-yellow-500" />;
        case 'QUOTA': return <Clock className="w-4 h-4 text-blue-400" />;
        default: return <AlertCircle className="w-4 h-4 text-red-400" />;
    }
};

// Provedores que de fato leem cupom hoje (OpenAI ainda é só um espaço reservado).
const READING_PROVIDERS: AiProvider[] = ['gemini', 'anthropic', 'openrouter'];

// Erro que vale para o lote inteiro: chave recusada ou cota/crédito esgotado. Continuar só repetiria
// o mesmo erro em cada arquivo (e, em cota diária, gastaria pedidos à toa).
const isBatchStopper = (e: GeminiError): boolean =>
    e.category === 'AUTH' || (e.category === 'QUOTA' && !e.isRetryable);

// Quantas falhas seguidas da IA (já com o pedido enviado) até parar o lote. Se 3 cupons seguidos não
// foram lidos nem com os modelos de reserva, o provedor está lento ou fora do ar: o 4º tende a falhar também.
const MAX_CONSECUTIVE_AI_FAILURES = 3;

const Scanner: React.FC<ScannerProps> = ({ onScanComplete, onCancel, onManualEntry, knownEstablishments, categories, establishments = [], masterProducts = [] }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [progress, setProgress] = useState<{current: number, total: number} | null>(null);
  const [failedItems, setFailedItems] = useState<FailedItem[]>([]);
  const [tempReceipts, setTempReceipts] = useState<Receipt[]>([]);
  const [reportSent, setReportSent] = useState(false);
  const [batchStop, setBatchStop] = useState<GeminiError | null>(null);
  const [scannerLogs, setScannerLogs] = useState<string[]>([]);
  
  const abortProcessingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const cancelRejectRef = useRef<((reason?: any) => void) | null>(null);

  const processBatch = async (files: FileList | File[], isRetry = false) => {
    const totalFiles = files.length;
    if (totalFiles > 300) {
        alert("Por favor, selecione no máximo 300 arquivos por vez para garantir a estabilidade do estúdio.");
        return;
    }

    setIsProcessing(true);
    setIsStopping(false);
    setReportSent(false);
    abortProcessingRef.current = false;
    if (!isRetry) {
        setTempReceipts([]);
    }
    setFailedItems([]); 
    setBatchStop(null);
    setScannerLogs([]);
    setProgress({ current: 0, total: totalFiles });

    const addLog = (msg: string) => {
        setScannerLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
        diagnostics.log('SCANNER', msg);
    };

    addLog(`Iniciando processamento em lote: ${totalFiles} arquivos detectados.`);

    const processedReceipts: Receipt[] = [];
    const currentFailures: FailedItem[] = [];

    // Cadastro do lote: cópia das lojas conhecidas (para o 2º cupom da mesma loja achar o 1º)
    // e catálogo de produtos já preparado uma única vez.
    const batchRegistry: Establishment[] = [...establishments];
    const masterIndex = buildMasterIndex(masterProducts);

    // Para o lote: os arquivos que faltam ficam como "recuperáveis" (Tentar Recuperação), sem serem enviados.
    const stopBatch = (reason: GeminiError, atIndex: number) => {
        for (let j = atIndex + 1; j < totalFiles; j++) {
            currentFailures.push({ file: files[j], error: new GeminiError('Não processado: o lote parou antes de chegar neste arquivo.', reason.category, true) });
        }
        setBatchStop(reason);
        addLog(`Lote interrompido no arquivo ${atIndex + 1}/${totalFiles}. ${totalFiles - atIndex - 1} arquivo(s) não foram enviados à IA.`);
    };
    let aiFailuresInARow = 0;

    for (let i = 0; i < totalFiles; i++) {
        if (abortProcessingRef.current) {
            addLog('Processamento interrompido pelo usuário.');
            break;
        }
        
        const file = files[i];
        let sentToAi = false;
        setProgress({ current: i + 1, total: totalFiles });
        addLog(`Processando arquivo ${i + 1}/${totalFiles}: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);

        try {
            // Check for backup files
            if (file.name.toLowerCase().endsWith('.json') || file.name.toLowerCase().endsWith('.zip')) {
                throw new GeminiError("Arquivos de backup (JSON/ZIP) devem ser importados nas Configurações > Importar.", 'PARSING', false);
            }

            if (!file.type.startsWith('image/')) throw new GeminiError(`Formato '${file.type}' não suportado. Use imagens.`, 'PARSING', false);
            if (file.size > 20 * 1024 * 1024) throw new GeminiError("Arquivo excede limite de 20MB.", 'PARSING', false);

            // ETAPA 1: Leitura do arquivo
            addLog('Lendo arquivo...');
            const rawBase64 = await readFileAsBase64(file);
            
            // ETAPA 2: Otimização para OCR (Redimensionamento inteligente)
            addLog('Otimizando imagem...');
            const optimizedBase64Full = await resizeImage(rawBase64, 1280, 0.80);
            
            const mimeTypeMatch = optimizedBase64Full.match(/^data:(.*?);base64/);
            const finalMimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/jpeg';
            const base64Data = optimizedBase64Full.split(',')[1];

            // ETAPA 3: Envio para Inteligência Artificial com Timeout
            addLog(`Enviando para ${getActiveProviderLabel()} (IA)...`);
            
            // O OpenRouter grátis é lento e já tem controle de tempo próprio; os demais mantêm 90 s.
            const limitMs = getActiveProvider() === 'openrouter' ? SCAN_LIMIT_OPENROUTER_MS : 90000;
            const timeoutPromise = new Promise<never>((_, reject) => 
                setTimeout(() => reject(new GeminiError(`Tempo limite excedido (${Math.round(limitMs / 1000)}s). O cupom é muito longo ou o provedor está lento.`, 'NETWORK', true)), limitMs)
            );

            const cancelPromise = new Promise<never>((_, reject) => {
                cancelRejectRef.current = reject;
            });

            sentToAi = true;
            const extractedData = await Promise.race([
                parseReceiptImage(base64Data, finalMimeType, knownEstablishments, categories),
                timeoutPromise,
                cancelPromise
            ]) as Partial<Receipt>;
            
            cancelRejectRef.current = null; // Clear after success
            
            if (abortProcessingRef.current) break; // Stop immediately if cancelled during await

            addLog('Dados extraídos com sucesso. Processando itens...');
            let rawItems = extractedData.items || [];
            let calculatedItems = rawItems.map(item => {
                let q = cleanNumber(item.quantity);
                let u = cleanNumber(item.unitPrice);
                let t = cleanNumber(item.totalPrice);
                if (q <= 0) q = 1; 
                return { ...item, quantity: q, unitPrice: u, totalPrice: t };
            });

            calculatedItems = calculatedItems.map(item => {
                let { quantity: q, unitPrice: u, totalPrice: t } = item;
                if (t === 0 && u > 0) t = Number((q * u).toFixed(2));
                else if (u === 0 && t > 0) u = Number((t / q).toFixed(2));
                return { ...item, quantity: q, unitPrice: u, totalPrice: t };
            });

            let receiptTotal = cleanNumber(extractedData.totalAmount);
            const itemsSum = calculatedItems.reduce((acc, i) => acc + i.totalPrice, 0);

            if (receiptTotal === 0 && itemsSum > 0) receiptTotal = Number(itemsSum.toFixed(2));

            const newReceipt: Receipt = {
                id: generateId(),
                establishmentName: extractedData.establishmentName || "Estabelecimento Desconhecido",
                cnpj: extractedData.cnpj || "",
                address: extractedData.address || "",
                city: extractedData.city || "",
                state: (extractedData.state || "").toUpperCase().substring(0, 2),
                date: extractedData.date || new Date().toISOString().split('T')[0],
                time: extractedData.time || "12:00", 
                totalAmount: receiptTotal || 0,
                items: calculatedItems,
                scannedAt: new Date().toISOString()
            };
            
            // ETAPA 4: Consulta ao cadastro (loja pelo CNPJ; itens pelo catálogo de produtos)
            const registry = applyRegistry(newReceipt, { establishments: batchRegistry, masterIndex, categories });
            registry.notes.forEach(addLog);
            learnEstablishment(batchRegistry, registry);

            processedReceipts.push(registry.receipt);
            aiFailuresInARow = 0;
            addLog(`Sucesso: ${file.name} - Total: R$ ${registry.receipt.totalAmount}`);
            
        } catch (err: any) {
            if (abortProcessingRef.current) break;
            const errorObj = err instanceof GeminiError ? err : new GeminiError(err.message || "Erro inesperado de hardware/rede.", 'UNKNOWN', true, err);
            if (isBatchStopper(errorObj)) {
                // O lote para aqui. Este arquivo e os que faltavam ficam como "recuperáveis": depois de
                // corrigir a chave (ou trocar de provedor), "Tentar Recuperação" processa todos de novo.
                currentFailures.push({ file, error: new GeminiError(errorObj.message, errorObj.category, true, err) });
                addLog(`ERRO em ${file.name}: ${errorObj.message}`);
                stopBatch(errorObj, i);
                break;
            }
            currentFailures.push({ file, error: errorObj });
            addLog(`ERRO em ${file.name}: ${errorObj.message}`);

            if (sentToAi) aiFailuresInARow++;
            if (aiFailuresInARow >= MAX_CONSECUTIVE_AI_FAILURES && i < totalFiles - 1) {
                stopBatch(new GeminiError(
                    `A IA falhou em ${aiFailuresInARow} cupons seguidos, então o lote foi interrompido para não perder tempo nem cota à toa. Costuma ser lentidão ou instabilidade do provedor naquele momento. Tente de novo daqui a alguns minutos, escolha outro modelo em Config ou use outro provedor.`,
                    'NETWORK', true, err), i);
                break;
            }
        }
    }

    setIsProcessing(false);
    setIsStopping(false);
    setProgress(null);

    if (currentFailures.length > 0) {
        setFailedItems(currentFailures);
        if (processedReceipts.length > 0) {
            setTempReceipts(prev => [...prev, ...processedReceipts]);
        }
    } else {
        if (processedReceipts.length > 0) {
            setTempReceipts(prev => {
                const updated = [...prev, ...processedReceipts];
                onScanComplete(updated);
                return [];
            });
        } else {
            if (tempReceipts.length > 0) {
                onScanComplete(tempReceipts);
                setTempReceipts([]);
            }
        }
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleStopProcessing = () => {
      abortProcessingRef.current = true;
      setIsStopping(true);
      if (cancelRejectRef.current) {
          cancelRejectRef.current(new Error("Processamento interrompido pelo usuário."));
          cancelRejectRef.current = null;
      }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
        processBatch(files);
    }
  };

  const handleRetry = () => {
      const filesToRetry = failedItems.filter(i => i.error.isRetryable).map(item => item.file);
      if (filesToRetry.length === 0) return;
      processBatch(filesToRetry, true);
  };

  // Outros provedores com chave salva, para oferecer a troca quando o lote parou por chave/cota.
  const alternativeProviders = batchStop
      ? READING_PROVIDERS.filter(p => p !== getActiveProvider() && getUserApiKey(p))
      : [];

  const handleSwitchProviderAndRetry = (provider: AiProvider) => {
      setActiveProvider(provider);
      handleRetry();
  };

  const handleFinishAndGoToHistory = () => {
      onScanComplete(tempReceipts);
      setTempReceipts([]);
      setFailedItems([]);
  };

  const handleDownloadErrorReport = () => {
      if (failedItems.length === 0) return;

      const now = new Date();
      const formattedDate = now.toLocaleString('pt-BR');

      let reportContent = `================================================================================\n`;
      reportContent += `RELATÓRIO DE ERROS DE IMPORTAÇÃO - EUKASCONTA DESIGN STUDIO\n`;
      reportContent += `Gerado em: ${formattedDate}\n`;
      reportContent += `================================================================================\n\n`;
      reportContent += `RESUMO DO PROCESSAMENTO:\n`;
      reportContent += `- Cupons Processados com Sucesso: ${tempReceipts.length}\n`;
      reportContent += `- Cupons com Ocorrências/Falhas: ${failedItems.length}\n`;
      reportContent += `- Total de Arquivos no Lote: ${tempReceipts.length + failedItems.length}\n\n`;
      reportContent += `--------------------------------------------------------------------------------\n`;
      reportContent += `DETALHES DOS ERROS POR ARQUIVO:\n`;
      reportContent += `--------------------------------------------------------------------------------\n\n`;

      failedItems.forEach((item, idx) => {
          reportContent += `[${idx + 1}] ARQUIVO: ${item.file.name}\n`;
          reportContent += `    Tamanho: ${(item.file.size / 1024).toFixed(2)} KB\n`;
          reportContent += `    Categoria do Erro: ${item.error.category || 'DESCONHECIDA'}\n`;
          reportContent += `    Mensagem de Erro: ${item.error.message || 'Sem mensagem adicional.'}\n`;
          reportContent += `    Recuperável (Geralmente falha de conexão/cota): ${item.error.isRetryable ? 'Sim' : 'Não'}\n`;
          reportContent += `--------------------------------------------------------------------------------\n\n`;
      });

      reportContent += `Eukasconta Design Studio - Inteligência Tributária de Alta Performance.\n`;
      reportContent += `Fim do Relatório.`;

      const blob = new Blob([reportContent], { type: 'text/plain;charset=utf-8;' });
      const fileDate = now.toISOString().split('T')[0].replace(/-/g, '');
      const fileTime = now.toTimeString().split(' ')[0].replace(/:/g, '');
      downloadFile(blob, `relatorio_erros_${fileDate}_${fileTime}.txt`).catch(() => { /* sem permissão para compartilhar */ });
  };

  const retryableCount = failedItems.filter(i => i.error.isRetryable).length;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] animate-in fade-in duration-700">
      <div className="w-full max-w-4xl text-center">
        <h2 className="text-4xl md:text-6xl font-serif font-medium text-white mb-4 tracking-tight">
          ESCANEAR <span className="italic font-light text-luxury-gold">CUPOM</span>
        </h2>
        <p className="text-zinc-500 font-sans tracking-wide mb-12 text-sm md:text-base">
          Extração de alta performance para o Estúdio de Design.
        </p>

        <div className="relative group max-w-2xl mx-auto">
             <div className="absolute -inset-0.5 bg-gradient-to-r from-luxury-gold/30 to-zinc-800/30 rounded-3xl blur opacity-30 group-hover:opacity-50 transition duration-1000 pointer-events-none"></div>
             <div className="relative bg-black border border-white/10 rounded-2xl p-8 md:p-20 flex flex-col items-center justify-center min-h-[320px]">
                {isProcessing ? (
                     <div className="flex flex-col items-center w-full max-w-xs">
                        <div className="relative mb-10">
                            <Loader2 className="w-16 h-16 text-luxury-gold animate-spin" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-[10px] font-bold text-white">{Math.round((progress ? progress.current / progress.total : 0) * 100)}%</span>
                            </div>
                        </div>
                        <div className="w-full bg-zinc-800 rounded-full h-1.5 mb-6 overflow-hidden">
                            <div className="bg-luxury-gold h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress ? (progress.current / progress.total) * 100 : 0}%` }} />
                        </div>
                        <span className="text-zinc-300 text-[10px] tracking-[0.3em] uppercase animate-pulse mb-8 font-bold">
                            {isStopping ? "Finalizando Processo..." : `Sincronizando ${progress?.current}/${progress?.total}`}
                        </span>
                        <button onClick={handleStopProcessing} disabled={isStopping} className="flex items-center gap-2 px-8 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 hover:bg-red-600 hover:text-white transition-all text-[10px] font-bold uppercase tracking-widest disabled:opacity-50">
                            <Ban className="w-4 h-4" /> Interromper
                        </button>

                        {/* Scanner Live Logs */}
                        <div className="mt-8 w-full max-w-md h-32 overflow-y-auto bg-black/50 border border-white/5 rounded-xl p-4 text-left custom-scrollbar">
                            {scannerLogs.map((log, i) => (
                                <p key={i} className="text-[9px] text-zinc-500 font-mono mb-1 border-b border-white/5 pb-1 last:border-0">
                                    {log}
                                </p>
                            ))}
                            <div ref={(el) => el?.scrollIntoView({ behavior: 'smooth' })} />
                        </div>
                     </div>
                ) : failedItems.length > 0 ? (
                    <div className="w-full max-w-md animate-in zoom-in-95 duration-300">
                        <div className="flex flex-col items-center mb-6">
                            <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mb-4 border border-white/10 shadow-xl shadow-black/40">
                                <FileText className="w-8 h-8 text-luxury-gold" />
                            </div>
                            <h3 className="text-xl font-serif text-white mb-1 uppercase tracking-tight">Processamento Concluído</h3>
                            <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Resultado do lote de cupons</p>
                        </div>

                        {/* Summary Metrics */}
                        <div className="grid grid-cols-2 gap-3 mb-6">
                            <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-2xl p-4 text-center">
                                <span className="text-[9px] uppercase tracking-wider text-emerald-500 font-bold block mb-1">Processados com Sucesso</span>
                                <span className="text-2xl font-serif font-bold text-emerald-400">{tempReceipts.length}</span>
                                <span className="text-[9px] text-zinc-500 block mt-1">cupons salvos</span>
                            </div>
                            <div className="bg-red-950/20 border border-red-500/20 rounded-2xl p-4 text-center">
                                <span className="text-[9px] uppercase tracking-wider text-red-500 font-bold block mb-1">Ocorrências / Falhas</span>
                                <span className="text-2xl font-serif font-bold text-red-400">{failedItems.length}</span>
                                <span className="text-[9px] text-zinc-500 block mt-1">não importados</span>
                            </div>
                        </div>

                        {/* Motivo da parada do lote + saída com um toque */}
                        {batchStop && (
                            <div className="mb-6 p-4 rounded-2xl border border-red-500/30 bg-red-950/20 text-left">
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 shrink-0">{getErrorIcon(batchStop.category)}</div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-widest font-bold text-red-400 mb-1">Lote interrompido</p>
                                        <p className="text-[11px] text-zinc-300 leading-snug font-sans normal-case">{batchStop.message}</p>
                                        <p className="text-[10px] text-zinc-500 leading-snug mt-2 font-sans normal-case">
                                            Os arquivos seguintes não foram enviados à IA. Corrija e toque em Tentar Recuperação para processar todos.
                                        </p>
                                    </div>
                                </div>
                                {alternativeProviders.length > 0 && (
                                    <div className="flex flex-col gap-2 mt-4">
                                        {alternativeProviders.map(p => (
                                            <button key={p} onClick={() => handleSwitchProviderAndRetry(p)} className="w-full bg-luxury-gold hover:bg-zinc-100 text-black font-bold py-3 rounded-xl text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all">
                                                <RefreshCw className="w-4 h-4" /> Usar {PROVIDER_LABELS[p]} e reprocessar ({failedItems.length})
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Title of Failures */}
                        <div className="flex items-center justify-between mb-3 px-1">
                            <span className="text-[9px] uppercase tracking-widest text-zinc-400 font-bold">Detalhamento dos Erros ({failedItems.length})</span>
                            <button 
                                onClick={handleDownloadErrorReport} 
                                className="text-[9px] uppercase tracking-widest text-luxury-gold hover:text-white font-bold flex items-center gap-1.5 transition-all"
                            >
                                <Download className="w-3.5 h-3.5" /> Baixar Relatório
                            </button>
                        </div>

                        {/* List of failures */}
                        <div className="bg-zinc-900/50 rounded-2xl border border-white/5 mb-6 max-h-[200px] overflow-y-auto custom-scrollbar p-2">
                            {failedItems.map((item, idx) => (
                                <div key={idx} className="flex items-start justify-between p-3 border-b border-white/5 last:border-0 bg-white/[0.01] rounded-xl mb-1">
                                    <div className="flex items-start gap-3 overflow-hidden">
                                        <div className="mt-0.5 shrink-0">{getErrorIcon(item.error.category)}</div>
                                        <div className="text-left overflow-hidden">
                                            <p className="text-[10px] text-zinc-300 truncate font-bold uppercase tracking-wider">{item.file.name}</p>
                                            <p className="text-[9px] text-zinc-500 leading-snug mt-1 font-sans normal-case">{item.error.message}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-col gap-3">
                            {retryableCount > 0 && (
                                <button onClick={handleRetry} className="w-full bg-luxury-gold hover:bg-zinc-100 hover:text-zinc-900 text-black font-bold py-4 rounded-xl text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-xl shadow-luxury-gold/10">
                                    <RefreshCw className="w-4 h-4" /> Tentar Recuperação ({retryableCount})
                                </button>
                            )}
                            <button onClick={handleFinishAndGoToHistory} className="w-full bg-white hover:bg-zinc-200 text-black font-bold py-4 rounded-xl text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all">
                                <CheckCircle2 className="w-4 h-4" /> Concluir e Ir para Histórico
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="w-24 h-24 rounded-3xl bg-zinc-900/50 border border-white/5 flex items-center justify-center mb-10 shadow-inner group-hover:border-luxury-gold/50 transition-all duration-700">
                            <ScanLine className="w-10 h-10 text-luxury-gold" />
                        </div>
                        <h3 className="text-2xl font-serif text-zinc-200 mb-2 uppercase tracking-[0.2em]">Importar Ativos</h3>
                        <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-10 font-bold">Selecione cupons para auditoria AI</p>
                        
                        <div className="flex flex-col gap-4 w-full max-w-sm mt-6">
                            <div className="grid grid-cols-2 gap-4">
                                <input type="file" ref={cameraInputRef} onChange={handleFileChange} accept="image/*" capture="environment" className="hidden" />
                                <button onClick={() => cameraInputRef.current?.click()} className="bg-luxury-gold hover:bg-zinc-100 hover:text-zinc-900 text-black font-bold text-[10px] uppercase tracking-widest py-5 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-xl shadow-luxury-gold/10">
                                    <Camera className="w-4 h-4" /> Câmera
                                </button>
                                
                                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" multiple className="hidden" />
                                <button onClick={() => fileInputRef.current?.click()} className="bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 font-bold text-[10px] uppercase tracking-widest py-5 rounded-2xl transition-all flex items-center justify-center gap-2">
                                    <ImageIcon className="w-4 h-4" /> Galeria
                                </button>
                            </div>
                            
                            <button onClick={onManualEntry} className="w-full bg-transparent hover:bg-white/5 border border-white/5 text-zinc-600 hover:text-white font-bold py-4 rounded-xl text-[9px] uppercase tracking-[0.3em] flex items-center justify-center gap-2 transition-all mt-4">
                                <Keyboard className="w-4 h-4" /> Lançamento Manual
                            </button>
                        </div>
                    </>
                )}
             </div>
        </div>
        
        <div className="mt-12 flex items-center justify-center gap-8 opacity-40">
            <div className="flex flex-col items-center gap-2">
                <FileJson className="w-5 h-5 text-zinc-500" />
                <span className="text-[8px] uppercase font-bold tracking-widest">JSON Audit</span>
            </div>
            <div className="flex flex-col items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-zinc-500" />
                <span className="text-[8px] uppercase font-bold tracking-widest">Secure OCR</span>
            </div>
            <div className="flex flex-col items-center gap-2">
                <Clock className="w-5 h-5 text-zinc-500" />
                <span className="text-[8px] uppercase font-bold tracking-widest">Real-time sync</span>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Scanner;
