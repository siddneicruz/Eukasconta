import React from 'react';
import { Loader2, AlertCircle, X } from 'lucide-react';
import { useScanQueue, markScanResultsSeen } from '../services/scanQueue';

interface ScanProgressChipProps {
  // Abre a tela do Scanner (andamento, falhas, Interromper)
  onOpen: () => void;
  // Escondido quando a própria tela do Scanner já está aberta
  hidden?: boolean;
}

// Aviso flutuante da leitura de cupons em segundo plano. Aparece em qualquer aba enquanto o lote roda e,
// se terminou com falhas, até a pessoa abrir o Scanner (ou fechar o aviso).
const ScanProgressChip: React.FC<ScanProgressChipProps> = ({ onOpen, hidden }) => {
  const { isProcessing, isStopping, progress, failedItems, savedCount, resultsSeen } = useScanQueue();
  const showResult = !isProcessing && failedItems.length > 0 && !resultsSeen;
  if (hidden || (!isProcessing && !showResult)) return null;

  const current = progress?.current ?? 0;
  const total = progress?.total ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  return (
    <div className="scan-chip fixed z-[60] animate-in slide-in-from-bottom-3 duration-200" role="status" aria-live="polite" data-testid="scan-chip">
      <div className="relative bg-zinc-900/95 backdrop-blur-xl border border-luxury-gold/30 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">
        <button type="button" onClick={onOpen} data-testid="scan-chip-open" className="w-full flex items-center gap-3 pl-4 pr-12 py-3 text-left">
          {isProcessing
            ? <Loader2 className="w-5 h-5 text-luxury-gold animate-spin shrink-0" />
            : <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />}
          <span className="min-w-0">
            <span className="block text-sm text-white font-semibold truncate" data-testid="scan-chip-title">
              {isProcessing
                ? (isStopping ? 'Finalizando a leitura…' : `Lendo cupons: ${current} de ${total}`)
                : `Leitura terminou: ${failedItems.length} ${failedItems.length === 1 ? 'não importado' : 'não importados'}`}
            </span>
            <span className="block text-xs text-zinc-400 truncate">
              {isProcessing
                ? `${savedCount} ${savedCount === 1 ? 'salvo' : 'salvos'}. Segue em segundo plano.`
                : `${savedCount} ${savedCount === 1 ? 'salvo' : 'salvos'}. Toque para ver as falhas.`}
            </span>
          </span>
        </button>
        {!isProcessing && (
          <button type="button" onClick={markScanResultsSeen} aria-label="Fechar aviso" data-testid="scan-chip-close"
            className="absolute top-1/2 -translate-y-1/2 right-2 w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        )}
        {isProcessing && (
          <div className="absolute bottom-0 inset-x-0 h-0.5 bg-white/10">
            <div className="h-full bg-luxury-gold transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ScanProgressChip;
