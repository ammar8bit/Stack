-- StackTime "Study Together" multiplayer rooms (up to 5 people per room)
-- Run this in Supabase Dashboard -> SQL Editor -> New query -> Run. Safe to run again after updates.
-- (supabase-setup.sql must already have been run; this file is independent of user_progress.)
--
-- Privacy: a room stores a display name, a status (studying / paused / idle), the time studied
-- since joining the room, and the room's recent chat messages (last 200). Only members of a room
-- can read any of it. Rooms are joined by a 6-character code and deleted when the last person leaves.

create table if not exists public.study_rooms (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  created_by uuid not null references auth.users(id) on delete cascade,
  target_hours numeric not null default 0 check (target_hours >= 0 and target_hours <= 100),
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_code text not null references public.study_rooms(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  status text not null default 'idle' check (status in ('studying', 'paused', 'idle')),
  -- Time studied in this room (ms, starts at 0 on joining) at the moment of updated_at. While
  -- status = 'studying' the other members' browsers add the time elapsed since updated_at, which
  -- is what makes the counter live.
  elapsed_ms bigint not null default 0 check (elapsed_ms >= 0 and elapsed_ms < 100000000000),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_code, user_id)
);

-- When this member first reached the room goal (decides who won the race)
alter table public.room_members add column if not exists reached_at timestamptz;

create index if not exists room_members_user_idx on public.room_members (user_id);

create table if not exists public.room_messages (
  id bigint generated always as identity primary key,
  room_code text not null references public.study_rooms(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  kind text not null default 'text' check (kind in ('text', 'cheer', 'nudge')),
  body text not null check (char_length(body) between 1 and 300),
  target_user uuid,
  created_at timestamptz not null default now()
);

create index if not exists room_messages_room_idx on public.room_messages (room_code, id desc);

alter table public.study_rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_messages enable row level security;

-- Membership check used by the policies (security definer avoids recursive RLS on room_members).
create or replace function public.is_room_member(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members
    where room_code = p_code and user_id = (select auth.uid())
  );
$$;

drop policy if exists "Members can read their room" on public.study_rooms;
create policy "Members can read their room"
on public.study_rooms for select to authenticated
using (public.is_room_member(code));

drop policy if exists "Members can read room members" on public.room_members;
create policy "Members can read room members"
on public.room_members for select to authenticated
using (public.is_room_member(room_code));

-- Members may only change their own row, and only its status / time (column grant below).
-- Joining goes through join_room() so the 5-person limit cannot be bypassed.
drop policy if exists "Members can update their own row" on public.room_members;
create policy "Members can update their own row"
on public.room_members for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke insert, update on public.room_members from anon, authenticated;
grant update (status, elapsed_ms) on public.room_members to authenticated;

drop policy if exists "Members can leave" on public.room_members;
create policy "Members can leave"
on public.room_members for delete to authenticated
using ((select auth.uid()) = user_id);

-- Chat is read by members; sending goes through send_room_message() (no direct inserts).
drop policy if exists "Members can read room chat" on public.room_messages;
create policy "Members can read room chat"
on public.room_messages for select to authenticated
using (public.is_room_member(room_code));

revoke insert, update, delete on public.room_messages from anon, authenticated;
revoke insert, update, delete on public.study_rooms from anon, authenticated;

-- updated_at is always set by the server, never trusted from the browser (avoids clock skew),
-- and only moves when the time or status actually changed. Also stamps the moment the goal is hit.
create or replace function public.touch_room_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target numeric;
begin
  if new.elapsed_ms is distinct from old.elapsed_ms or new.status is distinct from old.status then
    new.updated_at := now();
  end if;
  if new.reached_at is null then
    select target_hours into v_target from public.study_rooms where code = new.room_code;
    if coalesce(v_target, 0) > 0 and new.elapsed_ms >= v_target * 3600000 then
      new.reached_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists room_members_touch on public.room_members;
create trigger room_members_touch
before update on public.room_members
for each row execute function public.touch_room_member();

create or replace function public.clean_room_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(left(btrim(regexp_replace(coalesce(p_name, ''), '[\r\n\t]+', ' ', 'g')), 24), ''), 'Student');
$$;

-- Leave every room; a room is deleted (with its chat) when its last member leaves.
create or replace function public.leave_all_rooms()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  with gone as (
    delete from public.room_members where user_id = v_user returning room_code
  )
  delete from public.study_rooms r
  where r.code in (select room_code from gone)
    and not exists (
      select 1 from public.room_members m where m.room_code = r.code and m.user_id <> v_user
    );
end;
$$;

-- Create a room and join it. A person is in one room at a time.
create or replace function public.create_room(p_name text, p_target numeric default 0)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_try int := 0;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  perform public.leave_all_rooms();
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into public.study_rooms (code, created_by, target_hours)
      values (v_code, v_user, greatest(0, least(coalesce(p_target, 0), 100)));
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 10 then raise exception 'Could not create a room, please try again'; end if;
    end;
  end loop;
  insert into public.room_members (room_code, user_id, display_name)
  values (v_code, v_user, public.clean_room_name(p_name));
  return v_code;
end;
$$;

-- Join a room by code (max 5 members). Everyone starts at 0.
create or replace function public.join_room(p_code text, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_count int;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  -- Lock the room row so two people joining at once cannot exceed the limit.
  perform 1 from public.study_rooms where code = v_code for update;
  if not found then raise exception 'Room not found. Check the code and try again.'; end if;

  if exists (select 1 from public.room_members where room_code = v_code and user_id = v_user) then
    update public.room_members set display_name = public.clean_room_name(p_name)
    where room_code = v_code and user_id = v_user;
    return v_code;
  end if;

  select count(*) into v_count from public.room_members where room_code = v_code;
  if v_count >= 5 then raise exception 'This room is full (5 people max).'; end if;

  perform public.leave_all_rooms();
  insert into public.room_members (room_code, user_id, display_name)
  values (v_code, v_user, public.clean_room_name(p_name));
  return v_code;
end;
$$;

-- Change the room goal. The race is re-judged against the new goal.
create or replace function public.set_room_target(p_code text, p_hours numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_room_member(p_code) then raise exception 'You are not in this room'; end if;
  update public.study_rooms
  set target_hours = greatest(0, least(coalesce(p_hours, 0), 100))
  where code = p_code;
  update public.room_members set reached_at = null where room_code = p_code;
end;
$$;

-- One round trip: members + the shared goal + the server clock. The browser uses server_now_ms to
-- correct for its own clock being wrong, so live counters agree between friends.
create or replace function public.room_snapshot(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_target numeric;
begin
  if v_user is null or not public.is_room_member(p_code) then
    raise exception 'not_a_member';
  end if;
  select target_hours into v_target from public.study_rooms where code = p_code;
  return jsonb_build_object(
    'server_now_ms', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'target_hours', coalesce(v_target, 0),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'name', m.display_name,
        'status', m.status,
        'elapsed_ms', m.elapsed_ms,
        'updated_ms', (extract(epoch from m.updated_at) * 1000)::bigint,
        'reached_ms', case when m.reached_at is null then null
                           else (extract(epoch from m.reached_at) * 1000)::bigint end,
        'is_me', m.user_id = v_user
      ) order by m.joined_at)
      from public.room_members m where m.room_code = p_code
    ), '[]'::jsonb)
  );
end;
$$;

-- Send a chat message, cheer or nudge. The sender's name is taken from their membership,
-- so it cannot be faked, and there is a small rate limit.
create or replace function public.send_room_message(p_code text, p_kind text, p_body text, p_target uuid default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_recent int;
  v_id bigint;
  v_body text := left(btrim(coalesce(p_body, '')), 300);
begin
  select display_name into v_name from public.room_members
  where room_code = p_code and user_id = v_user;
  if v_name is null then raise exception 'You are not in this room'; end if;
  if v_body = '' then raise exception 'Message is empty'; end if;
  if p_kind not in ('text', 'cheer', 'nudge') then raise exception 'Invalid message'; end if;

  select count(*) into v_recent from public.room_messages
  where room_code = p_code and user_id = v_user and created_at > now() - interval '10 seconds';
  if v_recent >= 8 then raise exception 'Slow down a little'; end if;

  insert into public.room_messages (room_code, user_id, display_name, kind, body, target_user)
  values (p_code, v_user, v_name, p_kind, v_body, p_target)
  returning id into v_id;

  -- Keep only the room's most recent 200 messages
  delete from public.room_messages
  where room_code = p_code
    and id < (select id from public.room_messages where room_code = p_code
              order by id desc offset 199 limit 1);
  return v_id;
end;
$$;

revoke all on function public.create_room(text, numeric) from public, anon;
revoke all on function public.join_room(text, text) from public, anon;
revoke all on function public.leave_all_rooms() from public, anon;
revoke all on function public.set_room_target(text, numeric) from public, anon;
revoke all on function public.room_snapshot(text) from public, anon;
revoke all on function public.is_room_member(text) from public, anon;
revoke all on function public.send_room_message(text, text, text, uuid) from public, anon;
revoke all on function public.touch_room_member() from public, anon, authenticated;
grant execute on function public.create_room(text, numeric) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.leave_all_rooms() to authenticated;
grant execute on function public.set_room_target(text, numeric) to authenticated;
grant execute on function public.room_snapshot(text) to authenticated;
grant execute on function public.is_room_member(text) to authenticated;
grant execute on function public.send_room_message(text, text, text, uuid) to authenticated;

-- Live updates: let the browser subscribe to changes in these tables.
do $$
declare
  t text;
begin
  foreach t in array array['room_members', 'study_rooms', 'room_messages'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
