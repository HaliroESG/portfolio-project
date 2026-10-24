-- OFFLINE ACL supplement. Apply only inside the sealed migration + owner-read transaction.
-- Object-local rights only. No ALTER DEFAULT PRIVILEGES, role membership or global grant.
do $acl_guard$
begin
  if to_regclass('public.target_sleeve_allocations') is null
     or to_regclass('public.target_sleeve_allocations_id_seq') is null
     or pg_get_serial_sequence('public.target_sleeve_allocations', 'id')::regclass
        is distinct from 'public.target_sleeve_allocations_id_seq'::regclass then
    raise exception 'unexpected sleeve table/sequence binding';
  end if;
  if not exists (select 1 from pg_class
    where oid = 'public.target_sleeve_allocations'::regclass
      and relkind = 'r' and relrowsecurity
      and pg_has_role(current_user, relowner, 'USAGE')) then
    raise exception 'sleeve ACL correction requires its owner and enabled RLS';
  end if;
end
$acl_guard$;

revoke all privileges on table public.target_sleeve_allocations
  from public, anon, authenticated, service_role;
revoke all privileges on sequence public.target_sleeve_allocations_id_seq
  from public, anon, authenticated, service_role;
grant select on table public.target_sleeve_allocations to authenticated;
grant select, insert, update, delete on table public.target_sleeve_allocations to service_role;
grant usage, select on sequence public.target_sleeve_allocations_id_seq to service_role;

do $acl_check$
begin
  if has_table_privilege('anon', 'public.target_sleeve_allocations',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     or has_table_privilege('authenticated', 'public.target_sleeve_allocations',
       'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     or not has_table_privilege('authenticated', 'public.target_sleeve_allocations', 'SELECT')
     or has_sequence_privilege('anon', 'public.target_sleeve_allocations_id_seq', 'USAGE,SELECT,UPDATE')
     or has_sequence_privilege('authenticated', 'public.target_sleeve_allocations_id_seq', 'USAGE,SELECT,UPDATE')
     or has_table_privilege('service_role', 'public.target_sleeve_allocations', 'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     or not has_table_privilege('service_role', 'public.target_sleeve_allocations', 'SELECT')
     or not has_table_privilege('service_role', 'public.target_sleeve_allocations', 'INSERT')
     or not has_table_privilege('service_role', 'public.target_sleeve_allocations', 'UPDATE')
     or not has_table_privilege('service_role', 'public.target_sleeve_allocations', 'DELETE')
     or not has_sequence_privilege('service_role', 'public.target_sleeve_allocations_id_seq', 'USAGE')
     or not has_sequence_privilege('service_role', 'public.target_sleeve_allocations_id_seq', 'SELECT')
     or has_sequence_privilege('service_role', 'public.target_sleeve_allocations_id_seq', 'UPDATE') then
    raise exception 'unexpected effective sleeve table/sequence privileges';
  end if;
end
$acl_check$;
