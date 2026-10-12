-- Eu Kasconta — funções: casamento de produtos, contribuição anônima de preços,
-- sugestão de preço menor por perto e alertas.

-- ---------------------------------------------------------------- texto do item
create or replace function public.item_code(t text)
returns text language sql immutable parallel safe
set search_path = public
as $$ select substring(btrim(coalesce(t, '')) from '^(\d{3,14})\s') $$;

create or replace function public.item_clean(t text)
returns text language sql immutable parallel safe
set search_path = public
as $$ select btrim(regexp_replace(btrim(coalesce(t, '')), '^\d{3,14}\s+', '')) $$;

-- Acha o produto mestre de um texto de cupom: mesmo texto na mesma loja, mesmo texto em qualquer loja,
-- ou texto muito parecido (>= 0,80) com a mesma unidade. Nunca cria nada.
create or replace function public._match_master(p_est uuid, p_norm text, p_unit text)
returns table (master_id uuid, kind text)
language sql stable
set search_path = public, extensions
as $$
  select x.master_id, x.kind
  from (
    select a.master_product_id as master_id, 'alias_store'::text as kind, 1 as rk, 1.0::real as score, a.votes
      from public.product_aliases a
     where p_est is not null and a.establishment_id = p_est and a.alias_norm = p_norm
    union all
    select a.master_product_id, 'alias_any'::text, 2, 1.0::real, a.votes
      from public.product_aliases a
     where a.alias_norm = p_norm
    union all
    select a.master_product_id, 'similar'::text, 3, similarity(a.alias_norm, p_norm), a.votes
      from public.product_aliases a
      join public.master_products m on m.id = a.master_product_id
     where a.alias_norm % p_norm and m.unit_type = p_unit and similarity(a.alias_norm, p_norm) >= 0.8
  ) x
  order by x.rk, x.score desc, x.votes desc
  limit 1
$$;

-- ---------------------------------------------------------------- cupons privados: preenchimentos automáticos
create or replace function public.trg_receipt_fill()
returns trigger language plpgsql
set search_path = public, extensions
as $$
begin
  new.cnpj := nullif(regexp_replace(coalesce(new.cnpj, ''), '\D', '', 'g'), '');
  if new.establishment_id is null and new.cnpj is not null then
    select e.id into new.establishment_id from public.establishments e where e.cnpj = new.cnpj;
  end if;
  return new;
end $$;
create trigger trg_receipts_fill before insert or update of cnpj on public.receipts
  for each row execute function public.trg_receipt_fill();

create or replace function public.trg_receipt_item_resolve()
returns trigger language plpgsql
set search_path = public, extensions
as $$
declare v_est uuid;
begin
  if new.master_product_id is null then
    select r.establishment_id into v_est from public.receipts r where r.id = new.receipt_id;
    select m.master_id into new.master_product_id
      from public._match_master(v_est, public.norm_text(public.item_clean(new.description)), upper(coalesce(new.unit_type, 'UN'))) m;
  end if;
  return new;
end $$;
create trigger trg_receipt_items_resolve before insert on public.receipt_items
  for each row execute function public.trg_receipt_item_resolve();

-- Limite de alertas por pessoa
create or replace function public.trg_alert_limit()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.price_alerts a where a.user_id = new.user_id) >= 50 then
    raise exception 'alert_limit: máximo de 50 alertas por conta' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_price_alerts_limit before insert on public.price_alerts
  for each row execute function public.trg_alert_limit();

-- ---------------------------------------------------------------- consultas de leitura
-- Resolve, no cadastro compartilhado, o estabelecimento (por CNPJ) e cada item do cupom.
-- p_items: [{"description": "...", "unit_type": "KG"}]
create or replace function public.resolve_items(p_cnpj text, p_items jsonb)
returns table (input text, master_product_id uuid, master_code text, master_description text,
               master_unit text, master_category text, match_kind text)
language plpgsql stable security invoker
set search_path = public, extensions
as $$
declare
  v_est uuid;
  v_it jsonb;
  v_desc text;
  v_unit text;
  v_mid uuid;
  v_kind text;
begin
  select e.id into v_est from public.establishments e
   where e.cnpj = regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  for v_it in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 300 loop
    v_desc := btrim(coalesce(v_it ->> 'description', ''));
    v_unit := upper(left(coalesce(nullif(btrim(v_it ->> 'unit_type'), ''), 'UN'), 6));
    v_mid := null; v_kind := null;
    if char_length(public.norm_text(public.item_clean(v_desc))) >= 2 then
      select m.master_id, m.kind into v_mid, v_kind
        from public._match_master(v_est, public.norm_text(public.item_clean(v_desc)), v_unit) m;
    end if;
    input := v_desc; master_product_id := v_mid; match_kind := v_kind;
    master_code := null; master_description := null; master_unit := null; master_category := null;
    if v_mid is not null then
      select mp.code, mp.description, mp.unit_type, mp.category
        into master_code, master_description, master_unit, master_category
        from public.master_products mp where mp.id = v_mid;
    end if;
    return next;
  end loop;
end $$;

create or replace function public.search_products(p_query text, p_limit integer default 20)
returns table (id uuid, code text, description text, unit_type text, category text, score real)
language sql stable security invoker
set search_path = public, extensions
as $$
  select m.id, m.code, m.description, m.unit_type, m.category,
         (similarity(m.description, public.norm_text(p_query))
          + case when left(m.description, char_length(public.norm_text(p_query))) = public.norm_text(p_query) then 0.5 else 0 end)::real as score
    from public.master_products m
   where char_length(public.norm_text(p_query)) >= 2
     and (strpos(m.description, public.norm_text(p_query)) > 0 or m.description % public.norm_text(p_query))
   order by score desc, m.description
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- Menor preço recente de um produto nas lojas perto de um ponto (uma linha por loja, a observação mais recente).
create or replace function public.best_prices_nearby(
  p_master_product_id uuid, p_lat double precision, p_lng double precision,
  p_radius_km numeric default 10, p_days integer default 60)
returns table (establishment_id uuid, establishment_name text, address text, city text,
               distance_km numeric, unit_price numeric, unit_type text, observed_on date)
language sql stable security invoker
set search_path = public, extensions
as $$
  select t.* from (
    select distinct on (e.id)
           e.id, coalesce(e.alias_name, e.name), e.address, e.city,
           round((st_distance(e.location, q.pt) / 1000.0)::numeric, 1),
           po.unit_price::numeric, po.unit_type, po.observed_on
      from public.price_observations po
      join public.establishments e on e.id = po.establishment_id
     cross join lateral (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as pt) q
     where po.master_product_id = p_master_product_id
       and not po.suspect
       and po.observed_on >= current_date - greatest(coalesce(p_days, 60), 1)
       and e.location is not null
       and st_dwithin(e.location, q.pt, least(greatest(coalesce(p_radius_km, 10), 0.5), 200) * 1000)
     order by e.id, po.observed_on desc
  ) t
  order by t.unit_price asc, t.observed_on desc
$$;

-- Para cada item pago, o menor preço (>= 5% mais barato) visto em outra loja perto da loja do cupom.
-- p_items: [{"description","master_product_id","unit_type","paid_price"}]
create or replace function public.price_suggestions(
  p_establishment_id uuid, p_items jsonb,
  p_radius_km numeric default 8, p_days integer default 45)
returns jsonb
language plpgsql stable security invoker
set search_path = public, extensions
as $$
declare
  v_loc extensions.geography;
  v_res jsonb;
begin
  select e.location into v_loc from public.establishments e where e.id = p_establishment_id;
  if v_loc is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.savings_pct desc, s.cheaper_price), '[]'::jsonb) into v_res
  from (
    select i.description, i.master_product_id, i.unit_type, i.paid_price,
           best.unit_price as cheaper_price, best.establishment_id,
           coalesce(e.alias_name, e.name) as establishment_name, e.address, e.city,
           round((best.dist / 1000.0)::numeric, 1) as distance_km, best.observed_on,
           round(((i.paid_price - best.unit_price) / i.paid_price * 100)::numeric, 0) as savings_pct
      from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
             as i(description text, master_product_id uuid, unit_type text, paid_price numeric)
      cross join lateral (
        select po.establishment_id, po.unit_price::numeric as unit_price, po.observed_on,
               st_distance(e2.location, v_loc) as dist
          from public.price_observations po
          join public.establishments e2 on e2.id = po.establishment_id
         where po.master_product_id = i.master_product_id
           and po.unit_type = i.unit_type
           and not po.suspect
           and po.establishment_id <> p_establishment_id
           and po.observed_on >= current_date - greatest(coalesce(p_days, 45), 1)
           and e2.location is not null
           and st_dwithin(e2.location, v_loc, least(greatest(coalesce(p_radius_km, 8), 0.5), 200) * 1000)
           and po.unit_price <= i.paid_price * 0.95
         order by po.unit_price asc, po.observed_on desc
         limit 1
      ) best
      join public.establishments e on e.id = best.establishment_id
     where i.master_product_id is not null and i.paid_price > 0
  ) s;
  return v_res;
end $$;

-- ---------------------------------------------------------------- escrita controlada
-- Coordenadas de um estabelecimento (primeira pessoa que informa define; dentro do Brasil).
create or replace function public.set_establishment_location(p_cnpj text, p_lat double precision, p_lng double precision)
returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  v_rows integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_lat is null or p_lng is null or p_lat not between -34 and 6 or p_lng not between -74 and -32 then
    return false;
  end if;
  update public.establishments e
     set location = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, geocode_status = 'found'
   where e.cnpj = v_cnpj and e.location is null;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

-- Recebe um cupom e devolve os itens já casados com o cadastro comum + sugestões de preço menor por perto.
-- Entram no cadastro compartilhado só: loja (CNPJ, nome, endereço), produto, preço, unidade e dia. Nada da pessoa.
-- p: {"cnpj","name","address","city","state","date","time","receipt_number","total","lat","lng",
--     "items":[{"description","quantity","unit_type","unit_price","total_price","category"}]}
create or replace function public.contribute_receipt(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_share boolean;
  v_quota integer;
  v_cnpj text := regexp_replace(coalesce(p ->> 'cnpj', ''), '\D', '', 'g');
  v_date date;
  v_fp text;
  v_rows integer;
  v_new boolean;
  v_name text;
  v_state text;
  v_lat double precision := public.try_numeric(p ->> 'lat');
  v_lng double precision := public.try_numeric(p ->> 'lng');
  v_pt extensions.geography;
  v_est public.establishments;
  v_item jsonb;
  v_desc text; v_code text; v_norm text; v_unit text; v_cat text;
  v_price numeric;
  v_master uuid; v_kind text;
  v_n integer; v_median numeric; v_suspect boolean;
  v_items_out jsonb := '[]'::jsonb;
  v_processed integer := 0;
  v_sugs jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select pr.share_prices into v_share from public.profiles pr where pr.id = v_uid;
  if v_share = false then return jsonb_build_object('status', 'skipped', 'reason', 'opt_out'); end if;

  if not public.is_valid_cnpj(v_cnpj) then
    return jsonb_build_object('status', 'skipped', 'reason', 'invalid_cnpj');
  end if;

  begin v_date := (p ->> 'date')::date; exception when others then v_date := null; end;
  if v_date is null or v_date < date '2020-01-01' or v_date > current_date + 1 then
    return jsonb_build_object('status', 'skipped', 'reason', 'invalid_date');
  end if;

  insert into public.contribution_quota as q (user_id, day, receipts) values (v_uid, current_date, 1)
  on conflict (user_id, day) do update set receipts = q.receipts + 1
  returning q.receipts into v_quota;
  if v_quota > 80 then return jsonb_build_object('status', 'skipped', 'reason', 'rate_limited'); end if;

  v_fp := encode(sha256(convert_to(
            v_cnpj || '|' || v_date::text || '|' || coalesce(p ->> 'time', '') || '|' ||
            coalesce(p ->> 'receipt_number', '') || '|' ||
            coalesce(round(public.try_numeric(p ->> 'total') * 100)::text, ''), 'UTF8')), 'hex');
  insert into public.contribution_batches (fingerprint) values (v_fp) on conflict do nothing;
  get diagnostics v_rows = row_count;
  v_new := v_rows > 0;

  v_name := left(btrim(coalesce(p ->> 'name', '')), 120);
  if v_name = '' then v_name := 'ESTABELECIMENTO DESCONHECIDO'; end if;
  v_state := upper(left(btrim(coalesce(p ->> 'state', '')), 2));
  if v_state !~ '^[A-Z]{2}$' then v_state := null; end if;
  if v_lat is not null and v_lng is not null and v_lat between -34 and 6 and v_lng between -74 and -32 then
    v_pt := st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography;
  end if;

  insert into public.establishments as e (cnpj, name, address, city, state, location, geocode_status, contributions)
  values (v_cnpj, v_name, nullif(left(btrim(coalesce(p ->> 'address', '')), 200), ''),
          nullif(left(btrim(coalesce(p ->> 'city', '')), 80), ''), v_state, v_pt,
          case when v_pt is not null then 'found' else 'pending' end, case when v_new then 1 else 0 end)
  on conflict (cnpj) do update set
    name = case when e.name = 'ESTABELECIMENTO DESCONHECIDO' then excluded.name else e.name end,
    address = coalesce(e.address, excluded.address),
    city = coalesce(e.city, excluded.city),
    state = coalesce(e.state, excluded.state),
    location = coalesce(e.location, excluded.location),
    geocode_status = case when e.location is null and excluded.location is not null then 'found' else e.geocode_status end,
    contributions = e.contributions + case when v_new then 1 else 0 end
  returning * into v_est;

  -- quem contribuiu não recebe aviso do próprio preço
  perform set_config('app.contributor', v_uid::text, true);

  for v_item in select value from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) limit 300 loop
    v_desc := left(btrim(coalesce(v_item ->> 'description', '')), 200);
    v_code := public.item_code(v_desc);
    v_norm := public.norm_text(public.item_clean(v_desc));
    v_unit := upper(left(coalesce(nullif(btrim(v_item ->> 'unit_type'), ''), 'UN'), 6));
    v_price := round(public.try_numeric(v_item ->> 'unit_price'), 4);
    v_cat := left(btrim(coalesce(v_item ->> 'category', '')), 80);
    if char_length(v_norm) < 2 or v_price is null or v_price <= 0 or v_price > 100000 then continue; end if;

    select m.master_id, m.kind into v_master, v_kind from public._match_master(v_est.id, v_norm, v_unit) m;
    if v_master is null then
      insert into public.master_products (description, unit_type, category)
      values (left(v_norm, 160), v_unit, case when v_cat = '' then 'Outros' else v_cat end)
      returning id into v_master;
      v_kind := 'new';
    elsif v_cat <> '' and v_cat <> 'Outros' then
      update public.master_products mp set category = v_cat
       where mp.id = v_master and (mp.category is null or mp.category = 'Outros');
    end if;

    if v_new then
      insert into public.product_aliases as a (master_product_id, establishment_id, alias_norm, alias_raw, store_code)
      values (v_master, v_est.id, v_norm, left(public.item_clean(v_desc), 200), v_code)
      on conflict (alias_norm, establishment_id) do update
        set votes = a.votes + 1, store_code = coalesce(a.store_code, excluded.store_code);

      select count(*), percentile_cont(0.5) within group (order by po.unit_price) into v_n, v_median
        from public.price_observations po
       where po.master_product_id = v_master and po.unit_type = v_unit and not po.suspect
         and po.observed_on >= current_date - 180;
      v_suspect := v_n >= 5 and (v_price < v_median * 0.25 or v_price > v_median * 4);

      insert into public.price_observations (establishment_id, master_product_id, unit_type, unit_price, observed_on, suspect)
      values (v_est.id, v_master, v_unit, v_price, v_date, v_suspect)
      on conflict (establishment_id, master_product_id, unit_type, observed_on, unit_price) do nothing;
    end if;

    v_processed := v_processed + 1;
    v_items_out := v_items_out || jsonb_build_array(jsonb_build_object(
      'description', v_desc, 'master_product_id', v_master, 'unit_type', v_unit, 'paid_price', v_price, 'match', v_kind));
  end loop;

  if v_est.location is not null then
    v_sugs := public.price_suggestions(v_est.id, v_items_out, 8, 45);
  end if;

  return jsonb_build_object(
    'status', case when v_new then 'ok' else 'duplicate' end,
    'establishment_id', v_est.id,
    'needs_location', v_est.location is null,
    'items', v_items_out,
    'suggestions', v_sugs);
end $$;

-- ---------------------------------------------------------------- alertas
create or replace function public.trg_price_obs_notify()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_est public.establishments;
  v_mp public.master_products;
  v_contrib uuid := nullif(current_setting('app.contributor', true), '')::uuid;
  v_name text;
  r record;
  v_dist numeric;
begin
  if new.suspect then return new; end if;
  select * into v_est from public.establishments where id = new.establishment_id;
  select * into v_mp from public.master_products where id = new.master_product_id;
  v_name := coalesce(v_est.alias_name, v_est.name);

  -- 1) alertas que a pessoa criou
  for r in
    select a.*
      from public.price_alerts a
     where a.active
       and a.master_product_id = new.master_product_id
       and (a.unit_type is null or a.unit_type = new.unit_type)
       and (a.min_price is null or new.unit_price >= a.min_price)
       and (a.max_price is null or new.unit_price <= a.max_price)
       and (a.establishment_id is null or a.establishment_id = new.establishment_id)
       and a.user_id is distinct from v_contrib
       and (a.radius_km is null
            or (v_est.location is not null
                and st_dwithin(v_est.location, st_setsrid(st_makepoint(a.center_lng, a.center_lat), 4326)::geography, a.radius_km * 1000)))
  loop
    v_dist := case when v_est.location is not null and r.center_lat is not null
                   then round((st_distance(v_est.location, st_setsrid(st_makepoint(r.center_lng, r.center_lat), 4326)::geography) / 1000.0)::numeric, 1) end;
    insert into public.notifications (user_id, alert_id, observation_id, kind, title, body, payload, dedupe_key)
    values (r.user_id, r.id, new.id, 'alert',
            'Alerta de preço: ' || initcap(lower(v_mp.description)),
            public.fmt_brl(new.unit_price) || '/' || new.unit_type || ' em ' || v_name
              || coalesce(' · ' || replace(to_char(v_dist, 'FM990.0'), '.', ',') || ' km', ''),
            jsonb_build_object('master_product_id', new.master_product_id, 'establishment_id', new.establishment_id,
                               'unit_price', new.unit_price, 'unit_type', new.unit_type, 'observed_on', new.observed_on,
                               'distance_km', v_dist, 'address', v_est.address, 'city', v_est.city),
            'a:' || r.id || ':' || new.establishment_id || ':' || new.observed_on)
    on conflict (user_id, dedupe_key) do nothing;
    update public.price_alerts set last_triggered_at = now() where id = r.id;
  end loop;

  -- 2) aviso automático: quem comprou esse produto mais caro, perto desta loja, nos últimos 60 dias
  if v_est.location is not null then
    for r in
      select distinct on (ri.user_id)
             ri.user_id, ri.unit_price as paid, rc.date as bought_on,
             st_distance(e2.location, v_est.location) as dist
        from public.receipt_items ri
        join public.receipts rc on rc.id = ri.receipt_id
        join public.establishments e2 on e2.id = rc.establishment_id
        join public.profiles pr on pr.id = ri.user_id
       where ri.master_product_id = new.master_product_id
         and upper(coalesce(ri.unit_type, 'UN')) = new.unit_type
         and rc.date >= current_date - 60
         and rc.establishment_id <> new.establishment_id
         and ri.unit_price >= new.unit_price * 1.10
         and e2.location is not null
         and pr.notify_cheaper_nearby
         and st_dwithin(e2.location, v_est.location, pr.suggest_radius_km * 1000)
         and ri.user_id is distinct from v_contrib
         and not exists (select 1 from public.notifications n where n.user_id = ri.user_id and n.observation_id = new.id)
       order by ri.user_id, rc.date desc
    loop
      insert into public.notifications (user_id, observation_id, kind, title, body, payload, dedupe_key)
      values (r.user_id, new.id, 'cheaper_nearby',
              'Mais barato perto de você: ' || initcap(lower(v_mp.description)),
              public.fmt_brl(new.unit_price) || '/' || new.unit_type || ' em ' || v_name
                || ' (' || replace(to_char(round((r.dist / 1000.0)::numeric, 1), 'FM990.0'), '.', ',') || ' km de onde você comprou)'
                || ' · você pagou ' || public.fmt_brl(r.paid) || ' em ' || to_char(r.bought_on, 'DD/MM'),
              jsonb_build_object('master_product_id', new.master_product_id, 'establishment_id', new.establishment_id,
                                 'unit_price', new.unit_price, 'unit_type', new.unit_type, 'paid_price', r.paid,
                                 'savings_pct', round(((r.paid - new.unit_price) / r.paid * 100)::numeric, 0),
                                 'observed_on', new.observed_on, 'address', v_est.address, 'city', v_est.city),
              'c:' || new.master_product_id || ':' || new.establishment_id || ':' || new.observed_on)
      on conflict (user_id, dedupe_key) do nothing;
    end loop;
  end if;

  return new;
end $$;
create trigger trg_price_obs_notify after insert on public.price_observations
  for each row execute function public.trg_price_obs_notify();

-- ---------------------------------------------------------------- permissões das funções
revoke all on function public.trg_price_obs_notify() from public, anon, authenticated;
revoke all on function public.trg_receipt_fill() from public, anon, authenticated;
revoke all on function public.trg_receipt_item_resolve() from public, anon, authenticated;
revoke all on function public.trg_alert_limit() from public, anon, authenticated;
revoke all on function public._match_master(uuid, text, text) from public, anon;
grant execute on function public._match_master(uuid, text, text) to authenticated;
revoke all on function public.contribute_receipt(jsonb) from public, anon;
revoke all on function public.set_establishment_location(text, double precision, double precision) from public, anon;
grant execute on function public.contribute_receipt(jsonb) to authenticated;
grant execute on function public.set_establishment_location(text, double precision, double precision) to authenticated;
revoke all on function public.resolve_items(text, jsonb) from public, anon;
revoke all on function public.search_products(text, integer) from public, anon;
revoke all on function public.best_prices_nearby(uuid, double precision, double precision, numeric, integer) from public, anon;
revoke all on function public.price_suggestions(uuid, jsonb, numeric, integer) from public, anon;
grant execute on function public.resolve_items(text, jsonb) to authenticated;
grant execute on function public.search_products(text, integer) to authenticated;
grant execute on function public.best_prices_nearby(uuid, double precision, double precision, numeric, integer) to authenticated;
grant execute on function public.price_suggestions(uuid, jsonb, numeric, integer) to authenticated;

-- Avisos em tempo real para o app
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
