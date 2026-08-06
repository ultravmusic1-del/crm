-- 0001b_function_search_path.sql
-- Security Advisor: function_search_path_mutable on the three functions in
-- 0001 that did not pin search_path. A caller who controls search_path can
-- otherwise shadow objects a function references. It matters most for
-- hook_restrict_signup, which executes as the privileged supabase_auth_admin
-- role during login.
--
-- Numbered 0001b so it sorts between 0001 and 0002 without renumbering the
-- migrations the plan already allocates.
--
-- No function BODY changes: all three already fully qualify their public
-- references, and everything else they touch (now(), lower(),
-- jsonb_build_object(), the at-time-zone operator, ::date) lives in
-- pg_catalog, which stays on the implicit path even with search_path = ''.

alter function public.f_set_updated_at()          set search_path = '';
alter function public.f_today()                   set search_path = '';
alter function public.hook_restrict_signup(jsonb) set search_path = '';
