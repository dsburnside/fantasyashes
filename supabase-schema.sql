-- ============================================================
-- The Ashes · Fantasy XI — Supabase schema
-- Run this whole file once in Supabase: Project → SQL Editor → New query → Run
-- Safe to re-run any time you pull a newer copy — every statement is written
-- to skip or backfill rather than fail if it's already been applied.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- profiles (tracks who's an admin, and a display name for the leaderboard) ----------
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  is_admin   boolean not null default false,
  first_name text,
  last_name  text
);

alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;

alter table public.profiles enable row level security;

-- Users can only read their own profile — enough for the app to know its own
-- admin status and name, and enough for other tables' RLS policies to check
-- admin status too. (Other players see your name via squads.manager_name, a
-- copy taken at squad-creation time — see squads below — not by reading your
-- profile row directly.)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = user_id);

-- No insert/update policy for regular users on purpose — a row is created
-- automatically on sign-up (see trigger below) using the name they entered
-- on the sign-up form, and is_admin can only be flipped by you, directly in
-- the SQL Editor or Table Editor.

-- Automatically create a profiles row whenever someone signs up, pulling
-- first/last name out of the signup call's metadata (see showLoginOverlay's
-- signUp({..., options:{data:{first_name,last_name}}}) in the app).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, is_admin, first_name, last_name)
  values (
    new.id,
    false,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Series, Teams, Venues, Leagues
--
-- A "series" is one real-world tour: its own player pool, fixtures and match
-- stats (e.g. "The Ashes 2026/27"), contested between two teams. Teams and
-- venues are shared master data — created once, reusable across any series.
--
-- A "league" is a group of friends competing within one series — multiple
-- leagues can point at the same series and share its player pool/fixtures/
-- stats, differing only in membership (league_members) and therefore their
-- own leaderboard. A user's squad belongs to a SERIES, not a single league:
-- if they're in two leagues on the same series, it's the same squad on both
-- leaderboards, not a duplicate. Joining a league is invite-only via its
-- join_code; leagues you're not a member of aren't listable at all.
--
-- Fixed ids for the series/league/teams this app originally shipped with, so
-- upgrading from an older version has somewhere for existing data to land.
-- ============================================================

create table if not exists public.series (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

alter table public.series enable row level security;

drop policy if exists "series_select_all" on public.series;
create policy "series_select_all" on public.series
  for select using (true);

drop policy if exists "series_write_admin" on public.series;
create policy "series_write_admin" on public.series
  for all
  using (exists (select 1 from public.profiles where user_id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where user_id = auth.uid() and is_admin));

insert into public.series (id, name)
values ('00000000-0000-0000-0000-000000000001', 'The Ashes 2026/27')
on conflict (id) do nothing;

-- ---------- teams & venues (shared master data, reused across every series) ----------
create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  short_code text not null unique,
  created_at timestamptz not null default now()
);

alter table public.teams enable row level security;

drop policy if exists "teams_select_all" on public.teams;
create policy "teams_select_all" on public.teams
  for select using (true);

drop policy if exists "teams_write_admin" on public.teams;
create policy "teams_write_admin" on public.teams
  for all
  using (exists (select 1 from public.profiles where user_id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where user_id = auth.uid() and is_admin));

create table if not exists public.venues (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

alter table public.venues enable row level security;

drop policy if exists "venues_select_all" on public.venues;
create policy "venues_select_all" on public.venues
  for select using (true);

drop policy if exists "venues_write_admin" on public.venues;
create policy "venues_write_admin" on public.venues
  for all
  using (exists (select 1 from public.profiles where user_id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where user_id = auth.uid() and is_admin));

insert into public.teams (id, name, short_code) values
  ('00000000-0000-0000-0000-000000000003', 'England', 'ENG'),
  ('00000000-0000-0000-0000-000000000004', 'Australia', 'AUS')
on conflict (id) do nothing;

-- Each series is contested between exactly two teams, picked from the shared
-- pool above (or created inline as part of setting the series up).
alter table public.series add column if not exists team_a_id uuid references public.teams(id);
alter table public.series add column if not exists team_b_id uuid references public.teams(id);
update public.series set team_a_id = '00000000-0000-0000-0000-000000000003', team_b_id = '00000000-0000-0000-0000-000000000004'
where id = '00000000-0000-0000-0000-000000000001' and team_a_id is null;

-- ---------- leagues ----------
create table if not exists public.leagues (
  id         uuid primary key default gen_random_uuid(),
  series_id  uuid not null references public.series(id) on delete cascade,
  name       text not null,
  join_code  text not null unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

insert into public.leagues (id, series_id, name, join_code)
values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'The Ashes 2026/27', 'ASHES2026')
on conflict (id) do nothing;

-- Snapshot of the creator's name at creation time, same idea as
-- squads.manager_name below — profiles are select-own-only (see
-- profiles_select_own), so this is the only way the My Leagues list can show
-- "created by" without relaxing that privacy boundary.
alter table public.leagues add column if not exists created_by_name text;
update public.leagues l set created_by_name = (
  select trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,''))
  from public.profiles p where p.user_id = l.created_by
) where (l.created_by_name is null or l.created_by_name = '') and l.created_by is not null;

-- ---------- league_members (who's actually playing in a league) ----------
-- Deliberately decoupled from squads: a squad belongs to a series (see
-- squads, further down) and is shared across every league a user is in for
-- that series, so squad existence alone can't tell you league membership —
-- this table is the real membership record, and what leaderboards read to
-- know whose squads to show.
create table if not exists public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

-- Whether the current user is a member of a given league — used by
-- league_members' own select policy and leagues' select policy below.
-- SECURITY DEFINER so it reads league_members bypassing its own RLS: a
-- policy that subqueries the very table it protects otherwise re-invokes
-- itself on every nested reference, and Postgres aborts with "infinite
-- recursion detected in policy".
create or replace function public.is_league_member(p_league_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.league_members
    where league_id = p_league_id and user_id = auth.uid()
  );
$$;

alter table public.league_members enable row level security;

-- Seeing the full membership list of a league you're in (or any league, as
-- an admin) is what lets that league's leaderboard show every member's
-- squad, not just your own.
drop policy if exists "league_members_select_member_or_admin" on public.league_members;
create policy "league_members_select_member_or_admin" on public.league_members
  for select using (
    public.is_league_member(league_id)
    or exists (select 1 from public.profiles where user_id = auth.uid() and is_admin)
  );

-- Joining a league (by code, or auto-linking an existing series squad to a
-- second league on that series) means inserting your own membership row.
drop policy if exists "league_members_insert_own" on public.league_members;
create policy "league_members_insert_own" on public.league_members
  for insert with check (user_id = auth.uid());

drop policy if exists "league_members_delete_own_or_admin" on public.league_members;
create policy "league_members_delete_own_or_admin" on public.league_members
  for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles where user_id = auth.uid() and is_admin)
  );

alter table public.leagues enable row level security;

-- A league only becomes visible once you're a member of it, or you created
-- it (so you can see and share it before you or anyone else has formally
-- joined), or you're a site admin. Combined with join codes not being
-- guessable, this keeps one friend group's league invisible to another's.
drop policy if exists "leagues_select_member_or_admin" on public.leagues;
create policy "leagues_select_member_or_admin" on public.leagues
  for select using (
    public.is_league_member(id)
    or created_by = auth.uid()
    or exists (select 1 from public.profiles where user_id = auth.uid() and is_admin)
  );

-- Leagues are self-service: any signed-in user can create one for any
-- series (naming themselves as creator), and can rename/regenerate its code/
-- delete it afterward — same as a site admin can, for any league. Admins
-- only need to manage series/fixtures/players directly; league creation and
-- invites are a player-facing feature, not a backend one.
drop policy if exists "leagues_write_admin" on public.leagues;

drop policy if exists "leagues_insert_own" on public.leagues;
create policy "leagues_insert_own" on public.leagues
  for insert with check (auth.uid() = created_by);

drop policy if exists "leagues_update_own_or_admin" on public.leagues;
create policy "leagues_update_own_or_admin" on public.leagues
  for update
  using (created_by = auth.uid() or exists (select 1 from public.profiles where user_id = auth.uid() and is_admin))
  with check (created_by = auth.uid() or exists (select 1 from public.profiles where user_id = auth.uid() and is_admin));

drop policy if exists "leagues_delete_own_or_admin" on public.leagues;
create policy "leagues_delete_own_or_admin" on public.leagues
  for delete using (created_by = auth.uid() or exists (select 1 from public.profiles where user_id = auth.uid() and is_admin));

-- Resolves a join code to a league's id/name/series without ever exposing
-- the leagues table to browsing — the only way to find a league you're not
-- already a member of is to have its code. SECURITY DEFINER so it can read
-- past the leagues_select_member_or_admin policy above, which would
-- otherwise hide the very row a joining (non-member) user needs to see.
create or replace function public.resolve_join_code(p_code text)
returns table(id uuid, name text, series_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query select l.id, l.name, l.series_id from public.leagues l where l.join_code = p_code;
end;
$$;

revoke all on function public.resolve_join_code(text) from public;
grant execute on function public.resolve_join_code(text) to authenticated;

-- ---------- players (scoped to a series) ----------
-- nat holds a team's short_code (e.g. 'ENG') by convention, matching whichever
-- two teams the player's series is contested between — not constrained to a
-- fixed list here, since different series can involve different teams.
create table if not exists public.players (
  series_id uuid not null references public.series(id) on delete cascade,
  id        text not null,
  name      text not null,
  nat       text not null,
  role      text not null check (role in ('BAT','BOWL','AR','WK')),
  primary key (series_id, id)
);

-- Upgrade path from the single-series version: add series_id, backfill every
-- existing player into the default series, then widen the primary key. Also
-- drop the old hardcoded ENG/AUS-only check now that teams are configurable.
alter table public.players add column if not exists series_id uuid references public.series(id) on delete cascade;
update public.players set series_id = '00000000-0000-0000-0000-000000000001' where series_id is null;
alter table public.players alter column series_id set not null;
alter table public.players drop constraint if exists players_pkey;
alter table public.players add primary key (series_id, id);
alter table public.players drop constraint if exists players_nat_check;

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

-- ---------- fixtures (scoped to a series) ----------
create table if not exists public.fixtures (
  series_id uuid not null references public.series(id) on delete cascade,
  test      int not null,
  venue     text not null,
  date      date not null,
  deadline  timestamptz not null,
  primary key (series_id, test)
);

-- Upgrade path: add series_id, backfill, then widen the primary key. Use
-- cascade so the old single-column FK match_stats held against fixtures(test)
-- drops along with the old PK — it's recreated as a composite FK below.
alter table public.fixtures add column if not exists series_id uuid references public.series(id) on delete cascade;
update public.fixtures set series_id = '00000000-0000-0000-0000-000000000001' where series_id is null;
alter table public.fixtures alter column series_id set not null;
alter table public.fixtures drop constraint if exists fixtures_pkey cascade;
alter table public.fixtures add primary key (series_id, test);

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

-- Backfill: register every venue already in use so it's immediately reusable
-- when setting up other series.
insert into public.venues (name)
select distinct venue from public.fixtures
on conflict (name) do nothing;

-- ---------- match_stats (one row per Test per series) ----------
-- playing_xi holds the real-world Playing XI announced for that Test (player
-- ids, both nations combined). It drives automatic substitutions: any
-- fantasy team's locked XI player missing from this list is treated as not
-- having played, and scoring swaps in their first bench player (in squad
-- order) who is on this list. An empty array means "not announced yet" — no
-- subs are applied for that Test until an admin fills it in.
create table if not exists public.match_stats (
  series_id  uuid not null references public.series(id) on delete cascade,
  test       int not null,
  stats      jsonb not null default '{}'::jsonb,
  playing_xi jsonb not null default '[]'::jsonb,
  innings    jsonb not null default '[]'::jsonb,
  primary key (series_id, test),
  foreign key (series_id, test) references public.fixtures(series_id, test) on delete cascade
);

-- Upgrade path: add series_id, backfill, widen the primary key and point the
-- fixtures foreign key at the new composite key.
alter table public.match_stats add column if not exists series_id uuid;
update public.match_stats set series_id = '00000000-0000-0000-0000-000000000001' where series_id is null;
alter table public.match_stats alter column series_id set not null;
alter table public.match_stats drop constraint if exists match_stats_series_id_fkey;
alter table public.match_stats add constraint match_stats_series_id_fkey foreign key (series_id) references public.series(id) on delete cascade;
alter table public.match_stats drop constraint if exists match_stats_pkey cascade;
alter table public.match_stats add primary key (series_id, test);
alter table public.match_stats drop constraint if exists match_stats_series_test_fkey;
alter table public.match_stats add constraint match_stats_series_test_fkey foreign key (series_id, test) references public.fixtures(series_id, test) on delete cascade;
alter table public.match_stats add column if not exists playing_xi jsonb not null default '[]'::jsonb;
-- innings holds the ordered list of innings added in the admin match-setup
-- UI, e.g. [{"battingCode":"ENG","inn":1}, ...] — up to 4 entries, at most
-- 2 per team. Drives which team's players show under Batting vs Bowling/
-- Fielding for each innings tab; the stats jsonb itself stays keyed by
-- player id + inn1/inn2 regardless.
alter table public.match_stats add column if not exists innings jsonb not null default '[]'::jsonb;

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

-- ---------- squads (one per user per SERIES — shared across every league on that series) ----------
create table if not exists public.squads (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  series_id                uuid not null references public.series(id) on delete cascade,
  team_name                text not null,
  -- Copied from profiles.first_name/last_name at squad-creation time, so the
  -- leaderboard can show who manages a team without needing to expose other
  -- users' profile rows. A later name change won't retroactively update old
  -- squads — an accepted simplification for a hobby league.
  manager_name             text,
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
  updated_at               timestamptz not null default now(),
  unique (user_id, series_id),
  unique (series_id, team_name)
);

alter table public.squads add column if not exists manager_name text;
alter table public.squads add column if not exists series_id uuid references public.series(id) on delete cascade;

-- Backfill for squads created before manager_name existed (or before
-- signup captured first/last name) — this is a direct SQL migration run
-- with owner privileges, so unlike the app it can read every profile
-- regardless of profiles_select_own.
update public.squads s set manager_name = (
  select trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,''))
  from public.profiles p where p.user_id = s.user_id
) where manager_name is null or manager_name = '';

-- Upgrade path from the per-league version: a squad used to belong to a
-- single league; it now belongs to a series and is shared across every
-- league you're in for that series. Only relevant when upgrading from that
-- older schema (squads had a league_id column) — a fresh install skips this
-- block entirely, since a brand-new squads table never has one to read.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'squads' and column_name = 'league_id'
  ) then
    -- Backfill league_members from the old league_id column before it's
    -- dropped, so nobody loses their existing league membership in the move.
    insert into public.league_members (league_id, user_id)
    select league_id, user_id from public.squads where league_id is not null
    on conflict do nothing;

    -- Derive each squad's series_id from that same old league_id.
    update public.squads s
    set series_id = l.series_id
    from public.leagues l
    where s.league_id = l.id and s.series_id is null;
  end if;
end $$;

-- Fallback for the rare case of a squad with neither a series_id nor a
-- league_id to derive one from (e.g. jumping here from a very old schema
-- version) — default it to the original series rather than fail NOT NULL.
update public.squads set series_id = '00000000-0000-0000-0000-000000000001' where series_id is null;
alter table public.squads alter column series_id set not null;

alter table public.squads drop constraint if exists squads_user_id_key;
alter table public.squads drop constraint if exists squads_team_name_key;
alter table public.squads drop constraint if exists squads_user_id_league_id_key;
alter table public.squads drop constraint if exists squads_league_id_team_name_key;
alter table public.squads drop constraint if exists squads_user_id_series_id_key;
alter table public.squads add constraint squads_user_id_series_id_key unique (user_id, series_id);
alter table public.squads drop constraint if exists squads_series_id_team_name_key;
alter table public.squads add constraint squads_series_id_team_name_key unique (series_id, team_name);

-- A previous schema version's squads_select_member_or_admin policy referenced
-- league_id directly (via is_league_member(league_id)); Postgres won't drop a
-- column a policy still depends on, so that policy has to go first. It's
-- recreated further down, after RLS is (re-)enabled, in its new league_id-free
-- form.
drop policy if exists "squads_select_member_or_admin" on public.squads;
alter table public.squads drop column if exists league_id;

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

-- You can always see your own squad, whether or not it's in any league —
-- picking a team just needs a series, not a league. Beyond that, a squad is
-- also visible to anyone who shares a league with its owner on the same
-- series (i.e. you're both members of at least one common league there), or
-- to site admins. This is what keeps one league's leaderboard private from
-- another's even though squads themselves aren't tied to a single league.
drop policy if exists "squads_select_all" on public.squads;
drop policy if exists "squads_select_member_or_admin" on public.squads;
create policy "squads_select_member_or_admin" on public.squads
  for select using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.league_members lm_self
      join public.league_members lm_owner on lm_owner.league_id = lm_self.league_id
      join public.leagues l on l.id = lm_self.league_id
      where lm_self.user_id = auth.uid()
        and lm_owner.user_id = squads.user_id
        and l.series_id = squads.series_id
    )
    or exists (select 1 from public.profiles where user_id = auth.uid() and is_admin)
  );

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
-- Scoped directly by series_id now that squads belong to a series rather than
-- a single league. Runs as SECURITY DEFINER so it can update rows the caller
-- doesn't own. Restricted to admins via an explicit check inside the function
-- (a plain GRANT can't express per-row admin status, only role membership).
drop function if exists public.lock_test(int);
create or replace function public.lock_test(p_series_id uuid, p_test int)
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
  where jsonb_array_length(xi11) = 11
    and series_id = p_series_id;
end;
$$;

revoke all on function public.lock_test(uuid, int) from public;
grant execute on function public.lock_test(uuid, int) to authenticated;

-- ============================================================
-- Seed data — safe to re-run, existing rows are left untouched
-- ============================================================

-- Backfill a profile row for anyone who signed up before this trigger existed.
insert into public.profiles (user_id, is_admin)
select id, false from auth.users
on conflict (user_id) do nothing;

insert into public.players (series_id, id, name, nat, role) values
  ('00000000-0000-0000-0000-000000000001','eng_crawley','Zak Crawley','ENG','BAT'),
  ('00000000-0000-0000-0000-000000000001','eng_duckett','Ben Duckett','ENG','BAT'),
  ('00000000-0000-0000-0000-000000000001','eng_pope','Ollie Pope','ENG','BAT'),
  ('00000000-0000-0000-0000-000000000001','eng_root','Joe Root','ENG','BAT'),
  ('00000000-0000-0000-0000-000000000001','eng_brook','Harry Brook','ENG','BAT'),
  ('00000000-0000-0000-0000-000000000001','eng_smith','Jamie Smith','ENG','WK'),
  ('00000000-0000-0000-0000-000000000001','eng_stokes','Ben Stokes','ENG','AR'),
  ('00000000-0000-0000-0000-000000000001','eng_bethell','Jacob Bethell','ENG','AR'),
  ('00000000-0000-0000-0000-000000000001','eng_woakes','Chris Woakes','ENG','AR'),
  ('00000000-0000-0000-0000-000000000001','eng_carse','Brydon Carse','ENG','BOWL'),
  ('00000000-0000-0000-0000-000000000001','eng_wood','Mark Wood','ENG','BOWL'),
  ('00000000-0000-0000-0000-000000000001','eng_atkinson','Gus Atkinson','ENG','BOWL'),
  ('00000000-0000-0000-0000-000000000001','eng_archer','Jofra Archer','ENG','BOWL'),
  ('00000000-0000-0000-0000-000000000001','eng_bashir','Shoaib Bashir','ENG','BOWL'),
  ('00000000-0000-0000-0000-000000000001','aus_smith','Steven Smith','AUS','BAT'),
  ('00000000-0000-0000-0000-000000000001','aus_head','Travis Head','AUS','BAT'),
  ('00000000-0000-0000-0000-000000000001','aus_khawaja','Usman Khawaja','AUS','BAT'),
  ('00000000-0000-0000-0000-000000000001','aus_labuschagne','Marnus Labuschagne','AUS','BAT'),
  ('00000000-0000-0000-0000-000000000001','aus_weatherald','Jake Weatherald','AUS','BAT'),
  ('00000000-0000-0000-0000-000000000001','aus_green','Cameron Green','AUS','AR'),
  ('00000000-0000-0000-0000-000000000001','aus_webster','Beau Webster','AUS','AR'),
  ('00000000-0000-0000-0000-000000000001','aus_carey','Alex Carey','AUS','WK'),
  ('00000000-0000-0000-0000-000000000001','aus_inglis','Josh Inglis','AUS','WK'),
  ('00000000-0000-0000-0000-000000000001','aus_cummins','Pat Cummins','AUS','BOWL'),
  ('00000000-0000-0000-0000-000000000001','aus_starc','Mitchell Starc','AUS','BOWL'),
  ('00000000-0000-0000-0000-000000000001','aus_hazlewood','Josh Hazlewood','AUS','BOWL'),
  ('00000000-0000-0000-0000-000000000001','aus_boland','Scott Boland','AUS','BOWL'),
  ('00000000-0000-0000-0000-000000000001','aus_lyon','Nathan Lyon','AUS','BOWL')
on conflict (series_id, id) do nothing;

insert into public.fixtures (series_id, test, venue, date, deadline) values
  ('00000000-0000-0000-0000-000000000001', 1, 'Perth (Optus Stadium)', '2026-11-20', '2026-11-20T10:00:00'),
  ('00000000-0000-0000-0000-000000000001', 2, 'Brisbane (The Gabba)',  '2026-12-03', '2026-12-03T10:00:00'),
  ('00000000-0000-0000-0000-000000000001', 3, 'Adelaide Oval (D/N)',   '2026-12-16', '2026-12-16T10:00:00'),
  ('00000000-0000-0000-0000-000000000001', 4, 'Melbourne (MCG)',       '2026-12-26', '2026-12-26T10:00:00'),
  ('00000000-0000-0000-0000-000000000001', 5, 'Sydney (SCG)',          '2027-01-03', '2027-01-03T10:00:00')
on conflict (series_id, test) do nothing;
