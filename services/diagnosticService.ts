
import { DiagnosticLog, LogType, PerformanceReport } from '../types';
import { generateId } from './idUtils';
import { GoogleGenAI } from "@google/genai";

class DiagnosticService {
    private logs: DiagnosticLog[] = [];
    private maxLogs = 1000;

    constructor() {
        this.loadLogs();
    }

    private loadLogs() {
        try {
            const saved = localStorage.getItem('eukasconta_diagnostics');
            if (saved) this.logs = JSON.parse(saved);
        } catch (e) {
            console.warn("Erro ao carregar logs de diagnóstico:", e);
        }
    }

    private saveLogs() {
        try {
            localStorage.setItem('eukasconta_diagnostics', JSON.stringify(this.logs.slice(0, this.maxLogs)));
            window.dispatchEvent(new Event('diagnostic_update'));
        } catch (e) {
            console.error("Falha ao salvar logs no localStorage. Limite de quota pode ter sido atingido.", e);
            // Se falhar por quota, limpa logs antigos para tentar novamente
            if (this.logs.length > 100) {
                this.logs = this.logs.slice(0, 50);
                this.saveLogs();
            }
        }
    }

    public log(type: LogType, description: string, executionTime?: number, metadata?: any) {
        console.debug(`[${type}] ${description}`);
        const newLog: DiagnosticLog = {
            id: generateId(),
            timestamp: Date.now(),
            type,
            description,
            executionTime,
            metadata
        };
        this.logs.unshift(newLog);
        this.saveLogs();
    }

    public getLogs() {
        return this.logs;
    }

    public getReport(): PerformanceReport {
        const apiLogs = this.logs.filter(l => l.type === 'API_CALL' && l.executionTime);
        const errorLogs = this.logs.filter(l => l.type === 'SYSTEM_ERROR');
        
        const avgLatency = apiLogs.length > 0 
            ? apiLogs.reduce((acc, l) => acc + (l.executionTime || 0), 0) / apiLogs.length 
            : 0;

        return {
            avgApiLatency: Math.round(avgLatency),
            errorRate: this.logs.length > 0 ? (errorLogs.length / this.logs.length) * 100 : 0,
            totalInteractions: this.logs.filter(l => l.type === 'CLICK').length,
            uptime: performance.now()
        };
    }

    public generateFullBlackBoxLog(): string {
        const report = this.getReport();
        const dataSize = new Blob([JSON.stringify(this.logs)]).size / 1024;
        
        let txt = `================================================================================\n`;
        txt += `               EUKASCONTA - RELATÓRIO DE AUDITORIA DE SISTEMA                 \n`;
        txt += `================================================================================\n`;
        txt += `DATA DE GERAÇÃO   : ${new Date().toLocaleString('pt-BR')}\n`;
        txt += `INTEGRIDADE       : ${report.errorRate < 5 ? 'ESTÁVEL (NOMINAL)' : 'DEGRADADA (VERIFICAR ERROS)'}\n`;
        txt += `LATÊNCIA API      : ${report.avgApiLatency}ms\n`;
        txt += `CLIQUES MONITORAD.: ${report.totalInteractions}\n`;
        txt += `TAMANHO DO DUMP   : ${dataSize.toFixed(2)} KB\n`;
        txt += `--------------------------------------------------------------------------------\n\n`;
        txt += `FLUXO CRONOLÓGICO DE EVENTOS (MAIS RECENTES PRIMEIRO):\n\n`;
        
        this.logs.forEach(l => {
            const dateStr = new Date(l.timestamp).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            txt += `[${dateStr}] [${l.type.padEnd(14)}] ${l.description}\n`;
            
            if (l.executionTime) {
                txt += `   >> PERFORMANCE: ${l.executionTime.toFixed(2)}ms\n`;
            }
            
            if (l.metadata) {
                const metaEntries = Object.entries(l.metadata);
                if (metaEntries.length > 0) {
                    txt += `   >> METADADOS: `;
                    const metaParts = metaEntries.map(([k, v]) => `${k.toUpperCase()}=${v}`);
                    txt += metaParts.join(' | ');
                    txt += `\n`;
                }
            }
            
            if (l.type === 'DATA_INTEGRITY' || l.type === 'API_CALL' || l.type === 'PERFORMANCE') {
                const status = l.metadata?.status || 'SUCCESS';
                txt += `   >> STATUS FINAL: ${status}\n`;
            }

            txt += `\n`;
        });
        
        txt += `\n================ EOF / FIM DO REGISTRO DE AUDITORIA ================`;
        return txt;
    }

    public clear() {
        this.logs = [];
        this.saveLogs();
    }
}

export const diagnostics = new DiagnosticService();
