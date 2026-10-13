import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import {
  type IngestEventInput,
  type IngestEventResult,
} from "./shared";
import { processEventSideEffects, type PostCommitEffect } from "./side-effects";
import type { DepositItemCache } from "./item-cache";

export type IngestMachine = Prisma.MachineGetPayload<{
  include: { organization: true };
}>;

export interface IngestOptions {
  /** Preloaded machine row — skips redundant lookup when ingesting a batch. */
  machine?: IngestMachine;
  /** Reused across events in the same ingest batch to avoid repeated lookups. */
  depositItemCache?: DepositItemCache;
  /** Test seams injected by the caller's process (never reachable over HTTP). */
  hooks?: IngestHooks;
}

export interface IngestHooks {
  /** Inside the event transaction after every side effect (reward included), before COMMIT. */
  afterSideEffects?: (tx: Prisma.TransactionClient) => Promise<void>;
}

/** P2002 (or SQLSTATE 23505 through a raw query): another writer owns the key. */
function isUniqueViolation(error: unknown): boolean {
  const { code, meta } = (error ?? {}) as { code?: unknown; meta?: { code?: unknown } };
  return code === "P2002" || (code === "P2010" && meta?.code === "23505");
}

/**
 * Idempotent machine event ingestion with acceptance-point reward gating.
 *
 * Resolves only after the event row and every side effect (reward included)
 * committed in one transaction, so callers may report it as accepted; any
 * exception inside it rolls the event and its ledger effects back together. A
 * money side effect (acceptance, fraud hold) takes the reward recipient's User
 * lock before any DepositSession/DepositItem lock (lib/db-locks.ts). A retry
 * of a committed localEventId, including one that loses a concurrent
 * unique-insert race, returns `duplicate: true` without running side effects
 * again. Notifications are sent only after commit.
 */
export async function ingestMachineEvent(
  input: IngestEventInput,
  options?: IngestOptions,
): Promise<IngestEventResult> {
  const machine =
    options?.machine ??
    (await prisma.machine.findUnique({
      where: { machineCode: input.machineCode },
      include: { organization: true },
    }));
  if (!machine) throw new Error("Mesin tidak ditemukan");

  const existing = await prisma.machineEvent.findUnique({
    where: {
      machineId_localEventId: {
        machineId: machine.id,
        localEventId: input.localEventId,
      },
    },
  });
  if (existing) {
    return {
      duplicate: true,
      eventId: existing.id,
      message: "Event sudah diproses",
      depositItemId: existing.depositItemId,
    };
  }

  // Edge machines can retain queued events across a server database reset.
  // Detach stale foreign keys instead of failing the complete ingest batch.
  let sessionId = input.sessionId ?? null;
  let depositItemId = input.depositItemId ?? null;
  const orphanedReferences: Record<string, string> = {};

  if (sessionId) {
    const session = await prisma.depositSession.findFirst({
      where: { id: sessionId, machineId: machine.id },
      select: { id: true },
    });
    if (!session) {
      orphanedReferences.sessionId = sessionId;
      sessionId = null;
      depositItemId = null;
    }
  }

  if (depositItemId) {
    const item = await prisma.depositItem.findFirst({
      where: { id: depositItemId, session: { machineId: machine.id } },
      select: { id: true, sessionId: true },
    });
    if (!item || (sessionId && item.sessionId !== sessionId)) {
      orphanedReferences.depositItemId = depositItemId;
      depositItemId = null;
    }
  }

  const sanitizedInput: IngestEventInput = {
    ...input,
    sessionId,
    depositItemId,
    payload:
      Object.keys(orphanedReferences).length > 0
        ? { ...(input.payload ?? {}), orphanedReferences }
        : input.payload,
  };

  let createdItemId: string | null = null;

  const occurredAt = input.occurredAt
    ? new Date(input.occurredAt)
    : new Date();

  // Admin notifications/pushes queued by side effects; sent only after commit
  // so a rolled-back attempt (later retried) never notifies twice.
  const afterCommit: PostCommitEffect[] = [];
  let eventId: string;
  try {
    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.machineEvent.create({
        data: {
          machineId: machine.id,
          sessionId,
          depositItemId,
          localEventId: input.localEventId,
          eventType: input.eventType,
          payloadJson: (sanitizedInput.payload ?? undefined) as Prisma.InputJsonValue | undefined,
          occurredAt,
        },
      });

      await processEventSideEffects(
        tx,
        machine,
        sanitizedInput,
        created.id,
        (id) => {
          createdItemId = id;
        },
        options?.depositItemCache,
        (effect) => {
          afterCommit.push(effect);
        },
      );
      await options?.hooks?.afterSideEffects?.(tx);
      return created;
    });
    eventId = event.id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // A concurrent delivery of the same localEventId won the insert. The
    // event row and its side effects commit together, so a visible row means
    // that commit is complete: answer duplicate instead of an error.
    const winner = await prisma.machineEvent.findUnique({
      where: {
        machineId_localEventId: {
          machineId: machine.id,
          localEventId: input.localEventId,
        },
      },
    });
    if (!winner) throw error;
    return {
      duplicate: true,
      eventId: winner.id,
      message: "Event sudah diproses",
      depositItemId: winner.depositItemId,
    };
  }

  for (const effect of afterCommit) {
    try {
      await effect();
    } catch (error) {
      // Best effort: the event is committed and must still be reported accepted.
      console.error("[machine-events] post-commit effect failed:", error);
    }
  }

  return {
    duplicate: false,
    eventId,
    depositItemId: createdItemId ?? depositItemId,
    message:
      Object.keys(orphanedReferences).length > 0
        ? "Referensi sesi/item lokal tidak ditemukan dan dilepas"
        : undefined,
  };
}
