-- Leituras de preço de TODOS os usuários num raio (base do comparativo entre lojas).
-- Anônimo: sai loja, produto, preço, unidade e dia. Nunca quem leu. Só para quem está logado.
create or replace function public.shared_price_observations(
  p_lat double precision, p_lng double precision,
  p_radius_km numeric default 30, p_days integer default 400, p_limit integer default 20000)
returns table(master_product_id uuid, description text, category text, unit_type text, ean text,
              establishment_id uuid, cnpj text, store_name text, store_type text,
              distance_km numeric, unit_price numeric, observed_on date)
language plpgsql stable security definer
set search_path to 'public', 'extensions'
as $function$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return query
  select m.id, m.description, m.category, po.unit_type,
         (select c.code from public.master_product_codes c
           where c.master_product_id = m.id and c.kind = 'ean' and c.code ~ '^[0-9]{8,14}$'
           order by length(c.code) desc limit 1),
         e.id, e.cnpj, coalesce(e.alias_name, e.name), ms.type,
         round((st_distance(e.location, q.pt) / 1000.0)::numeric, 1),
         po.unit_price::numeric, po.observed_on
    from public.price_observations po
    join public.master_products m on m.id = po.master_product_id
    join public.establishments e on e.id = po.establishment_id
    left join public.master_stores ms on ms.cnpj = e.cnpj
   cross join lateral (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as pt) q
   where not po.suspect
     and po.observed_on >= current_date - least(greatest(coalesce(p_days, 400), 1), 800)
     and e.location is not null
     and st_dwithin(e.location, q.pt, least(greatest(coalesce(p_radius_km, 30), 0.5), 200) * 1000)
   order by po.observed_on desc
   limit least(greatest(coalesce(p_limit, 20000), 1), 50000);
end $function$;

revoke all on function public.shared_price_observations(double precision, double precision, numeric, integer, integer) from public, anon;
grant execute on function public.shared_price_observations(double precision, double precision, numeric, integer, integer) to authenticated;
