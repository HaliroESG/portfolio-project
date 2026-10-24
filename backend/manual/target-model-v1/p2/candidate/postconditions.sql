do $p2_post$
begin
 if (select count(*) from pg_attribute where attrelid='public.target_models'::regclass and attnum>0 and not attisdropped)<>15
 or (select count(*) from pg_attribute where attrelid='public.allocation_advice_items_latest'::regclass and attnum>0 and not attisdropped)<>32
 or not exists(select 1 from pg_class where oid='public.allocation_advice_items_latest'::regclass and 'security_invoker=true'=any(reloptions))
 or not exists(select 1 from pg_class where oid='public.target_sleeve_allocations'::regclass and relrowsecurity)
 then raise exception 'Contract shape or security_invoker mismatch'; end if;
 if exists(select 1 from public.target_models)
 or exists(select 1 from public.target_buckets)
 or exists(select 1 from public.target_sleeve_allocations)
 or exists(select 1 from public.target_envelope_lines)
 or exists(select 1 from public.target_model_audit_holdings)
 then raise exception 'Schema-only package unexpectedly imported a model'; end if;
 if has_function_privilege('anon','public.apply_target_model_v1(jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
 or has_function_privilege('authenticated','public.apply_target_model_v1(jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
 or not has_function_privilege('service_role','public.apply_target_model_v1(jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
 then raise exception 'RPC execute privilege mismatch'; end if;
 if not exists(select 1 from pg_policy where polrelid='public.target_sleeve_allocations'::regclass
   and polname='target_sleeve_allocations_read' and polcmd='r'
   and polroles=array['authenticated'::regrole::oid] and pg_get_expr(polqual,polrelid) like '%fo_owner_profiles%')
 then raise exception 'Owner-read postlude missing'; end if;
end $p2_post$;

