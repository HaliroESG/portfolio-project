-- OFFLINE CANDIDATE ONLY. Never run separately from the sealed migration transaction.
-- This narrows one new policy; it does not authorize applying any SQL to Supabase.
do $guard$
begin
  if to_regclass('public.fo_owner_profiles') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception 'registered-owner authorization dependencies are absent';
  end if;
  if not exists (
    select 1 from pg_class where oid = 'public.fo_owner_profiles'::regclass and relrowsecurity
  ) then
    raise exception 'owner profile RLS is not enabled';
  end if;
  if exists (
    select 1 from pg_roles
    where rolname = 'authenticated' and (rolsuper or rolbypassrls)
  ) or pg_has_role('authenticated',
       (select relowner from pg_class where oid = 'public.target_sleeve_allocations'::regclass), 'USAGE') then
    raise exception 'authenticated role can bypass sleeve RLS';
  end if;
  if exists (
    select 1 from pg_policy
    where polrelid = 'public.target_sleeve_allocations'::regclass
      and polcmd in ('r', '*')
      and polname not in ('target_sleeve_allocations_read', 'target_sleeve_allocations_service_role_write')
  ) then
    raise exception 'unexpected sleeve SELECT/ALL policy; stop without rewriting it';
  end if;
  if has_table_privilege('authenticated', 'public.target_sleeve_allocations',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception 'unexpected authenticated sleeve write grant';
  end if;
end
$guard$;

drop policy if exists target_sleeve_allocations_read on public.target_sleeve_allocations;
create policy target_sleeve_allocations_read on public.target_sleeve_allocations
  for select to authenticated
  using (exists (
    select 1 from public.fo_owner_profiles profile
    where profile.user_id = (select auth.uid())
  ));
-- Other policies, tables, routines and grants are intentionally unchanged.

