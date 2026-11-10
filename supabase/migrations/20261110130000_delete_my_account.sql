-- Exclusão de conta pelo próprio usuário (exigência das lojas de apps e da LGPD).
-- Todas as tabelas com user_id têm ON DELETE CASCADE, então apagar o usuário apaga cupons, itens,
-- metas, alertas, avaliações, backups e créditos. As observações de preço (price_observations) são
-- anônimas (sem vínculo com a pessoa) e permanecem.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
