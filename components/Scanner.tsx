
import React, { useState, useRef, useEffect } from 'react';
import { QrCode, Camera, ScanLine, Image as ImageIcon, Loader2, AlertCircle, CheckCircle2, RefreshCw, Ban, Keyboard, WifiOff, ShieldAlert, Lock, FileJson, Clock, Download, FileText } from 'lucide-react';
import { GeminiError } from '../services/geminiService';
import { getActiveProvider, getUserApiKey, setActiveProvider, PROVIDER_LABELS, AiProvider } from '../services/keyStorageService';
import { Establishment, MasterProduct } from '../types';
import { diagnostics } from '../services/diagnosticService';
import { downloadFile } from '../services/nativeFiles';
import { nativeScannerSupported, scanWithNativeScanner } from '../services/documentScanner';
import QrReceiptSheet from './QrReceiptSheet';
import { Receipt } from '../types';
import { useScanQueue, startScan, retryFailed, stopScan, dismissScanResults, markScanResultsSeen, MAX_FILES_PER_BATCH, ScanContext } from '../services/scanQueue';

interface ScannerProps {
  // Clique em "Concluir": a leitura já gravou os cupons, aqui só se vai ver o histórico.
  onFinish: () => void;
  onCancel: () => void;
  onManualEntry: () => void; 
  knownEstablishments: string[];
  categories: string[]; 
  // Cadastro do app. Com ele, logo depois da leitura o Scanner procura a loja pelo CNPJ e os itens no catálogo.
  establishments?: Establishment[];
  masterProducts?: MasterProduct[];
  // Cupons lidos pelo QR Code (sem IA): o app grava no histórico.
  onImportReceipts?: (receipts: Receipt[]) => Promise<void> | void;
}

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

const Scanner: React.FC<ScannerProps> = ({ onFinish, onCancel, onManualEntry, knownEstablishments, categories, establishments = [], masterProducts = [], onImportReceipts }) => {
  const [qrOpen, setQrOpen] = useState(false);
  // A leitura roda em segundo plano (services/scanQueue): esta tela só mostra o andamento e continua certa
  // se a pessoa sair e voltar durante o lote.
  const { isProcessing, isStopping, progress, failedItems, savedCount, duplicateCount, batchStop, logs: scannerLogs } = useScanQueue();
  // Scanner de documentos do Android (só no app instalado): texto de andamento enquanto abre,
  // aviso se falhar, e "desligado" para a próxima toque cair na câmera comum.
  const [nativeScanBusy, setNativeScanBusy] = useState<string | null>(null);
  const [nativeScanNotice, setNativeScanNotice] = useState<string | null>(null);
  const [nativeScannerOff, setNativeScannerOff] = useState(false);
  const useNativeScanner = nativeScannerSupported() && !nativeScannerOff;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Abrir esta tela é "ver o resultado": o aviso flutuante das outras abas some.
  useEffect(() => { markScanResultsSeen(); }, [failedItems.length, isProcessing]);

  const scanContext = (): ScanContext => ({ knownEstablishments, categories, establishments, masterProducts });

  const processBatch = (files: FileList | File[]) => {
    const res = startScan(files, scanContext());
    if (!res.ok && res.reason === 'too_many') {
        alert(`Por favor, selecione no máximo ${MAX_FILES_PER_BATCH} arquivos por vez para garantir a estabilidade do estúdio.`);
    }
    // Libera o seletor para escolher os mesmos arquivos de novo depois
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleStopProcessing = () => stopScan();

  const handleCameraClick = async () => {
    if (!useNativeScanner) { cameraInputRef.current?.click(); return; }
    setNativeScanNotice(null);
    setNativeScanBusy('Abrindo o scanner…');
    try {
      const out = await scanWithNativeScanner(setNativeScanBusy);
      if (out.status === 'ok') {
        diagnostics.log('SCANNER', `Scanner de documentos devolveu ${out.files.length} página(s).`);
        processBatch(out.files);
      } else if (out.status === 'unavailable') {
        diagnostics.log('SCANNER', `Scanner de documentos indisponível: ${out.reason}`);
        setNativeScannerOff(true);
        setNativeScanNotice(`Não consegui abrir o scanner de documentos (${out.reason}). Toque em Câmera de novo para usar a câmera comum.`);
      }
    } finally {
      setNativeScanBusy(null);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
        processBatch(files);
    }
  };

  const handleRetry = () => { retryFailed(scanContext()); };

  // Outros provedores com chave salva, para oferecer a troca quando o lote parou por chave/cota.
  const alternativeProviders = batchStop
      ? READING_PROVIDERS.filter(p => p !== getActiveProvider() && getUserApiKey(p))
      : [];

  const handleSwitchProviderAndRetry = (provider: AiProvider) => {
      setActiveProvider(provider);
      handleRetry();
  };

  const handleFinishAndGoToHistory = () => {
      dismissScanResults();
      onFinish();
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
      reportContent += `- Cupons Salvos: ${savedCount}\n`;
      reportContent += `- Cupons que já estavam no histórico: ${duplicateCount}\n`;
      reportContent += `- Cupons com Ocorrências/Falhas: ${failedItems.length}\n`;
      reportContent += `- Total de Arquivos no Lote: ${savedCount + duplicateCount + failedItems.length}\n\n`;
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
                                <span className="text-xs font-bold text-white">{Math.round((progress ? progress.current / progress.total : 0) * 100)}%</span>
                            </div>
                        </div>
                        <div className="w-full bg-zinc-800 rounded-full h-1.5 mb-6 overflow-hidden">
                            <div className="bg-luxury-gold h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress ? (progress.current / progress.total) * 100 : 0}%` }} />
                        </div>
                        <span className="text-zinc-300 text-[11px] tracking-[0.1em] uppercase animate-pulse mb-8 font-bold">
                            {isStopping ? "Finalizando Processo..." : `Sincronizando ${progress?.current}/${progress?.total}`}
                        </span>
                        <button onClick={handleStopProcessing} disabled={isStopping} className="flex items-center gap-2 px-8 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 hover:bg-red-600 hover:text-white transition-all text-[11px] font-bold uppercase tracking-[0.08em] disabled:opacity-50">
                            <Ban className="w-4 h-4" /> Interromper
                        </button>

                        {/* Scanner Live Logs */}
                        <div className="mt-8 w-full max-w-md h-32 overflow-y-auto bg-black/50 border border-white/5 rounded-xl p-4 text-left custom-scrollbar">
                            {scannerLogs.map((log, i) => (
                                <p key={i} className="text-xs text-zinc-500 font-mono mb-1 border-b border-white/5 pb-1 last:border-0">
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
                            <p className="text-[11px] text-zinc-500 uppercase tracking-[0.08em]">Resultado do lote de cupons</p>
                        </div>

                        {/* Summary Metrics */}
                        <div className="grid grid-cols-2 gap-3 mb-6">
                            <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-2xl p-4 text-center">
                                <span className="text-[11px] uppercase tracking-wider text-emerald-500 font-bold block mb-1">Processados com Sucesso</span>
                                <span className="text-2xl font-serif font-bold text-emerald-400">{savedCount}</span>
                                <span className="text-xs text-zinc-500 block mt-1">{savedCount === 1 ? 'cupom salvo' : 'cupons salvos'}{duplicateCount > 0 ? ` (+${duplicateCount} já ${duplicateCount === 1 ? 'existia' : 'existiam'})` : ''}</span>
                            </div>
                            <div className="bg-red-950/20 border border-red-500/20 rounded-2xl p-4 text-center">
                                <span className="text-[11px] uppercase tracking-wider text-red-500 font-bold block mb-1">Ocorrências / Falhas</span>
                                <span className="text-2xl font-serif font-bold text-red-400">{failedItems.length}</span>
                                <span className="text-xs text-zinc-500 block mt-1">não importados</span>
                            </div>
                        </div>

                        {/* Motivo da parada do lote + saída com um toque */}
                        {batchStop && (
                            <div className="mb-6 p-4 rounded-2xl border border-red-500/30 bg-red-950/20 text-left">
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 shrink-0">{getErrorIcon(batchStop.category)}</div>
                                    <div>
                                        <p className="text-[11px] uppercase tracking-[0.08em] font-bold text-red-400 mb-1">Lote interrompido</p>
                                        <p className="text-xs text-zinc-300 leading-snug font-sans normal-case">{batchStop.message}</p>
                                        <p className="text-xs text-zinc-500 leading-snug mt-2 font-sans normal-case">
                                            Os arquivos seguintes não foram enviados à IA. Corrija e toque em Tentar Recuperação para processar todos.
                                        </p>
                                    </div>
                                </div>
                                {alternativeProviders.length > 0 && (
                                    <div className="flex flex-col gap-2 mt-4">
                                        {alternativeProviders.map(p => (
                                            <button key={p} onClick={() => handleSwitchProviderAndRetry(p)} className="w-full bg-luxury-gold hover:bg-zinc-100 text-black font-bold py-3 rounded-xl text-[11px] uppercase tracking-[0.08em] flex items-center justify-center gap-2 transition-all">
                                                <RefreshCw className="w-4 h-4" /> Usar {PROVIDER_LABELS[p]} e reprocessar ({failedItems.length})
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Title of Failures */}
                        <div className="flex items-center justify-between mb-3 px-1">
                            <span className="text-[11px] uppercase tracking-[0.08em] text-zinc-400 font-bold">Detalhamento dos Erros ({failedItems.length})</span>
                            <button 
                                onClick={handleDownloadErrorReport} 
                                className="text-[11px] uppercase tracking-[0.08em] text-luxury-gold hover:text-white font-bold flex items-center gap-1.5 transition-all"
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
                                            <p className="text-[11px] text-zinc-300 truncate font-bold uppercase tracking-wider">{item.file.name}</p>
                                            <p className="text-xs text-zinc-500 leading-snug mt-1 font-sans normal-case">{item.error.message}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-col gap-3">
                            {retryableCount > 0 && (
                                <button onClick={handleRetry} className="w-full bg-luxury-gold hover:bg-zinc-100 hover:text-zinc-900 text-black font-bold py-4 rounded-xl text-[11px] uppercase tracking-[0.08em] flex items-center justify-center gap-2 transition-all shadow-xl shadow-luxury-gold/10">
                                    <RefreshCw className="w-4 h-4" /> Tentar Recuperação ({retryableCount})
                                </button>
                            )}
                            <button onClick={handleFinishAndGoToHistory} className="w-full bg-white hover:bg-zinc-200 text-black font-bold py-4 rounded-xl text-[11px] uppercase tracking-[0.08em] flex items-center justify-center gap-2 transition-all">
                                <CheckCircle2 className="w-4 h-4" /> Concluir e Ir para Histórico
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="w-24 h-24 rounded-3xl bg-zinc-900/50 border border-white/5 flex items-center justify-center mb-10 shadow-inner group-hover:border-luxury-gold/50 transition-all duration-700">
                            <ScanLine className="w-10 h-10 text-luxury-gold" />
                        </div>
                        <h3 className="text-2xl font-serif text-zinc-200 mb-2 uppercase tracking-[0.1em]">Importar Ativos</h3>
                        <p className="text-[11px] text-zinc-500 uppercase tracking-[0.08em] mb-10 font-bold">Selecione cupons para auditoria AI</p>
                        
                        <div className="flex flex-col gap-4 w-full max-w-sm mt-6">
                            <div className="grid grid-cols-2 gap-4">
                                <input type="file" ref={cameraInputRef} onChange={handleFileChange} accept="image/*" capture="environment" className="hidden" />
                                <button onClick={handleCameraClick} disabled={!!nativeScanBusy} data-testid="camera-button" className="bg-luxury-gold hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-60 text-black font-bold text-[11px] uppercase tracking-[0.08em] py-5 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-xl shadow-luxury-gold/10">
                                    {nativeScanBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />} Câmera
                                </button>
                                
                                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" multiple className="hidden" />
                                <button onClick={() => fileInputRef.current?.click()} className="bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 font-bold text-[11px] uppercase tracking-[0.08em] py-5 rounded-2xl transition-all flex items-center justify-center gap-2">
                                    <ImageIcon className="w-4 h-4" /> Galeria
                                </button>
                            </div>

                            {nativeScanBusy && (
                                <p className="text-[11px] text-luxury-gold uppercase tracking-[0.08em] font-bold text-center" data-testid="native-scan-status">{nativeScanBusy}</p>
                            )}
                            {nativeScanNotice && !nativeScanBusy && (
                                <div className="px-4 py-3 rounded-xl bg-amber-950/20 border border-amber-900/30 text-amber-300 text-xs leading-relaxed" data-testid="native-scan-notice">{nativeScanNotice}</div>
                            )}
                            {useNativeScanner && !nativeScanBusy && !nativeScanNotice && (
                                <p className="text-[11px] text-zinc-500 uppercase tracking-[0.08em] font-bold text-center leading-relaxed">
                                    A câmera usa o scanner de documentos: recorta só o cupom e deixa em preto e branco.
                                </p>
                            )}

                            {onImportReceipts && (
                                <button onClick={() => setQrOpen(true)} data-testid="qr-open"
                                    className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 font-bold text-[11px] uppercase tracking-[0.08em] py-4 rounded-2xl transition-all flex items-center justify-center gap-2">
                                    <QrCode className="w-4 h-4" /> Ler pelo QR Code (sem IA)
                                </button>
                            )}
                            <button onClick={onManualEntry} className="w-full bg-transparent hover:bg-white/5 border border-white/5 text-zinc-500 hover:text-white font-bold py-4 rounded-xl text-[11px] uppercase tracking-[0.1em] flex items-center justify-center gap-2 transition-all mt-4">
                                <Keyboard className="w-4 h-4" /> Lançamento Manual
                            </button>
                        </div>
                    </>
                )}
             </div>
             {qrOpen && onImportReceipts && <QrReceiptSheet onImport={onImportReceipts} onClose={() => setQrOpen(false)} />}
        </div>
        
        <div className="mt-12 flex items-center justify-center gap-8 opacity-40">
            <div className="flex flex-col items-center gap-2">
                <FileJson className="w-5 h-5 text-zinc-500" />
                <span className="text-[11px] uppercase font-bold tracking-[0.08em]">JSON Audit</span>
            </div>
            <div className="flex flex-col items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-zinc-500" />
                <span className="text-[11px] uppercase font-bold tracking-[0.08em]">Secure OCR</span>
            </div>
            <div className="flex flex-col items-center gap-2">
                <Clock className="w-5 h-5 text-zinc-500" />
                <span className="text-[11px] uppercase font-bold tracking-[0.08em]">Real-time sync</span>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Scanner;
