// Blindagem na entrada: todo cupom novo passa por aqui antes de ser guardado. A tabela mãe de lojas (a mesma para todos os
// usuários) corrige o CNPJ lido errado, a razão social, o endereço, a cidade e a UF. Só corrige sozinho quando há certeza;
// com dúvida, só sugere (a tela "Conferir com a tabela mãe" mostra o motivo).
import { Receipt, Establishment } from '../types';
import type { MasterStore } from './masterService';
import { cnpjGap, coreTokens, nameRelation, validDocument, cityCompat, addressCompat } from './storeDedupe';
import { joinAddress } from './establishmentEdit';

export interface StoreMatch { master: MasterStore; score: number; reasons: string[]; exact: boolean }

const digits = (s: unknown): string => String(s ?? '').replace(/\D/g, '');

/** Maior trecho de dígitos em comum (começo, meio ou fim): pega CNPJ cortado ou com um dígito a mais na leitura da foto. */
const commonRun = (a: string, b: string): number => {
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = tmp;
    }
  }
  return best;
};

const asEst = (m: MasterStore): Establishment => ({
  cnpj: m.cnpj, originalName: m.legalName || m.name, city: m.city, state: m.state, cep: m.cep,
  address: joinAddress({ street: m.address, number: m.number, neighborhood: m.neighborhood }),
});

type Probe = Pick<Establishment, 'cnpj' | 'originalName' | 'address' | 'city' | 'state' | 'cep'>;

export const rankMasterStores = (e: Probe, masters: MasterStore[]): StoreMatch[] => {
  const d = digits(e.cnpj);
  const exactHit = d.length >= 11 ? masters.find(m => digits(m.cnpj) === d) : undefined;
  if (exactHit) return [{ master: exactHit, score: 1, reasons: ['CNPJ igual ao da tabela mãe'], exact: true }];
  // CNPJ completo e com dígitos certos que a tabela mãe não tem é outra empresa de verdade: nunca é "corrigido"
  if (d.length === 14 && validDocument(d)) return [];
  const probe = e as Establishment;
  const mine = coreTokens({ originalName: e.originalName, city: e.city });
  const cepMine = digits((e.cep || '') || (String(e.address || '').match(/\b\d{5}-?\d{3}\b/)?.[0] ?? ''));
  const out: StoreMatch[] = [];
  for (const m of masters) {
    const me = asEst(m);
    const reasons: string[] = [];
    let score = 0;
    if (d.length >= 8) {
      const gap = cnpjGap(d, m.cnpj);
      if (gap !== null && gap <= 1) { score += 0.45; reasons.push('CNPJ com 1 dígito de diferença'); }
      else if (gap !== null && gap <= 2) { score += 0.35; reasons.push('CNPJ com 2 dígitos de diferença'); }
      else if (commonRun(d, m.cnpj) >= 10) { score += 0.3; reasons.push('CNPJ cortado ou com dígito a mais'); }
    }
    const rel = nameRelation(mine, coreTokens({ originalName: m.legalName || m.name, city: m.city }));
    if (rel === 'igual') { score += 0.3; reasons.push('mesmo nome'); }
    else if (rel === 'contido') { score += 0.2; reasons.push('nome parecido (um contém o outro)'); }
    else if (rel === 'parecido') { score += 0.15; reasons.push('nome semelhante'); }
    const city = cityCompat(probe, me);
    if (city === 'diferente') continue;
    if (city === 'igual') { score += 0.1; reasons.push('mesma cidade'); } else if (city === 'parcial') score += 0.05;
    const addr = addressCompat(probe, me);
    if (addr === 'igual') { score += 0.2; reasons.push('mesmo endereço e número'); }
    else if (addr === 'diferente') score -= 0.3;
    if (cepMine && digits(m.cep) === cepMine) { score += 0.2; reasons.push('mesmo CEP'); }
    const evidence = reasons.some(r => r.startsWith('CNPJ')) || (rel !== null && (addr === 'igual' || (cepMine && digits(m.cep) === cepMine)));
    if (!evidence || score < 0.4) continue;
    out.push({ master: m, score: Math.round(score * 100) / 100, reasons, exact: false });
  }
  return out.sort((a, b) => b.score - a.score);
};

/** Sozinho só corrige com nota alta e sem concorrente próximo. */
export const confidentMatch = (list: StoreMatch[]): StoreMatch | null => {
  const [a, b] = list;
  if (!a) return null;
  if (a.exact) return a;
  const strongPair = a.reasons.includes('mesmo nome') && a.reasons.includes('mesmo endereço e número');
  return (a.score >= 0.7 || (a.score >= 0.6 && strongPair)) && (!b || a.score - b.score >= 0.2) ? a : null;
};

export const applyMasterStore = (r: Receipt, m: MasterStore): Receipt => {
  const addr = joinAddress({ street: m.address, number: m.number, neighborhood: m.neighborhood });
  return {
    ...r,
    cnpj: m.cnpj,
    establishmentName: m.legalName || r.establishmentName,
    address: addr || r.address,
    city: m.city || r.city,
    state: m.state || r.state,
  };
};

export const resolveReceiptStore = (r: Receipt, masters: MasterStore[]): { receipt: Receipt; match: StoreMatch | null; fixed: boolean } => {
  if (!masters.length) return { receipt: r, match: null, fixed: false };
  const list = rankMasterStores({ cnpj: r.cnpj, originalName: r.establishmentName, address: r.address, city: r.city, state: r.state }, masters);
  const sure = confidentMatch(list);
  if (!sure) return { receipt: r, match: list[0] ?? null, fixed: false };
  const next = applyMasterStore(r, sure.master);
  return { receipt: next, match: sure, fixed: next.cnpj !== r.cnpj || next.establishmentName !== r.establishmentName };
};
