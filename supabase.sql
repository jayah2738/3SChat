-- 3SChat Supabase Database Setup Script
-- Paste this script into your Supabase SQL Editor to set up the schema, policies, and triggers.

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Clean up existing triggers/tables if they exist (uncomment if resetting)
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop function if exists public.handle_new_user();
-- drop table if exists public.user_sessions cascade;
-- drop table if exists public.messages cascade;
-- drop table if exists public.chat_participants cascade;
-- drop table if exists public.chats cascade;
-- drop table if exists public.profiles cascade;

-- 1. Create Profiles Table (extends auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  phone_number text unique not null,
  display_name text,
  avatar_url text,
  status text default 'Hey there! I am using 3SChat.',
  last_seen timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Create Chats Table
create table public.chats (
  id uuid default gen_random_uuid() primary key,
  name text,
  is_group boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Create Chat Participants Table (Many-to-Many)
create table public.chat_participants (
  chat_id uuid references public.chats(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  primary key (chat_id, user_id)
);

-- 4. Create Messages Table
create table public.messages (
  id uuid default gen_random_uuid() primary key,
  chat_id uuid references public.chats(id) on delete cascade not null,
  sender_id uuid references public.profiles(id) on delete cascade not null,
  content text,
  media_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  is_read boolean default false
);

-- 5. Create User Sessions Table (Tracks device logs)
create table public.user_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade unique not null,
  active_device_id text not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_participants enable row level security;
alter table public.messages enable row level security;
alter table public.user_sessions enable row level security;

-- 6. RLS Policies

-- PROFILES Policies
create policy "Allow public read-only access to profiles" 
  on public.profiles for select 
  using (auth.role() = 'authenticated');

create policy "Allow users to update their own profile" 
  on public.profiles for update 
  using (auth.uid() = id);

-- CHATS Policies
create policy "Allow users to see chats they are in" 
  on public.chats for select 
  using (
    exists (
      select 1 from public.chat_participants 
      where chat_participants.chat_id = chats.id 
      and chat_participants.user_id = auth.uid()
    )
  );

create policy "Allow authenticated users to create chats" 
  on public.chats for insert 
  with check (auth.role() = 'authenticated');

-- CHAT_PARTICIPANTS Policies
create policy "Allow users to see participants of their chats" 
  on public.chat_participants for select 
  using (
    exists (
      select 1 from public.chat_participants cp
      where cp.chat_id = chat_participants.chat_id 
      and cp.user_id = auth.uid()
    )
  );

create policy "Allow users to add participants to chats" 
  on public.chat_participants for insert 
  with check (auth.role() = 'authenticated');

-- MESSAGES Policies
create policy "Allow users to read messages in their chats" 
  on public.messages for select 
  using (
    exists (
      select 1 from public.chat_participants 
      where chat_participants.chat_id = messages.chat_id 
      and chat_participants.user_id = auth.uid()
    )
  );

create policy "Allow users to send messages to their chats" 
  on public.messages for insert 
  with check (
    auth.uid() = sender_id 
    and exists (
      select 1 from public.chat_participants 
      where chat_participants.chat_id = messages.chat_id 
      and chat_participants.user_id = auth.uid()
    )
  );

-- USER_SESSIONS Policies
create policy "Allow users to read their own session" 
  on public.user_sessions for select 
  using (auth.uid() = user_id);

create policy "Allow users to insert/update their own session" 
  on public.user_sessions for insert 
  with check (auth.uid() = user_id);

create policy "Allow users to update their own session" 
  on public.user_sessions for update 
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- 7. Trigger to automatically handle profiles when user signs up
create or replace function public.handle_new_user()
returns trigger as $$
declare
  raw_phone text;
  raw_display text;
begin
  -- Try to extract phone or fallback to email
  raw_phone := coalesce(new.phone, split_part(new.email, '@', 1));
  raw_display := coalesce(
    new.raw_user_meta_data->>'display_name', 
    'User_' || substr(new.id::text, 1, 6)
  );

  insert into public.profiles (id, phone_number, display_name, avatar_url, status)
  values (
    new.id,
    raw_phone,
    raw_display,
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      'https://api.dicebear.com/7.x/bottts/svg?seed=' || encode(hmac(new.id::text, 'seed', 'sha256'), 'hex')
    ),
    'Hey there! I am using 3SChat.'
  );
  return new;
end;
$$ language plpgsql security definer;

-- Bind the trigger
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Enable Realtime for message inserts, chat updates, and user session changes
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.user_sessions;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.chat_participants;
