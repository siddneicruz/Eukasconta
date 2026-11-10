-- "Tanque" de qualidade: quem vê a nota de qualidade gasta 1 do tanque por produto por dia; quem avalia enche (+3, teto 20).
-- Todo mundo começa com o tanque cheio. Tanque vazio = o preço continua aparecendo, a nota de qualidade fica trancada.
create table if not exists public.produce_tank (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 20 check (balance between 0 and 20),
  updated_at timestamptz not null default now()
);
alter table public.produce_tank enable row level security;
comment on table public.produce_tank is 'Só funções do banco acessam (sem policy de propósito).';

create table if not exists public.produce_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  master_product_id uuid not null references public.master_products(id) on delete cascade,
  day date not null default current_date,
  primary key (user_id, master_product_id, day)
);
alter table public.produce_views enable row level security;

create or replace function public.produce_tank_balance()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid(); v_b integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  insert into public.produce_tank(user_id) values (v_uid) on conflict do nothing;
  select balance into v_b from public.produce_tank where user_id = v_uid;
  return v_b;
end $$;

drop function if exists public.produce_quality(uuid, uuid[], integer);
create or replace function public.produce_quality(p_master_product_id uuid, p_establishment_ids uuid[], p_days integer default 14)
returns table (establishment_id uuid, avg_score numeric, n integer, locked boolean, tank integer)
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid(); v_bal integer; v_seen boolean; v_has boolean; v_open boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  insert into public.produce_tank(user_id) values (v_uid) on conflict do nothing;
  select balance into v_bal from public.produce_tank where user_id = v_uid for update;
  select exists(select 1 from public.produce_ratings r
                 where r.master_product_id = p_master_product_id and r.establishment_id = any(coalesce(p_establishment_ids, '{}'))
                   and r.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90))) into v_has;
  if not v_has then return; end if;   -- nada para mostrar: não gasta o tanque
  select exists(select 1 from public.produce_views v where v.user_id = v_uid and v.master_product_id = p_master_product_id and v.day = current_date) into v_seen;
  v_open := v_seen;
  if not v_seen and v_bal > 0 then
    insert into public.produce_views(user_id, master_product_id) values (v_uid, p_master_product_id) on conflict do nothing;
    update public.produce_tank set balance = balance - 1, updated_at = now() where user_id = v_uid;
    v_bal := v_bal - 1; v_open := true;
  end if;
  return query
    select r.establishment_id,
           case when v_open and count(*) >= 5 then round(avg(r.score)::numeric, 1) end,
           count(*)::integer, not v_open, v_bal
      from public.produce_ratings r
     where r.master_product_id = p_master_product_id
       and r.establishment_id = any(coalesce(p_establishment_ids, '{}'))
       and r.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90))
     group by r.establishment_id;
end $$;

-- rate_produce passa a encher o tanque: +3 por nota nova (não por edição), teto 20
create or replace function public.rate_produce(p_cnpj text, p_receipt_ref text, p_items jsonb)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid(); v_est uuid; v_today integer; v_saved integer := 0; v_new integer := 0;
  v_it jsonb; v_mid uuid; v_score integer; v_inserted boolean;
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
      on conflict (user_id, receipt_ref, master_product_id) do update set score = excluded.score
      returning (xmax = 0) into v_inserted;
    v_saved := v_saved + 1;
    if v_inserted then v_new := v_new + 1; end if;
  end loop;
  if v_new > 0 then
    insert into public.produce_tank(user_id) values (v_uid) on conflict do nothing;
    update public.produce_tank set balance = least(20, balance + 3 * v_new), updated_at = now() where user_id = v_uid;
  end if;
  return v_saved;
end $$;

revoke all on function public.produce_tank_balance() from public, anon;
revoke all on function public.produce_quality(uuid, uuid[], integer) from public, anon;
revoke all on function public.rate_produce(text, text, jsonb) from public, anon;
grant execute on function public.produce_tank_balance() to authenticated;
grant execute on function public.produce_quality(uuid, uuid[], integer) to authenticated;
grant execute on function public.rate_produce(text, text, jsonb) to authenticated;
