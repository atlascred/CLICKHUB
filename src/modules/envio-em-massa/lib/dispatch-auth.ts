import "server-only";
import { requireCurrentUser } from "@/lib/auth-context";
import { assertPermission } from "@/lib/permissions";
import { permissions } from "@/constants/permissions";
export async function requireDispatchUser() {
  const user = await requireCurrentUser();
  assertPermission(user, permissions.conversationsView);
  assertPermission(user, permissions.agentsEdit);
  return user;
}
