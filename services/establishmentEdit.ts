// Edição dos dados de uma loja (Config > Lojas e Mapa).
//
// A loja do cadastro é identificada por CNPJ + nome do cupom. Apelido, CEP, endereço, cidade, UF e posição são só do
// cadastro e podem mudar à vontade. CNPJ e nome do cupom são a identidade: quando a pessoa corrige um deles, os cupons
// dessa loja recebem a correção também, senão o cadastro e o histórico deixariam de se encontrar.
// Tudo aqui é função pura (não lê localStorage nem chama rede), então dá para testar isolada.

import { Establishment, Receipt } from '../types';
import { cleanCNPJ } from './productNormalization';

export const sameStore = (a: Pick<Establishment, 'cnpj' | 'originalName'>, b: Pick<Establishment, 'cnpj' | 'originalName'>): boolean =>
  cleanCNPJ(a.cnpj) === cleanCNPJ(b.cnpj) && a.originalName === b.originalName;

/** Cupons que são desta loja: pelo CNPJ; loja sem CNPJ, pelo nome do cupom. */
export const receiptsOfStore = (est: Pick<Establishment, 'cnpj' | 'originalName'>, receipts: Receipt[]): Receipt[] => {
  const c = cleanCNPJ(est.cnpj);
  return receipts.filter(r => (c ? cleanCNPJ(r.cnpj) === c : !cleanCNPJ(r.cnpj) && r.establishmentName === est.originalName));
};

export interface StoreSummary {
  receipts: number;
  items: number;
  spent: number;
  average: number;
  first: string;   // AAAA-MM-DD, vazio se não há cupom
  last: string;
}

export const summarizeStore = (est: Pick<Establishment, 'cnpj' | 'originalName'>, receipts: Receipt[]): StoreSummary => {
  const mine = receiptsOfStore(est, receipts);
  const dates = mine.map(r => r.date || '').filter(Boolean).sort();
  const spent = mine.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
  return {
    receipts: mine.length,
    items: mine.reduce((s, r) => s + (r.items?.length || 0), 0),
    spent,
    average: mine.length ? spent / mine.length : 0,
    first: dates[0] || '',
    last: dates[dates.length - 1] || '',
  };
};

/* ───────────────────────────── campos ───────────────────────────── */

export const formatCep = (raw: string | undefined | null): string => {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

/** O endereço do cupom costuma trazer o CEP no fim ("… - CEP: 89885-000"). */
export const cepFromAddress = (address: string | undefined | null): string => {
  const m = String(address ?? '').match(/\b(\d{5})-?(\d{3})\b/);
  return m ? `${m[1]}-${m[2]}` : '';
};

const num = (text: string): number => Number(text.trim().replace(',', '.'));

export type Coordinate = { value: number } | { empty: true } | { invalid: string };

export const parseCoordinate = (text: string, kind: 'lat' | 'lng'): Coordinate => {
  const t = String(text ?? '').trim();
  if (!t) return { empty: true };
  if (!/^[-+−]?\d{1,3}(?:[.,]\d+)?$/.test(t.replace('−', '-'))) return { invalid: `${kind === 'lat' ? 'Latitude' : 'Longitude'} inválida: use só números, como -27.0953.` };
  const v = num(t.replace('−', '-'));
  const max = kind === 'lat' ? 90 : 180;
  if (!Number.isFinite(v) || Math.abs(v) > max) return { invalid: `${kind === 'lat' ? 'Latitude' : 'Longitude'} fora do limite (de -${max} a ${max}).` };
  return { value: v };
};

/** "-27.0953, -52.6172" (como o Google Maps copia) vira os dois campos. */
export const splitLatLng = (text: string): [string, string] | null => {
  const m = String(text ?? '').replace('−', '-').trim().match(/^([-+]?\d{1,3}\.\d+)\s*[,;]\s*([-+]?\d{1,3}\.\d+)$/)
    || String(text ?? '').replace('−', '-').trim().match(/^([-+]?\d{1,3},\d+)\s+([-+]?\d{1,3},\d+)$/);
  return m ? [m[1], m[2]] : null;
};

/* ───────────────────────────── rascunho e gravação ───────────────────────────── */

export interface StoreDraft {
  aliasName: string;
  originalName: string;
  cnpj: string;
  cep: string;
  address: string;
  city: string;
  state: string;
  latitude: string;
  longitude: string;
}

export const draftOf = (e: Establishment): StoreDraft => ({
  aliasName: (e.aliasName || '').trim(),
  originalName: e.originalName || '',
  cnpj: cleanCNPJ(e.cnpj),
  cep: formatCep(e.cep) || cepFromAddress(e.address),
  address: e.address || '',
  city: e.city || '',
  state: e.state || '',
  latitude: typeof e.latitude === 'number' ? String(e.latitude) : '',
  longitude: typeof e.longitude === 'number' ? String(e.longitude) : '',
});

const squash = (s: string): string => String(s ?? '').replace(/\s+/g, ' ').trim();
const same6 = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

export type EditResult =
  | { ok: true; next: Establishment; establishments: Establishment[]; receipts: Receipt[]; changedReceipts: number; identityChanged: boolean }
  | { ok: false; error: string };

export const applyStoreEdit = (
  prev: Establishment,
  draft: StoreDraft,
  establishments: Establishment[],
  receipts: Receipt[],
  now: number = Date.now(),
): EditResult => {
  const name = squash(draft.originalName);
  if (!name) return { ok: false, error: 'Informe o nome da loja como aparece no cupom.' };

  const cnpj = cleanCNPJ(draft.cnpj);
  if (cnpj && cnpj.length !== 14 && cnpj.length !== 11) return { ok: false, error: 'O CNPJ precisa ter 14 números (ou 11, se for CPF). Deixe vazio se a loja não tem.' };

  const state = squash(draft.state).toUpperCase();
  if (state && !/^[A-Z]{2}$/.test(state)) return { ok: false, error: 'A UF tem 2 letras, como SC.' };

  const cepDigits = String(draft.cep || '').replace(/\D/g, '');
  if (cepDigits && cepDigits.length !== 8) return { ok: false, error: 'O CEP tem 8 números, como 89885-000.' };

  const la = parseCoordinate(draft.latitude, 'lat');
  const lo = parseCoordinate(draft.longitude, 'lng');
  if ('invalid' in la) return { ok: false, error: la.invalid };
  if ('invalid' in lo) return { ok: false, error: lo.invalid };
  if (('empty' in la) !== ('empty' in lo)) return { ok: false, error: 'Preencha latitude e longitude juntas, ou deixe as duas vazias.' };

  const clash = establishments.find(e =>
    !sameStore(e, prev) && (cnpj ? cleanCNPJ(e.cnpj) === cnpj : !cleanCNPJ(e.cnpj) && e.originalName === name));
  if (clash) {
    return { ok: false, error: cnpj
      ? `Já existe outra loja com este CNPJ (${clash.aliasName?.trim() || clash.originalName}). Para juntar as duas, use "Unificar lojas".`
      : 'Já existe outra loja sem CNPJ com este nome.' };
  }

  const address = squash(draft.address), city = squash(draft.city);
  const addrChanged = address !== squash(prev.address || '') || city !== squash(prev.city || '') || state !== squash(prev.state || '').toUpperCase();
  const hadCoords = typeof prev.latitude === 'number' && typeof prev.longitude === 'number';
  const typedCoords = 'value' in la && 'value' in lo;

  const next: Establishment = { ...prev, originalName: name, cnpj, address, city, state };
  const alias = squash(draft.aliasName);
  if (alias) next.aliasName = alias; else delete next.aliasName;
  if (cepDigits) next.cep = formatCep(cepDigits); else delete next.cep;
  if (!address) delete next.address;
  if (!city) delete next.city;
  if (!state) delete next.state;

  const resetPosition = () => {
    delete next.latitude; delete next.longitude;
    delete next.geocodeStatus; delete next.geocodedAt; delete next.geocodeApprox; delete next.geocodeManual;
  };

  if (typedCoords) {
    const lat = (la as { value: number }).value, lng = (lo as { value: number }).value;
    const moved = !hadCoords || !same6(lat, prev.latitude as number) || !same6(lng, prev.longitude as number);
    if (moved) {
      next.latitude = lat; next.longitude = lng;
      next.geocodeStatus = 'found'; next.geocodedAt = now;
      delete next.geocodeApprox; next.geocodeManual = true;
    } else if (addrChanged && !prev.geocodeManual) {
      resetPosition();   // endereço novo: o app procura a posição de novo
    }
  } else {
    // coordenadas apagadas: some a posição e o app volta a procurar pelo endereço
    // (sem posição antes e depois, só reabre a busca se o endereço mudou)
    if (hadCoords || addrChanged) resetPosition();
  }

  const identityChanged = cnpj !== cleanCNPJ(prev.cnpj) || name !== prev.originalName;

  let replaced = false;
  const nextList = establishments.map(e => {
    if (!replaced && sameStore(e, prev)) { replaced = true; return next; }
    return e;
  });
  if (!replaced) nextList.push(next);

  let changedReceipts = 0;
  let nextReceipts = receipts;
  if (identityChanged) {
    const mine = new Set(receiptsOfStore(prev, receipts));
    nextReceipts = receipts.map(r => {
      if (!mine.has(r)) return r;
      changedReceipts += 1;
      return { ...r, cnpj, establishmentName: name };
    });
  }

  return { ok: true, next, establishments: nextList, receipts: nextReceipts, changedReceipts, identityChanged };
};
