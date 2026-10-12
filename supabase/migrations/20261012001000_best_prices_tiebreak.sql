-- Empate de dia na mesma loja: vale o preço mais baixo.
create or replace function public.best_prices_nearby(
  p_master_product_id uuid, p_lat double precision, p_lng double precision,
  p_radius_km numeric default 10, p_days integer default 60)
returns table (establishment_id uuid, establishment_name text, address text, city text,
               distance_km numeric, unit_price numeric, unit_type text, observed_on date)
language sql stable security invoker
set search_path = public, extensions
as $$
  select t.* from (
    select distinct on (e.id)
           e.id, coalesce(e.alias_name, e.name), e.address, e.city,
           round((st_distance(e.location, q.pt) / 1000.0)::numeric, 1),
           po.unit_price::numeric, po.unit_type, po.observed_on
      from public.price_observations po
      join public.establishments e on e.id = po.establishment_id
     cross join lateral (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as pt) q
     where po.master_product_id = p_master_product_id
       and not po.suspect
       and po.observed_on >= current_date - greatest(coalesce(p_days, 60), 1)
       and e.location is not null
       and st_dwithin(e.location, q.pt, least(greatest(coalesce(p_radius_km, 10), 0.5), 200) * 1000)
     order by e.id, po.observed_on desc, po.unit_price asc
  ) t
  order by t.unit_price asc, t.observed_on desc
$$;
revoke all on function public.best_prices_nearby(uuid, double precision, double precision, numeric, integer) from public, anon;
grant execute on function public.best_prices_nearby(uuid, double precision, double precision, numeric, integer) to authenticated;
