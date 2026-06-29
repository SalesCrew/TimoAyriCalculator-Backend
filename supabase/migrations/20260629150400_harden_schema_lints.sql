create schema if not exists extensions;

do $$
declare
  current_schema text;
begin
  select n.nspname
  into current_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'citext';

  if current_schema is not null and current_schema <> 'extensions' then
    execute 'alter extension citext set schema extensions';
  end if;
end
$$;

create index if not exists invitation_requests_accepted_by_idx
  on public.invitation_requests(accepted_by);
create index if not exists invitation_requests_created_user_id_idx
  on public.invitation_requests(created_user_id);
create index if not exists drink_entries_drink_type_id_idx
  on public.drink_entries(drink_type_id);

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
