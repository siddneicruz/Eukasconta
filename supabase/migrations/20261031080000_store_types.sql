-- Tipos de estabelecimento (Mercado, Restaurante, Farmácia...): lista simples editada na planilha da tabela mãe.
create table if not exists public.store_types (
  name text primary key,
  sort int not null default 0
);
alter table public.store_types enable row level security;
drop policy if exists store_types_read on public.store_types;
create policy store_types_read on public.store_types for select to authenticated using (true);

insert into public.store_types (name, sort) values
  ('Mercado',1),('Padaria',2),('Açougue e Peixaria',3),('Hortifruti',4),('Restaurante e Lanchonete',5),('Farmácia',6),
  ('Academia',7),('Posto de Combustível',8),('Loja de Roupas e Calçados',9),('Casa e Construção',10),('Pet Shop',11),
  ('Eletrônicos',12),('Serviços',13),('Outros',14)
on conflict (name) do nothing;

create or replace function public.publish_store_types(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Só o administrador publica a tabela mãe' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) = 0 then
    raise exception 'A lista de tipos está vazia; nada foi publicado';
  end if;
  delete from public.store_types;
  insert into public.store_types (name, sort)
    select btrim(e.value #>> '{}'), e.ord::int from jsonb_array_elements(p) with ordinality as e(value, ord)
    where btrim(e.value #>> '{}') <> ''
    on conflict (name) do nothing;
  select count(*) into n from public.store_types;
  update public.master_meta set version = version + 1, published_at = now() where id;
  return jsonb_build_object('types', n);
end $$;
grant execute on function public.publish_store_types(jsonb) to authenticated;
