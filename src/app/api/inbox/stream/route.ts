import { requireCurrentUser } from "@/lib/auth-context";
import { assertPermission } from "@/lib/permissions";
import { permissions } from "@/constants/permissions";
import { authErrorResponse } from "@/lib/api-errors";
// The reference UI falls back to polling. Avoid a database connection per tab.
export async function GET() {
  try { const user=await requireCurrentUser(); assertPermission(user,permissions.conversationsView); return new Response(null,{status:204}); }
  catch(error) { return authErrorResponse(error) ?? new Response(null,{status:503}); }
}
