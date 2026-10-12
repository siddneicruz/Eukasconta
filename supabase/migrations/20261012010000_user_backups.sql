-- Backup da conta: uma linha por pessoa com os dados do app (chave do localStorage -> texto) e,
-- à parte, as chaves de IA dela. Serve para o app voltar sozinho depois de reinstalar:
-- é só entrar na conta. Só a própria pessoa lê e grava (RLS); nenhuma outra tabela depende disto.
create table public.user_backups (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  data          jsonb not null default '{}'::jsonb,
  secrets       jsonb not null default '{}'::jsonb,
  receipt_count integer not null default 0,
  app_version   text,
  updated_at    timestamptz not null default now()
);

comment on table public.user_backups is 'Backup privado do app por pessoa (dados + chaves de IA). Só o dono acessa.';
comment on column public.user_backups.secrets is 'Chaves de IA do dono (BYOK). Opcional: o app só envia se a pessoa deixar ligado.';

alter table public.user_backups enable row level security;

create policy user_backups_all_own on public.user_backups for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.user_backups from anon, public;
grant select, insert, update, delete on public.user_backups to authenticated;
