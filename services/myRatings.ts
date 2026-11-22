import { useEffect, useState } from 'react';
import * as cloud from './cloudService';

/* As notas de hortifruti que a própria pessoa deu ("Como estava?"). Só ela vê as suas: ficam neste aparelho (as que ela der daqui para a frente)
   e, quando a função do banco existe, voltam da conta (as dadas antes). Ninguém mais enxerga uma nota individual. */

export interface MyRating { ref: string; cnpj: string; desc: string; score: number; at: string }

const KEY = 'ek_my_ratings';
const EVT = 'ek-my-ratings';
let remote: MyRating[] = [];
let loaded = false;

const readLocal = (): MyRating[] => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['kg', 'un', 'g', 'bandeja', 'granel', 'hortifruti', 'horti', 'de', 'da', 'do']);
const tokens = (s: string) => norm(s).split(' ').filter(t => t && !STOP.has(t) && !/^\d+$/.test(t));
/** a descrição avaliada e a do cupom falam do mesmo produto: todas as palavras de uma estão na outra */
const same = (a: string, b: string) => {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const sa = new Set(ta), sb = new Set(tb);
  return ta.every(t => sb.has(t)) || tb.every(t => sa.has(t));
};
const digits = (s: string) => String(s || '').replace(/\D/g, '');

export const addMyRatings = (ref: string, cnpj: string, rated: { description: string; score: number }[]) => {
  const at = new Date().toISOString();
  const keep = readLocal().filter(r => !(r.ref === ref && rated.some(x => same(x.description, r.desc))));
  const next = [...keep, ...rated.map(x => ({ ref, cnpj: digits(cnpj), desc: x.description, score: x.score, at }))].slice(-1500);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sem espaço */ }
  window.dispatchEvent(new Event(EVT));
};

const all = (): MyRating[] => [...readLocal(), ...remote];

/** nota desta pessoa para o item de um cupom (pelo código do cupom e pelo nome) */
export const myRatingForItem = (ref: string, description: string): MyRating | null =>
  all().filter(r => r.ref === ref && same(r.desc, description)).sort((a, b) => b.at.localeCompare(a.at))[0] || null;

/** a nota mais recente desta pessoa para o item numa loja */
export const myLatestRating = (cnpj: string, description: string): MyRating | null => {
  const c = digits(cnpj);
  return all().filter(r => r.cnpj === c && same(r.desc, description)).sort((a, b) => b.at.localeCompare(a.at))[0] || null;
};

export const refreshMyRatings = async () => {
  try {
    if (!cloud.cloudAvailable()) return;
    const rows = await cloud.myProduceRatings();
    remote = rows.map(r => ({ ref: r.receipt_ref, cnpj: digits(r.cnpj), desc: r.description, score: r.score, at: r.created_at }));
    loaded = true;
    window.dispatchEvent(new Event(EVT));
  } catch { /* função ainda não existe ou sem conta: ficam só as deste aparelho */ }
};

/** faz a tela refazer quando uma nota nova entra; busca as da conta uma vez */
export const useMyRatingsVersion = (): number => {
  const [v, setV] = useState(0);
  useEffect(() => {
    const f = () => setV(x => x + 1);
    window.addEventListener(EVT, f);
    if (!loaded) void refreshMyRatings();
    return () => window.removeEventListener(EVT, f);
  }, []);
  return v;
};
