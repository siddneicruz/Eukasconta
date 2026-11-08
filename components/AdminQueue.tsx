import React, { useCallback, useEffect, useState } from 'react';
import { Check, ClipboardCheck, Loader2, X } from 'lucide-react';
import { AdminQueue as Queue, AuditFinding, MasterCompany, ProductSubmission, AddressSuggestion, fetchAddressSuggestions, reviewAddressSuggestion, fetchAdminQueue, reviewCompany, reviewFinding, reviewSubmission } from '../services/masterService';
import { formatCNPJ } from '../services/productNormalization';

/* Fila única do administrador: só você decide unificar lojas, corrigir e aprovar cadastros.
   A auditoria do banco (todo dia) e a IA só sugerem; nada é juntado sem o seu toque. */

const btn = 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-[12.5px] font-bold active:opacity-80 disabled:opacity-40';

const AdminQueue: React.FC<{ onToast?: (m: string) => void }> = ({ onToast }) => {
  const [q, setQ] = useState<Queue | null>(null);
  const [addr, setAddr] = useState<AddressSuggestion[]>([]);
  const [error, setError] = useState('');
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setQ(await fetchAdminQueue()); setAddr(await fetchAddressSuggestions().catch(() => [])); setError(''); } catch (e: any) { setError(e?.message || 'Não consegui ler a fila.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const doFinding = async (f: AuditFinding, approve: boolean) => {
    setWorking(`f${f.id}`);
    try { await reviewFinding(f.id, approve); await load(); onToast?.(approve ? 'Marcado como repetida. A junção é feita em Lojas repetidas.' : 'Sugestão recusada.'); }
    catch (e: any) { setError(e?.message || 'Não consegui concluir.'); } finally { setWorking(null); }
  };
  const doCompany = async (c: MasterCompany, approve: boolean) => {
    setWorking(`c${c.id}`);
    try { await reviewCompany(c.id, approve); await load(); onToast?.(approve ? 'Empresa aprovada.' : 'Empresa ignorada.'); }
    catch (e: any) { setError(e?.message || 'Não consegui concluir.'); } finally { setWorking(null); }
  };
  const doAddr = async (a: AddressSuggestion, approve: boolean) => {
    setWorking(`a${a.id}`);
    try { await reviewAddressSuggestion(a.id, approve); await load(); onToast?.(approve ? 'Dado da loja atualizado.' : 'Sugestão recusada.'); }
    catch (e: any) { setError(e?.message || 'Não consegui concluir.'); } finally { setWorking(null); }
  };
  const doSub = async (s: ProductSubmission, approve: boolean) => {
    setWorking(`s${s.id}`);
    try { const c = await reviewSubmission(s.id, approve, 1); await load(); onToast?.(approve ? `Cadastro aprovado. O usuário ganhou ${c} leitura de cupom.` : 'Cadastro recusado.'); }
    catch (e: any) { setError(e?.message || 'Não consegui concluir.'); } finally { setWorking(null); }
  };

  const total = q ? q.companies.length + q.findings.length + q.submissions.length + q.corrections.length + addr.length : 0;
  const cn = (d: string | null) => (d && d.length === 14 ? formatCNPJ(d) : d || '');

  return (
    <div className="bg-black/40 border border-white/5 rounded-[2.5rem] p-5 sm:p-8 shadow-2xl" data-testid="admin-queue">
      <h4 className="text-base font-semibold text-zinc-100 flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-luxury-gold" /> Fila de aprovação {total > 0 && <span className="min-w-[1.4rem] px-1.5 py-0.5 rounded-full bg-luxury-gold text-black text-[11px] font-bold leading-none text-center">{total}</span>}</h4>
      <p className="mt-1 text-xs text-zinc-500">Só você decide. A auditoria diária e a IA apenas sugerem.</p>
      {error && <p className="mt-2 text-xs text-red-400" role="alert">{error}</p>}
      {!q && !error && <p className="mt-3 text-xs text-zinc-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando…</p>}
      {q && total === 0 && <p className="mt-3 text-xs text-zinc-500">Nada esperando por você.</p>}

      {q && q.findings.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">Lojas</p>
          <ul className="mt-2 space-y-2.5">
            {q.findings.map(f => (
              <li key={f.id} className="rounded-2xl border border-white/5 bg-white/[0.02] p-3.5" data-testid="admin-finding">
                <p className="text-[11px] font-bold text-luxury-gold">{f.kind === 'store_dup' ? (f.strength === 'alta' ? 'Possível loja repetida · certeza alta' : 'Possível loja repetida · conferir') : 'CNPJ com dígito errado'}</p>
                <p className="mt-1 text-[12.5px] text-zinc-200 break-words">{f.reason}</p>
                <p className="mt-1.5 text-[12px] text-zinc-400 break-words tabular-nums">
                  {f.details?.a_name || f.details?.name || ''} · {cn(f.subject_a)}
                  {f.subject_b && <><br />{f.details?.b_name || ''} · {cn(f.subject_b)}</>}
                </p>
                <div className="mt-2.5 flex gap-2">
                  <button type="button" disabled={working === `f${f.id}`} onClick={() => doFinding(f, true)} className={`${btn} flex-1 bg-luxury-gold text-black`}>{working === `f${f.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Confirmar</button>
                  <button type="button" disabled={working === `f${f.id}`} onClick={() => doFinding(f, false)} className={`${btn} flex-1 bg-white/5 border border-white/10 text-zinc-300`}><X className="w-4 h-4" /> Não é</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {q && q.companies.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">Empresas (marcas e fornecedores) · {q.companies.length}</p>
          <ul className="mt-2 space-y-2">
            {q.companies.slice(0, 30).map(c => (
              <li key={c.id} className="rounded-2xl border border-white/5 bg-white/[0.02] p-3" data-testid="admin-company">
                <p className="text-[13px] text-zinc-100 break-words">{c.name} <span className="text-[11px] text-zinc-500">· {c.kind} · {c.n_eans.toLocaleString('pt-BR')} EANs</span></p>
                {c.conferir && <p className="text-[11px] font-bold text-amber-500">Conferir: nome estranho</p>}
                {c.example && <p className="mt-0.5 text-[11.5px] text-zinc-500 break-words">Ex.: {c.example}</p>}
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={working === `c${c.id}`} onClick={() => doCompany(c, true)} className={`${btn} flex-1 bg-luxury-gold text-black`}><Check className="w-4 h-4" /> Aprovar</button>
                  <button type="button" disabled={working === `c${c.id}`} onClick={() => doCompany(c, false)} className={`${btn} flex-1 bg-white/5 border border-white/10 text-zinc-300`}>Ignorar</button>
                </div>
              </li>
            ))}
          </ul>
          {q.companies.length > 30 && <p className="mt-2 text-[11.5px] text-zinc-500">Mostrando 30 de {q.companies.length}; as outras aparecem quando você decidir essas.</p>}
        </div>
      )}

      {q && addr.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">Endereços das lojas (vindos do CNPJ) · {addr.length}</p>
          <ul className="mt-2 space-y-2">
            {addr.slice(0, 30).map(a => (
              <li key={a.id} className="rounded-2xl border border-white/5 bg-white/[0.02] p-3" data-testid="admin-address">
                <p className="text-[12.5px] text-zinc-100 break-words">{a.store_name || cn(a.cnpj)} <span className="text-[11px] text-zinc-500">· {({ address: 'Rua', neighborhood: 'Bairro', cep: 'CEP', city: 'Cidade', state: 'UF', legal_name: 'Razão social', situacao: 'Situação' } as Record<string, string>)[a.field] || a.field}</span></p>
                {a.kind === 'divergente' && <p className="text-[11px] font-bold text-amber-500">Diferente do que está salvo</p>}
                {a.current_value && <p className="text-[11.5px] text-zinc-500 break-words">Hoje: {a.current_value}</p>}
                <p className="text-[12px] text-zinc-300 break-words">Sugerido: {a.suggested_value}</p>
                <div className="mt-2 flex gap-2">
                  {a.field !== 'situacao' && <button type="button" disabled={working === `a${a.id}`} onClick={() => doAddr(a, true)} className={`${btn} flex-1 bg-luxury-gold text-black`}><Check className="w-4 h-4" /> Aprovar</button>}
                  <button type="button" disabled={working === `a${a.id}`} onClick={() => doAddr(a, false)} className={`${btn} flex-1 bg-white/5 border border-white/10 text-zinc-300`}>{a.field === 'situacao' ? 'Entendi' : 'Recusar'}</button>
                </div>
              </li>
            ))}
          </ul>
          {addr.length > 30 && <p className="mt-2 text-[11.5px] text-zinc-500">Mostrando 30 de {addr.length}.</p>}
        </div>
      )}

      {q && q.submissions.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">Cadastros de produto (aprovar dá 1 leitura de cupom)</p>
          <ul className="mt-2 space-y-2.5">
            {q.submissions.map(s => (
              <li key={s.id} className="rounded-2xl border border-white/5 bg-white/[0.02] p-3.5" data-testid="admin-submission">
                <p className="text-[12.5px] text-zinc-200 break-words">{[s.brand, s.name, s.variant].filter(Boolean).join(' · ') || 'Sem nome'}</p>
                <p className="mt-1 text-[11.5px] text-zinc-500 tabular-nums break-words">EAN {s.ean || '—'}{s.size_value ? ` · ${s.size_value} ${s.size_unit || ''}` : ''}{s.packaging ? ` · ${s.packaging}` : ''}{s.units ? ` · ${s.units} un` : ''}</p>
                <div className="mt-2.5 flex gap-2">
                  <button type="button" disabled={working === `s${s.id}`} onClick={() => doSub(s, true)} className={`${btn} flex-1 bg-luxury-gold text-black`}>{working === `s${s.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Aprovar</button>
                  <button type="button" disabled={working === `s${s.id}`} onClick={() => doSub(s, false)} className={`${btn} flex-1 bg-white/5 border border-white/10 text-zinc-300`}>Recusar</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {q && q.corrections.length > 0 && (
        <p className="mt-4 text-[11.5px] text-zinc-500">{q.corrections.length} sugestão(ões) de correção de produto esperando; a tela para decidir vem na próxima versão.</p>
      )}
    </div>
  );
};

export default AdminQueue;
