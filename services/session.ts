import "server-only";
import { AppError } from "@/domain/errors";
import { getServiceClient, getUserClient } from "@/lib/supabase/server";

/** The signed-in founder, their RLS client and their (first) organization. */
export async function requireFounder() {
  const supabase = await getUserClient();
  if (!supabase) throw new AppError("PROVIDER_UNAVAILABLE", "Supabase is not configured");
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new AppError("UNAUTHORIZED", "Sign in required");
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, organizations(name)")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership) throw new AppError("FORBIDDEN", "No organization found for this account");
  const orgRel = membership.organizations as { name: string } | { name: string }[] | null;
  const organizationName = (Array.isArray(orgRel) ? orgRel[0]?.name : orgRel?.name) ?? null;
  return { supabase, user: auth.user, orgId: membership.organization_id as string, organizationName };
}

/** Service client for server-side writes founders can't make directly. Throws when not configured. */
export function requireService() {
  const service = getServiceClient();
  if (!service) throw new AppError("PROVIDER_UNAVAILABLE", "The server key for Supabase is not configured");
  return service;
}

/** Platform staff (admin or operator), checked server-side against platform_staff. */
export async function requireOperator() {
  const supabase = await getUserClient();
  if (!supabase) throw new AppError("PROVIDER_UNAVAILABLE", "Supabase is not configured");
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new AppError("UNAUTHORIZED", "Sign in required");
  const service = requireService();
  const { data: staff } = await service.from("platform_staff").select("role").eq("user_id", auth.user.id).maybeSingle();
  if (!staff || !["admin", "operator"].includes(staff.role)) throw new AppError("NOT_FOUND", "Not found");
  return { service, user: auth.user };
}
