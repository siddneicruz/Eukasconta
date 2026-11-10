-- Qualidade de hortifruti: a pessoa dá uma nota (0 a 10) ao item de um cupom que ela leu.
-- A tabela é só das funções (RLS ligada, sem policy): ninguém lê a nota de outra pessoa, só a média por loja e produto.
create table if not exists public.produce_ratings (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  master_product_id uuid not null references public.master_products(id) on delete cascade,
  receipt_ref text not null,
  score smallint not null check (score between 0 and 10),
  created_at timestamptz not null default now(),
  unique (user_id, receipt_ref, master_product_id)
);
create index if not exists produce_ratings_prod_idx on public.produce_ratings (master_product_id, establishment_id, created_at desc);
alter table public.produce_ratings enable row level security;
comment on table public.produce_ratings is 'Só funções do banco acessam (sem policy de propósito).';

-- Grava as notas de um cupom. p_items: [{"description":"Tomate","unit_type":"KG","score":6}]. Limite: 40 notas por dia por conta.
create or replace function public.rate_produce(p_cnpj text, p_receipt_ref text, p_items jsonb)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_est uuid;
  v_today integer;
  v_saved integer := 0;
  v_it jsonb;
  v_mid uuid;
  v_score integer;
  v_n integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(btrim(p_receipt_ref), '') = '' then raise exception 'receipt_ref_required'; end if;
  select e.id into v_est from public.establishments e where e.cnpj = regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  if v_est is null then return 0; end if;
  select count(*) into v_today from public.produce_ratings where user_id = v_uid and created_at >= now() - interval '1 day';
  for v_it in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 10 loop
    exit when v_today + v_saved >= 40;
    v_score := (v_it ->> 'score')::integer;
    continue when v_score is null or v_score < 0 or v_score > 10;
    select r.master_product_id into v_mid
      from public.resolve_items(p_cnpj, jsonb_build_array(jsonb_build_object('description', v_it ->> 'description', 'unit_type', v_it ->> 'unit_type'))) r limit 1;
    continue when v_mid is null;
    insert into public.produce_ratings(user_id, establishment_id, master_product_id, receipt_ref, score)
      values (v_uid, v_est, v_mid, left(p_receipt_ref, 80), v_score)
      on conflict (user_id, receipt_ref, master_product_id) do update set score = excluded.score, created_at = now();
    get diagnostics v_n = row_count;
    v_saved := v_saved + v_n;
  end loop;
  return v_saved;
end $$;

-- Média das notas recentes por loja para um produto. A média só aparece com 5 notas ou mais (n sempre vem).
create or replace function public.produce_quality(p_master_product_id uuid, p_establishment_ids uuid[], p_days integer default 14)
returns table (establishment_id uuid, avg_score numeric, n integer)
language sql stable security definer
set search_path = public, extensions
as $$
  select r.establishment_id,
         case when count(*) >= 5 then round(avg(r.score)::numeric, 1) end,
         count(*)::integer
    from public.produce_ratings r
   where r.master_product_id = p_master_product_id
     and r.establishment_id = any(coalesce(p_establishment_ids, '{}'))
     and r.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90))
   group by r.establishment_id
$$;

revoke all on function public.rate_produce(text, text, jsonb) from public, anon;
revoke all on function public.produce_quality(uuid, uuid[], integer) from public, anon;
grant execute on function public.rate_produce(text, text, jsonb) to authenticated;
grant execute on function public.produce_quality(uuid, uuid[], integer) to authenticated;
