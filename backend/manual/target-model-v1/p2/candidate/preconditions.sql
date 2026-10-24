-- Guarded one-time transition. No unknown pre-existing object is repaired silently.
do $p2_pre$
declare n text; populated boolean;
begin
  if to_regclass('public.target_sleeve_allocations') is not null
     or to_regclass('public.target_sleeve_allocations_id_seq') is not null
     or to_regprocedure('public.apply_target_model_v1(jsonb,jsonb,jsonb,jsonb,jsonb)') is not null
     or exists(select 1 from pg_attribute where attrelid='public.target_models'::regclass
       and attname in ('allocation_contract_version','reserve_floor_eur','reserve_excluded_from_risky_allocation') and not attisdropped) then
    raise exception 'Already-applied or incompatible contract objects: stop, do not replay';
  end if;
  if (select count(*) from pg_attribute where attrelid='public.target_models'::regclass and attnum>0 and not attisdropped)<>12 then
    raise exception 'Unexpected target_models shape';
  end if;
  foreach n in array array['target_models','target_buckets','target_envelope_lines','target_model_audit_holdings'] loop
    execute format('select exists(select 1 from public.%I)',n) into strict populated;
    if populated then raise exception 'This transition is qualified only for empty target tables'; end if;
  end loop;
  if exists(select 1 from pg_roles where rolname='authenticated' and (rolsuper or rolbypassrls))
     or pg_has_role('authenticated','postgres','USAGE') then
    raise exception 'Client bypasses owner isolation';
  end if;
  if exists(select 1 from pg_class where oid in ('public.fo_owner_profiles'::regclass,
    'public.target_models'::regclass,'public.target_buckets'::regclass,
    'public.fo_portfolios'::regclass,'public.fo_position_snapshots'::regclass,
    'public.fo_cash_balances_daily'::regclass) and not relrowsecurity) then
    raise exception 'Required existing RLS is absent';
  end if;
  if exists(select 1 from pg_policy where polrelid in ('public.target_models'::regclass,'public.target_buckets'::regclass)
    and polcmd in ('r','*') and polpermissive and
      exists(select 1 from unnest(polroles) as policy_role(role_oid)
         where case when role_oid=0 then true
                    else pg_has_role('authenticated',role_oid,'USAGE') end) and
      (polname in ('target_models_read','target_buckets_read') or pg_get_expr(polqual,polrelid) in ('true','(true)'))) then
    raise exception 'Legacy permissive client read policy: separate remediation required';
  end if;
end $p2_pre$;

