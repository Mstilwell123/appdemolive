-- Supabase security advisor fixes (PRD §93, §100). No behaviour change for the app.
-- Trigger functions never need to be called through the API; triggers still fire without EXECUTE.
alter function public.set_updated_at() set search_path = public;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.app_version_lock() from public, anon, authenticated;
revoke all on function public.launch_payment_guard() from public, anon, authenticated;
revoke all on function public.launch_price_snapshot() from public, anon, authenticated;

-- RLS helpers: signed-in users need them (policies call them as the caller); signed-out visitors don't.
revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_org_role(uuid, text[]) from public, anon;
revoke all on function public.is_platform_staff() from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.has_org_role(uuid, text[]) to authenticated, service_role;
grant execute on function public.is_platform_staff() to authenticated, service_role;
