import React, { useRef, useState } from 'react';
import { X, QrCode, ExternalLink, ClipboardPaste, Check, UserRound, Loader2, ImagePlus, Camera, AlertCircle } from 'lucide-react';
import { Browser } from '@capacitor/browser';
import { isNativeApp } from '../services/platform';
import { Receipt } from '../types';
import { decodeQrFromFile, parseNfceQr, parseSefazText, NfceQr } from '../services/nfceQr';

/* Ler cupom pelo QR Code, sem IA: câmera ou galeria → página da SEFAZ → copiar e colar o texto → cupom no histórico.
   Vale para vários cupons de uma vez: a pessoa valida um a um e marca "humano" os que ficaram para depois. */

type Status = 'pendente' | 'importado' | 'humano';
interface Entry { id: string; fileName: string; qr: NfceQr | null; status: Status; text: string; error: string }

interface Props {
  /** devolve os cupons lidos; o app grava no histórico (cadastro de lojas e produtos incluídos) */
  onImport: (receipts: Receipt[]) => Promise<void> | void;
  onClose: () => void;
}

const openExternal = (url: string) => {
  if (isNativeApp()) Browser.open({ url }).catch(() => {});
  else window.open(url, '_blank', 'noopener');
};

const QrReceiptSheet: React.FC<Props> = ({ onImport, onClose }) => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const patch = (id: string, p: Partial<Entry>) => setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...p } : e)));

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    const added: Entry[] = [];
    for (const f of Array.from(files)) {
      let qr: NfceQr | null = null;
      try { const raw = await decodeQrFromFile(f); qr = raw ? parseNfceQr(raw) : null; } catch { qr = null; }
      if (qr && (added.some(a => a.qr?.key === qr!.key) || entries.some(a => a.qr?.key === qr!.key))) continue; // mesmo cupom de novo
      added.push({
        id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 7)}`, fileName: f.name, qr, text: '',
        status: qr ? 'pendente' : 'humano', error: qr ? '' : 'Não achei um QR Code de nota fiscal nessa imagem.',
      });
    }
    setEntries(prev => [...prev, ...added]);
    if (added.length && !openId) setOpenId(added.find(a => a.status === 'pendente')?.id ?? added[0].id);
    setBusy(false);
  };

  const paste = async (e: Entry) => {
    try { const t = await navigator.clipboard.readText(); patch(e.id, { text: t, error: '' }); }
    catch { patch(e.id, { error: 'O celular não deixou ler a área de transferência. Toque no campo e cole com um toque longo.' }); }
  };

  const importOne = async (e: Entry) => {
    const res = parseSefazText(e.text, e.qr);
    if (res.ok === false) { patch(e.id, { error: res.reason }); return; }
    await onImport([res.receipt]);
    patch(e.id, { status: 'importado', error: '' });
    const next = entries.find(x => x.id !== e.id && x.status === 'pendente');
    setOpenId(next ? next.id : null);
  };

  const markHuman = (e: Entry) => {
    patch(e.id, { status: 'humano' });
    const next = entries.find(x => x.id !== e.id && x.status === 'pendente');
    setOpenId(next ? next.id : null);
  };

  const counts = {
    pendente: entries.filter(e => e.status === 'pendente').length,
    importado: entries.filter(e => e.status === 'importado').length,
    humano: entries.filter(e => e.status === 'humano').length,
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md" onClick={onClose} data-testid="qr-sheet">
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-zinc-950 border border-white/10 p-5" onClick={ev => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-base font-semibold text-zinc-100 flex items-center gap-2"><QrCode className="w-5 h-5 text-luxury-gold" /> Ler cupom pelo QR Code</p>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">Sem IA e sem gastar token. Leia o QR Code, abra a página da SEFAZ, copie o texto da nota e cole aqui.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <button type="button" onClick={() => cameraRef.current?.click()} disabled={busy} data-testid="qr-camera"
            className="flex items-center justify-center gap-2 py-3 rounded-xl bg-luxury-gold text-black text-xs font-bold disabled:opacity-50"><Camera className="w-4 h-4" /> Câmera</button>
          <button type="button" onClick={() => galleryRef.current?.click()} disabled={busy} data-testid="qr-gallery"
            className="flex items-center justify-center gap-2 py-3 rounded-xl bg-white/10 text-zinc-100 text-xs font-bold disabled:opacity-50"><ImagePlus className="w-4 h-4" /> Galeria (várias)</button>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={ev => { addFiles(ev.target.files); ev.target.value = ''; }} />
          <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={ev => { addFiles(ev.target.files); ev.target.value = ''; }} />
        </div>
        {busy && <p className="flex items-center gap-2 text-xs text-zinc-400 mb-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Lendo os QR Codes…</p>}

        {entries.length > 0 && (
          <p className="text-xs text-zinc-500 mb-2" data-testid="qr-counts">{counts.pendente} a validar · {counts.importado} importados · {counts.humano} para ver depois</p>
        )}

        <ul className="space-y-2">
          {entries.map(e => {
            const open = openId === e.id;
            return (
              <li key={e.id} className="rounded-xl border border-white/10 bg-white/[0.03]" data-testid="qr-entry" data-status={e.status}>
                <button type="button" onClick={() => setOpenId(open ? null : e.id)} className="w-full flex items-center gap-3 p-3 text-left">
                  {e.status === 'importado' ? <Check className="w-4 h-4 text-emerald-400 shrink-0" /> : e.status === 'humano' ? <UserRound className="w-4 h-4 text-amber-400 shrink-0" /> : <QrCode className="w-4 h-4 text-luxury-gold shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-zinc-100 truncate">{e.qr ? `Nota ${e.qr.number} · ${e.qr.uf} · ${e.qr.month}` : e.fileName}</span>
                    <span className="block text-[11px] text-zinc-500 truncate">{e.qr ? `Chave ${e.qr.key.slice(0, 8)}…${e.qr.key.slice(-6)}${e.qr.keyValid ? '' : ' · dígito da chave não fecha'}` : e.error}</span>
                  </span>
                  <span className="text-[11px] text-zinc-500 shrink-0">{e.status === 'importado' ? 'Importado' : e.status === 'humano' ? 'Humano' : 'A validar'}</span>
                </button>

                {open && e.qr && e.status !== 'importado' && (
                  <div className="px-3 pb-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" disabled={!e.qr.url} onClick={() => openExternal(e.qr!.url)} data-testid="qr-open-sefaz"
                        className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/10 text-zinc-100 text-xs font-bold disabled:opacity-40"><ExternalLink className="w-4 h-4" /> Abrir na SEFAZ</button>
                      <button type="button" onClick={() => paste(e)} data-testid="qr-paste"
                        className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/10 text-zinc-100 text-xs font-bold"><ClipboardPaste className="w-4 h-4" /> Colar texto</button>
                    </div>
                    <textarea value={e.text} onChange={ev => patch(e.id, { text: ev.target.value, error: '' })} rows={4} placeholder="Texto copiado da página da nota…" data-testid="qr-text"
                      className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-zinc-100 outline-none focus:border-luxury-gold/50 placeholder:text-zinc-600" />
                    {e.error && <p className="flex items-start gap-2 text-xs text-red-400" role="alert"><AlertCircle className="w-4 h-4 shrink-0" />{e.error}</p>}
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => importOne(e)} disabled={!e.text.trim()} data-testid="qr-import"
                        className="py-2.5 rounded-xl bg-luxury-gold text-black text-xs font-bold disabled:opacity-40">Importar este cupom</button>
                      <button type="button" onClick={() => markHuman(e)} data-testid="qr-human"
                        className="py-2.5 rounded-xl border border-amber-400/40 text-amber-300 text-xs font-bold">Marcar como humano</button>
                    </div>
                    {!e.qr.keyValid && <p className="text-[11px] text-amber-300">O dígito verificador da chave não fecha: o QR pode ter sido lido errado. Confira a nota.</p>}
                  </div>
                )}

                {open && e.status === 'humano' && !e.qr && (
                  <div className="px-3 pb-3"><p className="text-xs text-zinc-400">Essa imagem fica para você ver depois, ou leia o cupom por foto com IA.</p></div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default QrReceiptSheet;
