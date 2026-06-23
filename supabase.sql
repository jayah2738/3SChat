-- 3SChat production schema / migration
-- Run this entire file in the Supabase SQL editor, then configure the email
-- template as described in README.md. It is safe to run more than once.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  phone_number text not null unique,
  display_name text not null,
  avatar_url text,
  status text not null default 'Hey there! I am using 3SChat.',
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists created_at timestamptz not null default now();
update public.profiles set display_name = 'User ' || right(phone_number, 4) where display_name is null;
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

create table if not exists public.chat_participants (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

alter table public.chat_participants add column if not exists joined_at timestamptz not null default now();

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
  constraint message_has_payload check (
    nullif(btrim(content), '') is not null or media_path is not null
  )
);

alter table public.messages add column if not exists message_type text not null default 'text';
alter table public.messages add column if not exists media_path text;
alter table public.messages add column if not exists media_mime_type text;
alter table public.messages add column if not exists media_size bigint;
alter table public.messages add column if not exists duration_seconds integer;
alter table public.messages add column if not exists updated_at timestamptz not null default now();

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

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
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
create index if not exists reactions_message_idx on public.message_reactions(message_id);
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

  insert into public.user_sessions(user_id, active_session_id, updated_at)
  values (auth.uid(), session_id, now())
  on conflict (user_id) do update
    set active_session_id = excluded.active_session_id,
        updated_at = excluded.updated_at;
end;
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
begin
  supplied_phone := coalesce(nullif(new.raw_user_meta_data ->> 'phone_number', ''), nullif(new.phone, ''));
  if supplied_phone is null then
    raise exception 'A phone number is required for 3SChat accounts';
  end if;

  supplied_name := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 'User ' || right(supplied_phone, 4));
  insert into public.profiles(id, phone_number, display_name)
  values (new.id, supplied_phone, supplied_name)
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
alter table public.user_sessions enable row level security;

do $$ declare policy_name text; table_name text;
begin
  for table_name in select unnest(array['profiles','chats','chat_participants','messages','message_reactions','user_sessions']) loop
    for policy_name in select polname from pg_policy where polrelid = ('public.' || table_name)::regclass loop
      execute format('drop policy if exists %I on public.%I', policy_name, table_name);
    end loop;
  end loop;
end $$;

create policy profiles_read on public.profiles for select to authenticated using (public.is_active_session());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active_session())
  with check (id = auth.uid() and public.is_active_session());

create policy chats_read on public.chats for select to authenticated using (public.is_chat_member(id));
create policy participants_read on public.chat_participants for select to authenticated using (public.is_chat_member(chat_id));

create policy messages_read on public.messages for select to authenticated using (public.is_chat_member(chat_id));
create policy messages_send on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_chat_member(chat_id));

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

-- Old sessions may read this one row so Realtime can tell them they were replaced.
create policy sessions_read_self on public.user_sessions for select to authenticated using (user_id = auth.uid());

revoke all on function public.current_session_id() from public, anon;
revoke all on function public.is_active_session() from public, anon;
revoke all on function public.activate_session() from public, anon;
revoke all on function public.release_session() from public, anon;
revoke all on function public.is_chat_member(uuid) from public, anon;
revoke all on function public.create_direct_chat(uuid) from public, anon;
revoke all on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.current_session_id() to authenticated;
grant execute on function public.is_active_session() to authenticated;
grant execute on function public.activate_session() to authenticated;
grant execute on function public.release_session() to authenticated;
grant execute on function public.is_chat_member(uuid) to authenticated;
grant execute on function public.create_direct_chat(uuid) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media', 'chat-media', false, 15728640,
  array['image/jpeg','image/png','image/webp','image/gif','audio/webm','audio/ogg','audio/mp4','audio/mpeg']
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

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_sessions') then
    alter publication supabase_realtime add table public.user_sessions;
  end if;
end $$;
