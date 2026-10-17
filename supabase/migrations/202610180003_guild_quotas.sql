create or replace function public.reserve_emoji_asset(
  asset_id uuid, guild text, actor text, actor_name text, asset_name text,
  asset_bytes integer, asset_width integer, asset_height integer
) returns setof public.emoji_assets
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(728194036);
  if (select count(*) >= 500 or coalesce(sum(bytes), 0) + asset_bytes > 134217728 from public.emoji_assets where guild_id = guild) then
    raise exception 'asset_quota_exceeded';
  end if;
  if (select coalesce(sum(bytes), 0) + asset_bytes > 838860800 from public.emoji_assets) then
    raise exception 'project_quota_exceeded';
  end if;
  return query insert into public.emoji_assets (id, guild_id, owner_id, owner_name, name, bytes, width, height)
    values (asset_id, guild, actor, actor_name, asset_name, asset_bytes, asset_width, asset_height) returning *;
end;
$$;
revoke all on function public.reserve_emoji_asset(uuid, text, text, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_emoji_asset(uuid, text, text, text, text, integer, integer, integer) to service_role;
