import React, { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  // 'danger' (padrão, vermelho, para apagar) ou 'gold' (dourado, para ações que só substituem dados)
  tone?: 'danger' | 'gold';
  icon?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

// Pergunta de confirmação antes de uma ação que não dá para desfazer. Esc e toque fora cancelam;
// o foco começa em "Cancelar" para um toque sem querer não apagar nada.
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ title, message, confirmLabel = 'Excluir', cancelLabel = 'Cancelar', tone = 'danger', icon, onConfirm, onCancel }) => {
  const gold = tone === 'gold';
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150" onClick={onCancel} data-testid="confirm-dialog">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onClick={e => e.stopPropagation()}
        className={`w-full max-w-sm bg-[#0c0c0e] border ${gold ? 'border-luxury-gold/30' : 'border-red-900/30'} rounded-[2rem] p-6 sm:p-8 text-center shadow-2xl`}
      >
        <div className={`mx-auto mb-4 w-12 h-12 rounded-full border flex items-center justify-center ${gold ? 'bg-luxury-gold/10 border-luxury-gold/30 text-luxury-gold' : 'bg-red-950/40 border-red-900/40 text-red-400'}`}>
          {icon ?? <Trash2 className="w-5 h-5" />}
        </div>
        <h3 id="confirm-title" className="text-xl font-serif text-white mb-2 tracking-tight">{title}</h3>
        <div id="confirm-message" className="text-zinc-400 text-sm leading-relaxed mb-7">{message}</div>
        <div className="flex flex-col gap-3">
          <button type="button" onClick={onConfirm} data-testid="confirm-ok"
            className={`w-full py-4 rounded-xl font-bold text-[11px] uppercase tracking-[0.08em] transition-colors ${gold ? 'bg-luxury-gold text-black hover:bg-white' : 'bg-red-600 text-white hover:bg-red-500'}`}>
            {confirmLabel}
          </button>
          <button type="button" ref={cancelRef} onClick={onCancel} data-testid="confirm-cancel"
            className="w-full py-4 rounded-xl bg-white/5 border border-white/10 text-zinc-300 font-bold text-[11px] uppercase tracking-[0.08em] hover:bg-white/10 transition-colors">
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
