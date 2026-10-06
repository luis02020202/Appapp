import "server-only";
import { getAccountSummary, type AccountSummary } from "../accounts";
import { prisma } from "../db";
import { getConfigStatus } from "../env";
import { currentRunId, isSyncRunning, markStaleRuns } from "./engine";

export type SyncRunDTO = {
  id: string;
  mode: string;
  status: string;
  phase: string;
  discovered: number;
  processed: number;
  toProcess: number;
  errorCount: number;
  lastError: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type SyncStatusDTO = {
  configured: boolean;
  configIssues: string[];
  account: AccountSummary | null;
  running: boolean;
  run: SyncRunDTO | null;
  errors: { id: number; messageId: string | null; message: string; createdAt: string }[];
  stats: {
    total: number;
    withMetadata: number;
    pending: number;
    failed: number;
    removed: number;
  };
};

const EMPTY_STATS = { total: 0, withMetadata: 0, pending: 0, failed: 0, removed: 0 };

export async function getSyncStatus(): Promise<SyncStatusDTO> {
  const config = getConfigStatus();
  const configIssues = config.ok ? [] : config.issues;
  const account = await getAccountSummary();
  if (!account) {
    return { configured: config.ok, configIssues, account: null, running: false, run: null, errors: [], stats: EMPTY_STATS };
  }

  await markStaleRuns();
  const runningId = currentRunId();
  const run = await prisma.syncRun.findFirst({
    where: runningId && runningId !== "starting" ? { id: runningId } : { accountId: account.id },
    orderBy: { startedAt: "desc" },
  });

  const base = { accountId: account.id };
  const [total, withMetadata, pending, failed, removed, errors] = await Promise.all([
    prisma.message.count({ where: { ...base, removedAt: null } }),
    prisma.message.count({ where: { ...base, removedAt: null, metadataFetchedAt: { not: null } } }),
    prisma.message.count({ where: { ...base, removedAt: null, metadataFetchedAt: null } }),
    prisma.message.count({ where: { ...base, removedAt: null, metadataFetchedAt: null, fetchAttempts: { gte: 3 } } }),
    prisma.message.count({ where: { ...base, removedAt: { not: null } } }),
    run
      ? prisma.syncError.findMany({ where: { syncRunId: run.id }, orderBy: { id: "desc" }, take: 25 })
      : Promise.resolve([]),
  ]);

  return {
    configured: config.ok,
    configIssues,
    account,
    running: isSyncRunning(),
    run: run
      ? {
          id: run.id,
          mode: run.mode,
          status: run.status,
          phase: run.phase,
          discovered: run.discovered,
          processed: run.processed,
          toProcess: run.toProcess,
          errorCount: run.errorCount,
          lastError: run.lastError,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
        }
      : null,
    errors: errors.map((e) => ({
      id: e.id,
      messageId: e.messageId,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
    })),
    stats: { total, withMetadata, pending, failed, removed },
  };
}
