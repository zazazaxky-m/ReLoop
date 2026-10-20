import { headers } from "next/headers";
import { linkTokenCaptureScript, type LinkTokenKind } from "@/lib/link-token";
import { NONCE_HEADER } from "@/lib/security-headers";

/**
 * Inline, nonce'd script placed first in a token page (A03): it runs while the
 * HTML is parsed, before the page's own scripts or any other resource, and
 * moves the emailed token out of the address bar (see lib/link-token.ts).
 */
export async function LinkTokenCapture({ kind }: { kind: LinkTokenKind }) {
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: linkTokenCaptureScript(kind) }} />;
}
