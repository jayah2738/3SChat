-- 3SChat production schema / migration
-- Run this entire file in the Supabase SQL editor, then configure the email
-- template as described in README.md. It is safe to run more than once.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  phone_number text unique,
  display_name text not null,
  avatar_url text,
  status text not null default 'Hey there! I am using 3SChat.',
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists account_status text not null default 'active';
alter table public.profiles add column if not exists suspension_reason text;
alter table public.profiles add column if not exists suspended_at timestamptz;
alter table public.profiles alter column phone_number drop not null;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('user', 'moderator', 'admin'));
alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check check (account_status in ('active', 'suspended'));
update public.profiles
set display_name = 'User ' || coalesce(nullif(right(phone_number, 4), ''), left(id::text, 8))
where display_name is null;
alter table public.profiles alter column display_name set not null;

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  name text,
  is_group boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.chats add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.chats add column if not exists updated_at timestamptz not null default now();
alter table public.chats add column if not exists encryption_enabled boolean not null default false;
alter table public.chats add column if not exists encryption_salt text;

create table if not exists public.chat_participants (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

alter table public.chat_participants add column if not exists joined_at timestamptz not null default now();
alter table public.chat_participants add column if not exists is_favorite boolean not null default false;
alter table public.chat_participants add column if not exists is_locked boolean not null default false;
alter table public.chat_participants add column if not exists last_read_at timestamptz not null default now();
alter table public.chat_participants add column if not exists is_archived boolean not null default false;
alter table public.chat_participants add column if not exists member_role text not null default 'member';
alter table public.chat_participants add column if not exists lock_pin_hash text;
alter table public.chat_participants drop constraint if exists chat_participants_member_role_check;
alter table public.chat_participants add constraint chat_participants_member_role_check check (member_role in ('owner', 'admin', 'member'));

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text,
  message_type text not null default 'text' check (message_type in ('text', 'image', 'voice', 'file')),
  media_path text,
  media_mime_type text,
  media_size bigint,
  duration_seconds integer,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  encrypted_content text,
  encryption_iv text,
  encryption_version integer,
  constraint message_has_payload check (
    deleted_at is not null or nullif(btrim(content), '') is not null or media_path is not null or encrypted_content is not null
  )
);

alter table public.messages add column if not exists message_type text not null default 'text';
alter table public.messages add column if not exists media_path text;
alter table public.messages add column if not exists media_mime_type text;
alter table public.messages add column if not exists media_size bigint;
alter table public.messages add column if not exists duration_seconds integer;
alter table public.messages add column if not exists updated_at timestamptz not null default now();
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists encrypted_content text;
alter table public.messages add column if not exists encryption_iv text;
alter table public.messages add column if not exists encryption_version integer;
alter table public.messages drop constraint if exists message_has_payload;

-- Preserve files referenced by older installations.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'media_url'
  ) then
    execute 'update public.messages set media_path = media_url where media_path is null and media_url is not null';
  end if;
end $$;

update public.messages set deleted_at = coalesce(deleted_at, created_at)
where nullif(btrim(content), '') is null and media_path is null and encrypted_content is null;
alter table public.messages add constraint message_has_payload check (
  deleted_at is not null or nullif(btrim(content), '') is not null or media_path is not null or encrypted_content is not null
);

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists public.message_pins (
  chat_id uuid not null references public.chats(id) on delete cascade,
  message_id uuid not null unique references public.messages(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);

create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (message_id, user_id)
);

create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  description text not null default '',
  avatar_url text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create table if not exists public.community_chats (
  community_id uuid not null references public.communities(id) on delete cascade,
  chat_id uuid not null unique references public.chats(id) on delete cascade,
  primary key (community_id, chat_id)
);

create table if not exists public.status_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text,
  media_path text,
  media_mime_type text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint update_has_payload check (nullif(btrim(content), '') is not null or media_path is not null)
);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  initiated_by uuid not null references public.profiles(id) on delete cascade,
  call_type text not null default 'audio' check (call_type in ('audio', 'video')),
  status text not null default 'ringing' check (status in ('ringing', 'accepted', 'declined', 'ended', 'missed')),
  offer_sdp jsonb,
  answer_sdp jsonb,
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz
);

create table if not exists public.call_ice_candidates (
  id bigint generated always as identity primary key,
  call_id uuid not null references public.calls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  candidate jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_error_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  message text not null,
  stack text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.blocked_users (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint cannot_block_self check (blocker_id <> blocked_id)
);

create table if not exists public.moderation_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  message_content text,
  message_type text,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  review_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.moderation_reports add column if not exists message_content text;
alter table public.moderation_reports add column if not exists message_type text;

create table if not exists public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_session_id text not null,
  updated_at timestamptz not null default now()
);

-- Migrate the old device-id column without trusting it as an authenticated session.
alter table public.user_sessions add column if not exists active_session_id text;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_sessions' and column_name = 'active_device_id'
  ) then
    execute 'update public.user_sessions set active_session_id = active_device_id where active_session_id is null';
    execute 'alter table public.user_sessions drop column active_device_id';
  end if;
end $$;
delete from public.user_sessions where active_session_id is null;
alter table public.user_sessions alter column active_session_id set not null;

create index if not exists chat_participants_user_idx on public.chat_participants(user_id, chat_id);
create index if not exists messages_chat_created_idx on public.messages(chat_id, created_at);
create index if not exists messages_chat_created_id_idx on public.messages(chat_id, created_at desc, id desc);
create index if not exists reactions_message_idx on public.message_reactions(message_id);
create index if not exists message_pins_chat_idx on public.message_pins(chat_id, pinned_at desc);
create index if not exists message_receipts_user_idx on public.message_receipts(user_id, read_at);
create index if not exists status_updates_expires_idx on public.status_updates(expires_at desc);
create index if not exists calls_chat_started_idx on public.calls(chat_id, started_at desc);
create index if not exists reports_status_created_idx on public.moderation_reports(status, created_at desc);
create index if not exists audit_created_idx on public.admin_audit_logs(created_at desc);
create index if not exists chats_updated_idx on public.chats(updated_at desc);

create or replace function public.current_session_id()
returns text
language sql
stable
security invoker
as $$
  select nullif(auth.jwt() ->> 'session_id', '');
$$;

create or replace function public.is_active_session()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_sessions us
    join public.profiles p on p.id = us.user_id and p.account_status = 'active'
    where us.user_id = auth.uid()
      and us.active_session_id = public.current_session_id()
  );
$$;

create or replace function public.activate_session()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_id text := public.current_session_id();
begin
  if auth.uid() is null or session_id is null then
    raise exception 'An authenticated Supabase session is required';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and account_status = 'active') then
    raise exception 'This account is suspended';
  end if;

  insert into public.user_sessions(user_id, active_session_id, updated_at)
  values (auth.uid(), session_id, now())
  on conflict (user_id) do update
    set active_session_id = excluded.active_session_id,
        updated_at = excluded.updated_at;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_session() and exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin' and account_status = 'active'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_session() and exists (
    select 1 from public.profiles where id = auth.uid() and role in ('moderator', 'admin') and account_status = 'active'
  );
$$;

create or replace function public.release_session()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.user_sessions
  where user_id = auth.uid()
    and active_session_id = public.current_session_id();
$$;

create or replace function public.change_phone_number(new_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text;
begin
  if not public.is_active_session() then raise exception 'Recent authentication required'; end if;
  normalized := regexp_replace(new_phone, '[^0-9+]', '', 'g');
  if normalized !~ '^\+[0-9]{8,15}$' then raise exception 'Enter a valid international phone number'; end if;
  update public.profiles set phone_number = normalized where id = auth.uid();
exception when unique_violation then
  raise exception 'That phone number is already registered';
end;
$$;

create or replace function public.is_chat_member(target_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_session() and exists (
    select 1 from public.chat_participants cp
    where cp.chat_id = target_chat_id and cp.user_id = auth.uid()
  );
$$;

create or replace function public.create_direct_chat(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  found_chat_id uuid;
begin
  if not public.is_active_session() then raise exception 'Inactive session'; end if;
  if target_user_id = auth.uid() then raise exception 'You cannot create a direct chat with yourself'; end if;
  if not exists (select 1 from public.profiles where id = target_user_id) then raise exception 'User not found'; end if;

  select c.id into found_chat_id
  from public.chats c
  join public.chat_participants mine on mine.chat_id = c.id and mine.user_id = auth.uid()
  join public.chat_participants theirs on theirs.chat_id = c.id and theirs.user_id = target_user_id
  where not c.is_group
    and (select count(*) from public.chat_participants all_cp where all_cp.chat_id = c.id) = 2
  limit 1;

  if found_chat_id is null then
    insert into public.chats(is_group, created_by) values (false, auth.uid()) returning id into found_chat_id;
    insert into public.chat_participants(chat_id, user_id)
    values (found_chat_id, auth.uid()), (found_chat_id, target_user_id);
  end if;

  return found_chat_id;
end;
$$;

create or replace function public.create_self_chat()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  found_chat_id uuid;
begin
  if not public.is_active_session() then raise exception 'Inactive session'; end if;

  select c.id into found_chat_id
  from public.chats c
  join public.chat_participants cp on cp.chat_id = c.id and cp.user_id = auth.uid()
  where not c.is_group
    and (select count(*) from public.chat_participants all_cp where all_cp.chat_id = c.id) = 1
  limit 1;

  if found_chat_id is null then
    insert into public.chats(name, is_group, created_by)
    values ('Message yourself', false, auth.uid()) returning id into found_chat_id;
    insert into public.chat_participants(chat_id, user_id) values (found_chat_id, auth.uid());
  end if;

  return found_chat_id;
end;
$$;

-- One compact row per conversation for the chat list. This avoids downloading
-- every message and receipt whenever the sidebar refreshes.
create or replace function public.get_chat_summaries()
returns table (
  chat_id uuid,
  last_message_content text,
  last_message_type text,
  last_message_encrypted boolean,
  last_message_deleted_at timestamptz,
  last_message_created_at timestamptz,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    membership.chat_id,
    latest.content,
    latest.message_type,
    latest.encrypted_content is not null,
    latest.deleted_at,
    latest.created_at,
    coalesce(unread.total, 0)
  from public.chat_participants membership
  left join lateral (
    select m.content, m.message_type, m.encrypted_content, m.deleted_at, m.created_at
    from public.messages m
    where m.chat_id = membership.chat_id
    order by m.created_at desc, m.id desc
    limit 1
  ) latest on true
  left join lateral (
    select count(*) as total
    from public.messages m
    where m.chat_id = membership.chat_id
      and m.sender_id <> auth.uid()
      and m.deleted_at is null
      and m.created_at > membership.last_read_at
  ) unread on true
  where membership.user_id = auth.uid()
    and public.is_active_session();
$$;

create or replace function public.set_chat_preferences(
  target_chat_id uuid,
  favorite_value boolean default null,
  locked_value boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_chat_member(target_chat_id) then raise exception 'Chat access denied'; end if;
  update public.chat_participants
  set is_favorite = coalesce(favorite_value, is_favorite)
  where chat_id = target_chat_id and user_id = auth.uid();
end;
$$;

create or replace function public.set_chat_archived(target_chat_id uuid, archived_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_chat_member(target_chat_id) then raise exception 'Chat access denied'; end if;
  update public.chat_participants set is_archived = archived_value
  where chat_id = target_chat_id and user_id = auth.uid();
end;
$$;

create or replace function public.enable_chat_encryption(target_chat_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  salt_value text;
begin
  if not public.is_chat_member(target_chat_id) then raise exception 'Chat access denied'; end if;
  select encryption_salt into salt_value from public.chats where id = target_chat_id;
  if salt_value is null then salt_value := encode(extensions.gen_random_bytes(16), 'base64'); end if;
  update public.chats set encryption_enabled = true, encryption_salt = salt_value where id = target_chat_id;
  return salt_value;
end;
$$;

create or replace function public.set_chat_lock_pin(target_chat_id uuid, pin_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_chat_member(target_chat_id) then raise exception 'Chat access denied'; end if;
  if pin_value !~ '^\d{4,8}$' then raise exception 'PIN must contain 4 to 8 digits'; end if;
  update public.chat_participants
  set is_locked = true, lock_pin_hash = extensions.crypt(pin_value, extensions.gen_salt('bf', 10))
  where chat_id = target_chat_id and user_id = auth.uid();
end;
$$;

create or replace function public.verify_chat_lock_pin(target_chat_id uuid, pin_value text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.is_active_session() and exists (
    select 1 from public.chat_participants
    where chat_id = target_chat_id and user_id = auth.uid() and is_locked
      and lock_pin_hash is not null and lock_pin_hash = extensions.crypt(pin_value, lock_pin_hash)
  );
$$;

create or replace function public.clear_chat_lock(target_chat_id uuid, pin_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.verify_chat_lock_pin(target_chat_id, pin_value) then raise exception 'Incorrect chat PIN'; end if;
  update public.chat_participants set is_locked = false, lock_pin_hash = null
  where chat_id = target_chat_id and user_id = auth.uid();
end;
$$;

create or replace function public.create_group(group_name text, member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_chat_id uuid;
begin
  if not public.is_active_session() then raise exception 'Inactive session'; end if;
  if char_length(btrim(group_name)) < 2 then raise exception 'Group name is too short'; end if;
  insert into public.chats(name, is_group, created_by)
  values (left(btrim(group_name), 100), true, auth.uid()) returning id into new_chat_id;
  insert into public.chat_participants(chat_id, user_id, member_role)
  values (new_chat_id, auth.uid(), 'owner');
  insert into public.chat_participants(chat_id, user_id, member_role)
  select new_chat_id, member_id, 'member'
  from (select distinct unnest(coalesce(member_ids, array[]::uuid[])) as member_id) selected
  join public.profiles p on p.id = selected.member_id and p.account_status = 'active'
  where member_id <> auth.uid()
  on conflict do nothing;
  return new_chat_id;
end;
$$;

create or replace function public.update_group(target_chat_id uuid, group_name text default null, add_member_ids uuid[] default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_session() or not exists (
    select 1 from public.chat_participants cp join public.chats c on c.id = cp.chat_id
    where cp.chat_id = target_chat_id and cp.user_id = auth.uid() and c.is_group and cp.member_role in ('owner', 'admin')
  ) then raise exception 'Group administrator access required'; end if;
  if group_name is not null then
    if char_length(btrim(group_name)) < 2 then raise exception 'Group name is too short'; end if;
    update public.chats set name = left(btrim(group_name), 100), updated_at = now() where id = target_chat_id;
  end if;
  insert into public.chat_participants(chat_id, user_id, member_role)
  select target_chat_id, member_id, 'member'
  from (select distinct unnest(coalesce(add_member_ids, array[]::uuid[])) as member_id) selected
  join public.profiles p on p.id = selected.member_id and p.account_status = 'active'
  where member_id <> auth.uid()
  on conflict do nothing;
end;
$$;

create or replace function public.remove_group_member(target_chat_id uuid, target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_user_id <> auth.uid() and not exists (
    select 1 from public.chat_participants where chat_id = target_chat_id and user_id = auth.uid() and member_role in ('owner', 'admin')
  ) then raise exception 'Group administrator access required'; end if;
  if exists (select 1 from public.chat_participants where chat_id = target_chat_id and user_id = target_user_id and member_role = 'owner') then
    raise exception 'Transfer ownership before removing the owner';
  end if;
  delete from public.chat_participants where chat_id = target_chat_id and user_id = target_user_id;
end;
$$;

create or replace function public.create_community(community_name text, community_description text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_community_id uuid;
  announcement_chat_id uuid;
begin
  if not public.is_active_session() then raise exception 'Inactive session'; end if;
  insert into public.communities(name, description, created_by)
  values (left(btrim(community_name), 100), left(coalesce(community_description, ''), 500), auth.uid())
  returning id into new_community_id;
  insert into public.community_members(community_id, user_id, member_role)
  values (new_community_id, auth.uid(), 'owner');
  insert into public.chats(name, is_group, created_by)
  values (left(btrim(community_name), 90) || ' Announcements', true, auth.uid()) returning id into announcement_chat_id;
  insert into public.chat_participants(chat_id, user_id, member_role) values (announcement_chat_id, auth.uid(), 'owner');
  insert into public.community_chats(community_id, chat_id) values (new_community_id, announcement_chat_id);
  return new_community_id;
end;
$$;

create or replace function public.toggle_message_pin(target_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_chat_id uuid;
begin
  select chat_id into target_chat_id from public.messages
  where id = target_message_id and deleted_at is null;
  if target_chat_id is null or not public.is_chat_member(target_chat_id) then
    raise exception 'Message access denied';
  end if;

  if exists (select 1 from public.message_pins where message_id = target_message_id) then
    delete from public.message_pins where message_id = target_message_id;
    return false;
  end if;

  insert into public.message_pins(chat_id, message_id, pinned_by)
  values (target_chat_id, target_message_id, auth.uid());
  return true;
end;
$$;

create or replace function public.edit_message(target_message_id uuid, new_content text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(new_content), '') is null then raise exception 'Message cannot be empty'; end if;
  update public.messages
  set content = left(btrim(new_content), 5000), edited_at = now(), updated_at = now()
  where id = target_message_id
    and sender_id = auth.uid()
    and message_type = 'text'
    and deleted_at is null
    and public.is_chat_member(chat_id);
  if not found then raise exception 'Message cannot be edited'; end if;
end;
$$;

create or replace function public.delete_message(target_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.messages
  set content = null, media_path = null, media_mime_type = null, media_size = null,
      duration_seconds = null, encrypted_content = null, encryption_iv = null, encryption_version = null,
      deleted_at = now(), updated_at = now()
  where id = target_message_id
    and sender_id = auth.uid()
    and deleted_at is null
    and public.is_chat_member(chat_id);
  if not found then raise exception 'Message cannot be deleted'; end if;
  delete from public.message_pins where message_id = target_message_id;
end;
$$;

create or replace function public.mark_chat_read(target_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_chat_member(target_chat_id) then raise exception 'Chat access denied'; end if;
  update public.messages
  set is_read = true, updated_at = now()
  where chat_id = target_chat_id and sender_id <> auth.uid() and not is_read;
  update public.chat_participants cp set last_read_at = now()
  where cp.chat_id = target_chat_id and cp.user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      left join public.message_receipts receipt
        on receipt.message_id = m.id and receipt.user_id = auth.uid()
      where m.chat_id = target_chat_id
        and m.sender_id <> auth.uid()
        and m.deleted_at is null
        and receipt.read_at is null
    );
  insert into public.message_receipts(message_id, user_id, delivered_at, read_at)
  select m.id, auth.uid(), now(), now()
  from public.messages m
  where m.chat_id = target_chat_id and m.sender_id <> auth.uid() and m.deleted_at is null
  on conflict (message_id, user_id) do update
    set read_at = excluded.read_at
    where public.message_receipts.read_at is null;
end;
$$;

create or replace function public.can_send_to_chat(target_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_chat_member(target_chat_id) and not exists (
    select 1
    from public.chat_participants other
    join public.blocked_users blocked
      on (blocked.blocker_id = auth.uid() and blocked.blocked_id = other.user_id)
      or (blocked.blocked_id = auth.uid() and blocked.blocker_id = other.user_id)
    where other.chat_id = target_chat_id and other.user_id <> auth.uid()
  );
$$;

create or replace function public.is_community_member(target_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_session() and exists (
    select 1 from public.community_members where community_id = target_community_id and user_id = auth.uid()
  );
$$;

create or replace function public.toggle_block_user(target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_session() then raise exception 'Inactive session'; end if;
  if target_user_id = auth.uid() then raise exception 'You cannot block yourself'; end if;
  if not exists (select 1 from public.profiles where id = target_user_id) then raise exception 'User not found'; end if;

  if exists (select 1 from public.blocked_users where blocker_id = auth.uid() and blocked_id = target_user_id) then
    delete from public.blocked_users where blocker_id = auth.uid() and blocked_id = target_user_id;
    return false;
  end if;
  insert into public.blocked_users(blocker_id, blocked_id) values (auth.uid(), target_user_id);
  return true;
end;
$$;

create or replace function public.submit_report(target_message_id uuid, report_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  reported_user uuid;
  target_chat uuid;
  reported_content text;
  reported_type text;
  report_id uuid;
begin
  select sender_id, chat_id, content, message_type into reported_user, target_chat, reported_content, reported_type from public.messages
  where id = target_message_id and deleted_at is null;
  if target_chat is null or not public.is_chat_member(target_chat) then raise exception 'Message access denied'; end if;
  if reported_user = auth.uid() then raise exception 'You cannot report your own message'; end if;
  if char_length(btrim(report_reason)) < 3 then raise exception 'Please provide a report reason'; end if;

  insert into public.moderation_reports(reporter_id, reported_user_id, message_id, message_content, message_type, reason)
  values (auth.uid(), reported_user, target_message_id, reported_content, reported_type, left(btrim(report_reason), 1000))
  returning id into report_id;
  return report_id;
end;
$$;

create or replace function public.admin_set_user_status(target_user_id uuid, new_status text, reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if new_status not in ('active', 'suspended') then raise exception 'Invalid account status'; end if;
  if target_user_id = auth.uid() and new_status = 'suspended' then raise exception 'You cannot suspend your own account'; end if;

  update public.profiles set
    account_status = new_status,
    suspension_reason = case when new_status = 'suspended' then nullif(left(btrim(reason), 500), '') else null end,
    suspended_at = case when new_status = 'suspended' then now() else null end
  where id = target_user_id;
  if not found then raise exception 'User not found'; end if;
  if new_status = 'suspended' then delete from public.user_sessions where user_id = target_user_id; end if;

  insert into public.admin_audit_logs(actor_id, target_user_id, action, details)
  values (auth.uid(), target_user_id, 'user_status_changed', jsonb_build_object('status', new_status, 'reason', reason));
end;
$$;

create or replace function public.admin_set_user_role(target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if new_role not in ('user', 'moderator', 'admin') then raise exception 'Invalid role'; end if;
  if target_user_id = auth.uid() and new_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin' and account_status = 'active') <= 1 then
    raise exception 'The last active administrator cannot be demoted';
  end if;

  update public.profiles set role = new_role where id = target_user_id;
  if not found then raise exception 'User not found'; end if;
  insert into public.admin_audit_logs(actor_id, target_user_id, action, details)
  values (auth.uid(), target_user_id, 'user_role_changed', jsonb_build_object('role', new_role));
end;
$$;

create or replace function public.admin_review_report(target_report_id uuid, new_status text, note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reported_user uuid;
begin
  if not public.is_staff() then raise exception 'Moderator access required'; end if;
  if new_status not in ('reviewing', 'resolved', 'dismissed') then raise exception 'Invalid report status'; end if;
  update public.moderation_reports set
    status = new_status,
    review_note = nullif(left(btrim(note), 1000), ''),
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = target_report_id
  returning reported_user_id into reported_user;
  if not found then raise exception 'Report not found'; end if;
  insert into public.admin_audit_logs(actor_id, target_user_id, action, details)
  values (auth.uid(), reported_user, 'report_reviewed', jsonb_build_object('report_id', target_report_id, 'status', new_status));
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  supplied_phone text;
  supplied_name text;
  supplied_avatar text;
  auth_provider text;
begin
  supplied_phone := coalesce(nullif(new.raw_user_meta_data ->> 'phone_number', ''), nullif(new.phone, ''));
  auth_provider := coalesce(nullif(new.raw_app_meta_data ->> 'provider', ''), 'email');
  if supplied_phone is null and auth_provider <> 'google' then
    raise exception 'A phone number is required for 3SChat accounts';
  end if;

  supplied_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    case when supplied_phone is not null then 'User ' || right(supplied_phone, 4) end,
    'Google user'
  );
  supplied_avatar := coalesce(
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(new.raw_user_meta_data ->> 'picture', '')
  );
  insert into public.profiles(id, phone_number, display_name, avatar_url)
  values (new.id, supplied_phone, left(supplied_name, 60), supplied_avatar)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.touch_chat_after_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.chats set updated_at = now() where id = new.chat_id;
  return new;
end;
$$;

drop trigger if exists touch_chat_on_message on public.messages;
create trigger touch_chat_on_message after insert on public.messages
for each row execute function public.touch_chat_after_message();

alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_participants enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.message_pins enable row level security;
alter table public.message_receipts enable row level security;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_chats enable row level security;
alter table public.status_updates enable row level security;
alter table public.calls enable row level security;
alter table public.call_ice_candidates enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.client_error_events enable row level security;
alter table public.blocked_users enable row level security;
alter table public.moderation_reports enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.user_sessions enable row level security;

do $$ declare policy_name text; table_name text;
begin
  for table_name in select unnest(array['profiles','chats','chat_participants','messages','message_reactions','message_pins','message_receipts','communities','community_members','community_chats','status_updates','calls','call_ice_candidates','push_subscriptions','client_error_events','blocked_users','moderation_reports','admin_audit_logs','user_sessions']) loop
    for policy_name in select polname from pg_policy where polrelid = ('public.' || table_name)::regclass loop
      execute format('drop policy if exists %I on public.%I', policy_name, table_name);
    end loop;
  end loop;
end $$;

create policy profiles_read on public.profiles for select to authenticated using (public.is_active_session());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active_session())
  with check (id = auth.uid() and public.is_active_session());
revoke update on public.profiles from authenticated;
grant update(display_name, avatar_url, status, last_seen) on public.profiles to authenticated;

create policy chats_read on public.chats for select to authenticated using (public.is_chat_member(id));
create policy participants_read on public.chat_participants for select to authenticated using (public.is_chat_member(chat_id));

create policy messages_read on public.messages for select to authenticated using (public.is_chat_member(chat_id));
create policy messages_send on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.can_send_to_chat(chat_id));

create policy reactions_read on public.message_reactions for select to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id and public.is_chat_member(m.chat_id))
);
create policy reactions_add on public.message_reactions for insert to authenticated with check (
  user_id = auth.uid() and exists (
    select 1 from public.messages m where m.id = message_id and public.is_chat_member(m.chat_id)
  )
);
create policy reactions_remove on public.message_reactions for delete to authenticated using (
  user_id = auth.uid() and public.is_active_session()
);
create policy pins_read on public.message_pins for select to authenticated using (public.is_chat_member(chat_id));
create policy receipts_read on public.message_receipts for select to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id and public.is_chat_member(m.chat_id))
);
create policy communities_read on public.communities for select to authenticated using (public.is_community_member(id));
create policy community_members_read on public.community_members for select to authenticated using (public.is_community_member(community_id));
create policy community_chats_read on public.community_chats for select to authenticated using (public.is_community_member(community_id));
create policy updates_read on public.status_updates for select to authenticated using (public.is_active_session() and expires_at > now());
create policy updates_create on public.status_updates for insert to authenticated with check (user_id = auth.uid() and public.is_active_session());
create policy updates_delete on public.status_updates for delete to authenticated using (user_id = auth.uid() and public.is_active_session());
create policy calls_read on public.calls for select to authenticated using (public.is_chat_member(chat_id));
create policy calls_create on public.calls for insert to authenticated with check (initiated_by = auth.uid() and public.can_send_to_chat(chat_id));
create policy calls_update on public.calls for update to authenticated using (public.is_chat_member(chat_id)) with check (public.is_chat_member(chat_id));
create policy ice_read on public.call_ice_candidates for select to authenticated using (
  exists (select 1 from public.calls c where c.id = call_id and public.is_chat_member(c.chat_id))
);
create policy ice_create on public.call_ice_candidates for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.calls c where c.id = call_id and public.is_chat_member(c.chat_id))
);
create policy push_manage_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid() and public.is_active_session())
  with check (user_id = auth.uid() and public.is_active_session());
create policy errors_create on public.client_error_events for insert to authenticated with check (user_id = auth.uid() and public.is_active_session());
create policy errors_read_admin on public.client_error_events for select to authenticated using (public.is_admin());
create policy blocks_read_own on public.blocked_users for select to authenticated using (
  public.is_active_session() and (blocker_id = auth.uid() or blocked_id = auth.uid())
);
create policy reports_read_own_or_admin on public.moderation_reports for select to authenticated using (
  (reporter_id = auth.uid() and public.is_active_session()) or public.is_staff()
);
create policy audit_read_admin on public.admin_audit_logs for select to authenticated using (public.is_admin());

-- Old sessions may read this one row so Realtime can tell them they were replaced.
create policy sessions_read_self on public.user_sessions for select to authenticated using (user_id = auth.uid());

revoke all on function public.current_session_id() from public, anon;
revoke all on function public.is_active_session() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_staff() from public, anon;
revoke all on function public.activate_session() from public, anon;
revoke all on function public.release_session() from public, anon;
revoke all on function public.change_phone_number(text) from public, anon;
revoke all on function public.is_chat_member(uuid) from public, anon;
revoke all on function public.create_direct_chat(uuid) from public, anon;
revoke all on function public.create_self_chat() from public, anon;
revoke all on function public.get_chat_summaries() from public, anon;
revoke all on function public.set_chat_preferences(uuid, boolean, boolean) from public, anon;
revoke all on function public.set_chat_archived(uuid, boolean) from public, anon;
revoke all on function public.enable_chat_encryption(uuid) from public, anon;
revoke all on function public.set_chat_lock_pin(uuid, text) from public, anon;
revoke all on function public.verify_chat_lock_pin(uuid, text) from public, anon;
revoke all on function public.clear_chat_lock(uuid, text) from public, anon;
revoke all on function public.create_group(text, uuid[]) from public, anon;
revoke all on function public.update_group(uuid, text, uuid[]) from public, anon;
revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
revoke all on function public.create_community(text, text) from public, anon;
revoke all on function public.toggle_message_pin(uuid) from public, anon;
revoke all on function public.edit_message(uuid, text) from public, anon;
revoke all on function public.delete_message(uuid) from public, anon;
revoke all on function public.mark_chat_read(uuid) from public, anon;
revoke all on function public.can_send_to_chat(uuid) from public, anon;
revoke all on function public.is_community_member(uuid) from public, anon;
revoke all on function public.toggle_block_user(uuid) from public, anon;
revoke all on function public.submit_report(uuid, text) from public, anon;
revoke all on function public.admin_set_user_status(uuid, text, text) from public, anon;
revoke all on function public.admin_set_user_role(uuid, text) from public, anon;
revoke all on function public.admin_review_report(uuid, text, text) from public, anon;
grant execute on function public.current_session_id() to authenticated;
grant execute on function public.is_active_session() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.activate_session() to authenticated;
grant execute on function public.release_session() to authenticated;
grant execute on function public.change_phone_number(text) to authenticated;
grant execute on function public.is_chat_member(uuid) to authenticated;
grant execute on function public.create_direct_chat(uuid) to authenticated;
grant execute on function public.create_self_chat() to authenticated;
grant execute on function public.get_chat_summaries() to authenticated;
grant execute on function public.set_chat_preferences(uuid, boolean, boolean) to authenticated;
grant execute on function public.set_chat_archived(uuid, boolean) to authenticated;
grant execute on function public.enable_chat_encryption(uuid) to authenticated;
grant execute on function public.set_chat_lock_pin(uuid, text) to authenticated;
grant execute on function public.verify_chat_lock_pin(uuid, text) to authenticated;
grant execute on function public.clear_chat_lock(uuid, text) to authenticated;
grant execute on function public.create_group(text, uuid[]) to authenticated;
grant execute on function public.update_group(uuid, text, uuid[]) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.create_community(text, text) to authenticated;
grant execute on function public.toggle_message_pin(uuid) to authenticated;
grant execute on function public.edit_message(uuid, text) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;
grant execute on function public.can_send_to_chat(uuid) to authenticated;
grant execute on function public.is_community_member(uuid) to authenticated;
grant execute on function public.toggle_block_user(uuid) to authenticated;
grant execute on function public.submit_report(uuid, text) to authenticated;
grant execute on function public.admin_set_user_status(uuid, text, text) to authenticated;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;
grant execute on function public.admin_review_report(uuid, text, text) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media', 'chat-media', false, 5242880,
  array['image/jpeg','image/png','image/webp','image/gif','audio/webm','audio/ogg','audio/mp4','audio/mpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'status-media', 'status-media', false, 5242880,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_media_read on storage.objects;
drop policy if exists chat_media_upload on storage.objects;
drop policy if exists chat_media_delete on storage.objects;

create policy chat_media_read on storage.objects for select to authenticated using (
  bucket_id = 'chat-media' and public.is_chat_member((storage.foldername(name))[1]::uuid)
);
create policy chat_media_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[2] = auth.uid()::text
  and public.is_chat_member((storage.foldername(name))[1]::uuid)
);
create policy chat_media_delete on storage.objects for delete to authenticated using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[2] = auth.uid()::text
  and public.is_chat_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists status_media_read on storage.objects;
drop policy if exists status_media_upload on storage.objects;
drop policy if exists status_media_delete on storage.objects;

create policy status_media_read on storage.objects for select to authenticated using (
  bucket_id = 'status-media' and public.is_active_session()
);
create policy status_media_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'status-media'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.is_active_session()
);
create policy status_media_delete on storage.objects for delete to authenticated using (
  bucket_id = 'status-media'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.is_active_session()
);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_pins') then
    alter publication supabase_realtime add table public.message_pins;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_sessions') then
    alter publication supabase_realtime add table public.user_sessions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_participants') then
    alter publication supabase_realtime add table public.chat_participants;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_receipts') then
    alter publication supabase_realtime add table public.message_receipts;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'status_updates') then
    alter publication supabase_realtime add table public.status_updates;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calls') then
    alter publication supabase_realtime add table public.calls;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_ice_candidates') then
    alter publication supabase_realtime add table public.call_ice_candidates;
  end if;
end $$;
