import { NextRequest } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { getClientIp } from "@/lib/client-ip";
import { DELETION_TOKEN_INVALID, confirmDeletionRequest, getErasureStatus, runErasureJob } from "@/lib/erasure-jobs";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/, DELETION_TOKEN_INVALID),
});

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 3600_000; // 1 hour

/**
 * The account owner confirms a public deletion request with the one-time token
 * from the mailed link (POST, never GET, so link scanners cannot trigger it).
 * Answers 202 with the job status, like DELETE /api/user/data.
 */
export async function POST(req: NextRequest) {
  try {
    const rl = await checkRateLimit(`account-deletion-confirm:${getClientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      return jsonError(429, "Terlalu banyak percobaan. Coba lagi dalam 1 jam.");
    }
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return jsonError(400, DELETION_TOKEN_INVALID);

    const { requestId, status } = await confirmDeletionRequest(parsed.data.token);
    if (status === "PROCESSING" || status === "VERIFIED" || status === "RETRYABLE_FAILED") {
      try {
        await runErasureJob(requestId);
      } catch (error) {
        console.error("[erasure] first run failed", error instanceof Error ? error.name : "unknown");
      }
    }
    return jsonOk(await getErasureStatus(requestId), 202);
  } catch (error) {
    return handleApiError(error);
  }
}
