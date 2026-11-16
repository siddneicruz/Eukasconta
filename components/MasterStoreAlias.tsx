import React, { useEffect, useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import { useMasterInfo } from './MasterContext';
import { publishMasterStores } from '../services/masterService';
import { cleanCNPJ } from '../services/productNormalization';

/* Campo "Apelido" da loja.
   - Loja que NÃO está na tabela mãe: apelido local, como sempre.
   - Loja da tabela mãe, conta comum: mostra o nome da tabela mãe, travado (vale igual para todos).
   - Loja da tabela mãe, conta do administrador: editável; o botão "Salvar na tabela mãe" grava o nome novo e publica,
     então todos os celulares passam a ver o nome novo. Nada é gravado enquanto o botão não for tocado. */

interface Props {
  cnpj?: string;
  localAlias: string;
  onLocalChange: (v: string) => void;
  placeholder?: string;
  className: string;
  testId: string;
  hint?: boolean;
}

const MasterStoreAlias: React.FC<Props> = ({ cnpj, localAlias, onLocalChange, placeholder, className, testId, hint = true }) => {
  const info = useMasterInfo();
  const d = cleanCNPJ(cnpj || '');
  const ms = d ? info.master?.stores?.find(m => m.cnpj === d) : undefined;
  const masterName = (ms?.name || '').trim();
  const [draft, setDraft] = useState(masterName);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => { setDraft(masterName); }, [masterName]);

  if (!ms || !masterName) {
    return <input type="text" value={localAlias} onChange={e => onLocalChange(e.target.value)} placeholder={placeholder} data-testid={testId} className={className} />;
  }
  if (!info.isAdmin) {
    return (
      <>
        <input type="text" value={masterName} disabled data-testid={testId} className={className} />
        {hint && <p className="mt-1.5 text-xs text-zinc-500">Definido na tabela mãe, igual para todos. Se estiver errado, avise o administrador.</p>}
      </>
    );
  }
  const changed = draft.trim() !== masterName && draft.trim().length > 0;
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await publishMasterStores([{ cnpj: ms.cnpj, name: draft.trim(), type: '' }]);
      await info.syncNow(true);
      setMsg({ ok: true, t: 'Salvo na tabela mãe e publicado para todos.' });
    } catch (e: any) {
      setMsg({ ok: false, t: `Não consegui salvar: ${e?.message || 'sem conexão'}` });
    } finally { setBusy(false); }
  };
  return (
    <>
      <input type="text" value={draft} onChange={e => { setDraft(e.target.value); setMsg(null); }} placeholder={placeholder} data-testid={testId} className={className} />
      {changed && (
        <button type="button" onClick={save} disabled={busy} data-testid={`${testId}-master-save`}
          className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-luxury-gold text-black text-xs font-bold disabled:opacity-60">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Salvar na tabela mãe
        </button>
      )}
      {hint && <p className="mt-1.5 text-xs text-zinc-500">Nome da tabela mãe. Como administrador, ao salvar ele muda para todos os usuários.</p>}
      {msg && <p className={`mt-1.5 text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`} role="status">{msg.t}</p>}
    </>
  );
};

export default MasterStoreAlias;
