-- Staging remains private. Signed tokens can only insert at one server-chosen path.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('emoji-upload-staging', 'emoji-upload-staging', false, 4194304, array['image/webp','image/png']);

-- Deliberately no cascading FK: deleting an asset must not release a live upload token's quota.
create table public.emoji_asset_uploads (
  id uuid primary key,
  guild_id text not null check (guild_id ~ '^[0-9]{17,20}$'),
  owner_id text not null check (owner_id ~ '^[0-9]{17,20}$'),
  state text not null default 'pending' check (state in ('pending','processing','ready','failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 hours'
);
create index emoji_asset_uploads_owner_created on public.emoji_asset_uploads(owner_id, created_at);
create index emoji_asset_uploads_expiry on public.emoji_asset_uploads(expires_at);
alter table public.emoji_asset_uploads enable row level security;
revoke all on public.emoji_asset_uploads from public, anon, authenticated;
grant all on public.emoji_asset_uploads to service_role;

-- Include staging reservations, even for already deleted assets, in both quota checks.
create or replace function public.reserve_emoji_asset(
  asset_id uuid, guild text, actor text, actor_name text, asset_name text,
  asset_bytes integer, asset_width integer, asset_height integer
) returns setof public.emoji_assets
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(728194036);
  if (select count(*) >= 500 or coalesce(sum(bytes), 0) + asset_bytes +
      (select count(*) * 4194304 from public.emoji_asset_uploads where guild_id = guild) > 134217728
      from public.emoji_assets where guild_id = guild) then
    raise exception 'asset_quota_exceeded';
  end if;
  if (select coalesce(sum(bytes), 0) + asset_bytes +
      (select count(*) * 4194304 from public.emoji_asset_uploads) > 838860800 from public.emoji_assets) then
    raise exception 'project_quota_exceeded';
  end if;
  return query insert into public.emoji_assets (id,guild_id,owner_id,owner_name,name,bytes,width,height)
    values (asset_id,guild,actor,actor_name,asset_name,asset_bytes,asset_width,asset_height) returning *;
end;
$$;

create function public.reserve_emoji_asset_upload(asset_id uuid, guild text, actor text, actor_name text, asset_name text)
returns setof public.emoji_asset_uploads
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(728194036);
  if (select count(*) >= 10 from public.emoji_asset_uploads where owner_id=actor and created_at > now()-interval '1 hour')
     or (select count(*) >= 3 from public.emoji_asset_uploads where owner_id=actor and state in ('pending','processing') and created_at > now()-interval '10 minutes') then
    raise exception 'upload_throttled';
  end if;
  insert into public.emoji_asset_uploads(id,guild_id,owner_id) values(asset_id,guild,actor);
  -- Reserve worst-case output AND staging bytes atomically, never trust client dimensions/size.
  perform public.reserve_emoji_asset(asset_id,guild,actor,actor_name,asset_name,4194304,1,1);
  return query select * from public.emoji_asset_uploads where id=asset_id;
end;
$$;
revoke all on function public.reserve_emoji_asset_upload(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_emoji_asset_upload(uuid,text,text,text,text) to service_role;
