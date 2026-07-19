-- ============================================================
-- The Ashes · Fantasy XI — Supabase schema
-- Run this whole file once in Supabase: Project → SQL Editor → New query → Run
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- profiles (tracks who's an admin) ----------
create table if not exists public.profiles (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false
);

alter table public.profiles enable row level security;

-- Users can only read their own profile — enough for the app to know its own
-- admin status, and enough for other tables' RLS policies to check it too.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = user_id);

-- No insert/update policy for regular users on purpose — a row is created
-- automatically on sign-up (see trigger below), and is_admin can only be
-- flipped by you, directly in the SQL Editor or Table Editor.

-- Automatically create a profiles row whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, is_admin) values (new.id, false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- players ----------
create table if not exists public.players (
  id   text primary key,
  name text not null,
  nat  text not null check (nat in ('ENG','AUS')),
  role text not null check (role in ('BAT','BOWL','AR','WK'))
);

alter table public.players enable row level security;

drop policy if exists "players_select_all" on public.players;
create policy "players_select_all" on public.players
  for select using (true);

drop policy if exists "players_write_authenticated" on public.players;
drop policy if exists "players_write_admin" on public.players;
create policy "players_write_admin" on public.players
  for all
  using (exists (select 1 from public.profiles where user_id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where user_id = auth.uid() and is_admin));

-- ---------- fixtures ----------
create table if not exists public.fixtures (
  test     int primary key,
  venue    text not null,
  date     date not null,
  deadline timestamptz not null
);

alter table public.fixtures enable row level security;

drop policy if exists "fixtures_select_all" on public.fixtures;
create policy "fixtures_select_all" on public.fixtures
  for select using (true);

drop policy if exists "fixtures_write_authenticated" on public.fixtures;
drop policy if exists "fixtures_write_admin" on public.fixtures;
create policy "fixtures_write_admin" on public.fixtures
  for all
  using (exists (select 1 from public.profiles where user_id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where user_id = auth.uid() and is_admin));

-- ---------- match_stats (one row per Test, stats blob keyed by player id) ----------
create table if not exists public.match_stats (
  test  int primary key references public.fixtures(test) on delete cascade,
  stats jsonb not null default '{}'::jsonb
);

alter table public.match_stats enable row level security;

drop policy if exists "stats_select_all" on public.match_stats;
create policy "stats_select_all" on public.match_stats
  for select using (true);

drop policy if exists "stats_write_authenticated" on public.match_stats;
drop policy if exists "stats_write_admin" on public.match_stats;
create policy "stats_write_admin" on public.match_stats
  for all
  using (exists (select 1 from public.profiles where user_id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where user_id = auth.uid() and is_admin));

-- ---------- squads (one per signed-in user) ----------
create table if not exists public.squads (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique references auth.users(id) on delete cascade,
  team_name                text not null unique,
  squad14                  jsonb not null default '[]'::jsonb,
  xi11                     jsonb not null default '[]'::jsonb,
  bench3                   jsonb not null default '[]'::jsonb,
  captain                  text,
  vice_captain             text,
  -- The 14-man squad as it stood after the last lock (or initial creation, pre-Test-1).
  -- Transfers are measured against this baseline: a commit may change at most 2 of
  -- the 14 players versus it, unless the wildcard is armed. Picking your starting XI
  -- from whichever 14 you currently have is always free and isn't limited by this.
  baseline_squad14         jsonb not null default '[]'::jsonb,
  wildcard_used            boolean not null default false,
  wildcard_active_now      boolean not null default false,
  -- True once the user has committed at least one change while the wildcard was
  -- armed, since the last lock. Only squads with this true actually spend their
  -- wildcard when lock_test() runs — arming it and never committing costs nothing.
  wildcard_committed_pending boolean not null default false,
  locked_xi_by_test        jsonb not null default '{}'::jsonb,
  updated_at               timestamptz not null default now()
);

-- Safe to re-run on an existing table from an earlier version of this schema.
alter table public.squads add column if not exists baseline_squad14 jsonb not null default '[]'::jsonb;
alter table public.squads add column if not exists wildcard_committed_pending boolean not null default false;
alter table public.squads drop column if exists swaps_used_this_window;
alter table public.squads drop column if exists baseline_xi11;
alter table public.squads drop column if exists baseline_bench3;
alter table public.squads drop column if exists baseline_captain;
alter table public.squads drop column if exists baseline_vice_captain;

-- Backfill: anyone whose baseline was never set (pre-existing squads from before this
-- column existed) gets their current committed squad as their starting baseline.
update public.squads
set baseline_squad14 = squad14
where jsonb_array_length(baseline_squad14) = 0 and jsonb_array_length(squad14) = 14;

alter table public.squads enable row level security;

-- Everyone (including anonymous visitors) can read all squads — needed for the public leaderboard.
drop policy if exists "squads_select_all" on public.squads;
create policy "squads_select_all" on public.squads
  for select using (true);

-- Only the owner can create, edit or delete their own squad.
drop policy if exists "squads_insert_own" on public.squads;
create policy "squads_insert_own" on public.squads
  for insert with check (auth.uid() = user_id);

drop policy if exists "squads_update_own" on public.squads;
create policy "squads_update_own" on public.squads
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "squads_delete_own" on public.squads;
create policy "squads_delete_own" on public.squads
  for delete using (auth.uid() = user_id);

-- ---------- lock_test(): the one cross-user action ----------
-- Snapshots every squad's currently committed XI/captain/VC into locked_xi_by_test
-- for the given Test, promotes that committed 14-man squad to be the new transfer
-- baseline, and finalizes the wildcard: it's only marked used if it was armed AND
-- actually spent on a commit since the last lock (wildcard_committed_pending).
-- Runs as SECURITY DEFINER so it can update rows the caller doesn't own. Restricted to
-- admins via an explicit check inside the function (a plain GRANT can't express
-- per-row admin status, only role membership).
create or replace function public.lock_test(p_test int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and is_admin) then
    raise exception 'Only admins can lock a Test';
  end if;

  update public.squads
  set
    locked_xi_by_test = locked_xi_by_test || jsonb_build_object(
      p_test::text,
      jsonb_build_object(
        'xi', xi11,
        'bench', bench3,
        'captain', captain,
        'viceCaptain', vice_captain
      )
    ),
    baseline_squad14 = squad14,
    wildcard_used = case when wildcard_active_now and wildcard_committed_pending then true else wildcard_used end,
    wildcard_active_now = false,
    wildcard_committed_pending = false,
    updated_at = now()
  where jsonb_array_length(xi11) = 11;
end;
$$;

revoke all on function public.lock_test(int) from public;
grant execute on function public.lock_test(int) to authenticated;

-- ============================================================
-- Seed data — safe to re-run, existing rows are left untouched
-- ============================================================

-- Backfill a profile row for anyone who signed up before this trigger existed.
insert into public.profiles (user_id, is_admin)
select id, false from auth.users
on conflict (user_id) do nothing;

insert into public.players (id, name, nat, role) values
  ('eng_crawley','Zak Crawley','ENG','BAT'),
  ('eng_duckett','Ben Duckett','ENG','BAT'),
  ('eng_pope','Ollie Pope','ENG','BAT'),
  ('eng_root','Joe Root','ENG','BAT'),
  ('eng_brook','Harry Brook','ENG','BAT'),
  ('eng_smith','Jamie Smith','ENG','WK'),
  ('eng_stokes','Ben Stokes','ENG','AR'),
  ('eng_bethell','Jacob Bethell','ENG','AR'),
  ('eng_woakes','Chris Woakes','ENG','AR'),
  ('eng_carse','Brydon Carse','ENG','BOWL'),
  ('eng_wood','Mark Wood','ENG','BOWL'),
  ('eng_atkinson','Gus Atkinson','ENG','BOWL'),
  ('eng_archer','Jofra Archer','ENG','BOWL'),
  ('eng_bashir','Shoaib Bashir','ENG','BOWL'),
  ('aus_smith','Steven Smith','AUS','BAT'),
  ('aus_head','Travis Head','AUS','BAT'),
  ('aus_khawaja','Usman Khawaja','AUS','BAT'),
  ('aus_labuschagne','Marnus Labuschagne','AUS','BAT'),
  ('aus_weatherald','Jake Weatherald','AUS','BAT'),
  ('aus_green','Cameron Green','AUS','AR'),
  ('aus_webster','Beau Webster','AUS','AR'),
  ('aus_carey','Alex Carey','AUS','WK'),
  ('aus_inglis','Josh Inglis','AUS','WK'),
  ('aus_cummins','Pat Cummins','AUS','BOWL'),
  ('aus_starc','Mitchell Starc','AUS','BOWL'),
  ('aus_hazlewood','Josh Hazlewood','AUS','BOWL'),
  ('aus_boland','Scott Boland','AUS','BOWL'),
  ('aus_lyon','Nathan Lyon','AUS','BOWL')
on conflict (id) do nothing;

insert into public.fixtures (test, venue, date, deadline) values
  (1, 'Perth (Optus Stadium)', '2026-11-20', '2026-11-20T10:00:00'),
  (2, 'Brisbane (The Gabba)',  '2026-12-03', '2026-12-03T10:00:00'),
  (3, 'Adelaide Oval (D/N)',   '2026-12-16', '2026-12-16T10:00:00'),
  (4, 'Melbourne (MCG)',       '2026-12-26', '2026-12-26T10:00:00'),
  (5, 'Sydney (SCG)',          '2027-01-03', '2027-01-03T10:00:00')
on conflict (test) do nothing;
