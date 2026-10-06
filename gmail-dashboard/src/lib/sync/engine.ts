import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  AuthRequiredError,
  GmailApiError,
  GmailNetworkError,
  HistoryExpiredError,
  SyncCancelledError,
  errorMessage,
} from "../errors";
import { GmailClient } from "../gmail/client";
import { flagsFromLabels, normalizeMessage, outOfScopeReason } from "../gmail/parse";
import type { GmailMessage, GmailMessageRef } from "../gmail/types";

/**
 * Gmail → local database synchronization.
 *
 * Design guarantees:
 * - Local data is never deleted by sync. Messages that disappear from Gmail are
 *   flagged with removedAt/removedReason instead.
 * - Work is resumable: listing writes lightweight "stub" rows first; metadata is
 *   fetched for any stub without metadataFetchedAt on every run, so an
 *   interrupted sync simply continues next time.
 * - The history checkpoint is only advanced after the changes it covers have
 *   been persisted.
 */

export type SyncMode = "full" | "incremental";

const METADATA_BATCH = 200;
const METADATA_CONCURRENCY = 8;
const MAX_FETCH_ATTEMPTS = 3;
const MAX_STORED_ERRORS_PER_RUN = 500;

// ---------------------------------------------------------------------------
// Process-wide runtime state (survives Next.js dev hot reloads).
// ---------------------------------------------------------------------------

type Runtime = { runId: string | null; cancelRequested: boolean };
const g = globalThis as unknown as { __gmailSyncRuntime?: Runtime };
const runtime: Runtime = (g.__gmailSyncRuntime ??= { runId: null, cancelRequested: false });

export function isSyncRunning(): boolean {
  return runtime.runId !== null;
}

export function currentRunId(): string | null {
  return runtime.runId;
}

export function requestCancel(): boolean {
  if (!runtime.runId) return false;
  runtime.cancelRequested = true;
  return true;
}

/**
 * Runs persisted as "running" that this process is not executing were left
 * behind by a crashed or restarted server; mark them interrupted.
 */
export async function markStaleRuns(): Promise<void> {
  if (runtime.runId === "starting") return;
  await prisma.syncRun.updateMany({
    where: { status: "running", ...(runtime.runId ? { id: { not: runtime.runId } } : {}) },
    data: {
      status: "interrupted",
      finishedAt: new Date(),
      lastError: "The server stopped during synchronization. Progress was kept and the next sync resumes from it.",
    },
  });
}

export async function startSync(
  accountId: string,
  requested: "auto" | "full" = "auto",
): Promise<{ runId: string; mode: SyncMode; alreadyRunning: boolean }> {
  if (runtime.runId && runtime.runId !== "starting") {
    const run = await prisma.syncRun.findUnique({ where: { id: runtime.runId } });
    return { runId: runtime.runId, mode: (run?.mode as SyncMode) ?? "incremental", alreadyRunning: true };
  }
  if (runtime.runId === "starting") throw new Error("A synchronization is already starting.");

  runtime.runId = "starting"; // synchronous lock before any await
  runtime.cancelRequested = false;
  try {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    if (account.needsReauth || !account.refreshTokenEnc) throw new AuthRequiredError(account.authError ?? undefined);

    await prisma.syncRun.updateMany({
      where: { accountId, status: "running" },
      data: { status: "interrupted", finishedAt: new Date(), lastError: "Superseded by a new synchronization." },
    });

    const mode: SyncMode = requested === "full" || !account.historyId ? "full" : "incremental";
    const run = await prisma.syncRun.create({ data: { accountId, mode, status: "running" } });
    runtime.runId = run.id;

    void execute(run.id, accountId, mode).finally(() => {
      runtime.runId = null;
      runtime.cancelRequested = false;
    });

    return { runId: run.id, mode, alreadyRunning: false };
  } catch (e) {
    runtime.runId = null;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Run context: counters + throttled progress persistence.
// ---------------------------------------------------------------------------

class RunContext {
  phase = "starting";
  discovered = 0;
  processed = 0;
  toProcess = 0;
  errorCount = 0;
  storedErrors = 0;
  private lastFlush = 0;

  constructor(
    readonly runId: string,
    readonly accountId: string,
    readonly gmail: GmailClient,
  ) {}

  checkCancelled() {
    if (runtime.cancelRequested) throw new SyncCancelledError();
  }

  async setPhase(phase: string) {
    this.phase = phase;
    await this.flush(true);
  }

  async flush(force = false) {
    const now = Date.now();
    if (!force && now - this.lastFlush < 750) return;
    this.lastFlush = now;
    await prisma.syncRun.update({
      where: { id: this.runId },
      data: {
        phase: this.phase,
        discovered: this.discovered,
        processed: this.processed,
        toProcess: this.toProcess,
        errorCount: this.errorCount,
        heartbeatAt: new Date(),
      },
    });
  }

  async recordError(messageId: string | null, message: string) {
    this.errorCount++;
    if (this.storedErrors >= MAX_STORED_ERRORS_PER_RUN) return;
    this.storedErrors++;
    await prisma.syncError.create({
      data: { syncRunId: this.runId, messageId, message: message.slice(0, 1000) },
    });
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function execute(runId: string, accountId: string, mode: SyncMode) {
  const ctx = new RunContext(runId, accountId, new GmailClient(accountId));
  let status = "completed";
  let lastError: string | null = null;

  try {
    await syncLabels(ctx);

    let fullCompleted = false;
    if (mode === "incremental") {
      try {
        await incrementalSync(ctx);
      } catch (e) {
        if (!(e instanceof HistoryExpiredError)) throw e;
        console.info("[sync]", e.message);
        await prisma.syncRun.update({ where: { id: runId }, data: { mode: "full" } });
        await fullListing(ctx);
        fullCompleted = true;
      }
    } else {
      await fullListing(ctx);
      fullCompleted = true;
    }

    await fetchPendingMetadata(ctx, mode === "full");

    await ctx.setPhase("finalizing");
    const [pending, account] = await Promise.all([
      prisma.message.count({ where: { accountId, metadataFetchedAt: null, removedAt: null } }),
      prisma.account.findUniqueOrThrow({ where: { id: accountId } }),
    ]);
    // "Initial sync complete" = a full listing has succeeded at some point and
    // every listed message has metadata.
    const initialDone = !account.initialSyncCompletedAt && Boolean(fullCompleted || account.historyId) && pending === 0;
    await prisma.account.update({
      where: { id: accountId },
      data: { lastSyncAt: new Date(), ...(initialDone ? { initialSyncCompletedAt: new Date() } : {}) },
    });

    status = ctx.errorCount > 0 ? "completed_with_errors" : "completed";
  } catch (e) {
    if (e instanceof SyncCancelledError) {
      status = "cancelled";
      lastError = "Cancelled by user. Everything fetched so far was saved.";
    } else {
      status = "failed";
      lastError = errorMessage(e);
      console.error("[sync] run failed:", e);
    }
  } finally {
    ctx.phase = "done";
    try {
      await ctx.flush(true);
      await prisma.syncRun.update({
        where: { id: runId },
        data: { status, lastError, finishedAt: new Date() },
      });
    } catch (e) {
      console.error("[sync] could not persist final run state:", e);
    }
  }
}

async function syncLabels(ctx: RunContext) {
  await ctx.setPhase("labels");
  const labels = await ctx.gmail.listLabels();
  for (const label of labels) {
    await prisma.label.upsert({
      where: { accountId_gmailId: { accountId: ctx.accountId, gmailId: label.id } },
      create: {
        accountId: ctx.accountId,
        gmailId: label.id,
        name: label.name,
        type: label.type ?? "user",
      },
      update: { name: label.name, type: label.type ?? "user" },
    });
  }
}

// ---------------------------------------------------------------------------
// Full listing: enumerate every message id via messages.list pagination.
// ---------------------------------------------------------------------------

async function fullListing(ctx: RunContext) {
  await ctx.setPhase("listing");

  // Capture the history checkpoint BEFORE listing so changes that happen while
  // we list are picked up by the next incremental sync.
  const profile = await ctx.gmail.getProfile();
  await prisma.account.update({
    where: { id: ctx.accountId },
    data: { gmailMessagesTotal: profile.messagesTotal },
  });

  let pageToken: string | undefined;
  do {
    ctx.checkCancelled();
    const page = await ctx.gmail.listMessages({ pageToken });
    const refs = page.messages ?? [];
    await upsertStubs(ctx, refs, { markSeen: true });
    ctx.discovered += refs.length;
    await ctx.flush();
    pageToken = page.nextPageToken;
  } while (pageToken);

  // The listing completed, so anything not seen is no longer in the mailbox
  // scope (deleted, or moved to Trash/Spam). Flag it; never delete the row.
  await prisma.message.updateMany({
    where: {
      accountId: ctx.accountId,
      removedAt: null,
      OR: [{ lastSeenSyncRunId: null }, { lastSeenSyncRunId: { not: ctx.runId } }],
    },
    data: { removedAt: new Date(), removedReason: "missing" },
  });

  await markAttachments(ctx, "has:attachment");

  await prisma.account.update({
    where: { id: ctx.accountId },
    data: { historyId: profile.historyId },
  });
}

/** Inserts rows for unknown ids; refreshes bookkeeping for known ones. */
async function upsertStubs(ctx: RunContext, refs: GmailMessageRef[], opts: { markSeen: boolean }) {
  if (refs.length === 0) return;
  const ids = refs.map((r) => r.id);
  const existing = await prisma.message.findMany({
    where: { id: { in: ids } },
    select: { id: true, removedAt: true },
  });
  const known = new Map(existing.map((m) => [m.id, m]));
  const fresh = refs.filter((r) => !known.has(r.id));
  const reappeared = existing.filter((m) => m.removedAt !== null).map((m) => m.id);

  await prisma.$transaction([
    prisma.message.createMany({
      data: fresh.map((r) => ({
        id: r.id,
        threadId: r.threadId,
        accountId: ctx.accountId,
        lastSeenSyncRunId: opts.markSeen ? ctx.runId : null,
      })),
    }),
    // Restored from Trash/Spam: clear the flag and refetch labels.
    prisma.message.updateMany({
      where: { id: { in: reappeared } },
      data: { removedAt: null, removedReason: null, metadataFetchedAt: null, fetchAttempts: 0 },
    }),
    ...(opts.markSeen
      ? [prisma.message.updateMany({ where: { id: { in: existing.map((m) => m.id) } }, data: { lastSeenSyncRunId: ctx.runId } })]
      : []),
  ]);
}

/**
 * Gmail's metadata format does not expose MIME parts, so attachment presence
 * comes from Gmail's own search operator, which costs one list call per 500.
 */
async function markAttachments(ctx: RunContext, q: string) {
  await ctx.setPhase("attachments");
  let pageToken: string | undefined;
  do {
    ctx.checkCancelled();
    const page = await ctx.gmail.listMessages({ q, pageToken });
    const ids = (page.messages ?? []).map((m) => m.id);
    if (ids.length) {
      await prisma.message.updateMany({ where: { id: { in: ids } }, data: { hasAttachments: true } });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
}

// ---------------------------------------------------------------------------
// Incremental sync via users.history.list
// ---------------------------------------------------------------------------

type LabelDelta = { add: Set<string>; remove: Set<string> };

async function incrementalSync(ctx: RunContext) {
  await ctx.setPhase("history");
  const account = await prisma.account.findUniqueOrThrow({ where: { id: ctx.accountId } });
  const startHistoryId = account.historyId;
  if (!startHistoryId) throw new HistoryExpiredError();

  const added = new Map<string, GmailMessageRef>();
  const deleted = new Set<string>();
  const deltas = new Map<string, LabelDelta>();
  let latestHistoryId = startHistoryId;

  const deltaFor = (id: string) => {
    let d = deltas.get(id);
    if (!d) deltas.set(id, (d = { add: new Set(), remove: new Set() }));
    return d;
  };

  let pageToken: string | undefined;
  do {
    ctx.checkCancelled();
    const page = await ctx.gmail.listHistory({ startHistoryId, pageToken });
    // Records are in chronological order; apply them in sequence.
    for (const record of page.history ?? []) {
      for (const { message } of record.messagesAdded ?? []) {
        added.set(message.id, { id: message.id, threadId: message.threadId });
        deleted.delete(message.id);
      }
      for (const { message } of record.messagesDeleted ?? []) {
        deleted.add(message.id);
        added.delete(message.id);
      }
      for (const change of record.labelsAdded ?? []) {
        const d = deltaFor(change.message.id);
        for (const l of change.labelIds ?? []) {
          d.remove.delete(l);
          d.add.add(l);
        }
      }
      for (const change of record.labelsRemoved ?? []) {
        const d = deltaFor(change.message.id);
        for (const l of change.labelIds ?? []) {
          d.add.delete(l);
          d.remove.add(l);
        }
      }
    }
    if (page.historyId) latestHistoryId = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);

  ctx.discovered = added.size;
  await ctx.flush(true);

  // New messages → stubs (metadata fetched below).
  const addedRefs = Array.from(added.values());
  for (let i = 0; i < addedRefs.length; i += 500) {
    await upsertStubs(ctx, addedRefs.slice(i, i + 500), { markSeen: false });
  }

  // Permanently deleted in Gmail → flag locally.
  const deletedIds = Array.from(deleted);
  for (let i = 0; i < deletedIds.length; i += 500) {
    await prisma.message.updateMany({
      where: { id: { in: deletedIds.slice(i, i + 500) }, removedAt: null },
      data: { removedAt: new Date(), removedReason: "deleted" },
    });
  }

  // Label changes (read/unread, archive, trash, ...) applied as deltas. Rows
  // without metadata yet are skipped: their upcoming fetch returns current
  // labels. Deltas are idempotent, so re-processing a window is safe.
  await applyLabelDeltas(
    ctx,
    Array.from(deltas.entries()).filter(([id]) => !deleted.has(id)),
  );

  if (added.size > 0) {
    // Attachment flags for new mail: search the window since the last sync
    // (with a 2-day margin for delayed delivery). after: accepts epoch seconds.
    const since = Math.floor(((account.lastSyncAt?.getTime() ?? Date.now()) - 2 * 86_400_000) / 1000);
    await markAttachments(ctx, `has:attachment after:${since}`);
  }

  // Everything covered by this history window is persisted; advance checkpoint.
  await prisma.account.update({ where: { id: ctx.accountId }, data: { historyId: latestHistoryId } });
}

async function applyLabelDeltas(ctx: RunContext, entries: [string, LabelDelta][]) {
  for (let i = 0; i < entries.length; i += 200) {
    ctx.checkCancelled();
    const chunk = entries.slice(i, i + 200);
    const ids = chunk.map(([id]) => id);
    const rows = await prisma.message.findMany({
      where: { id: { in: ids } },
      select: { id: true, metadataFetchedAt: true, removedReason: true, labels: { select: { labelId: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    await prisma.$transaction(async (tx) => {
      for (const [id, delta] of chunk) {
        const row = byId.get(id);
        if (!row || !row.metadataFetchedAt) continue; // unknown or not yet fetched: full fetch will cover it
        const labels = new Set(row.labels.map((l) => l.labelId));
        delta.add.forEach((l) => labels.add(l));
        delta.remove.forEach((l) => labels.delete(l));
        const list = Array.from(labels);
        const outOfScope = outOfScopeReason(list);

        await replaceLabels(tx, id, list);
        await tx.message.update({
          where: { id },
          data: {
            ...flagsFromLabels(list),
            ...(outOfScope
              ? { removedAt: new Date(), removedReason: outOfScope }
              : row.removedReason === "trash" || row.removedReason === "spam"
                ? { removedAt: null, removedReason: null }
                : {}),
          },
        });
      }
    });
  }
}

async function replaceLabels(tx: Prisma.TransactionClient, messageId: string, labelIds: string[]) {
  await tx.messageLabel.deleteMany({ where: { messageId } });
  if (labelIds.length) {
    await tx.messageLabel.createMany({ data: labelIds.map((labelId) => ({ messageId, labelId })) });
  }
}

// ---------------------------------------------------------------------------
// Metadata fetch for every stub without metadata (resumable).
// ---------------------------------------------------------------------------

type FetchResult =
  | { id: string; ok: true; message: GmailMessage }
  | { id: string; ok: false; notFound: boolean; transient: boolean; error: string };

async function fetchPendingMetadata(ctx: RunContext, resetAttempts: boolean) {
  await ctx.setPhase("metadata");
  const where = {
    accountId: ctx.accountId,
    metadataFetchedAt: null,
    removedAt: null,
    fetchAttempts: { lt: MAX_FETCH_ATTEMPTS },
  };

  if (resetAttempts) {
    await prisma.message.updateMany({
      where: { accountId: ctx.accountId, metadataFetchedAt: null, removedAt: null },
      data: { fetchAttempts: 0 },
    });
  }

  ctx.toProcess = await prisma.message.count({ where });
  ctx.processed = 0;
  await ctx.flush(true);

  for (;;) {
    ctx.checkCancelled();
    const batch = await prisma.message.findMany({ where, select: { id: true }, take: METADATA_BATCH });
    if (batch.length === 0) break;

    const results = await mapWithConcurrency(batch, METADATA_CONCURRENCY, async ({ id }): Promise<FetchResult> => {
      try {
        return { id, ok: true, message: await ctx.gmail.getMessageMetadata(id) };
      } catch (e) {
        if (e instanceof AuthRequiredError) throw e;
        const notFound = e instanceof GmailApiError && e.status === 404;
        const transient =
          e instanceof GmailNetworkError || (e instanceof GmailApiError && (e.status >= 500 || e.status === 429));
        return { id, ok: false, notFound, transient, error: errorMessage(e) };
      }
    });

    // If the whole batch failed transiently (network down, Gmail outage), stop
    // the run instead of burning retry attempts. Everything so far is saved.
    const failures = results.filter((r): r is Extract<FetchResult, { ok: false }> => !r.ok);
    if (failures.length === results.length && failures.every((f) => f.transient)) {
      throw new GmailNetworkError(`Gmail is unreachable right now (${failures[0].error}). Progress was saved.`);
    }

    await persistBatch(ctx, results);
    ctx.processed += results.filter((r) => r.ok || r.notFound).length;
    await ctx.flush();
  }
}

async function persistBatch(ctx: RunContext, results: FetchResult[]) {
  const now = new Date();
  const errors: { id: string; error: string }[] = [];

  await prisma.$transaction(
    async (tx) => {
      for (const r of results) {
        if (r.ok) {
          let n: ReturnType<typeof normalizeMessage>;
          try {
            n = normalizeMessage(r.message);
          } catch (e) {
            // Malformed message: keep the row, record the problem, don't retry forever.
            errors.push({ id: r.id, error: `Could not parse message: ${errorMessage(e)}` });
            await tx.message.update({
              where: { id: r.id },
              data: { fetchAttempts: MAX_FETCH_ATTEMPTS, lastFetchError: "parse error" },
            });
            continue;
          }
          const { labelIds, ...fields } = n;
          const outOfScope = outOfScopeReason(labelIds);
          await tx.message.update({
            where: { id: r.id },
            data: {
              ...fields,
              metadataFetchedAt: now,
              lastFetchError: null,
              ...(outOfScope ? { removedAt: now, removedReason: outOfScope } : {}),
            },
          });
          await replaceLabels(tx, r.id, labelIds);
        } else if (r.notFound) {
          await tx.message.update({
            where: { id: r.id },
            data: { removedAt: now, removedReason: "deleted", lastFetchError: "Not found in Gmail" },
          });
        } else {
          errors.push({ id: r.id, error: r.error });
          await tx.message.update({
            where: { id: r.id },
            data: { fetchAttempts: { increment: 1 }, lastFetchError: r.error.slice(0, 500) },
          });
        }
      }
    },
    { timeout: 60_000 },
  );

  for (const e of errors) await ctx.recordError(e.id, e.error);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
