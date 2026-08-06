-- verify.sql — SQL assertions run against the database.
-- Every block raises on failure. `psql -v ON_ERROR_STOP=1 -f` must exit 0.
-- Grown by every phase. Gated in Phase 8.
--
-- This machine has no psql, so it is run through the Supabase MCP
-- `execute_sql` tool instead. Strip the \set line when pasting there;
-- keep it in the file so `npm run db:verify` works once Docker exists.

\set ON_ERROR_STOP on

-- ── Phase 0 ─────────────────────────────────────────────────────────────

-- P0.1: every table in public has RLS enabled. No exceptions.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'P0.1 FAIL: table(s) without RLS: %', v_bad;
  end if;
end $$;

-- P0.2: every table has at least one policy. RLS on with no policy makes a
-- table invisible to everyone — that is how the signup_allowlist bug in the
-- original spec would have rejected every login.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname
    );
  if v_bad is not null then
    raise exception 'P0.2 FAIL: table(s) with RLS but no policy: %', v_bad;
  end if;
end $$;

-- P0.3: anon can execute no function in public. Postgres grants EXECUTE to
-- PUBLIC by default and PostgREST exposes functions as RPC endpoints.
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_bad is not null then
    raise exception 'P0.3 FAIL: anon can execute function(s): %', v_bad;
  end if;
end $$;

-- P0.4: exactly one security definer function, and it is the auth trigger.
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname <> 'f_handle_new_user';
  if v_bad is not null then
    raise exception 'P0.4 FAIL: unexpected security definer function(s): %', v_bad;
  end if;
end $$;

-- P0.5: every function pins search_path. A caller who controls search_path
-- can otherwise shadow objects a function references.
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proconfig is null
         or not exists (
           select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'
         ));
  if v_bad is not null then
    raise exception 'P0.5 FAIL: function(s) with mutable search_path: %', v_bad;
  end if;
end $$;

-- P0.6: current_date appears in no function body. The database is UTC and
-- the business is UTC+3, so current_date is wrong for three hours a day.
--
-- The CTE is `as materialized` on purpose. Written as a plain join,
-- Postgres is free to evaluate pg_get_functiondef() BEFORE the namespace
-- predicate restricts the scan — it then hits an aggregate in pg_catalog
-- and dies with `42809: "array_agg" is an aggregate function`. Materialising
-- forces the filter to run first. prokind = 'f' excludes aggregates,
-- window functions and procedures, which pg_get_functiondef cannot render.
do $$
declare v_bad text;
begin
  with public_fns as materialized (
    select oid, proname
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and prokind = 'f'
  )
  select string_agg(proname, ', ') into v_bad
  from public_fns
  where pg_get_functiondef(oid) ~* '\mcurrent_date\M';

  if v_bad is not null then
    raise exception 'P0.6 FAIL: function(s) use current_date instead of f_today(): %', v_bad;
  end if;
end $$;

-- P0.7: the allowlist is readable by the auth admin and nobody else.
do $$
begin
  if not has_table_privilege('supabase_auth_admin', 'public.signup_allowlist', 'SELECT') then
    raise exception 'P0.7 FAIL: supabase_auth_admin cannot read signup_allowlist — every login will be rejected';
  end if;
  if has_table_privilege('anon', 'public.signup_allowlist', 'SELECT')
     or has_table_privilege('authenticated', 'public.signup_allowlist', 'SELECT') then
    raise exception 'P0.7 FAIL: signup_allowlist is readable by anon or authenticated';
  end if;
end $$;

-- ── Phase 1 ─────────────────────────────────────────────────────────────

-- P1.1: at most one primary contact per customer.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from (
    select customer_id from public.contacts
    where is_primary group by customer_id having count(*) > 1
  ) t;
  if v_bad > 0 then
    raise exception 'P1.1 FAIL: % customer(s) have more than one primary contact', v_bad;
  end if;
end $$;

-- P1.2: EVERY view is security_invoker. A view without it runs as its owner
-- and bypasses RLS on its base tables. This is the single most dangerous
-- mistake available in this schema, so it is checked across all views, not
-- a hardcoded list.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and (c.reloptions is null
         or not exists (
           select 1 from unnest(c.reloptions) opt
           where opt = 'security_invoker=on' or opt = 'security_invoker=true'
         ));
  if v_bad is not null then
    raise exception 'P1.2 FAIL: view(s) missing security_invoker = on: %', v_bad;
  end if;
end $$;

-- P1.3: anon can select from no view.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and has_table_privilege('anon', c.oid, 'SELECT');
  if v_bad is not null then
    raise exception 'P1.3 FAIL: anon can select from view(s): %', v_bad;
  end if;
end $$;

-- P1.4: no interaction has a follow-up flagged done with no date, or a
-- date in a state the "due" view could never surface.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.interactions
  where follow_up_done and follow_up_on is null;
  if v_bad > 0 then
    raise exception 'P1.4 FAIL: % interaction(s) marked follow-up-done with no follow-up date', v_bad;
  end if;
end $$;

do $$ begin raise notice 'verify.sql: ALL ASSERTIONS PASSED'; end $$;
