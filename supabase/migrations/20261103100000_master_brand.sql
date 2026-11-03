-- Marca e fabricante dos produtos da tabela mãe. A marca é um atributo (não entra na chave do produto).
-- brand_source: 'ean' (achado pelo código de barras no catálogo), 'planilha' (digitado/aprovado pelo administrador).
-- brand_suggestion: marca reconhecida na descrição, só para o administrador aprovar na planilha (coluna "Sugestão de marca").
alter table public.master_products
  add column if not exists brand text not null default '',
  add column if not exists manufacturer text not null default '',
  add column if not exists brand_source text not null default '',
  add column if not exists brand_suggestion text not null default '';

create or replace function public.publish_master_products(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare pr record; cd record; path text[]; nid uuid; mid uuid; cat text; prods int := 0; unmapped int := 0; codes int := 0;
begin
  if not public.is_admin() then raise exception 'Só o administrador publica a tabela mãe' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'array' then raise exception 'Lista de produtos inválida'; end if;
  create temp table _pm (k text primary key, id uuid) on commit drop;
  with recursive t as (
    select id, lower(name) k from public.taxonomy_master where parent_id is null
    union all select c.id, t.k || '>' || lower(c.name) from public.taxonomy_master c join t on c.parent_id = t.id)
  insert into _pm select k, min(id::text)::uuid from t group by k;
  for pr in select value as v from jsonb_array_elements(p) loop
    if coalesce(btrim(pr.v->>'code'), '') = '' or coalesce(btrim(pr.v->>'description'), '') = '' then continue; end if;
    path := array(select btrim(x) from jsonb_array_elements_text(coalesce(pr.v->'path', '[]'::jsonb)) x);
    nid := null;
    if coalesce(array_length(path, 1), 0) > 0 then
      select _pm.id into nid from _pm where _pm.k = lower(array_to_string(path, '>'));
    end if;
    if nid is null then unmapped := unmapped + 1; end if;
    cat := case when coalesce(array_length(path, 1), 0) >= 2 then path[1] || ' - ' || path[2] when coalesce(array_length(path, 1), 0) = 1 then path[1] else null end;
    insert into public.master_products (code, description, unit_type, category, node_id, brand, manufacturer, brand_source)
    values (btrim(pr.v->>'code'), btrim(pr.v->>'description'), coalesce(nullif(btrim(pr.v->>'unit'), ''), 'UN'), cat, nid,
            btrim(coalesce(pr.v->>'brand','')), btrim(coalesce(pr.v->>'manufacturer','')), case when coalesce(btrim(pr.v->>'brand'),'') <> '' then 'planilha' else '' end)
    on conflict (code) do update set description = excluded.description,
      unit_type = coalesce(nullif(btrim(pr.v->>'unit'), ''), public.master_products.unit_type),
      category = coalesce(excluded.category, public.master_products.category), node_id = excluded.node_id,
      brand = case when pr.v ? 'brand' then excluded.brand else public.master_products.brand end,
      manufacturer = case when pr.v ? 'manufacturer' then excluded.manufacturer else public.master_products.manufacturer end,
      brand_source = case when pr.v ? 'brand' then excluded.brand_source else public.master_products.brand_source end,
      brand_suggestion = case when pr.v ? 'brand' and btrim(coalesce(pr.v->>'brand','')) <> '' then '' else public.master_products.brand_suggestion end
    returning id into mid;
    prods := prods + 1;
    if pr.v ? 'eans' or pr.v ? 'stores' then
      delete from public.master_product_codes where master_product_id = mid;
      for cd in select btrim(x) as c from jsonb_array_elements_text(coalesce(pr.v->'eans', '[]'::jsonb)) x loop
        continue when cd.c = '';
        insert into public.master_product_codes (master_product_id, kind, store_key, code) values (mid, 'ean', '', cd.c) on conflict do nothing;
        codes := codes + 1;
      end loop;
      for cd in select btrim(x->>'code') as c, btrim(coalesce(x->>'key','')) as k, nullif(btrim(coalesce(x->>'name','')),'') as nm
                from jsonb_array_elements(coalesce(pr.v->'stores', '[]'::jsonb)) x loop
        continue when cd.c = '' or cd.k = '';
        insert into public.master_product_codes (master_product_id, kind, store_key, store_name, code) values (mid, 'store', cd.k, cd.nm, cd.c) on conflict do nothing;
        codes := codes + 1;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('products', prods, 'unmapped', unmapped, 'codes', codes);
end $$;
grant execute on function public.publish_master_products(jsonb) to authenticated;
