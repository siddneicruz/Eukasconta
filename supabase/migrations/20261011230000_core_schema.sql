-- Eu Kasconta — esquema base
-- Cadastro compartilhado (estabelecimentos por CNPJ, produtos mestre + apelidos), preços anônimos,
-- alertas/notificações e cupons privados de cada usuário. Tudo com RLS.

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------- helpers
create or replace function public.touch_updated_at()
returns trigger language plpgsql
set search_path = public
as $$ begin new.updated_at := now(); return new; end $$;

-- "Maçã  Fuji" -> "MACA FUJI"
create or replace function public.norm_text(t text)
returns text language sql immutable parallel safe
set search_path = public, extensions
as $$ select btrim(regexp_replace(upper(extensions.unaccent(coalesce(t, ''))), '\s+', ' ', 'g')) $$;

create or replace function public.try_numeric(t text)
returns numeric language plpgsql immutable
set search_path = public
as $$ begin return t::numeric; exception when others then return null; end $$;

create or replace function public.fmt_brl(n numeric)
returns text language sql immutable
set search_path = public
as $$ select 'R$ ' || replace(to_char(n, 'FM999999990.00'), '.', ',') $$;

-- CNPJ com dígitos verificadores (mod 11)
create or replace function public.is_valid_cnpj(c text)
returns boolean language plpgsql immutable
set search_path = public
as $$
declare
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int; r int; i int;
begin
  if c is null or c !~ '^[0-9]{14}$' then return false; end if;
  if c ~ '^(.)\1{13}$' then return false; end if;
  s := 0;
  for i in 1..12 loop s := s + substr(c, i, 1)::int * w1[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  if r <> substr(c, 13, 1)::int then return false; end if;
  s := 0;
  for i in 1..13 loop s := s + substr(c, i, 1)::int * w2[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  return r = substr(c, 14, 1)::int;
end $$;

-- ---------------------------------------------------------------- perfil
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  ai_provider text not null default 'gemini'
    check (ai_provider in ('gemini','openai','anthropic','openrouter')),
  plan text not null default 'free' check (plan in ('free','paid')),
  revenuecat_app_user_id text,
  -- privacidade: contribuir com preços (sem vínculo com a pessoa) e receber sugestões
  share_prices boolean not null default true,
  notify_cheaper_nearby boolean not null default true,
  suggest_radius_km numeric(5,1) not null default 8 check (suggest_radius_km between 0.5 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- cadastro compartilhado
create table public.establishments (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null unique check (cnpj ~ '^[0-9]{14}$'),
  name text not null,
  alias_name text,
  address text,
  city text,
  state text check (state is null or char_length(state) = 2),
  location extensions.geography(Point, 4326),
  geocode_status text not null default 'pending' check (geocode_status in ('pending','found','not_found')),
  contributions integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index establishments_location_idx on public.establishments using gist (location);
create index establishments_name_trgm_idx on public.establishments using gin (name extensions.gin_trgm_ops);
create trigger trg_establishments_touch before update on public.establishments
  for each row execute function public.touch_updated_at();

create sequence public.master_product_code_seq;
create table public.master_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('MAE' || lpad(nextval('public.master_product_code_seq')::text, 6, '0')),
  description text not null,
  unit_type text not null default 'UN',
  category text not null default 'Outros',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index master_products_desc_trgm_idx on public.master_products using gin (description extensions.gin_trgm_ops);
create trigger trg_master_products_touch before update on public.master_products
  for each row execute function public.touch_updated_at();

create table public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references public.master_products(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  alias_norm text not null,   -- texto do cupom, normalizado, sem o código da loja
  alias_raw text not null,
  store_code text,            -- código do item na loja (o número que vem antes da descrição)
  votes integer not null default 1,
  created_at timestamptz not null default now(),
  unique (alias_norm, establishment_id)
);
create index product_aliases_master_idx on public.product_aliases (master_product_id);
create index product_aliases_est_idx on public.product_aliases (establishment_id);
create index product_aliases_norm_trgm_idx on public.product_aliases using gin (alias_norm extensions.gin_trgm_ops);

-- Correções sugeridas por usuários (revisão por IA fica para uma função de borda depois)
create table public.product_correction_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  alias_id uuid references public.product_aliases(id) on delete cascade,
  suggested_master_id uuid references public.master_products(id) on delete set null,
  suggested_description text,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  ai_verdict text,
  ai_confidence numeric(4,3),
  ai_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index product_corrections_user_idx on public.product_correction_suggestions (user_id);
create index product_corrections_alias_idx on public.product_correction_suggestions (alias_id);
create index product_corrections_master_idx on public.product_correction_suggestions (suggested_master_id);

-- Preços observados: item + preço + loja + dia. Nenhuma coluna liga o preço a uma pessoa.
create table public.price_observations (
  id bigint generated always as identity primary key,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  master_product_id uuid not null references public.master_products(id) on delete cascade,
  unit_type text not null,
  unit_price numeric(12,4) not null check (unit_price > 0 and unit_price <= 100000),
  observed_on date not null check (observed_on >= date '2020-01-01'),
  suspect boolean not null default false,   -- fora da faixa típica: não entra em sugestões nem alertas
  created_at timestamptz not null default now(),
  unique (establishment_id, master_product_id, unit_type, observed_on, unit_price)
);
create index price_obs_product_idx on public.price_observations (master_product_id, observed_on desc);
create index price_obs_est_idx on public.price_observations (establishment_id, observed_on desc);

-- Controle de duplicidade e limite diário. Sem vínculo com o usuário na tabela de lotes.
create table public.contribution_batches (
  fingerprint text primary key,
  created_at timestamptz not null default now()
);
create table public.contribution_quota (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  receipts integer not null default 0,
  primary key (user_id, day)
);

-- ---------------------------------------------------------------- cupons privados
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id text not null,
  establishment_id uuid references public.establishments(id) on delete set null,
  cnpj text,
  establishment_name text not null default '',
  receipt_number text,
  address text,
  city text,
  state text,
  date date not null,
  time text,
  total_amount numeric(12,2) not null default 0,
  scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);
create index receipts_user_date_idx on public.receipts (user_id, date desc);
create index receipts_est_idx on public.receipts (establishment_id);
create trigger trg_receipts_touch before update on public.receipts
  for each row execute function public.touch_updated_at();

create table public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  position integer not null,
  description text not null,
  quantity numeric(14,4) not null default 1,
  unit_type text,
  unit_price numeric(14,4) not null default 0,
  total_price numeric(14,2) not null default 0,
  category text,
  master_product_id uuid references public.master_products(id) on delete set null,
  unique (receipt_id, position)
);
create index receipt_items_user_idx on public.receipt_items (user_id);
create index receipt_items_master_idx on public.receipt_items (master_product_id, user_id);

-- ---------------------------------------------------------------- alertas e avisos
create table public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  master_product_id uuid not null references public.master_products(id) on delete cascade,
  label text,
  unit_type text,                 -- null = qualquer unidade
  min_price numeric(12,4) check (min_price is null or min_price >= 0),
  max_price numeric(12,4) check (max_price is null or max_price > 0),
  establishment_id uuid references public.establishments(id) on delete cascade,  -- null = qualquer loja
  center_lat double precision check (center_lat is null or center_lat between -90 and 90),
  center_lng double precision check (center_lng is null or center_lng between -180 and 180),
  radius_km numeric(5,1) check (radius_km is null or radius_km between 0.5 and 200),
  active boolean not null default true,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now(),
  check (min_price is not null or max_price is not null),
  check (min_price is null or max_price is null or min_price <= max_price),
  check (radius_km is null or (center_lat is not null and center_lng is not null))
);
create index price_alerts_user_idx on public.price_alerts (user_id);
create index price_alerts_product_idx on public.price_alerts (master_product_id) where active;
create index price_alerts_est_idx on public.price_alerts (establishment_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  alert_id uuid references public.price_alerts(id) on delete cascade,
  observation_id bigint references public.price_observations(id) on delete set null,
  kind text not null check (kind in ('alert','cheaper_nearby')),
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_alert_idx on public.notifications (alert_id);
create index notifications_obs_idx on public.notifications (observation_id);

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.establishments enable row level security;
alter table public.master_products enable row level security;
alter table public.product_aliases enable row level security;
alter table public.product_correction_suggestions enable row level security;
alter table public.price_observations enable row level security;
alter table public.contribution_batches enable row level security;
alter table public.contribution_quota enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;
alter table public.price_alerts enable row level security;
alter table public.notifications enable row level security;

-- Perfil: cada um vê e edita o seu
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Cadastro compartilhado: qualquer pessoa logada lê; escrita só pelas funções do banco
create policy establishments_read on public.establishments for select to authenticated using (true);
create policy master_products_read on public.master_products for select to authenticated using (true);
create policy product_aliases_read on public.product_aliases for select to authenticated using (true);
create policy price_observations_read on public.price_observations for select to authenticated using (true);

-- Correções: cada pessoa cria e lê as suas
create policy corrections_select_own on public.product_correction_suggestions for select to authenticated
  using (user_id = (select auth.uid()));
create policy corrections_insert_own on public.product_correction_suggestions for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending');

-- Cupons: só o dono
create policy receipts_all_own on public.receipts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy receipt_items_all_own on public.receipt_items for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.receipts r where r.id = receipt_id and r.user_id = (select auth.uid()))
  );

-- Alertas: só o dono
create policy alerts_all_own on public.price_alerts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Avisos: o dono lê, marca como lido e apaga; quem cria é o banco (gatilho)
create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete_own on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- Privilégios: sem acesso anônimo; sem escrita direta no que é compartilhado
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on public.establishments, public.master_products,
  public.product_aliases, public.price_observations, public.contribution_batches,
  public.contribution_quota from authenticated;
revoke all on public.contribution_batches, public.contribution_quota from authenticated;
revoke insert, delete, truncate on public.profiles from authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

comment on table public.contribution_batches is 'Só funções do banco acessam (sem policy de propósito).';
comment on table public.contribution_quota is 'Só funções do banco acessam (sem policy de propósito).';
