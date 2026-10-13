import { after } from "next/server";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { lockUser } from "@/lib/db-locks";
import { deliverEmailOutboxSafely } from "@/lib/email-outbox";
import { queueEmailVerification } from "@/lib/invitations";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireApiUser } from "@/lib/rbac";
import { emailLinkBase, LINK_BASE_UNAVAILABLE } from "@/lib/site";
import { runWalletTransaction } from "@/lib/wallet-service";

const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60 * 60_000;

/** Queues a new verification link for the signed-in account's current email. */
export async function POST() {
  try {
    const user = await requireApiUser();
    if (!emailLinkBase()) {
      console.error("[verify-email] NEXT_PUBLIC_BASE_URL is not configured; no verification link is sent");
      return jsonError(503, LINK_BASE_UNAVAILABLE);
    }
    const rl = await checkRateLimit(`verify-email-resend:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) return jsonError(429, "Terlalu banyak permintaan. Coba lagi nanti.");

    const outboxId = await runWalletTransaction(async (tx) => {
      await lockUser(tx, user.id);
      return queueEmailVerification(tx, user.id);
    });
    if (!outboxId) return jsonOk({ alreadyVerified: true, queued: false });
    after(() => deliverEmailOutboxSafely(outboxId));
    return jsonOk({ alreadyVerified: false, queued: true }, 202);
  } catch (error) {
    return handleApiError(error);
  }
}
