-- Personal Calendar: tables and Row Level Security.
--
-- Run once in the Supabase SQL editor. It is safe to run again.
-- Tables are prefixed with cal_ so they can live in the same project as other apps
-- without name clashes. Every row belongs to the user who created it (user_id defaults
-- to auth.uid()), and RLS only lets each user read and write their own rows.

-- ---------- Events (appointments, tasks, reminders…) ----------
-- Dates and times are stored as local calendar values (date + time without time zone)
-- because events repeat by calendar day (every Tuesday at 19:00), not by instant.
create table if not exists public.cal_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  type        text not null default 'other',
  date        date not null,
  all_day     boolean not null default true,
  start_time  time,
  end_time    time,
  repeat      text not null default 'none'
              check (repeat in ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  location    text not null default '',
  notes       text not null default '',
  done        boolean not null default false,  -- one-off tasks
  done_on     date[] not null default '{}',    -- repeating tasks: days marked as done
  created_at  timestamptz not null default now()
);
create index if not exists cal_events_user_id_idx on public.cal_events (user_id);

-- ---------- Daily routine ----------
create table if not exists public.cal_habits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  since       date,
  created_at  timestamptz not null default now()
);
create index if not exists cal_habits_user_id_idx on public.cal_habits (user_id);

-- One row per routine item completed on a given day.
create table if not exists public.cal_habit_log (
  habit_id    uuid not null references public.cal_habits (id) on delete cascade,
  day         date not null,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (habit_id, day)
);
create index if not exists cal_habit_log_user_id_idx on public.cal_habit_log (user_id);

-- ---------- To do ----------
create table if not exists public.cal_todos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  title       text not null check (char_length(title) between 1 and 300),
  due         date,
  done        boolean not null default false,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists cal_todos_user_id_idx on public.cal_todos (user_id);

-- ---------- Row Level Security ----------
alter table public.cal_events    enable row level security;
alter table public.cal_habits    enable row level security;
alter table public.cal_habit_log enable row level security;
alter table public.cal_todos     enable row level security;

-- "for all" covers select, insert, update and delete.
-- (select auth.uid()) is evaluated once per query instead of once per row.
drop policy if exists "Users manage their own events" on public.cal_events;
create policy "Users manage their own events" on public.cal_events
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own habits" on public.cal_habits;
create policy "Users manage their own habits" on public.cal_habits
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Log rows may only point at the user's own routine items.
drop policy if exists "Users manage their own habit log" on public.cal_habit_log;
create policy "Users manage their own habit log" on public.cal_habit_log
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.cal_habits h
      where h.id = habit_id and h.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users manage their own todos" on public.cal_todos;
create policy "Users manage their own todos" on public.cal_todos
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Signed-out visitors (anon role) get no access at all, even before RLS is evaluated.
revoke all on public.cal_events, public.cal_habits, public.cal_habit_log, public.cal_todos from anon;
