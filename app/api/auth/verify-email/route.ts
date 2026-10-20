import { z } from "zod";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { EMAIL_TOKEN_PATTERN } from "@/lib/email-tokens";
import { verifyEmailToken } from "@/lib/invitations";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireApiUser } from "@/lib/rbac";

/** Body is exactly `{ token }` (the emailed single-use token); the account is the signed-in user. */
const schema = z.object({ token: z.string().regex(EMAIL_TOKEN_PATTERN, "Tautan verifikasi tidak valid") }).strict();

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60_000;

export async function POST(req: Request) {
  try {
    const user = await requireApiUser();
    const rl = await checkRateLimit(`verify-email:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) return jsonError(429, "Terlalu banyak percobaan. Coba lagi nanti.");

    const { token } = schema.parse(await req.json().catch(() => null));
    await verifyEmailToken(user.id, token);
    return jsonOk({ verified: true });
  } catch (error) {
    return handleApiError(error);
  }
}
