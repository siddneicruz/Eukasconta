-- Lojas da tabela mãe: apelido e tipo por CNPJ, editados na aba "Lojas" da planilha.
create table if not exists public.master_stores (
  cnpj text primary key,
  name text not null default '',
  type text not null default ''
);
alter table public.master_stores enable row level security;
drop policy if exists master_stores_read on public.master_stores;
create policy master_stores_read on public.master_stores for select to authenticated using (true);

insert into public.master_stores (cnpj, name)
select store_key, max(store_name) from public.master_product_codes
where kind = 'store' and store_key ~ '^\d{11,14}$' and store_name is not null and store_name <> '' and store_name not ilike 'Estabelecimento Identificado%'
group by store_key
on conflict (cnpj) do nothing;

insert into public.master_stores (cnpj, name, type) values ('41813663000102', 'Boka''s', 'Restaurante e Lanchonete')
on conflict (cnpj) do update set name = excluded.name, type = excluded.type;
update public.master_product_codes set store_name = 'Boka''s' where kind = 'store' and store_key = '41813663000102';

create or replace function public.publish_master_stores(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Só o administrador publica a tabela mãe' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'array' then raise exception 'Lista de lojas inválida'; end if;
  delete from public.master_stores;
  insert into public.master_stores (cnpj, name, type)
    select regexp_replace(e->>'cnpj', '\D', '', 'g'), btrim(coalesce(e->>'name','')), btrim(coalesce(e->>'type',''))
    from jsonb_array_elements(p) e
    where regexp_replace(coalesce(e->>'cnpj',''), '\D', '', 'g') ~ '^\d{11,14}$'
    on conflict (cnpj) do nothing;
  update public.master_product_codes c set store_name = s.name from public.master_stores s
    where c.kind = 'store' and c.store_key = s.cnpj and s.name <> '';
  select count(*) into n from public.master_stores;
  update public.master_meta set version = version + 1, published_at = now() where id;
  return jsonb_build_object('stores', n);
end $$;
grant execute on function public.publish_master_stores(jsonb) to authenticated;

-- Endereço da loja (Endereço, Cidade, UF na aba Lojas)
alter table public.master_stores add column if not exists address text not null default '', add column if not exists city text not null default '', add column if not exists state text not null default '';
create or replace function public.publish_master_stores(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Só o administrador publica a tabela mãe' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'array' then raise exception 'Lista de lojas inválida'; end if;
  delete from public.master_stores;
  insert into public.master_stores (cnpj, name, type, address, city, state)
    select regexp_replace(e->>'cnpj', '\D', '', 'g'), btrim(coalesce(e->>'name','')), btrim(coalesce(e->>'type','')),
           btrim(coalesce(e->>'address','')), btrim(coalesce(e->>'city','')), upper(btrim(coalesce(e->>'state','')))
    from jsonb_array_elements(p) e
    where regexp_replace(coalesce(e->>'cnpj',''), '\D', '', 'g') ~ '^\d{11,14}$'
    on conflict (cnpj) do nothing;
  update public.master_product_codes c set store_name = s.name from public.master_stores s
    where c.kind = 'store' and c.store_key = s.cnpj and s.name <> '';
  select count(*) into n from public.master_stores;
  update public.master_meta set version = version + 1, published_at = now() where id;
  return jsonb_build_object('stores', n);
end $$;

-- CEP e razão social
alter table public.master_stores add column if not exists cep text not null default '', add column if not exists legal_name text not null default '';
create or replace function public.publish_master_stores(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Só o administrador publica a tabela mãe' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'array' then raise exception 'Lista de lojas inválida'; end if;
  delete from public.master_stores;
  insert into public.master_stores (cnpj, name, type, address, city, state, cep, legal_name)
    select regexp_replace(e->>'cnpj', '\D', '', 'g'), btrim(coalesce(e->>'name','')), btrim(coalesce(e->>'type','')),
           btrim(coalesce(e->>'address','')), btrim(coalesce(e->>'city','')), upper(btrim(coalesce(e->>'state',''))),
           btrim(coalesce(e->>'cep','')), btrim(coalesce(e->>'legalName',''))
    from jsonb_array_elements(p) e
    where regexp_replace(coalesce(e->>'cnpj',''), '\D', '', 'g') ~ '^\d{11,14}$'
    on conflict (cnpj) do nothing;
  update public.master_product_codes c set store_name = s.name from public.master_stores s
    where c.kind = 'store' and c.store_key = s.cnpj and s.name <> '';
  select count(*) into n from public.master_stores;
  update public.master_meta set version = version + 1, published_at = now() where id;
  return jsonb_build_object('stores', n);
end $$;
