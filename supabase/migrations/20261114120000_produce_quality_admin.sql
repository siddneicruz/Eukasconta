-- Qualidade de hortifruti para o administrador acompanhar: média e número de notas por loja e por produto,
-- sem o mínimo de 5 notas e sem o tanque (que existem para os demais usuários verem só a média confiável).
-- Ninguém além do administrador executa: a nota de cada pessoa continua anônima, só a média sai daqui.

-- 1) Um produto: todas as lojas que têm nota (para a lista "Onde comprar" da Cotações)
create or replace function public.produce_quality_admin_by_product(p_master_product_id uuid, p_days integer default 90)
returns table (establishment_id uuid, cnpj text, store_name text, avg_score numeric, n integer, last_rated_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'Só o administrador vê a qualidade sem tanque' using errcode = '42501'; end if;
  return query
    select r.establishment_id, e.cnpj, coalesce(nullif(btrim(e.alias_name), ''), e.name),
           round(avg(r.score)::numeric, 1), count(*)::integer, max(r.created_at)
      from public.produce_ratings r
      join public.establishments e on e.id = r.establishment_id
     where r.master_product_id = p_master_product_id
       and r.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 90), 1), 365))
     group by r.establishment_id, e.cnpj, e.alias_name, e.name
     order by avg(r.score) desc;
end $$;

-- 2) Uma loja: todos os produtos avaliados nela (para a aba Hortifruti do estabelecimento)
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

revoke all on function public.produce_quality_admin_by_product(uuid, integer) from public, anon;
revoke all on function public.produce_quality_admin_by_store(text, integer) from public, anon;
grant execute on function public.produce_quality_admin_by_product(uuid, integer) to authenticated;
grant execute on function public.produce_quality_admin_by_store(text, integer) to authenticated;
