import type { Campaign } from "@prisma/client";

/** Normalizes a list of email domains to lowercase `@domain.tld` form. */
export function normalizeEmailDomains(input: string[]): string[] {
  const cleaned = input
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
    .map((d) => (d.startsWith("@") ? d : `@${d}`))
    // Basic shape check: @ + label(.label)+
    .filter((d) => /^@([a-z0-9-]+\.)+[a-z]{2,}$/.test(d));
  return Array.from(new Set(cleaned));
}

/** Checks whether a user email is eligible for a private campaign. */
export function isCampaignEligible(
  campaign: Pick<
    Campaign,
    "visibility" | "allowedEmailDomainsJson" | "status" | "startAt" | "endAt"
  >,
  userEmail: string,
): { eligible: boolean; reason?: string } {
  const now = new Date();
  if (campaign.status !== "ACTIVE") {
    return { eligible: false, reason: "CAMPAIGN_INACTIVE" };
  }
  if (campaign.startAt && campaign.startAt > now) {
    return { eligible: false, reason: "CAMPAIGN_NOT_STARTED" };
  }
  if (campaign.endAt && campaign.endAt < now) {
    return { eligible: false, reason: "CAMPAIGN_ENDED" };
  }
  if (campaign.visibility === "PUBLIC") {
    return { eligible: true };
  }

  const domains = campaign.allowedEmailDomainsJson as string[] | null;
  if (!domains?.length) {
    return { eligible: false, reason: "PRIVATE_NO_DOMAINS" };
  }

  const emailLower = userEmail.toLowerCase();
  const ok = domains.some((d) => {
    const domain = d.startsWith("@") ? d.toLowerCase() : `@${d.toLowerCase()}`;
    return emailLower.endsWith(domain);
  });

  return ok
    ? { eligible: true }
    : { eligible: false, reason: "EMAIL_DOMAIN_MISMATCH" };
}
