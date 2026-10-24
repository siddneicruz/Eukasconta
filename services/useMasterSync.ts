// Mantém o app igual à tabela mãe: baixa quando a versão muda, troca a estrutura local e reclassifica os itens.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MasterProduct, Receipt, TaxonomyNode } from '../types';
import { applyMasterCodes } from './masterCodes';
import type { MasterInfo } from '../components/MasterContext';
import {
  MasterData, applyMasterToReceipts, cachedRole, fetchMaster, fetchMasterVersion, fetchPendingSuggestions, fetchRole,
  loadMasterCache, reviewSuggestion, saveMasterCache, submitSuggestion, taxonomySignature,
} from './masterService';

interface Opts {
  userId: string | null;
  taxonomy: TaxonomyNode[];
  setTaxonomy: (t: TaxonomyNode[]) => void;
  receipts: Receipt[];
  setReceipts: (r: Receipt[]) => void;
  masterProducts?: MasterProduct[];
  setMasterProducts?: (m: MasterProduct[]) => void;
  onToast?: (msg: string) => void;
}

const EVERY_MS = 5 * 60 * 1000;

export const useMasterSync = ({ userId, taxonomy, setTaxonomy, receipts, setReceipts, masterProducts, setMasterProducts, onToast }: Opts): MasterInfo => {
  const [master, setMaster] = useState<MasterData | null>(loadMasterCache);
  const [role, setRole] = useState<'admin' | 'user'>(() => cachedRole(userId));
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);
  const masterRef = useRef(master);
  masterRef.current = master;
  const roleRef = useRef(role);
  roleRef.current = role;

  const refreshPending = useCallback(async () => {
    if (!userId || roleRef.current !== 'admin') { setPending(0); return; }
    try { setPending((await fetchPendingSuggestions()).length); } catch { /* sem rede: mantém o número */ }
  }, [userId]);

  const syncNow = useCallback(async (force = false) => {
    if (!userId || busy.current) return;
    busy.current = true; setSyncing(true);
    try {
      const r = await fetchRole(userId);
      roleRef.current = r; setRole(r);
      const meta = await fetchMasterVersion();
      if (meta) {
        const cur = masterRef.current;
        if (meta.version <= 0) {
          if (cur) { saveMasterCache(null); setMaster(null); }
        } else if (force || !cur || cur.version !== meta.version) {
          const fresh = await fetchMaster(meta.version, meta.publishedAt);
          saveMasterCache(fresh);
          setMaster(fresh);
          if (cur && cur.version !== fresh.version) onToast?.('A tabela mãe foi atualizada: estrutura e categorias dos itens conferidas.');
        }
      }
      await refreshPending();
    } catch { /* sem rede: segue com a cópia guardada */ }
    finally { busy.current = false; setSyncing(false); }
  }, [userId, onToast, refreshPending]);

  useEffect(() => { setRole(cachedRole(userId)); }, [userId]);
  useEffect(() => { void syncNow(); }, [syncNow]);
  useEffect(() => {
    if (!userId) return;
    const tick = () => { if (document.visibilityState === 'visible') void syncNow(); };
    const id = window.setInterval(tick, EVERY_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('online', tick);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); window.removeEventListener('online', tick); };
  }, [userId, syncNow]);

  // A estrutura local é a da tabela mãe (também depois de restaurar um backup antigo)
  const masterSig = useMemo(() => (master ? taxonomySignature(master.nodes) : ''), [master]);
  useEffect(() => {
    if (!master) return;
    if (taxonomySignature(taxonomy) !== masterSig) setTaxonomy(master.nodes);
  }, [taxonomy, master, masterSig, setTaxonomy]);

  // Os itens que a tabela mãe conhece ficam na categoria dela (compras novas e as antigas)
  useEffect(() => {
    if (!master) return;
    const res = applyMasterToReceipts(receipts, master);
    if (res.changed > 0) setReceipts(res.receipts);
  }, [receipts, master, setReceipts]);

  // Códigos nativos (barras e de cada loja) viram parte do cadastro de produtos de todos
  useEffect(() => {
    if (!master?.codes?.length || !masterProducts || !setMasterProducts) return;
    const r = applyMasterCodes(masterProducts, master.codes);
    if (r.changed > 0) setMasterProducts(r.masters);
  }, [master, masterProducts, setMasterProducts]);

  const createLabel = useCallback<MasterInfo['createLabel']>(async (parentPath, name, ctx) => {
    if (!userId) throw new Error('Entre na sua conta para criar ou sugerir etiquetas.');
    const id = await submitSuggestion({ parentPath, name, productCode: ctx?.code, productDescription: ctx?.description });
    if (roleRef.current === 'admin') {
      await reviewSuggestion(id, true);
      await syncNow(true);
      return { approved: true };
    }
    return { approved: false, note: 'Sugestão enviada. Quando o administrador aprovar, a etiqueta aparece para todos.' };
  }, [userId, syncNow]);

  return {
    active: !!master, isAdmin: role === 'admin', version: master?.version ?? 0, publishedAt: master?.publishedAt ?? null,
    master, pending, syncing, syncNow, refreshPending, createLabel,
  };
};
