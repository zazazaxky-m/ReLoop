import { getCurrentUser } from "@/lib/rbac";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return jsonError(401, "Tidak terautentikasi");
    return jsonOk({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
