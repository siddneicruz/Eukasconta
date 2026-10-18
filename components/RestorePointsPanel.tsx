import React, { useRef, useState } from 'react';
import { History as HistoryIcon, Plus, Download, Upload, Trash2, RotateCcw, Loader2, Clock, ShieldCheck } from 'lucide-react';
import type { RestorePointsApi } from '../services/useRestorePoints';
import { KIND_LABEL, PointKind, PointMeta, fmtSize, pointSummary } from '../services/restorePoints';
import { agoText, useNow, whenText } from '../services/lastWhen';
import { isNativeApp } from '../services/platform';
import ConfirmDialog from './ConfirmDialog';
import Switch from './Switch';

/* Pontos de restauração: cópias completas dos dados deste aparelho. Cada uma pode ser restaurada ou exportada.
   O backup automático na conta continua como era; os pontos ficam só aqui (e no arquivo, se a pessoa exportar). */

const CHIP: Record<PointKind, string> = {
  manual: 'text-luxury-gold bg-luxury-gold/10 border-luxury-gold/30',
  auto: 'text-zinc-400 bg-white/5 border-white/10',
  before: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30',
  import: 'text-zinc-400 bg-white/5 border-white/10',
  legacy: 'text-zinc-400 bg-white/5 border-white/10',
};

interface Props {
  restore: RestorePointsApi;
  /** Conta ligada: o backup automático vai acompanhar o estado restaurado (a tela avisa). */
  cloudBackupOn?: boolean;
}

const RestorePointsPanel: React.FC<Props> = ({ restore, cloudBackupOn = false }) => {
  const now = useNow();
  const fileRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [askRestore, setAskRestore] = useState<PointMeta | null>(null);
  const [askDelete, setAskDelete] = useState<PointMeta | null>(null);
  const busyCreate = restore.busy === 'create';

  const submitCreate = async () => {
    const ok = await restore.create(name);
    if (ok) { setName(''); setCreating(false); }
  };

  return (
    <div className="p-5 sm:p-8 bg-white/[0.02] border border-white/5 rounded-[2.5rem]" data-testid="restore-panel">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 shrink-0 rounded-xl bg-luxury-gold/10 border border-luxury-gold/25 flex items-center justify-center text-luxury-gold">
          <HistoryIcon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-xl font-serif text-white tracking-tight">Pontos de restauração</h3>
          <p className="text-sm text-zinc-400 leading-snug mt-1">
            Cópias completas dos seus dados neste aparelho, para voltar no tempo quando precisar. O backup automático na conta continua como está.
          </p>
        </div>
      </div>

      {!restore.supported && (
        <div className="mb-4 p-3 rounded-xl border border-red-900/30 bg-red-950/20 text-sm text-red-300" data-testid="restore-unsupported">
          Este aparelho não deixa o app guardar pontos de restauração. O backup na conta e a exportação continuam funcionando.
        </div>
      )}

      <div className="flex flex-wrap gap-2.5 mb-4">
        <button type="button" onClick={() => setCreating(c => !c)} disabled={!restore.supported} data-testid="restore-create-open"
          className="inline-flex items-center gap-2 px-5 min-h-[44px] rounded-2xl bg-luxury-gold text-black font-bold text-sm hover:brightness-110 transition disabled:opacity-40">
          <Plus className="w-4 h-4" /> Criar ponto agora
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={!restore.supported || restore.busy === 'import'} data-testid="restore-import"
          className="inline-flex items-center gap-2 px-5 min-h-[44px] rounded-2xl bg-white/5 border border-white/10 text-zinc-200 font-bold text-sm hover:border-luxury-gold/40 transition disabled:opacity-40">
          {restore.busy === 'import' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Importar ponto
        </button>
        <input ref={fileRef} type="file" className="hidden" data-testid="restore-import-input"
          accept={isNativeApp() ? '*/*' : '.zip,.json,application/zip,application/json'}
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restore.importFile(f); }} />
      </div>

      {creating && (
        <form className="mb-5 p-4 rounded-2xl bg-black/40 border border-white/10 space-y-3" data-testid="restore-create-form"
          onSubmit={e => { e.preventDefault(); void submitCreate(); }}>
          <label className="block text-sm text-zinc-300">
            Nome do ponto <span className="text-zinc-500">(opcional)</span>
            <input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={80} autoFocus data-testid="restore-name"
              placeholder="Ex.: antes de arrumar os ovos"
              className="mt-1.5 w-full bg-black border border-white/10 rounded-xl py-3 px-4 text-sm text-zinc-100 focus:border-luxury-gold outline-none" />
          </label>
          <div className="flex gap-2.5">
            <button type="submit" disabled={busyCreate} data-testid="restore-create-save"
              className="flex-1 min-h-[44px] rounded-xl bg-luxury-gold text-black font-bold text-sm hover:brightness-110 transition disabled:opacity-50 inline-flex items-center justify-center gap-2">
              {busyCreate && <Loader2 className="w-4 h-4 animate-spin" />} Salvar ponto
            </button>
            <button type="button" onClick={() => { setCreating(false); setName(''); }}
              className="px-5 min-h-[44px] rounded-xl bg-white/5 border border-white/10 text-zinc-300 font-bold text-sm hover:bg-white/10 transition">
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="mb-6 p-4 rounded-2xl bg-black/40 border border-white/5 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-200">Ponto automático por dia</p>
          <p className="text-xs text-zinc-500 leading-snug mt-1">
            Guarda o estado do app uma vez por dia, quando algo mudou. Também guardo um ponto antes de importar, unificar, limpar duplicatas, restaurar da conta e apagar tudo.
          </p>
        </div>
        <Switch on={restore.auto} onChange={restore.setAuto} label="Ponto automático por dia" testId="restore-auto" disabled={!restore.supported} />
      </div>

      {restore.supported && restore.loaded && restore.points.length === 0 && (
        <div className="py-10 border border-dashed border-white/10 rounded-[2rem] flex flex-col items-center justify-center text-zinc-500 gap-3 text-center px-6" data-testid="restore-empty">
          <Clock className="w-8 h-8 opacity-30" />
          <span className="text-sm">Nenhum ponto ainda. Crie o primeiro agora: leva menos de um segundo.</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="restore-list">
        {restore.points.map(p => {
          const when = new Date(p.createdAt);
          const working = restore.busy === p.id;
          return (
            <div key={p.id} data-restore-point={p.id} data-kind={p.kind}
              className="bg-black/40 border border-white/5 p-4 rounded-2xl hover:border-luxury-gold/30 transition-colors flex flex-col gap-3">
              <div className="min-w-0">
                <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-bold ${CHIP[p.kind]}`}>{KIND_LABEL[p.kind]}</span>
                <p className="mt-1.5 text-zinc-100 font-semibold text-[15px] leading-snug break-words" data-testid="restore-point-name">{p.name}</p>
                <p className="text-xs text-zinc-500 mt-1 tabular-nums">{whenText(when, now)} · {agoText(when, now)}</p>
                <p className="text-xs text-zinc-400 mt-1 tabular-nums">{pointSummary(p)} · {fmtSize(p.bytes)}</p>
                {p.partial && <p className="text-xs text-zinc-500 mt-1">Guarda só cupons, lojas e categorias: ao restaurar, o resto fica como está.</p>}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setAskRestore(p)} disabled={working || !!restore.busy} data-testid="restore-point-restore"
                  className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-luxury-gold/40 text-luxury-gold font-bold text-sm hover:bg-luxury-gold/10 transition disabled:opacity-40">
                  {working ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Restaurar
                </button>
                <button type="button" onClick={() => void restore.exportOne(p.id)} disabled={working || !!restore.busy} data-testid="restore-point-export"
                  className="min-h-[44px] px-4 inline-flex items-center justify-center gap-2 rounded-xl bg-white/5 border border-white/10 text-zinc-200 font-bold text-sm hover:border-luxury-gold/40 transition disabled:opacity-40">
                  <Download className="w-4 h-4" /> Exportar
                </button>
                <button type="button" onClick={() => setAskDelete(p)} disabled={working || !!restore.busy} aria-label="Excluir ponto" data-testid="restore-point-delete"
                  className="min-h-[44px] w-11 inline-flex items-center justify-center rounded-xl text-red-500 hover:bg-red-500/10 transition disabled:opacity-40">
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-zinc-500 leading-snug mt-5">
        Os pontos ficam só neste aparelho e não entram no backup da conta. Para guardar um ponto fora do app ou levar para outro aparelho, use Exportar.
      </p>

      {askRestore && (
        <ConfirmDialog
          tone="gold"
          icon={<RotateCcw className="w-5 h-5" />}
          title="Restaurar este ponto?"
          confirmLabel="Restaurar"
          message={<>
            <span className="block text-zinc-200 font-semibold break-words">{askRestore.name}</span>
            <span className="block mt-1 tabular-nums text-sm">{whenText(new Date(askRestore.createdAt), now)} · {pointSummary(askRestore)}</span>
            <span className="block mt-3">Seus dados de agora serão trocados pelos deste ponto. Antes, guardo o estado de agora na lista, então dá para voltar atrás.</span>
            {cloudBackupOn && <span className="block mt-2 text-xs text-zinc-500">O backup automático na conta vai acompanhar o estado restaurado.</span>}
          </>}
          onConfirm={() => { const p = askRestore; setAskRestore(null); void restore.restore(p.id); }}
          onCancel={() => setAskRestore(null)}
        />
      )}
      {askDelete && (
        <ConfirmDialog
          title="Excluir este ponto?"
          message={<>
            <span className="block text-zinc-200 font-semibold break-words">{askDelete.name}</span>
            <span className="block mt-1 tabular-nums text-sm">{whenText(new Date(askDelete.createdAt), now)} · {pointSummary(askDelete)}</span>
            <span className="block mt-3">Isso não pode ser desfeito. Se quiser guardar uma cópia, exporte antes.</span>
          </>}
          onConfirm={() => { const p = askDelete; setAskDelete(null); void restore.remove(p.id); }}
          onCancel={() => setAskDelete(null)}
        />
      )}
    </div>
  );
};

export default RestorePointsPanel;
