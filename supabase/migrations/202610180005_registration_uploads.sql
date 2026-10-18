
alter table public.emoji_asset_uploads add column purpose text not null default 'asset' check(purpose in ('asset','registration'));
alter table public.emoji_asset_uploads add column registration_name text check(registration_name ~ '^[A-Za-z0-9_]{2,32}$');
create function public.reserve_emoji_registration_upload(upload_id uuid,guild text,actor text,emoji_name text)
returns setof public.emoji_asset_uploads language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(728194036);
  if (select count(*)>=10 from public.emoji_asset_uploads where owner_id=actor and created_at>now()-interval '1 hour')
    or (select count(*)>=3 from public.emoji_asset_uploads where owner_id=actor and state in ('pending','processing') and created_at>now()-interval '10 minutes') then raise exception 'upload_throttled'; end if;
  if (select coalesce(sum(bytes),0) from public.emoji_assets where guild_id=guild) +
     (select count(*)*4194304 from public.emoji_asset_uploads where guild_id=guild)+4194304>134217728 then raise exception 'asset_quota_exceeded'; end if;
  if (select coalesce(sum(bytes),0) from public.emoji_assets) +
     (select count(*)*4194304 from public.emoji_asset_uploads)+4194304>838860800 then raise exception 'project_quota_exceeded'; end if;
  return query insert into public.emoji_asset_uploads(id,guild_id,owner_id,purpose,registration_name)
    values(upload_id,guild,actor,'registration',emoji_name) returning *;
end; $$;
revoke all on function public.reserve_emoji_registration_upload(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_emoji_registration_upload(uuid,text,text,text) to service_role;

-- A durable failed tombstone prevents an old, delayed request from creating after the UI resets.
create function public.cancel_unstarted_emoji_registration(request uuid,guild text,actor text,emoji_name text)
returns setof public.emoji_registrations language plpgsql security definer set search_path='' as $$
declare existing public.emoji_registrations;
begin
  perform pg_advisory_xact_lock(hashtextextended(guild,91827));
  select * into existing from public.emoji_registrations where request_id=request;
  if found then
    if existing.guild_id<>guild or existing.user_id<>actor then raise exception 'request_conflict'; end if;
    return next existing; return;
  end if;
  if (select count(*) from public.emoji_registrations where guild_id=guild and user_id=actor and created_at>now()-interval '10 minutes')>=5 then raise exception 'registration_throttled'; end if;
  return query insert into public.emoji_registrations(request_id,guild_id,user_id,name,fingerprint,status,error_code)
    values(request,guild,actor,emoji_name,repeat('0',64),'failed','cancelled_before_send') returning *;
end; $$;
revoke all on function public.cancel_unstarted_emoji_registration(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.cancel_unstarted_emoji_registration(uuid,text,text,text) to service_role;
