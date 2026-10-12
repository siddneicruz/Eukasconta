-- A pessoa só altera o que é dela (nome e preferências). Plano e id do RevenueCat só o servidor altera.
revoke update on public.profiles from authenticated;
grant update (display_name, ai_provider, share_prices, notify_cheaper_nearby, suggest_radius_km) on public.profiles to authenticated;
