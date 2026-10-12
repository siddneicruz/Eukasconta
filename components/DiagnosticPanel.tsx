
import React, { useState, useEffect } from 'react';
import { diagnostics } from '../services/diagnosticService';
import { Terminal, Activity, Zap, ShieldAlert, Trash2, X, ChevronRight, Clock, Cpu, BarChart3, AlertCircle, Copy, Check } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

const DiagnosticPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [logs, setLogs] = useState(diagnostics.getLogs());
    const [report, setReport] = useState(diagnostics.getReport());
    const [tab, setTab] = useState<'logs' | 'performance'>('logs');
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const handler = () => {
            setLogs([...diagnostics.getLogs()]);
            setReport(diagnostics.getReport());
        };
        window.addEventListener('diagnostic_update', handler);
        return () => window.removeEventListener('diagnostic_update', handler);
    }, []);

    const handleCopyReport = () => {
        // Fix: Changed non-existent getFormattedReportForAI to generateFullBlackBoxLog
        const text = diagnostics.generateFullBlackBoxLog();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const latencyData = logs
        .filter(l => l.type === 'API_CALL' && l.executionTime)
        .slice(0, 15)
        .reverse()
        .map((l, i) => ({ id: i, ms: l.executionTime }));

    const getStatusColor = () => {
        if (report.errorRate > 15) return 'text-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]';
        if (report.errorRate > 5) return 'text-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.4)]';
        return 'text-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]';
    };

    return (
        <div className="fixed inset-0 z-[110] bg-black/95 backdrop-blur-xl flex flex-col animate-in fade-in duration-500 font-mono text-[11px] uppercase tracking-[0.08em] border-l border-white/10">
            
            {/* HEADER */}
            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-zinc-900/50">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded bg-luxury-gold flex items-center justify-center text-black shadow-lg">
                        <Terminal className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-xl font-serif text-white tracking-tight normal-case">Black Box Console</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            <div className={`w-1.5 h-1.5 rounded-full animate-pulse bg-current ${getStatusColor()}`} />
                            <span className="text-zinc-500 text-xs">System Integrity: </span>
                            <span className={`text-xs font-bold ${getStatusColor()}`}>
                                {report.errorRate > 15 ? 'CRITICAL' : report.errorRate > 5 ? 'DEGRADED' : 'NOMINAL'}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button 
                        onClick={handleCopyReport}
                        className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-zinc-300 hover:text-luxury-gold hover:border-luxury-gold/50 transition-all active:scale-95"
                    >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copied ? 'Copiado' : 'Copiar Relatório p/ IA'}</span>
                    </button>
                    <button onClick={() => diagnostics.clear()} className="p-2.5 rounded-full hover:bg-red-950/20 text-zinc-600 hover:text-red-500 transition-all border border-white/5">
                        <Trash2 className="w-4 h-4" />
                    </button>
                    <button onClick={onClose} className="p-2.5 rounded-full hover:bg-white/10 text-zinc-500 hover:text-white transition-all border border-white/5">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* TABS */}
            <div className="flex border-b border-white/5 bg-black/20">
                <button 
                    onClick={() => setTab('logs')}
                    className={`flex-1 py-4 flex items-center justify-center gap-2 transition-all border-b-2 ${tab === 'logs' ? 'text-luxury-gold border-luxury-gold bg-luxury-gold/5' : 'text-zinc-600 border-transparent hover:text-zinc-300'}`}
                >
                    <Activity className="w-3.5 h-3.5" /> Event Stream
                </button>
                <button 
                    onClick={() => setTab('performance')}
                    className={`flex-1 py-4 flex items-center justify-center gap-2 transition-all border-b-2 ${tab === 'performance' ? 'text-luxury-gold border-luxury-gold bg-luxury-gold/5' : 'text-zinc-600 border-transparent hover:text-zinc-300'}`}
                >
                    <BarChart3 className="w-3.5 h-3.5" /> Performance Data
                </button>
            </div>

            {/* CONTENT */}
            <div className="flex-1 overflow-hidden p-6 bg-[radial-gradient(circle_at_center,rgba(212,175,55,0.02),transparent_70%)]">
                {tab === 'logs' ? (
                    <div className="h-full flex flex-col gap-4">
                        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 pr-4">
                            {logs.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-zinc-800 gap-4 opacity-30">
                                    <Activity className="w-12 h-12" />
                                    <span className="italic">Waiting for system events...</span>
                                </div>
                            ) : (
                                logs.map((log) => (
                                    <div key={log.id} className="p-3 bg-white/[0.02] border border-white/[0.03] rounded-lg flex items-start gap-4 group hover:bg-white/[0.05] hover:border-white/10 transition-all">
                                        <div className={`mt-1.5 w-1 h-1 rounded-full shrink-0 ${
                                            log.type === 'SYSTEM_ERROR' ? 'bg-red-500 shadow-[0_0_8px_red]' : 
                                            log.type === 'API_CALL' ? 'bg-blue-400' : 
                                            log.type === 'CLICK' ? 'bg-zinc-600' : 'bg-emerald-500'
                                        }`} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-center mb-0.5">
                                                <span className={`text-xs font-bold tracking-tighter ${
                                                    log.type === 'SYSTEM_ERROR' ? 'text-red-400' : 
                                                    log.type === 'API_CALL' ? 'text-blue-400' : 'text-zinc-500'
                                                }`}>{log.type}</span>
                                                <span className="text-zinc-700 text-xs">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                            </div>
                                            <p className="text-zinc-400 normal-case leading-relaxed text-xs font-sans">{log.description}</p>
                                            {log.executionTime && (
                                                <div className="flex items-center gap-2 mt-1.5">
                                                    <span className="text-luxury-gold bg-luxury-gold/10 px-1.5 py-0.5 rounded-[4px] text-xs font-bold">LATENCY: {log.executionTime}ms</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="h-full overflow-y-auto custom-scrollbar space-y-8 pr-4">
                        {/* KPI GRID */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <KPIBox icon={<Clock className="w-4 h-4" />} label="Avg Latency" value={`${report.avgApiLatency}ms`} color="text-luxury-gold" />
                            <KPIBox icon={<AlertCircle className="w-4 h-4" />} label="Error Rate" value={`${report.errorRate.toFixed(1)}%`} color={report.errorRate > 10 ? "text-red-500" : "text-emerald-500"} />
                            <KPIBox icon={<Zap className="w-4 h-4" />} label="Total Clicks" value={report.totalInteractions.toString()} color="text-blue-400" />
                            <KPIBox icon={<Cpu className="w-4 h-4" />} label="Engine Status" value="Online" color="text-zinc-400" />
                        </div>

                        {/* CHARTS */}
                        <div className="bg-black/40 border border-white/5 rounded-2xl p-6">
                            <h3 className="text-[11px] text-zinc-500 mb-6 flex items-center gap-2 uppercase tracking-[0.1em] font-bold">
                                <Activity className="w-3 h-3" /> Latency Telemetry (Last 15 Calls)
                            </h3>
                            <div className="h-[200px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={latencyData}>
                                        <defs>
                                            <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.2}/>
                                                <stop offset="95%" stopColor="#D4AF37" stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#18181b" vertical={false} />
                                        <XAxis dataKey="id" hide />
                                        <YAxis tick={{fill: '#3f3f46', fontSize: 8}} axisLine={false} tickLine={false} unit="ms" />
                                        <Tooltip 
                                            contentStyle={{ backgroundColor: '#09090b', border: '1px solid #27272a', fontSize: '9px', borderRadius: '8px' }}
                                            itemStyle={{ color: '#D4AF37' }}
                                            labelStyle={{ display: 'none' }}
                                        />
                                        <Area type="monotone" dataKey="ms" stroke="#D4AF37" strokeWidth={2} fillOpacity={1} fill="url(#colorLatency)" animationDuration={1000} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            
            <div className="p-4 bg-black/40 border-t border-white/5 text-center">
                <p className="text-[11px] text-zinc-500 uppercase tracking-[0.1em]">Encrypted Log Stream • Authorized Access Only</p>
            </div>
        </div>
    );
};

const KPIBox = ({ icon, label, value, color }: any) => (
    <div className="bg-white/[0.03] border border-white/[0.05] rounded-xl p-5 flex flex-col items-center justify-center text-center group hover:bg-white/[0.06] transition-all">
        <div className={`mb-3 ${color} group-hover:scale-110 transition-transform`}>{icon}</div>
        <span className="text-[11px] text-zinc-500 mb-1 uppercase tracking-[0.08em] font-bold">{label}</span>
        <span className={`text-base font-bold ${color} tracking-tighter`}>{value}</span>
    </div>
);

export default DiagnosticPanel;
