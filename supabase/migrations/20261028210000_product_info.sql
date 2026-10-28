-- Ficha do produto por código de barras (EAN): marca, peso, NCM etc.
-- Fontes: catálogos dos fabricantes (Tirol, Yoki/Kitano) e Open Food Facts (guardado quando alguém consulta).
create table if not exists public.product_info (
  ean text primary key check (ean ~ '^[0-9]{8,14}$'),
  name text,
  brand text,
  category text,
  quantity numeric,
  unit text,
  ncm text,
  units_per_box int,
  image_url text,
  source text,
  updated_at timestamptz not null default now()
);
alter table public.product_info enable row level security;
create policy "product_info leitura" on public.product_info for select to authenticated using (true);
create policy "product_info grava consulta" on public.product_info for insert to authenticated with check (source = 'Open Food Facts');
