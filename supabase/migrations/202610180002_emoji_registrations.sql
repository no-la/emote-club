-- Durable request deduplication; no image data or credentials are stored here.
create table public.emoji_registrations (
  request_id uuid primary key,
  guild_id text not null check (guild_id ~ '^[0-9]{17,20}$'),
  user_id text not null check (user_id ~ '^[0-9]{17,20}$'),
  name text not null check (name ~ '^[A-Za-z0-9_]{2,32}$'),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'unknown')),
  emoji_id text,
  error_code text,
  retry_at timestamptz,
  created_at timestamptz not null default now()
);
create index emoji_registrations_guild_time on public.emoji_registrations(guild_id, created_at desc);
alter table public.emoji_registrations enable row level security;
revoke all on public.emoji_registrations from public, anon, authenticated;
grant all on public.emoji_registrations to service_role;

create function public.reserve_emoji_registration(
  request uuid, guild text, actor text, emoji_name text, digest text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  existing public.emoji_registrations;
  wait_until timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(guild, 91827));
  select * into existing from public.emoji_registrations where request_id = request;
  if found then
    if existing.guild_id <> guild or existing.user_id <> actor or existing.fingerprint <> digest then
      raise exception 'request_conflict';
    end if;
    return jsonb_build_object('claimed', false, 'attempt', to_jsonb(existing));
  end if;
  -- A lost response must never trigger another create, even with a new request ID.
  if exists(select 1 from public.emoji_registrations where guild_id = guild
    and lower(name) = lower(emoji_name) and status in ('pending', 'unknown')) then
    raise exception 'registration_unresolved';
  end if;
  select max(retry_at) into wait_until from public.emoji_registrations where guild_id = guild;
  if wait_until > now() then
    return jsonb_build_object('claimed', false, 'retryAfter', ceil(extract(epoch from wait_until - now())));
  end if;
  -- Application abuse limit, independent of Discord's dynamic rate limits.
  if (select count(*) from public.emoji_registrations where guild_id = guild and user_id = actor and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'registration_throttled';
  end if;
  if exists(select 1 from public.emoji_registrations where guild_id = guild and status = 'pending' and created_at > now() - interval '60 seconds') then
    raise exception 'registration_busy';
  end if;
  insert into public.emoji_registrations(request_id, guild_id, user_id, name, fingerprint)
    values(request, guild, actor, emoji_name, digest) returning * into existing;
  return jsonb_build_object('claimed', true, 'attempt', to_jsonb(existing));
end;
$$;
revoke all on function public.reserve_emoji_registration(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.reserve_emoji_registration(uuid,text,text,text,text) to service_role;
