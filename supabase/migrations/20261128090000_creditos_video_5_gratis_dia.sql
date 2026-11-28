-- Aplicada via Supabase (projeto zmsqyhevruykpmyfzkfe) em 28/11/2026. Só acrescenta tabela/funções e troca as duas funções
-- srv_read_* criadas em 26/11 (sem dados de produção afetados). Regra: 5 leituras grátis por dia (conta comum); depois 1 crédito
-- por leitura; créditos vêm de vídeo (função admob-ssv). Administrador sem limite.
create table if not exists public.video_rewards (
  transaction_id text primary key,
  user_id uuid not null,
  ad_unit text,
  amount integer not null default 1,
  created_at timestamptz not null default now()
);
alter table public.video_rewards enable row level security;
create index if not exists video_rewards_user_day_idx on public.video_rewards (user_id, created_at desc);

drop function if exists public.srv_read_begin(uuid, integer, boolean);
drop function if exists public.srv_read_end(uuid, text, text, integer, integer, numeric, boolean, integer, text, boolean);

create or replace function public.srv_read_begin(p_user uuid, p_free_cap integer default 5)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_admin boolean; v_free_used integer; v_bal integer;
begin
  select (role = 'admin') into v_admin from profiles where id = p_user;
  if v_admin is null then return jsonb_build_object('allowed', false, 'reason', 'sem_perfil'); end if;
  if v_admin then return jsonb_build_object('allowed', true, 'admin', true); end if;
  select count(*) into v_free_used from usage_events
   where user_id = p_user and kind like 'leitura%' and ok and not charged
     and created_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
  if v_free_used < p_free_cap then
    return jsonb_build_object('allowed', true, 'admin', false, 'free_left', p_free_cap - v_free_used);
  end if;
  select coalesce(balance, 0) into v_bal from read_credits where user_id = p_user;
  if coalesce(v_bal, 0) > 0 then return jsonb_build_object('allowed', true, 'admin', false, 'with_credit', true); end if;
  return jsonb_build_object('allowed', false, 'reason', 'sem_credito', 'balance', 0, 'free_cap', p_free_cap);
end $$;

create or replace function public.srv_read_end(
  p_user uuid, p_kind text, p_model text, p_tokens_in integer, p_tokens_out integer, p_cost numeric,
  p_ok boolean, p_ms integer, p_ref text, p_free_cap integer default 5)
returns void language plpgsql security definer set search_path = public as $$
declare v_admin boolean; v_charged boolean := false; v_done boolean; v_free_used integer;
begin
  select (role = 'admin') into v_admin from profiles where id = p_user;
  if p_ok and not coalesce(v_admin, false) then
    select count(*) into v_free_used from usage_events
     where user_id = p_user and kind like 'leitura%' and ok and not charged
       and created_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
    if v_free_used >= p_free_cap then
      update read_credits set balance = balance - 1, updated_at = now() where user_id = p_user and balance > 0 returning true into v_done;
      if coalesce(v_done, false) then
        v_charged := true;
        insert into credit_ledger(user_id, delta, reason, ref) values (p_user, -1, 'leitura', p_ref);
      end if;
    end if;
  end if;
  insert into usage_events(user_id, kind, provider, model, tokens_in, tokens_out, cost_usd, paid_by, ok, ms, ref, charged)
  values (p_user, left(p_kind, 40), 'openrouter', left(p_model, 60), p_tokens_in, p_tokens_out, p_cost, 'owner', p_ok, p_ms, left(p_ref, 80), v_charged);
end $$;

create or replace function public.srv_video_reward(p_user uuid, p_tx text, p_ad_unit text, p_amount integer default 1, p_max_day integer default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_today integer; v_new boolean;
begin
  if not exists (select 1 from profiles where id = p_user) then return jsonb_build_object('ok', false, 'reason', 'sem_perfil'); end if;
  select count(*) into v_today from video_rewards
   where user_id = p_user and created_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
  if v_today >= p_max_day then return jsonb_build_object('ok', false, 'reason', 'limite_videos'); end if;
  insert into video_rewards(transaction_id, user_id, ad_unit, amount) values (p_tx, p_user, left(p_ad_unit, 80), p_amount)
    on conflict (transaction_id) do nothing returning true into v_new;
  if not coalesce(v_new, false) then return jsonb_build_object('ok', true, 'duplicado', true); end if;
  perform _credit_add(p_user, p_amount, 'video', p_tx);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.my_read_status(p_free_cap integer default 5)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_used integer; v_bal integer; v_videos integer; v_admin boolean;
begin
  if v_uid is null then return null; end if;
  select (role = 'admin') into v_admin from profiles where id = v_uid;
  select count(*) into v_used from usage_events where user_id = v_uid and kind like 'leitura%' and ok and not charged
     and created_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
  select coalesce(balance, 0) into v_bal from read_credits where user_id = v_uid;
  select count(*) into v_videos from video_rewards where user_id = v_uid
     and created_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
  return jsonb_build_object('admin', coalesce(v_admin, false), 'balance', coalesce(v_bal, 0),
    'free_left', greatest(p_free_cap - v_used, 0), 'free_cap', p_free_cap, 'videos_today', v_videos);
end $$;

create or replace function public.admin_grant_credits(p_user uuid, p_n integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then raise exception 'apenas administrador'; end if;
  perform _credit_add(p_user, p_n, 'ajuste_admin', null);
end $$;

revoke all on function public.srv_read_begin(uuid, integer) from public, anon, authenticated;
revoke all on function public.srv_read_end(uuid, text, text, integer, integer, numeric, boolean, integer, text, integer) from public, anon, authenticated;
revoke all on function public.srv_video_reward(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.srv_read_begin(uuid, integer) to service_role;
grant execute on function public.srv_read_end(uuid, text, text, integer, integer, numeric, boolean, integer, text, integer) to service_role;
grant execute on function public.srv_video_reward(uuid, text, text, integer, integer) to service_role;
revoke all on function public.my_read_status(integer) from public, anon;
grant execute on function public.my_read_status(integer) to authenticated;
revoke all on function public.admin_grant_credits(uuid, integer) from public, anon;
grant execute on function public.admin_grant_credits(uuid, integer) to authenticated;
