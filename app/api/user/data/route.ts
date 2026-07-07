import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireApiUser } from "@/lib/rbac";
import { createUserDataExportStream, processErasureRequest } from "@/lib/gdpr";

export async function GET() {
  try {
    const user = await requireApiUser();
    const stream = createUserDataExportStream(user.id);

    return new Response(stream, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="reloop-export-${user.id}.json"`,
        "Cache-Control": "no-store",
      },
    });
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
