
import React from 'react';
import { X, FileText, CheckCircle, AlertTriangle, Info } from 'lucide-react';

export interface ImportLogEntry {
    timestamp: string;
    level: 'info' | 'success' | 'warning' | 'error';
    message: string;
    details?: any;
}

interface ImportLogViewerProps {
    isOpen: boolean;
    onClose: () => void;
    logs: ImportLogEntry[];
}

const ImportLogViewer: React.FC<ImportLogViewerProps> = ({ isOpen, onClose, logs }) => {
    if (!isOpen) return null;

    const getIcon = (level: string) => {
        switch (level) {
            case 'success': return <CheckCircle className="w-4 h-4 text-emerald-500" />;
            case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-500" />;
            case 'error': return <X className="w-4 h-4 text-red-500" />;
            default: return <Info className="w-4 h-4 text-blue-500" />;
        }
    };

    const getLevelClass = (level: string) => {
        switch (level) {
            case 'success': return 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200';
            case 'warning': return 'border-amber-500/20 bg-amber-500/5 text-amber-200';
            case 'error': return 'border-red-500/20 bg-red-500/5 text-red-200';
            default: return 'border-blue-500/20 bg-blue-500/5 text-blue-200';
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
                <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-zinc-800 rounded-lg">
                            <FileText className="w-5 h-5 text-zinc-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">Relatório de Importação</h3>
                            <p className="text-xs text-zinc-500 uppercase tracking-wider">Log detalhado do processo</p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-white"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                    {logs.length === 0 ? (
                        <div className="text-center py-12 text-zinc-500">
                            <p>Nenhum registro de log disponível.</p>
                        </div>
                    ) : (
                        logs.map((log, index) => (
                            <div key={index} className={`p-3 rounded-lg border text-sm font-mono ${getLevelClass(log.level)}`}>
                                <div className="flex items-start gap-3">
                                    <span className="mt-0.5 shrink-0">{getIcon(log.level)}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-4 mb-1">
                                            <span className="font-bold">{log.message}</span>
                                            <span className="text-[10px] opacity-50 shrink-0">{log.timestamp}</span>
                                        </div>
                                        {log.details && (
                                            <pre className="mt-2 p-2 bg-black/30 rounded text-[10px] overflow-x-auto whitespace-pre-wrap">
                                                {typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}
                                            </pre>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 rounded-b-2xl flex justify-end">
                    <button 
                        onClick={onClose}
                        className="px-6 py-2 bg-zinc-100 text-zinc-900 font-bold text-sm rounded-lg hover:bg-zinc-200 transition-colors"
                    >
                        Fechar Relatório
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ImportLogViewer;
