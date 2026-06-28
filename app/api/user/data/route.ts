import { handleApiError, jsonOk, jsonError } from "@/lib/api";
import { requireApiUser } from "@/lib/rbac";
import { exportUserData, processErasureRequest } from "@/lib/gdpr";

export async function GET() {
  try {
    const user = await requireApiUser();
    const data = await exportUserData(user.id);
    return jsonOk({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE() {
  try {
    const user = await requireApiUser();
    if (user.role !== "USER") {
      return jsonError(403, "Hanya pengguna biasa yang dapat menghapus data");
    }
    await processErasureRequest(user.id);
    return jsonOk({ message: "Data berhasil dihapus. Akun dinonaktifkan." });
  } catch (error) {
    return handleApiError(error);
  }
}
