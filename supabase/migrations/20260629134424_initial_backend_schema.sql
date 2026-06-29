create extension if not exists pgcrypto;
create schema if not exists extensions;
create extension if not exists citext with schema extensions;

do $$
begin
  create type public.app_role as enum ('admin', 'user');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.invitation_status as enum ('pending', 'accepted', 'rejected');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role public.app_role not null default 'user',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invitation_requests (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 80),
  email extensions.citext not null unique,
  status public.invitation_status not null default 'pending',
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null,
  created_user_id uuid references auth.users(id) on delete set null,
  constraint invitation_acceptance_consistency check (
    (status = 'accepted' and accepted_at is not null and created_user_id is not null)
    or (status <> 'accepted')
  )
);

create table if not exists public.drink_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  abv_percent numeric(5,2) not null check (abv_percent >= 0 and abv_percent <= 96),
  category text not null default 'other',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.drink_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  drink_type_id uuid references public.drink_types(id) on delete set null,
  drink_name_snapshot text not null,
  drink_volume_ml numeric(8,2) not null check (drink_volume_ml > 0 and drink_volume_ml <= 5000),
  units integer not null check (units > 0 and units <= 50),
  abv_percent numeric(5,2) not null check (abv_percent >= 0 and abv_percent <= 96),
  pure_alcohol_ml numeric(10,2) not null check (pure_alcohol_ml >= 0),
  consumed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.competition_settings (
  id text primary key,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Europe/Vienna',
  updated_at timestamptz not null default now(),
  constraint competition_window_valid check (starts_at < ends_at)
);

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists invitation_requests_status_requested_at_idx
  on public.invitation_requests(status, requested_at desc);
create index if not exists invitation_requests_accepted_by_idx
  on public.invitation_requests(accepted_by);
create index if not exists invitation_requests_created_user_id_idx
  on public.invitation_requests(created_user_id);
create index if not exists drink_entries_user_consumed_at_idx
  on public.drink_entries(user_id, consumed_at desc);
create index if not exists drink_entries_drink_type_id_idx
  on public.drink_entries(drink_type_id);
create index if not exists drink_entries_consumed_at_idx
  on public.drink_entries(consumed_at desc);
create index if not exists drink_types_active_name_idx
  on public.drink_types(is_active, name);

alter table public.profiles enable row level security;
alter table public.invitation_requests enable row level security;
alter table public.drink_types enable row level security;
alter table public.drink_entries enable row level security;
alter table public.competition_settings enable row level security;

drop policy if exists "Profiles are readable by signed in users" on public.profiles;
create policy "Profiles are readable by signed in users"
  on public.profiles
  for select
  to authenticated
  using (true);

drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Admins can update profiles" on public.profiles;
drop policy if exists "Users and admins can update profiles" on public.profiles;
create policy "Users and admins can update profiles"
  on public.profiles
  for update
  to authenticated
  using (
    ((select auth.uid()) = id)
    or ((((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'))
  )
  with check (
    ((select auth.uid()) = id)
    or ((((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'))
  );

drop policy if exists "Admins can read invitations" on public.invitation_requests;
create policy "Admins can read invitations"
  on public.invitation_requests
  for select
  to authenticated
  using ((((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'));

drop policy if exists "Admins can update invitations" on public.invitation_requests;
create policy "Admins can update invitations"
  on public.invitation_requests
  for update
  to authenticated
  using ((((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'))
  with check ((((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'));

drop policy if exists "Drink types are public readable" on public.drink_types;
create policy "Drink types are public readable"
  on public.drink_types
  for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "Signed in users can read drink entries" on public.drink_entries;
create policy "Signed in users can read drink entries"
  on public.drink_entries
  for select
  to authenticated
  using (true);

drop policy if exists "Signed in users can insert own drink entries" on public.drink_entries;
create policy "Signed in users can insert own drink entries"
  on public.drink_entries
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own drink entries" on public.drink_entries;
create policy "Users can update their own drink entries"
  on public.drink_entries
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Competition settings are public readable" on public.competition_settings;
create policy "Competition settings are public readable"
  on public.competition_settings
  for select
  to anon, authenticated
  using (true);

grant usage on schema public to anon, authenticated;
grant select on public.drink_types to anon, authenticated;
grant select on public.competition_settings to anon, authenticated;
grant select, update on public.invitation_requests to authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, updated_at) on public.profiles to authenticated;
grant select on public.drink_entries to authenticated;

insert into public.competition_settings (id, starts_at, ends_at, timezone)
values ('summer_2026', '2026-06-21 00:00:00+02', '2026-09-22 23:59:59+02', 'Europe/Vienna')
on conflict (id) do update
set starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    timezone = excluded.timezone,
    updated_at = now();

insert into public.drink_types (name, abv_percent, category)
values
  ('Märzen Bier', 5.0, 'beer'),
  ('Lager', 4.8, 'beer'),
  ('Pils', 5.1, 'beer'),
  ('Radler', 2.5, 'beer'),
  ('Weizenbier', 5.4, 'beer'),
  ('Starkbier', 7.5, 'beer'),
  ('Cider', 4.5, 'cider'),
  ('Hard Seltzer', 4.5, 'ready_to_drink'),
  ('Weißwein', 12.5, 'wine'),
  ('Rotwein', 13.5, 'wine'),
  ('Rosé', 12.0, 'wine'),
  ('Prosecco', 11.0, 'sparkling'),
  ('Sekt', 12.0, 'sparkling'),
  ('Champagner', 12.0, 'sparkling'),
  ('Sangria', 8.0, 'wine_mix'),
  ('Aperol Spritz', 8.0, 'spritz'),
  ('Campari Spritz', 8.5, 'spritz'),
  ('Campari Soda', 10.0, 'spritz'),
  ('Hugo', 6.5, 'spritz'),
  ('Lillet Wild Berry', 6.5, 'spritz'),
  ('Bellini', 7.0, 'cocktail'),
  ('Mimosa', 6.0, 'cocktail'),
  ('Weißer Spritzer', 6.0, 'wine_mix'),
  ('Mojito', 13.0, 'cocktail'),
  ('Caipirinha', 20.0, 'cocktail'),
  ('Cuba Libre', 12.0, 'longdrink'),
  ('Dark and Stormy', 12.0, 'longdrink'),
  ('Gin Tonic', 12.0, 'longdrink'),
  ('Whiskey Cola', 12.0, 'longdrink'),
  ('Vodka Lemon', 12.0, 'longdrink'),
  ('Vodka Cranberry', 12.0, 'longdrink'),
  ('Long Island Iced Tea', 22.0, 'cocktail'),
  ('Espresso Martini', 18.0, 'cocktail'),
  ('Pornstar Martini', 16.0, 'cocktail'),
  ('Martini', 28.0, 'cocktail'),
  ('Negroni', 24.0, 'cocktail'),
  ('Margarita', 18.0, 'cocktail'),
  ('Paloma', 12.0, 'cocktail'),
  ('Moscow Mule', 12.0, 'cocktail'),
  ('Cosmopolitan', 16.0, 'cocktail'),
  ('Daiquiri', 18.0, 'cocktail'),
  ('Piña Colada', 13.0, 'cocktail'),
  ('Sex on the Beach', 12.0, 'cocktail'),
  ('Mai Tai', 18.0, 'cocktail'),
  ('Tequila Sunrise', 13.0, 'cocktail'),
  ('Amaretto Sour', 14.0, 'cocktail'),
  ('Whiskey Sour', 18.0, 'cocktail'),
  ('White Russian', 16.0, 'cocktail'),
  ('Bloody Mary', 10.0, 'cocktail'),
  ('French 75', 14.0, 'cocktail'),
  ('Vodka', 40.0, 'spirit'),
  ('Gin', 40.0, 'spirit'),
  ('Rum', 40.0, 'spirit'),
  ('Tequila', 38.0, 'spirit'),
  ('Whiskey', 40.0, 'spirit'),
  ('Jägermeister', 35.0, 'spirit'),
  ('Jägerbomb', 15.0, 'shot_mix'),
  ('Fernet', 39.0, 'spirit'),
  ('Ouzo', 38.0, 'spirit'),
  ('Sambuca', 38.0, 'spirit'),
  ('Limoncello', 30.0, 'spirit'),
  ('Baileys', 17.0, 'liqueur'),
  ('Malibu', 21.0, 'liqueur'),
  ('Korn', 32.0, 'spirit'),
  ('Shot Mix', 20.0, 'shot_mix'),
  ('Energy Vodka Mix', 10.0, 'ready_to_drink'),
  ('Flying Hirsch', 15.0, 'shot_mix')
on conflict (name) do update
set abv_percent = excluded.abv_percent,
    category = excluded.category,
    is_active = true;
