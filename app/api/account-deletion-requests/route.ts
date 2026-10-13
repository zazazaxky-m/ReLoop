import { after, NextRequest } from "next/server";
import { z } from "zod";
import { accountEmailSchema } from "@/lib/account-email";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { getClientIp } from "@/lib/client-ip";
import { PUBLIC_REQUEST_MESSAGE } from "@/lib/erasure-copy";
import { createPublicDeletionRequest } from "@/lib/erasure-jobs";
import { sendAccountDeletionVerificationEmail } from "@/lib/mailer";
import { checkRateLimit } from "@/lib/rate-limit";
import { emailLinkBase, LINK_BASE_UNAVAILABLE } from "@/lib/site";

const schema = z.object({
  email: accountEmailSchema(),
  reason: z.string().max(2000).optional().or(z.literal("")),
});

const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 3600_000; // 1 hour

/**
 * Public account-deletion form. Only records the request: nothing is erased
 * until the account owner opens the one-time link mailed to the account
 * address (POST /api/account-deletion-requests/confirm), signs in and deletes
 * from the app, or an operator verifies them (docs/privacy-erasure.md).
 * The answer is identical, and equally fast, whether or not the email has an
 * account: the confirmation mail is sent after the response (`after()`), and
 * its link is built only from the configured base URL, never the Host header.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent") ?? undefined;
    const rl = await checkRateLimit(
      `account-deletion:${ip}`,
      RATE_LIMIT,
      RATE_WINDOW_MS,
    );
    if (!rl.allowed) {
      return jsonError(
        429,
        "Terlalu banyak permintaan. Coba lagi dalam 1 jam.",
      );
    }

    const linkBase = emailLinkBase();
    if (!linkBase) {
      console.error("[account-deletion] NEXT_PUBLIC_BASE_URL is not configured; no confirmation link is sent");
      return jsonError(503, LINK_BASE_UNAVAILABLE);
    }

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return jsonError(422, "Validasi gagal", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const reason = parsed.data.reason?.trim() || null;

    const { requestId, verification } = await createPublicDeletionRequest({
      email,
      reason,
      ipAddress: ip,
      userAgent: userAgent ?? null,
    });

    // Off the response path: neither the delivery time nor a delivery failure
    // may reveal whether the email has an account.
    if (verification) {
      const confirmUrl = `${linkBase}/account-deletion/confirm?token=${verification.token}`;
      after(async () => {
        try {
          await sendAccountDeletionVerificationEmail({ to: verification.to, confirmUrl });
        } catch (error) {
          console.error("[account-deletion] confirmation email failed", error instanceof Error ? error.name : "unknown");
        }
      });
    }

    return jsonOk({ requestId, status: "PENDING", message: PUBLIC_REQUEST_MESSAGE }, 202);
  } catch (error) {
    return handleApiError(error);
  }
}
