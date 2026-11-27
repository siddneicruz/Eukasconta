-- Aplicada via Supabase (projeto zmsqyhevruykpmyfzkfe) em 26/11/2026, com backup das três tabelas (_bkp_leitura_20261126_*).
-- Leitura de cupom pelo servidor: colunas novas em usage_events e as funções srv_read_begin / srv_read_end
-- (só service_role; usadas pela função de borda read-receipt). Tudo aditivo.
alter table public.usage_events
  add column if not exists ok boolean not null default true,
  add column if not exists ms integer,
  add column if not exists ref text,
  add column if not exists charged boolean not null default false;
create index if not exists usage_events_user_day_idx on public.usage_events (user_id, created_at desc);
-- srv_read_begin(p_user, p_daily_cap, p_charge): confere admin, limite diário (America/Sao_Paulo) e saldo; não desconta.
-- srv_read_end(...): grava tokens e custo; desconta 1 crédito só se ok, cobrança ligada e não for admin.
