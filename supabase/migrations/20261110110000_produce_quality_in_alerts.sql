-- Avisos de preço (alerta criado pela pessoa e "mais barato perto de você") passam a trazer a nota de qualidade
-- daquela loja para aquele produto, quando houver 5 notas ou mais nos últimos 14 dias.
create or replace function public.produce_quality_note(p_est uuid, p_mp uuid)
returns text language sql stable security definer set search_path = public, extensions as $$
  select case when count(*) >= 5
         then ' · ★ ' || replace(round(avg(score)::numeric, 1)::text, '.', ',') || ' de qualidade aqui (' || count(*) || ' avaliações)' end
    from public.produce_ratings
   where establishment_id = p_est and master_product_id = p_mp and created_at >= now() - interval '14 days'
$$;
revoke all on function public.produce_quality_note(uuid, uuid) from public, anon, authenticated;

do $mig$
declare v text; v2 text;
begin
  select pg_get_functiondef('public.trg_price_obs_notify()'::regprocedure) into v;
  v2 := replace(v, $a$|| coalesce(' · ' || replace(to_char(v_dist, 'FM990.0'), '.', ',') || ' km', ''),$a$,
                   $a$|| coalesce(' · ' || replace(to_char(v_dist, 'FM990.0'), '.', ',') || ' km', '') || coalesce(public.produce_quality_note(new.establishment_id, new.master_product_id), ''),$a$);
  v2 := replace(v2, $b$|| ' · você pagou ' || public.fmt_brl(r.paid) || ' em ' || to_char(r.bought_on, 'DD/MM'),$b$,
                    $b$|| ' · você pagou ' || public.fmt_brl(r.paid) || ' em ' || to_char(r.bought_on, 'DD/MM') || coalesce(public.produce_quality_note(new.establishment_id, new.master_product_id), ''),$b$);
  if v2 = v or position('produce_quality_note' in v2) = 0 or length(v2) - length(v) < 120 then raise exception 'trigger não foi alterado como esperado'; end if;
  execute v2;
end $mig$;
