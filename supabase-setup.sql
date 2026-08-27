-- StackTime cloud progress storage
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

create table public.user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_progress enable row level security;

create policy "Users can read their own progress"
on public.user_progress
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own progress"
on public.user_progress
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own progress"
on public.user_progress
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
