import { Establishment } from '../types';
import { titleCase, isUnidentifiedName, UNIDENTIFIED_LABEL } from './textFormat';
import { normStoreKey } from './productCodes';
import { formatCNPJ } from './productNormalization';

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
}

export const buildStoreNamer = (establishments: Establishment[] = []): StoreNamer => {
  const byCnpj = new Map<string, string>();
  const byName = new Map<string, string>();
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
    return byName.get(plain(name)) ?? null;
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
  return { aliasOf, nameOf, keyOf };
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
