-- O envio de preços ao cadastro comum virou automático (sem chave nem botão); o limite de 80 cupons por dia sai.
-- Fica um teto de segurança de 5000 por dia só contra abuso. Cópia da função anterior: public._bkp_contribute_receipt_20261114.
create table if not exists public._bkp_contribute_receipt_20261114 as
  select now() as feito_em, pg_get_functiondef('public.contribute_receipt(jsonb)'::regprocedure) as definicao;
alter table public._bkp_contribute_receipt_20261114 enable row level security;
do $m$
declare d text;
begin
  d := pg_get_functiondef('public.contribute_receipt(jsonb)'::regprocedure);
  if d not like '%v_quota > 80%' then raise exception 'trecho do limite não encontrado'; end if;
  execute replace(d, 'v_quota > 80', 'v_quota > 5000');
end $m$;
