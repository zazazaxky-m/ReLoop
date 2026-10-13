/**
 * Travel-agent access impact report (task A03, finding SEC-03). Read-only.
 *
 * From A03 on, a travel agent's trips are visible only through a membership
 * accepted from the invited mailbox, by an account whose email is verified.
 * Memberships created before A03 (auto-linked by matching an unverified
 * registration email) are NOT verified automatically. Run this before the
 * release and again after it to see who loses trip access, so the rollout can
 * re-send their invitations and tell the agents (Z01):
 *
 *   npx tsx scripts/report-travel-agent-access.ts
 *
 * Output: one JSON document (ids, roles, agent and organization names, trip
 * counts; no email, phone or person name). Exit code 0 always when the report
 * was produced, 1 when it failed.
 */
async function main() {
  const { prisma } = await import("../lib/prisma");
  const { travelAgentAccessImpact } = await import("../lib/invitations");
  try {
    const report = await travelAgentAccessImpact();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /report-travel-agent-access\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error("[travel-agent-access] failed", error instanceof Error ? error.name : "unknown");
    process.exit(1);
  });
}
