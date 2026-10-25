// Leitura de cupons em segundo plano.
//
// O lote vive aqui, fora de qualquer tela: trocar de aba (ou fechar a tela do Scanner) não interrompe a
// leitura. O Scanner e o indicador de progresso só mostram o andamento deste módulo. Cada cupom lido é
// gravado no histórico na hora (pelo `commit` que o App registra), então nada se perde se o app fechar
// no meio de um lote grande.
import { useSyncExternalStore } from 'react';
import { Receipt, ReceiptItem, Establishment, MasterProduct } from '../types';
import { isEggItem, cleanEggCount } from './eggs';
import { parseReceiptImage, GeminiError } from './geminiService';
import { getActiveProvider, getActiveProviderLabel } from './keyStorageService';
import { applyRegistry, buildMasterIndex, learnEstablishment } from './registryLookupService';
import { cleanCode, splitLeadingCode } from './productCodes';
import { SCAN_LIMIT_OPENROUTER_MS } from './openrouterService';
import { diagnostics } from './diagnosticService';
import { generateId } from './idUtils';
import { normalizeReceiptDate } from './productNormalization';

export interface FailedItem {
  file: File;
  error: GeminiError;
}

export interface ScanContext {
  knownEstablishments: string[];
  categories: string[];
  establishments: Establishment[];
  masterProducts: MasterProduct[];
}

export interface ScanSnapshot {
  isProcessing: boolean;
  isStopping: boolean;
  progress: { current: number; total: number } | null;
  failedItems: FailedItem[];
  /** cupons novos gravados no histórico neste lote (soma as tentativas de recuperação) */
  savedCount: number;
  /** cupons lidos que já estavam no histórico */
  duplicateCount: number;
  batchStop: GeminiError | null;
  logs: string[];
  /** a pessoa já viu o resultado com falhas (o aviso flutuante some) */
  resultsSeen: boolean;
}

export interface ScanSummary {
  /** cupons novos gravados nesta rodada */
  added: Receipt[];
  /** lidos nesta rodada, mas já existentes no histórico */
  duplicates: number;
  /** arquivos que ainda estão com falha ao fim da rodada */
  failed: number;
  /** a pessoa apertou Interromper */
  interrupted: boolean;
  /** o lote parou sozinho (chave recusada, cota ou falhas seguidas) */
  stopped: boolean;
}

export interface ScanHandlers {
  /** grava o cupom no histórico; true = era novo, false = já existia */
  commit: (receipt: Receipt) => boolean;
  /** terminou uma rodada de leitura */
  onFinish: (summary: ScanSummary) => void;
}

export const MAX_FILES_PER_BATCH = 300;

const INITIAL: ScanSnapshot = {
  isProcessing: false,
  isStopping: false,
  progress: null,
  failedItems: [],
  savedCount: 0,
  duplicateCount: 0,
  batchStop: null,
  logs: [],
  resultsSeen: true,
};

let snap: ScanSnapshot = INITIAL;
const listeners = new Set<() => void>();
let handlers: ScanHandlers | null = null;
const unsaved: Receipt[] = [];          // lidos antes de o App registrar o `commit` (não deve acontecer)
let abortRequested = false;
let cancelCurrent: ((reason?: unknown) => void) | null = null;

const emit = (patch: Partial<ScanSnapshot>) => {
  snap = { ...snap, ...patch };
  listeners.forEach(l => l());
};

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => snap;

export const useScanQueue = (): ScanSnapshot => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export const setScanHandlers = (h: ScanHandlers | null) => {
  handlers = h;
  if (h && unsaved.length > 0) unsaved.splice(0).forEach(r => h.commit(r));
};

/* ── utilidades de imagem e número ── */

const resizeImage = (base64Str: string, maxWidth = 1024, quality = 0.85, rotate: 0 | 90 | -90 = 0): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    // Evita travar para sempre se a imagem não carregar
    const timeout = setTimeout(() => {
      img.src = '';
      reject(new Error('Tempo limite de processamento de imagem excedido.'));
    }, 10000);

    img.onload = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        // foto de cupom deitada: gira 90° para o cupom ficar em pé (o navegador já respeita o giro gravado na foto)
        let width = rotate === 0 ? img.width : img.height;
        let height = rotate === 0 ? img.height : img.width;
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Falha ao inicializar contexto de renderização 2D.')); return; }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        if (rotate === 0) ctx.drawImage(img, 0, 0, width, height);
        else {
          ctx.translate(width / 2, height / 2);
          ctx.rotate((rotate * Math.PI) / 180);
          // depois de girar, a largura desenhada é a altura final e vice-versa
          ctx.drawImage(img, -height / 2, -width / 2, height, width);
        }
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e: any) {
        reject(new Error(`Erro técnico no canvas: ${e.message}`));
      }
    };
    img.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('O arquivo de imagem está corrompido, vazio ou em formato não suportado pelo navegador.'));
    };
    img.src = base64Str;
  });

/** A foto está deitada (mais larga que alta)? Cupom é comprido: assim a foto veio girada. */
const isLandscape = (base64Str: string): Promise<boolean> =>
  new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img.width > img.height * 1.15);
    img.onerror = () => resolve(false);
    img.src = base64Str;
  });

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Falha na decodificação binária do arquivo.'));
    };
    reader.onerror = () => reject(new Error('Falha na leitura física do arquivo no disco.'));
    reader.readAsDataURL(file);
  });

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

// Erro que vale para o lote inteiro: chave recusada ou cota/crédito esgotado. Continuar só repetiria
// o mesmo erro em cada arquivo (e, em cota diária, gastaria pedidos à toa).
const isBatchStopper = (e: GeminiError): boolean =>
  e.category === 'AUTH' || (e.category === 'QUOTA' && !e.isRetryable);

// Quantas falhas seguidas da IA (já com o pedido enviado) até parar o lote. Se 3 cupons seguidos não
// foram lidos nem com os modelos de reserva, o provedor está lento ou fora do ar: o 4º tende a falhar também.
const MAX_CONSECUTIVE_AI_FAILURES = 3;

const addLog = (msg: string) => {
  diagnostics.log('SCANNER', msg);
  emit({ logs: [...snap.logs.slice(-199), `[${new Date().toLocaleTimeString()}] ${msg}`] });
};

/* ── comandos ── */

export interface StartResult { ok: boolean; reason?: 'busy' | 'too_many' | 'empty' }

/** Começa a ler os arquivos em segundo plano. `retry` mantém o que já foi gravado e as falhas sem nova tentativa. */
export const startScan = (input: FileList | File[], ctx: ScanContext, opts: { retry?: boolean } = {}): StartResult => {
  const files = Array.from(input);
  if (files.length === 0) return { ok: false, reason: 'empty' };
  if (snap.isProcessing) return { ok: false, reason: 'busy' };
  if (files.length > MAX_FILES_PER_BATCH) return { ok: false, reason: 'too_many' };
  void runBatch(files, ctx, !!opts.retry);
  return { ok: true };
};

/** Tenta de novo só as falhas que valem a pena repetir. */
export const retryFailed = (ctx: ScanContext): StartResult => {
  const files = snap.failedItems.filter(i => i.error.isRetryable).map(i => i.file);
  return startScan(files, ctx, { retry: true });
};

export const stopScan = () => {
  if (!snap.isProcessing) return;
  abortRequested = true;
  emit({ isStopping: true });
  if (cancelCurrent) { cancelCurrent(new Error('Processamento interrompido pelo usuário.')); cancelCurrent = null; }
};

/** Fecha o resultado do lote (a tela volta ao começo). O que foi lido já está no histórico. */
export const dismissScanResults = () => {
  if (snap.isProcessing) return;
  emit({ failedItems: [], savedCount: 0, duplicateCount: 0, batchStop: null, resultsSeen: true });
};

/** A pessoa abriu o Scanner e viu o resultado. */
export const markScanResultsSeen = () => {
  if (!snap.resultsSeen) emit({ resultsSeen: true });
};

/* ── o lote ── */

const runBatch = async (files: File[], ctx: ScanContext, isRetry: boolean) => {
  const totalFiles = files.length;
  abortRequested = false;
  cancelCurrent = null;

  const carried = isRetry ? snap.failedItems.filter(i => !i.error.isRetryable) : [];
  emit({
    isProcessing: true,
    isStopping: false,
    progress: { current: 0, total: totalFiles },
    failedItems: [],
    batchStop: null,
    logs: [],
    resultsSeen: true,
    ...(isRetry ? {} : { savedCount: 0, duplicateCount: 0 }),
  });
  addLog(`Iniciando processamento em lote: ${totalFiles} arquivos detectados.`);

  const added: Receipt[] = [];
  let duplicates = 0;
  const currentFailures: FailedItem[] = [];
  let stoppedByItself = false;
  let batchStop: GeminiError | null = null;

  // Cadastro do lote: cópia das lojas conhecidas (para o 2º cupom da mesma loja achar o 1º)
  // e catálogo de produtos já preparado uma única vez.
  const batchRegistry: Establishment[] = [...ctx.establishments];
  const masterIndex = buildMasterIndex(ctx.masterProducts);

  // Para o lote: os arquivos que faltam ficam como "recuperáveis" (Tentar Recuperação), sem serem enviados.
  const stopBatch = (reason: GeminiError, atIndex: number) => {
    for (let j = atIndex + 1; j < totalFiles; j++) {
      currentFailures.push({ file: files[j], error: new GeminiError('Não processado: o lote parou antes de chegar neste arquivo.', reason.category, true) });
    }
    batchStop = reason;
    stoppedByItself = true;
    addLog(`Lote interrompido no arquivo ${atIndex + 1}/${totalFiles}. ${totalFiles - atIndex - 1} arquivo(s) não foram enviados à IA.`);
  };
  let aiFailuresInARow = 0;

  for (let i = 0; i < totalFiles; i++) {
    if (abortRequested) { addLog('Processamento interrompido pelo usuário.'); break; }

    const file = files[i];
    let sentToAi = false;
    emit({ progress: { current: i + 1, total: totalFiles } });
    addLog(`Processando arquivo ${i + 1}/${totalFiles}: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);

    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      if (file.name.toLowerCase().endsWith('.json') || file.name.toLowerCase().endsWith('.zip')) {
        throw new GeminiError('Arquivos de backup (JSON/ZIP) devem ser importados nas Configurações > Importar.', 'PARSING', false);
      }
      if (!file.type.startsWith('image/')) throw new GeminiError(`Formato '${file.type}' não suportado. Use imagens.`, 'PARSING', false);
      if (file.size > 20 * 1024 * 1024) throw new GeminiError('Arquivo excede limite de 20MB.', 'PARSING', false);

      // ETAPA 1: leitura do arquivo
      addLog('Lendo arquivo...');
      const rawBase64 = await readFileAsBase64(file);

      // Foto deitada: tenta com o cupom girado para um lado e, se a leitura vier vazia ou quebrada, para o outro.
      const landscape = await isLandscape(rawBase64);
      const turns: (0 | 90 | -90)[] = landscape ? [-90, 90] : [0];
      let extractedData: Partial<Receipt> | undefined;
      let lastReadError: GeminiError | undefined;
      for (let t = 0; t < turns.length; t++) {
        // ETAPA 2: otimização para OCR (redimensionamento)
        addLog(landscape ? `Foto deitada: girando o cupom (${t === 0 ? 'um lado' : 'o outro lado'})...` : 'Otimizando imagem...');
        const optimizedBase64Full = await resizeImage(rawBase64, 1280, 0.80, turns[t]);
        const mimeTypeMatch = optimizedBase64Full.match(/^data:(.*?);base64/);
        const finalMimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/jpeg';
        const base64Data = optimizedBase64Full.split(',')[1];

        // ETAPA 3: envio para a IA, com limite de tempo
        addLog(`Enviando para ${getActiveProviderLabel()} (IA)...`);
        // O OpenRouter grátis é lento e já tem controle de tempo próprio; os demais mantêm 90 s.
        const limitMs = getActiveProvider() === 'openrouter' ? SCAN_LIMIT_OPENROUTER_MS : 90000;
        if (timer) clearTimeout(timer);
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new GeminiError(`Tempo limite excedido (${Math.round(limitMs / 1000)}s). O cupom é muito longo ou o provedor está lento.`, 'NETWORK', true)), limitMs);
        });
        const cancelPromise = new Promise<never>((_, reject) => { cancelCurrent = reject; });

        sentToAi = true;
        try {
          const got = await Promise.race([
            parseReceiptImage(base64Data, finalMimeType, ctx.knownEstablishments, ctx.categories),
            timeoutPromise,
            cancelPromise,
          ]) as Partial<Receipt>;
          if (abortRequested) break;
          if ((got.items || []).length > 0 || cleanNumber(got.totalAmount) > 0) { extractedData = got; break; }
          lastReadError = new GeminiError('A leitura veio vazia.', 'PARSING', true);
        } catch (e: any) {
          const ge = e instanceof GeminiError ? e : null;
          // só vale girar para o outro lado quando o problema foi a leitura em si
          if (!ge || ge.category !== 'PARSING' || t === turns.length - 1) throw e;
          lastReadError = ge;
        }
      }
      if (abortRequested) break;
      if (!extractedData) throw lastReadError || new GeminiError('A leitura veio vazia.', 'PARSING', true);

      cancelCurrent = null;
      if (abortRequested) break;   // cancelado durante a espera: descarta esta leitura

      addLog('Dados extraídos com sucesso. Processando itens...');
      const rawItems = extractedData.items || [];
      let calculatedItems = rawItems.map(raw => {
        // Modelo que deixou o código colado no começo do nome: separa os dois. O código lido é limpo (sem espaço, ponto ou traço).
        const item = splitLeadingCode(raw);
        let q = cleanNumber(item.quantity);
        const u = cleanNumber(item.unitPrice);
        const t = cleanNumber(item.totalPrice);
        if (q <= 0) q = 1;
        // Ovo: guarda quantos ovos vêm na embalagem só quando a leitura trouxe um número que vale (0 = a linha não dizia)
        const eggs = isEggItem(item) ? cleanEggCount(item.eggCount) : undefined;
        const read: ReceiptItem = { ...item, code: cleanCode(item.code) || undefined, quantity: q, unitPrice: u, totalPrice: t };
        if (eggs) read.eggCount = eggs; else delete read.eggCount;
        return read;
      });
      calculatedItems = calculatedItems.map(item => {
        const q = item.quantity;
        let u = item.unitPrice;
        let t = item.totalPrice;
        if (t === 0 && u > 0) t = Number((q * u).toFixed(2));
        else if (u === 0 && t > 0) u = Number((t / q).toFixed(2));
        return { ...item, quantity: q, unitPrice: u, totalPrice: t };
      });

      let receiptTotal = cleanNumber(extractedData.totalAmount);
      const itemsSum = calculatedItems.reduce((acc, it) => acc + it.totalPrice, 0);
      if (receiptTotal === 0 && itemsSum > 0) receiptTotal = Number(itemsSum.toFixed(2));

      // Leitura vazia (nenhum item e nenhum valor): não vira cupom "Estabelecimento Desconhecido" de R$ 0,00 no histórico.
      // Entra na lista de falhas, com opção de tentar de novo.
      if (calculatedItems.length === 0 && receiptTotal <= 0) {
        throw new GeminiError('A leitura veio vazia: não achou nenhum item nem valor neste cupom, por isso ele não foi salvo. Tire outra foto com o cupom inteiro, reto e bem iluminado, ou tente outro modelo em Config.', 'PARSING', true);
      }

      const newReceipt: Receipt = {
        id: generateId(),
        establishmentName: extractedData.establishmentName || 'Estabelecimento Desconhecido',
        cnpj: extractedData.cnpj || '',
        address: extractedData.address || '',
        city: extractedData.city || '',
        state: (extractedData.state || '').toUpperCase().substring(0, 2),
        date: normalizeReceiptDate(extractedData.date || ''),
        time: extractedData.time || '12:00',
        totalAmount: receiptTotal || 0,
        items: calculatedItems,
        scannedAt: new Date().toISOString(),
      };

      // ETAPA 4: consulta ao cadastro (loja pelo CNPJ; itens pelo catálogo de produtos)
      const registry = applyRegistry(newReceipt, { establishments: batchRegistry, masterIndex, categories: ctx.categories });
      registry.notes.forEach(addLog);
      learnEstablishment(batchRegistry, registry);

      // ETAPA 5: grava no histórico já, sem esperar o fim do lote
      let isNew = true;
      if (handlers) isNew = handlers.commit(registry.receipt);
      else unsaved.push(registry.receipt);
      if (isNew) { added.push(registry.receipt); emit({ savedCount: snap.savedCount + 1 }); }
      else { duplicates++; emit({ duplicateCount: snap.duplicateCount + 1 }); }

      aiFailuresInARow = 0;
      addLog(`${isNew ? 'Salvo' : 'Já estava no histórico'}: ${file.name} - Total: R$ ${registry.receipt.totalAmount}`);
    } catch (err: any) {
      if (abortRequested) break;
      const errorObj = err instanceof GeminiError ? err : new GeminiError(err?.message || 'Erro inesperado de hardware/rede.', 'UNKNOWN', true, err);
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
    } finally {
      if (timer) clearTimeout(timer);
      cancelCurrent = null;
    }
  }

  const failures = [...carried, ...currentFailures];
  const interrupted = abortRequested;
  abortRequested = false;
  emit({
    isProcessing: false,
    isStopping: false,
    progress: null,
    failedItems: failures,
    batchStop,
    // com falhas, o resultado fica na tela do Scanner até a pessoa ver; sem falhas, a tela volta ao começo
    resultsSeen: failures.length === 0,
    ...(failures.length === 0 ? { savedCount: 0, duplicateCount: 0 } : {}),
  });

  try {
    handlers?.onFinish({ added, duplicates, failed: failures.length, interrupted, stopped: stoppedByItself });
  } catch (e) {
    diagnostics.log('SCANNER', `Falha ao avisar o fim da leitura: ${(e as Error)?.message}`);
  }
};
