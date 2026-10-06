"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Clock,
  Loader2,
  RefreshCw,
  RotateCcw,
  Square,
  XCircle,
} from "lucide-react";
import type { SyncStatusDTO } from "@/lib/sync/status";
import { cn, formatDateTime, formatNumber, formatRelative } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const PHASE_LABELS: Record<string, string> = {
  starting: "Starting",
  labels: "Reading labels",
  listing: "Discovering messages",
  history: "Fetching changes since last sync",
  metadata: "Downloading message metadata",
  attachments: "Detecting attachments",
  finalizing: "Finalizing",
  done: "Done",
};

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "default"; icon: typeof CheckCircle2 }> = {
  running: { label: "Running", variant: "default", icon: Loader2 },
  completed: { label: "Completed", variant: "success", icon: CheckCircle2 },
  completed_with_errors: { label: "Completed with errors", variant: "warning", icon: AlertTriangle },
  failed: { label: "Failed", variant: "destructive", icon: XCircle },
  cancelled: { label: "Cancelled", variant: "secondary", icon: CircleSlash },
  interrupted: { label: "Interrupted", variant: "warning", icon: AlertTriangle },
};

export function SyncPanel({ initial }: { initial: SyncStatusDTO }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const wasRunning = useRef(initial.running);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/sync/status", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as SyncStatusDTO;
      setStatus(next);
      if (wasRunning.current && !next.running) router.refresh(); // update server-rendered numbers
      wasRunning.current = next.running;
    } catch {
      // transient; next poll retries
    }
  }, [router]);

  useEffect(() => {
    const id = setInterval(refresh, status.running ? 1500 : 10_000);
    return () => clearInterval(id);
  }, [refresh, status.running]);

  async function post(path: string, body?: unknown) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(data.error ?? `Request failed (${res.status})`);
      }
    } catch {
      setActionError("Could not reach the local server.");
    } finally {
      setBusy(false);
      wasRunning.current = true;
      await refresh();
    }
  }

  const { run, stats, account, running } = status;
  const statusInfo = run ? STATUS[run.status] ?? STATUS.failed : null;
  const isFetching = running && run?.phase === "metadata" && run.toProcess > 0;
  const percent = isFetching
    ? (run!.processed / run!.toProcess) * 100
    : !running && stats.total > 0
      ? (stats.withMetadata / stats.total) * 100
      : null;
  const estimatedTotal = account?.gmailMessagesTotal ?? null;

  return (
    <div className="space-y-6">
      {account?.needsReauth && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Google authorization expired</AlertTitle>
          <AlertDescription>
            <p>{account.authError ?? "Please reconnect your Google account."} Your local data is safe.</p>
            <Button asChild size="sm" variant="outline" className="mt-2">
              <a href="/api/auth/google?mode=readonly">Reconnect</a>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Synchronization
            {statusInfo && run && (
              <Badge variant={statusInfo.variant}>
                <statusInfo.icon className={cn(run.status === "running" && "animate-spin")} />
                {statusInfo.label}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {account?.initialSyncCompletedAt
              ? "Incremental sync — only new and changed messages are fetched."
              : "The first sync lists every message and downloads its metadata. Large mailboxes can take a while; it resumes automatically if interrupted."}
          </CardDescription>
          <CardAction className="flex gap-2">
            {running ? (
              <Button variant="outline" onClick={() => post("/api/sync/cancel")} disabled={busy}>
                <Square /> Cancel
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => post("/api/sync", { mode: "full" })}
                  disabled={busy || !account?.connected}
                  title="Re-list every message and reconcile deletions. Uses more API quota."
                >
                  <RotateCcw /> Full resync
                </Button>
                <Button onClick={() => post("/api/sync", { mode: "auto" })} disabled={busy || !account?.connected}>
                  <RefreshCw className={cn(busy && "animate-spin")} /> Sync now
                </Button>
              </>
            )}
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-5">
          {actionError && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {running && run ? PHASE_LABELS[run.phase] ?? run.phase : "Local metadata coverage"}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {isFetching && run
                  ? `${formatNumber(run.processed)} / ${formatNumber(run.toProcess)}`
                  : running
                    ? ""
                    : `${formatNumber(stats.withMetadata)} / ${formatNumber(stats.total)}`}
              </span>
            </div>
            <Progress value={running && !isFetching ? null : percent} />
          </div>

          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Stat
              label="Discovered (this run)"
              value={formatNumber(run?.discovered ?? 0)}
              hint={run?.mode === "full" && estimatedTotal ? `of ~${formatNumber(estimatedTotal)} in Gmail` : run ? `${run.mode} sync` : undefined}
            />
            <Stat label="Processed (this run)" value={formatNumber(run?.processed ?? 0)} />
            <Stat
              label="Errors"
              value={formatNumber(run?.errorCount ?? 0)}
              tone={run && run.errorCount > 0 ? "warn" : undefined}
            />
            <Stat label="Messages stored" value={formatNumber(stats.total)} hint={stats.pending ? `${formatNumber(stats.pending)} pending metadata` : "all with metadata"} />
            <Stat
              label="Last successful sync"
              value={formatRelative(account?.lastSyncAt)}
              hint={account?.lastSyncAt ? formatDateTime(account.lastSyncAt) : undefined}
            />
          </dl>

          {run?.lastError && run.status !== "running" && (
            <Alert variant={run.status === "failed" ? "destructive" : "warning"}>
              <AlertTriangle />
              <AlertTitle>{run.status === "failed" ? "Last sync failed" : "Note"}</AlertTitle>
              <AlertDescription>
                <p>{run.lastError}</p>
                {run.status === "failed" && <p>All data synchronized before the failure was kept. Run “Sync now” to resume.</p>}
              </AlertDescription>
            </Alert>
          )}

          {(stats.failed > 0 || stats.removed > 0) && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="size-3.5" />
              {stats.failed > 0 && `${formatNumber(stats.failed)} messages could not be fetched after 3 attempts (retried on Full resync). `}
              {stats.removed > 0 && `${formatNumber(stats.removed)} messages are no longer in your mailbox (deleted, trashed or spam) and are kept locally for history.`}
            </p>
          )}

          {status.errors.length > 0 && (
            <div className="rounded-lg border">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium"
                onClick={() => setShowErrors((v) => !v)}
              >
                Error log ({formatNumber(run?.errorCount ?? status.errors.length)})
                <ChevronDown className={cn("size-4 transition-transform", showErrors && "rotate-180")} />
              </button>
              {showErrors && (
                <ul className="max-h-64 divide-y overflow-auto border-t text-xs">
                  {status.errors.map((e) => (
                    <li key={e.id} className="px-4 py-2">
                      <span className="text-muted-foreground">{formatDateTime(e.createdAt)}</span>
                      {e.messageId && <span className="ml-2 font-mono">{e.messageId}</span>}
                      <div className="mt-0.5 break-words">{e.message}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <div className="rounded-lg bg-muted/60 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "warn" && "text-[oklch(0.55_0.14_60)]")}>{value}</dd>
      {hint && <dd className="mt-0.5 truncate text-xs text-muted-foreground" title={hint}>{hint}</dd>}
    </div>
  );
}
