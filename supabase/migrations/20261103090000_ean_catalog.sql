-- Catálogo de EAN (códigos de barras de fabricantes e distribuidores), separado da tabela mãe de produtos.
-- Só entra código com dígito verificador válido (GTIN 8/12/13/14); o resto vai para ean_rejects, para revisão.
create table if not exists public.ean_catalog (
  ean text primary key check (ean ~ '^\d{8}$|^\d{12,14}$'),
  description text not null,
  brand text not null default '',
  manufacturer text not null default '',
  category_src text not null default '',
  ncm text not null default '',
  dun14 text not null default '',
  size_value numeric,
  size_unit text,
  size_text text,
  image_url text not null default '',
  sources jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
create index if not exists ean_catalog_brand_idx on public.ean_catalog (lower(brand));
create table if not exists public.ean_rejects (
  id bigserial primary key,
  ean text not null default '',
  source text not null,
  reason text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);
alter table public.ean_catalog enable row level security;
alter table public.ean_rejects enable row level security;
drop policy if exists ean_catalog_read on public.ean_catalog;
create policy ean_catalog_read on public.ean_catalog for select to authenticated using (true);
drop policy if exists ean_rejects_read on public.ean_rejects;
create policy ean_rejects_read on public.ean_rejects for select to authenticated using (public.is_admin());

-- Importa um lote (sempre em partes pequenas por causa do limite de 8 s). Repetir o lote não duplica nada:
-- o EAN que já existe só ganha as fontes novas.
create or replace function public.ean_import_batch(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare n_new int; n_all int;
begin
  if not public.is_admin() then raise exception 'Só o administrador importa o catálogo de EAN' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'array' then raise exception 'Lote inválido'; end if;
  with src as (
    select e->>'ean' as ean, btrim(e->>'description') as description, btrim(coalesce(e->>'brand','')) as brand,
           btrim(coalesce(e->>'manufacturer','')) as manufacturer, btrim(coalesce(e->>'category_src','')) as category_src,
           coalesce(e->>'ncm','') as ncm, coalesce(e->>'dun14','') as dun14,
           nullif(e->>'size_value','')::numeric as size_value, nullif(e->>'size_unit','') as size_unit, nullif(e->>'size_text','') as size_text,
           coalesce(e->>'image_url','') as image_url, coalesce(e->'sources','[]'::jsonb) as sources
    from jsonb_array_elements(p) e
    where e->>'ean' ~ '^\d{8}$|^\d{12,14}$' and btrim(coalesce(e->>'description','')) <> ''
  ), up as (
    insert into public.ean_catalog as c (ean, description, brand, manufacturer, category_src, ncm, dun14, size_value, size_unit, size_text, image_url, sources)
    select ean, description, brand, manufacturer, category_src, ncm, dun14, size_value, size_unit, size_text, image_url, sources from src
    on conflict (ean) do update set
      sources = (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements(c.sources || excluded.sources) x),
      updated_at = now()
    returning (xmax = 0) as is_new
  )
  select count(*) filter (where is_new), count(*) into n_new, n_all from up;
  return jsonb_build_object('new', n_new, 'seen', n_all);
end $$;
grant execute on function public.ean_import_batch(jsonb) to authenticated;

create or replace function public.ean_reject_batch(p jsonb) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Só o administrador importa o catálogo de EAN' using errcode = '42501'; end if;
  insert into public.ean_rejects (ean, source, reason, description)
    select coalesce(e->>'ean',''), e->>'source', e->>'reason', coalesce(e->>'description','') from jsonb_array_elements(p) e;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.ean_reject_batch(jsonb) to authenticated;
