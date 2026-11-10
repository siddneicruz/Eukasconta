-- Endurecimento de segurança (auditoria de 10/11/2026). Nada é apagado; tudo é reversível com os grants guardados em _sec_acl_before_20261110.

-- 0) foto dos acessos de antes (para desfazer, se preciso)
create table if not exists public._sec_acl_before_20261110 as
select 'table'::text kind, table_name obj, grantee, privilege_type priv from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated')
union all
select 'function', routine_name, grantee, privilege_type from information_schema.role_routine_grants
 where routine_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC');
alter table public._sec_acl_before_20261110 enable row level security;
revoke all on public._sec_acl_before_20261110 from anon, authenticated;

-- 1) ninguém sem login lê ou grava tabela nenhuma (as políticas já eram só para quem entrou)
do $$ declare r record; begin
  for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') loop
    execute format('revoke all on table public.%I from anon', r.relname);
  end loop;
end $$;

-- 2) tabelas de trabalho (_bkp_*, _pad_*, _dup_*, _n4_*...): RLS ligada e fora da API para todos
do $$ declare r record; begin
  for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like '\_%' loop
    execute format('alter table public.%I enable row level security', r.relname);
    execute format('revoke all on table public.%I from anon, authenticated', r.relname);
  end loop;
end $$;

-- 3) tabelas só-leitura (ou só das funções): quem entrou não grava direto
revoke insert, update, delete, truncate, references, trigger on table
  public.ean_catalog, public.ean_rejects, public.master_code_redirects, public.master_meta, public.master_product_codes,
  public.master_stores, public.store_types, public.taxonomy_master, public.store_candidates, public.store_address_suggestions,
  public.credit_ledger, public.read_credits
  from authenticated;
revoke all on table
  public.ean_kw_rule, public.ean_ncm_rule, public.master_companies, public.audit_findings,
  public.produce_ratings, public.produce_tank, public.produce_views
  from authenticated;

-- 4) funções: sem login ninguém executa; quem entrou continua executando (as de admin têm is_admin() por dentro)
do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prokind = 'f'
             and has_function_privilege('anon', p.oid, 'execute') loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- audit_stores gravava sem checar quem chamava: agora só admin
do $mig$
declare v text; v2 text;
begin
  select pg_get_functiondef('public.audit_stores()'::regprocedure) into v;
  v2 := replace(v, E'begin\n  create temp table _s', E'begin\n  if not public.is_admin() then raise exception ''not_admin''; end if;\n  create temp table _s');
  if v2 = v then raise exception 'audit_stores não foi alterada'; end if;
  execute v2;
end $mig$;

-- 5) search_path fixo nas funções que estavam soltas
do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('_cnpj_ok', 'gtin_ok', '_gtin_ok', '_nz', '_fix_city', 'ean_preclass_batch', 'ean_preclass_batch2') loop
    execute format('alter function %s set search_path = public, extensions', r.sig);
  end loop;
end $$;

-- 6) índices de chave estrangeira que faltavam
create index if not exists produce_ratings_est_idx on public.produce_ratings (establishment_id);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id);
create index if not exists produce_views_master_idx on public.produce_views (master_product_id);
