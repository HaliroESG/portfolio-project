-- OFFLINE supplement: repair only authenticated ACL on the recreated advice view.
-- Apply with the sealed migration, sleeve ACL supplement and owner-read postlude
-- in the same transaction. No role, default privilege, schema or other object edit.
do $view_acl_guard$
begin
  if not exists (
    select 1 from pg_class
    where oid = to_regclass('public.allocation_advice_items_latest')
      and relkind = 'v' and pg_has_role(current_user, relowner, 'USAGE')
  ) then
    raise exception 'advice view ACL correction requires the expected view owner';
  end if;
end
$view_acl_guard$;

revoke all privileges on table public.allocation_advice_items_latest from authenticated;
grant select on table public.allocation_advice_items_latest to authenticated;

do $view_acl_check$
begin
  if not has_table_privilege('authenticated', 'public.allocation_advice_items_latest', 'SELECT')
     or has_table_privilege('authenticated', 'public.allocation_advice_items_latest',
         'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'unexpected effective authenticated advice view privileges';
  end if;
end
$view_acl_check$;

