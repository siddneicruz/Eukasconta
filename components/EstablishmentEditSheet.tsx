import React, { useEffect, useMemo, useState } from 'react';
import { Store, X, MapPin, ExternalLink, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Browser } from '@capacitor/browser';
import { Establishment, Receipt } from '../types';
import { cleanCNPJ } from '../services/productNormalization';
import { formatCNPJ } from '../services/productNormalization';
import { isValidCNPJ } from '../services/registryLookupService';
import { useMasterInfo } from './MasterContext';
import { DEFAULT_STORE_TYPES, suggestStoreType } from '../services/storeTypes';
import { StoreDraft, draftOf, receiptsOfStore, splitLatLng, summarizeStore } from '../services/establishmentEdit';
import { isNativeApp } from '../services/platform';
import { titleCase } from '../services/textFormat';

/* Folha com todos os dados de uma loja, para a pessoa corrigir o que o cupom trouxe errado.
   Nada muda antes de tocar em "Salvar". */

interface Props {
  est: Establishment;
  receipts: Receipt[];
  /** devolve o texto do erro (a folha fica aberta) ou null quando gravou */
  onSave: (prev: Establishment, draft: StoreDraft) => string | null;
  onClose: () => void;
}

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const day = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : '—'; };

const positionStatus = (e: Establishment): string => {
  if (e.geocodeManual) return 'Posição ajustada por você.';
  if (e.geocodeStatus === 'found' && e.geocodeApprox) return 'Posição aproximada: o app só achou o centro da cidade.';
  if (e.geocodeStatus === 'found') return 'Posição encontrada pelo endereço.';
  if (e.geocodeStatus === 'not_found') return 'O app não achou este endereço no mapa. Corrija o endereço ou digite a posição.';
  return 'Ainda não procurada no mapa.';
};

const inputCls = 'w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:border-luxury-gold/50 outline-none placeholder:text-zinc-600';

const Field: React.FC<{ label: string; hint?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ label, hint, className = '', children }) => (
  <label className={`block ${className}`}>
    <span className="block text-xs text-zinc-400 font-medium mb-1.5">{label}</span>
    {children}
    {hint && <span className="block text-[11px] mt-1 leading-snug">{hint}</span>}
  </label>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="px-5 sm:px-6 py-4 border-t border-white/5 first:border-t-0">
    <h4 className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold mb-3">{title}</h4>
    <div className="space-y-3">{children}</div>
  </section>
);

const EstablishmentEditSheet: React.FC<Props> = ({ est, receipts, onSave, onClose }) => {
  const [draft, setDraft] = useState<StoreDraft>(() => draftOf(est));
  const [error, setError] = useState('');
  const storeTypes = useMasterInfo().master?.storeTypes;
  const typeList = storeTypes && storeTypes.length ? storeTypes : DEFAULT_STORE_TYPES;
  const set = (patch: Partial<StoreDraft>) => { setDraft(d => ({ ...d, ...patch })); setError(''); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const summary = useMemo(() => summarizeStore(est, receipts), [est, receipts]);
  const mine = useMemo(() => receiptsOfStore(est, receipts).length, [est, receipts]);

  const digits = cleanCNPJ(draft.cnpj);
  const identityChanged = digits !== cleanCNPJ(est.cnpj) || draft.originalName.replace(/\s+/g, ' ').trim() !== est.originalName;
  const cnpjHint = digits.length === 14
    ? (isValidCNPJ(digits)
        ? <span className="inline-flex items-center gap-1 text-emerald-500"><CheckCircle2 className="w-3.5 h-3.5" /> CNPJ válido</span>
        : <span className="inline-flex items-center gap-1 text-amber-500"><AlertTriangle className="w-3.5 h-3.5" /> Este CNPJ não passa na conferência dos dígitos. Veja se digitou certo.</span>)
    : digits.length === 11 ? <span className="text-zinc-500">CPF (pessoa física)</span>
    : digits.length === 0 ? <span className="text-zinc-500">Sem CNPJ (pessoa física ou cupom sem o número)</span>
    : <span className="text-amber-500">Faltam números: o CNPJ tem 14.</span>;

  const lat = Number(draft.latitude.replace(',', '.')), lng = Number(draft.longitude.replace(',', '.'));
  const hasPoint = draft.latitude.trim() !== '' && draft.longitude.trim() !== '' && Number.isFinite(lat) && Number.isFinite(lng);
  const openMap = () => {
    const url = `https://www.google.com/maps?q=${lat},${lng}`;
    if (isNativeApp()) Browser.open({ url }).catch(() => {}); else window.open(url, '_blank', 'noopener');
  };

  const onLat = (v: string) => {
    const pair = splitLatLng(v);   // colou "-27.09, -52.61" de uma vez
    if (pair) set({ latitude: pair[0], longitude: pair[1] }); else set({ latitude: v });
  };

  const save = () => {
    const err = onSave(est, draft);
    if (err) setError(err); else onClose();
  };

  return (
    <div className="fixed inset-0 z-[250] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md animate-in fade-in duration-150" onClick={onClose} data-testid="store-edit-sheet">
      <div role="dialog" aria-modal="true" aria-labelledby="store-edit-title" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-xl max-h-[94dvh] flex flex-col bg-[#0c0c0e] border border-luxury-gold/30 rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl">
        <div className="flex items-start gap-3 p-5 sm:p-6 border-b border-white/5">
          <div className="shrink-0 w-10 h-10 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold flex items-center justify-center"><Store className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <h3 id="store-edit-title" className="text-lg font-serif text-white tracking-tight">Dados da loja</h3>
            <p className="text-xs text-zinc-400 mt-0.5 truncate">{titleCase(est.aliasName?.trim() || est.originalName)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <Section title="Suas compras aqui">
            <div className="grid grid-cols-3 gap-2" data-testid="store-edit-summary">
              {[['Cupons', String(summary.receipts)], ['Gasto total', brl(summary.spent)], ['Por compra', brl(summary.average)]].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-white/5 border border-white/5 px-3 py-2.5 min-w-0">
                  <p className="text-[11px] text-zinc-500">{k}</p>
                  <p className="text-sm font-bold text-zinc-100 tabular-nums truncate">{v}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-500">
              {summary.receipts > 0 ? `Primeira compra ${day(summary.first)} · última ${day(summary.last)} · ${summary.items} ${summary.items === 1 ? 'item' : 'itens'}` : 'Nenhum cupom desta loja ainda.'}
            </p>
          </Section>

          <Section title="Identificação">
            <Field label="Apelido" hint={<span className="text-zinc-500">Como você chama a loja. Aparece em todas as telas.</span>}>
              <input type="text" value={draft.aliasName} onChange={e => set({ aliasName: e.target.value })} placeholder="Como você chama esta loja" data-testid="store-edit-alias"
                className={`${inputCls} !text-luxury-gold font-semibold placeholder:font-normal`} />
            </Field>
            <Field label="Tipo de estabelecimento" hint={<span className="text-zinc-500">{draft.type ? 'Usado no filtro do início e nos relatórios.' : (() => { const g = suggestStoreType(`${draft.aliasName} ${draft.originalName}`, typeList); return g ? `Sem escolha, o app usa "${g}", pelo nome da loja.` : 'Sem escolha, a loja fica em "Sem tipo".'; })()}</span>}>
              <select value={draft.type} onChange={e => set({ type: e.target.value })} data-testid="store-edit-type" className={inputCls}>
                <option value="">Automático (pelo nome)</option>
                {(draft.type && !typeList.includes(draft.type) ? [draft.type, ...typeList] : typeList).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Nome no cupom">
              <input type="text" value={draft.originalName} onChange={e => set({ originalName: e.target.value })} data-testid="store-edit-name" className={inputCls} />
            </Field>
            <Field label="CNPJ" hint={cnpjHint}>
              <input type="text" inputMode="numeric" value={draft.cnpj.replace(/\D/g, '').length === 14 ? formatCNPJ(draft.cnpj) : draft.cnpj}
                onChange={e => set({ cnpj: e.target.value })} placeholder="00.000.000/0000-00" data-testid="store-edit-cnpj" className={`${inputCls} tabular-nums`} />
            </Field>
            {identityChanged && mine > 0 && (
              <p className="text-xs text-amber-500 leading-snug" data-testid="store-edit-identity-note">
                Mudar o nome ou o CNPJ corrige também {mine === 1 ? 'o 1 cupom' : `os ${mine} cupons`} desta loja.
              </p>
            )}
          </Section>

          <Section title="Endereço">
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Field label="Endereço" className="col-span-2">
                <input type="text" value={draft.address} onChange={e => set({ address: e.target.value })} placeholder="Rua, número, bairro" data-testid="store-edit-address" className={inputCls} />
              </Field>
              <Field label="Cidade">
                <input type="text" value={draft.city} onChange={e => set({ city: e.target.value })} data-testid="store-edit-city" className={inputCls} />
              </Field>
              <Field label="UF" className="w-20">
                <input type="text" maxLength={2} value={draft.state} onChange={e => set({ state: e.target.value.toUpperCase() })} data-testid="store-edit-state" className={`${inputCls} uppercase text-center`} />
              </Field>
              <Field label="CEP" className="col-span-2">
                <input type="text" inputMode="numeric" value={draft.cep} onChange={e => set({ cep: e.target.value })} placeholder="00000-000" data-testid="store-edit-cep" className={`${inputCls} tabular-nums`} />
              </Field>
            </div>
          </Section>

          <Section title="Posição no mapa">
            <p className="text-xs text-zinc-400 leading-snug flex items-start gap-1.5" data-testid="store-edit-position-status">
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-500" /> {positionStatus(est)}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude">
                <input type="text" inputMode="decimal" value={draft.latitude} onChange={e => onLat(e.target.value)} placeholder="-27.0953" data-testid="store-edit-lat" className={`${inputCls} tabular-nums`} />
              </Field>
              <Field label="Longitude">
                <input type="text" inputMode="decimal" value={draft.longitude} onChange={e => set({ longitude: e.target.value })} placeholder="-52.6172" data-testid="store-edit-lng" className={`${inputCls} tabular-nums`} />
              </Field>
            </div>
            <p className="text-[11px] text-zinc-500 leading-snug">Dica: no Google Maps, toque e segure o ponto da loja e cole aqui os dois números de uma vez. Se mudar o endereço, o app procura a posição de novo.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => set({ latitude: '', longitude: '' })} disabled={!draft.latitude && !draft.longitude} data-testid="store-edit-reset-position"
                className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-xs font-bold hover:border-luxury-gold/40 disabled:opacity-40">
                <RefreshCw className="w-3.5 h-3.5" /> Procurar no mapa de novo
              </button>
              {hasPoint && (
                <button type="button" onClick={openMap}
                  className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-xs font-bold hover:border-luxury-gold/40">
                  <ExternalLink className="w-3.5 h-3.5" /> Ver no Google Maps
                </button>
              )}
            </div>
          </Section>
        </div>

        {error && <p className="px-5 sm:px-6 pt-3 text-sm text-red-400 leading-snug" role="alert" data-testid="store-edit-error">{error}</p>}
        <div className="p-4 sm:p-5 border-t border-white/5 flex flex-col sm:flex-row gap-3">
          <button type="button" onClick={save} data-testid="store-edit-save"
            className="flex-1 py-4 rounded-xl font-bold text-[11px] uppercase tracking-[0.08em] bg-luxury-gold text-black hover:brightness-110 active:brightness-95 transition">
            Salvar
          </button>
          <button type="button" onClick={onClose}
            className="sm:w-36 py-4 rounded-xl bg-white/5 border border-white/10 text-zinc-300 font-bold text-[11px] uppercase tracking-[0.08em] hover:bg-white/10 transition-colors">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};

export default EstablishmentEditSheet;
