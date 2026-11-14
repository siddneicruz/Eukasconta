-- Qualidade de hortifruti com votos e data da última avaliação por item e por loja.
-- A nota de cada pessoa continua anônima: só média, número de votos e data saem do banco.

-- 1) Um produto: todas as lojas que têm nota, com média, número de votos e data da última avaliação (Cotações, "Onde comprar").
-- Todo usuário vê votos e última avaliação. A média segue a regra do tanque: só com 5 notas ou mais e com tanque (1 por produto por dia).
-- O administrador vê a média sempre, mesmo com poucas notas, sem gastar tanque.
create or replace function public.produce_quality_by_product(p_master_product_id uuid, p_days integer default 90)
returns table (establishment_id uuid, cnpj text, store_name text, avg_score numeric, n integer, last_rated_at timestamptz, locked boolean, tank integer)
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid(); v_admin boolean; v_bal integer; v_seen boolean; v_has boolean; v_open boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_admin := public.is_admin();
  insert into public.produce_tank(user_id) values (v_uid) on conflict do nothing;
  select balance into v_bal from public.produce_tank where user_id = v_uid for update;
  select exists(select 1 from public.produce_ratings r where r.master_product_id = p_master_product_id
                   and r.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 90), 1), 365))) into v_has;
  if not v_has then return; end if;
  select exists(select 1 from public.produce_views v where v.user_id = v_uid and v.master_product_id = p_master_product_id and v.day = current_date) into v_seen;
  v_open := v_admin or v_seen;
  if not v_open and v_bal > 0 then
    insert into public.produce_views(user_id, master_product_id) values (v_uid, p_master_product_id) on conflict do nothing;
    update public.produce_tank set balance = balance - 1, updated_at = now() where user_id = v_uid;
    v_bal := v_bal - 1; v_open := true;
  end if;
  return query
    select r.establishment_id, e.cnpj, coalesce(nullif(btrim(e.alias_name), ''), e.name),
           case when v_open and (v_admin or count(*) >= 5) then round(avg(r.score)::numeric, 1) end,
           count(*)::integer, max(r.created_at), not v_open, v_bal
      from public.produce_ratings r
      join public.establishments e on e.id = r.establishment_id
     where r.master_product_id = p_master_product_id
       and r.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 90), 1), 365))
     group by r.establishment_id, e.cnpj, e.alias_name, e.name
     order by max(r.created_at) desc;
end $$;

-- 1b) produce_quality (card "preços perto de você") passa a devolver também a data da última avaliação
drop function if exists public.produce_quality(uuid, uuid[], integer);
create or replace function public.produce_quality(p_master_product_id uuid, p_establishment_ids uuid[], p_days integer default 14)
returns table (establishment_id uuid, avg_score numeric, n integer, locked boolean, tank integer, last_rated_at timestamptz)
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid(); v_bal integer; v_seen boolean; v_has boolean; v_open boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  insert into public.produce_tank(user_id) values (v_uid) on conflict do nothing;
  select balance into v_bal from public.produce_tank where user_id = v_uid for update;
  select exists(select 1 from public.produce_ratings r
                 where r.master_product_id = p_master_product_id and r.establishment_id = any(coalesce(p_establishment_ids, '{}'))
                   and r.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90))) into v_has;
  if not v_has then return; end if;
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
           count(*)::integer, not v_open, v_bal, max(r.created_at)
      from public.produce_ratings r
     where r.master_product_id = p_master_product_id
       and r.establishment_id = any(coalesce(p_establishment_ids, '{}'))
       and r.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90))
     group by r.establishment_id;
end $$;

-- 2) Uma loja: todos os produtos avaliados nela (bloco Hortifruti do estabelecimento). Só o administrador, por enquanto.
create or replace function public.produce_quality_admin_by_store(p_cnpj text, p_days integer default 90)
returns table (master_product_id uuid, description text, unit_type text, avg_score numeric, n integer, last_rated_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'Só o administrador vê a qualidade sem tanque' using errcode = '42501'; end if;
  return query
    select r.master_product_id, m.description, m.unit_type,
           round(avg(r.score)::numeric, 1), count(*)::integer, max(r.created_at)
      from public.produce_ratings r
      join public.establishments e on e.id = r.establishment_id
      join public.master_products m on m.id = r.master_product_id
     where e.cnpj = regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g')
       and r.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 90), 1), 365))
     group by r.master_product_id, m.description, m.unit_type
     order by avg(r.score) desc;
end $$;

revoke all on function public.produce_quality_by_product(uuid, integer) from public, anon;
revoke all on function public.produce_quality(uuid, uuid[], integer) from public, anon;
revoke all on function public.produce_quality_admin_by_store(text, integer) from public, anon;
grant execute on function public.produce_quality_by_product(uuid, integer) to authenticated;
grant execute on function public.produce_quality(uuid, uuid[], integer) to authenticated;
grant execute on function public.produce_quality_admin_by_store(text, integer) to authenticated;
