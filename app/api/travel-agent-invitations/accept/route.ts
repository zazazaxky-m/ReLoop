import { z } from "zod";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { EMAIL_TOKEN_PATTERN } from "@/lib/email-tokens";
import { acceptTravelAgentInvite } from "@/lib/invitations";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireApiUser } from "@/lib/rbac";

/**
 * Body is exactly `{ token }`: the account is the signed-in user and the
 * address is that account's current email. An email (or anything else) in the
 * body is refused, so a caller can never name the address being claimed.
 */
const schema = z.object({ token: z.string().regex(EMAIL_TOKEN_PATTERN, "Tautan undangan tidak valid") }).strict();

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60_000;

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["USER"]);
    const rl = await checkRateLimit(`invite-accept:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) return jsonError(429, "Terlalu banyak percobaan. Coba lagi nanti.");

    const { token } = schema.parse(await req.json().catch(() => null));
    const { travelAgentId, organizationId } = await acceptTravelAgentInvite(user.id, token);
    return jsonOk({ accepted: true, travelAgentId, organizationId });
  } catch (error) {
    return handleApiError(error);
  }
}
