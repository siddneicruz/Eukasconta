import { Establishment } from '../types';
import { titleCase, isUnidentifiedName, UNIDENTIFIED_LABEL } from './textFormat';
import { normStoreKey } from './productCodes';
import { formatCNPJ } from './productNormalization';
import { NO_STORE_TYPE, suggestStoreType } from './storeTypes';

/* Apelido das lojas: o que a pessoa escreve em Config > Lojas passa a valer em todas as telas.
   O cupom continua guardado com o nome original; só a exibição troca. Lojas com o mesmo apelido
   (filiais, nomes lidos de formas diferentes) contam como uma só nos gráficos e no filtro. */

const plain = (s: string | undefined | null): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const digits = (s: string | undefined | null): string => String(s ?? '').replace(/\D/g, '');
// CNPJ (14) ou CPF (11): outros tamanhos são leitura errada do cupom e não servem para reconhecer a loja
const idLike = (d: string): boolean => d.length === 14 || d.length === 11;

export interface StoreNamer {
  /** apelido da loja já formatado, ou nulo se ela não tem */
  aliasOf: (name: string, cnpj?: string) => string | null;
  /** apelido, ou o nome do cupom em Iniciais Maiúsculas */
  nameOf: (name: string, cnpj?: string) => string;
  /** identidade para somar e filtrar: mesmo apelido = mesma loja; sem apelido, o mesmo nome */
  keyOf: (name: string, cnpj?: string) => string;
  /** tipo da loja (Mercado, Farmácia...): o escolhido, ou o que o nome sugere, ou "Sem tipo" */
  typeOf: (name: string, cnpj?: string) => string;
}

export const buildStoreNamer = (establishments: Establishment[] = [], storeTypes?: string[], masterStores: { cnpj: string; name: string; type: string }[] = []): StoreNamer => {
  // apelido e tipo da tabela mãe valem para quem não escolheu os seus (o que a pessoa escreve na loja sempre ganha)
  const mAlias = new Map<string, string>(), mType = new Map<string, string>();
  masterStores.forEach(m => { const d = String(m.cnpj || '').replace(/\D/g, ''); if (m.name) mAlias.set(d, m.name); if (m.type) mType.set(d, m.type); });
  const byCnpj = new Map<string, string>();
  const byName = new Map<string, string>();
  const typeByCnpj = new Map<string, string>();
  const typeByName = new Map<string, string>();
  establishments.forEach(e => {
    const t = (e.type || '').trim();
    if (!t) return;
    const d = digits(e.cnpj);
    if (idLike(d) && !typeByCnpj.has(d)) typeByCnpj.set(d, t);
    const n = plain(e.originalName);
    if (n && !typeByName.has(n)) typeByName.set(n, t);
  });
  establishments.forEach(e => {
    const alias = (e.aliasName || '').trim();
    if (!alias) return;
    const d = digits(e.cnpj);
    if (idLike(d) && !byCnpj.has(d)) byCnpj.set(d, alias);
    const n = plain(e.originalName);
    if (n && !byName.has(n)) byName.set(n, alias);
  });

  const rawAlias = (name: string, cnpj?: string): string | null => {
    const d = digits(cnpj);
    if (idLike(d)) { const hit = byCnpj.get(d); if (hit) return hit; }
    const own = byName.get(plain(name));
    if (own) return own;
    return idLike(d) ? mAlias.get(d) ?? null : null;
  };
  const aliasOf = (name: string, cnpj?: string): string | null => {
    const a = rawAlias(name, cnpj);
    return a ? titleCase(a) : null;
  };
  const nameOf = (name: string, cnpj?: string): string => {
    const a = aliasOf(name, cnpj);
    if (a) return a;
    return isUnidentifiedName(name) ? UNIDENTIFIED_LABEL : titleCase(name);
  };
  const keyOf = (name: string, cnpj?: string): string => {
    const a = rawAlias(name, cnpj);
    return a ? `a:${plain(a)}` : `n:${plain(name)}`;
  };
  const typeCache = new Map<string, string>();
  const typeOf = (name: string, cnpj?: string): string => {
    const ck = `${digits(cnpj)}|${name}`;
    const hit = typeCache.get(ck);
    if (hit) return hit;
    const d = digits(cnpj);
    let t = (idLike(d) ? typeByCnpj.get(d) : undefined) || typeByName.get(plain(name)) || (idLike(d) ? mType.get(d) : undefined) || '';
    if (!t && !isUnidentifiedName(name)) t = suggestStoreType(`${rawAlias(name, cnpj) || ''} ${name}`, storeTypes) || '';
    t = t || NO_STORE_TYPE;
    typeCache.set(ck, t);
    return t;
  };
  return { aliasOf, nameOf, keyOf, typeOf };
};

/** Lojas para escolher no cadastro de códigos. A chave é a mesma que os códigos usam (CNPJ só com dígitos, ou "n:nome").
 *  Duas lojas com o mesmo nome na lista ganham o CNPJ ao lado para dar para distinguir. */
export const storeCodeOptions = (establishments: Establishment[] = []): { key: string; label: string }[] => {
  const seen = new Map<string, string>();
  establishments.forEach(e => {
    const key = normStoreKey(e.cnpj || e.originalName);
    if (!key || seen.has(key)) return;
    const name = (e.aliasName || '').trim() ? titleCase(e.aliasName as string) : isUnidentifiedName(e.originalName) ? UNIDENTIFIED_LABEL : titleCase(e.originalName);
    seen.set(key, name);
  });
  const count = new Map<string, number>();
  seen.forEach(l => count.set(l, (count.get(l) || 0) + 1));
  return Array.from(seen.entries())
    .map(([key, label]) => ({ key, label: (count.get(label) || 0) > 1 && /^\d+$/.test(key) ? `${label} · ${formatCNPJ(key)}` : label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
};
