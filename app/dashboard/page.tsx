import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/rbac";
import { dashboardPath } from "@/lib/roles";

export default async function DashboardIndex() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(dashboardPath(user.role));
}
