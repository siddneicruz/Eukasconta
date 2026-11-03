-- Publicar lojas não apaga mais as que não vieram na planilha, e campo vazio nunca apaga campo preenchido.
create or replace function public.publish_master_stores(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Só o administrador publica a tabela mãe' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'array' then raise exception 'Lista de lojas inválida'; end if;
  insert into public.master_stores (cnpj, name, type, address, number, neighborhood, city, state, cep, legal_name)
    select regexp_replace(e->>'cnpj', '\D', '', 'g'), btrim(coalesce(e->>'name','')), btrim(coalesce(e->>'type','')),
           btrim(coalesce(e->>'address','')), btrim(coalesce(e->>'number','')), btrim(coalesce(e->>'neighborhood','')),
           btrim(coalesce(e->>'city','')), upper(btrim(coalesce(e->>'state',''))),
           btrim(coalesce(e->>'cep','')), btrim(coalesce(e->>'legalName',''))
    from jsonb_array_elements(p) e
    where regexp_replace(coalesce(e->>'cnpj',''), '\D', '', 'g') ~ '^\d{11,14}$'
    on conflict (cnpj) do update set
      name = coalesce(nullif(excluded.name,''), master_stores.name),
      type = coalesce(nullif(excluded.type,''), master_stores.type),
      address = coalesce(nullif(excluded.address,''), master_stores.address),
      number = coalesce(nullif(excluded.number,''), master_stores.number),
      neighborhood = coalesce(nullif(excluded.neighborhood,''), master_stores.neighborhood),
      city = coalesce(nullif(excluded.city,''), master_stores.city),
      state = coalesce(nullif(excluded.state,''), master_stores.state),
      cep = coalesce(nullif(excluded.cep,''), master_stores.cep),
      legal_name = coalesce(nullif(excluded.legal_name,''), master_stores.legal_name);
  update public.master_product_codes c set store_name = s.name from public.master_stores s
    where c.kind = 'store' and c.store_key = s.cnpj and s.name <> '';
  select count(*) into n from public.master_stores;
  update public.master_meta set version = version + 1, published_at = now() where id;
  return jsonb_build_object('stores', n);
end $$;

-- avisar os aparelhos de que algo mudou, sem mexer na estrutura (publicação só de produtos)
create or replace function public.publish_master_touch() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v int;
begin
  if not public.is_admin() then raise exception 'Só o administrador publica a tabela mãe' using errcode = '42501'; end if;
  update public.master_meta set version = version + 1, published_at = now() where id returning version into v;
  return jsonb_build_object('version', v);
end $$;
revoke all on function public.publish_master_touch() from public, anon;
grant execute on function public.publish_master_touch() to authenticated;
