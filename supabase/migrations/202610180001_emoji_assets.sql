-- Run in a dedicated development project first. Discord authentication stays in Next.js.
create table public.emoji_assets (
  id uuid primary key,
  guild_id text not null check (guild_id ~ '^[0-9]{17,20}$'),
  owner_id text not null check (owner_id ~ '^[0-9]{17,20}$'),
  owner_name text not null check (length(owner_name) between 1 and 80),
  name text not null check (length(btrim(name)) between 1 and 80),
  bytes integer not null check (bytes between 1 and 4194304),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  status text not null default 'pending' check (status in ('pending', 'ready', 'deleting')),
  created_at timestamptz not null default now(),
  check (width::bigint * height::bigint <= 16000000)
);
create index emoji_assets_guild_created on public.emoji_assets (guild_id, created_at desc, id);
alter table public.emoji_assets enable row level security;
revoke all on public.emoji_assets from public, anon, authenticated;
grant all on public.emoji_assets to service_role;

-- Count pending uploads and interrupted deletes too: failures cannot free space prematurely.
-- The global lock prevents concurrent requests/guilds from exceeding this project's cap.
create function public.reserve_emoji_asset(
  asset_id uuid, guild text, actor text, actor_name text, asset_name text,
  asset_bytes integer, asset_width integer, asset_height integer
) returns setof public.emoji_assets
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(728194036);
  if (select count(*) >= 500 or coalesce(sum(bytes), 0) + asset_bytes > 134217728 from public.emoji_assets) then
    raise exception 'asset_quota_exceeded';
  end if;
  return query insert into public.emoji_assets (id, guild_id, owner_id, owner_name, name, bytes, width, height)
    values (asset_id, guild, actor, actor_name, asset_name, asset_bytes, asset_width, asset_height)
    returning *;
end;
$$;
revoke all on function public.reserve_emoji_asset(uuid, text, text, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_emoji_asset(uuid, text, text, text, text, integer, integer, integer) to service_role;

-- No client Storage policies. Only the server's service key can read/write this bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('emoji-assets', 'emoji-assets', false, 4194304, array['image/webp']);
