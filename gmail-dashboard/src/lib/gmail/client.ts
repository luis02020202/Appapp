import "server-only";
import { getAccessToken, markNeedsReauth } from "../accounts";
import { AuthRequiredError, GmailApiError, GmailNetworkError, HistoryExpiredError } from "../errors";
import { gmailLimiter } from "./rate-limiter";
import type {
  GmailLabel,
  GmailMessage,
  GmailProfile,
  ListHistoryResponse,
  ListMessagesResponse,
} from "./types";

const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_ATTEMPTS = 7;
const REQUEST_TIMEOUT_MS = 30_000;
const RETRYABLE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "backendError"]);

/**
 * Only these headers are requested (format=metadata). Bodies are never fetched
 * during sync.
 */
export const METADATA_HEADERS = [
  "From",
  "Sender",
  "Reply-To",
  "Subject",
  "Date",
  "List-Unsubscribe",
  "List-Unsubscribe-Post",
  "List-Id",
  "Precedence",
  "Auto-Submitted",
  "Content-Type",
];

// Quota cost per method (units).
const COST = { profile: 1, labels: 1, list: 5, get: 5, history: 2 } as const;

type QueryValue = string | number | boolean | string[] | undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function backoffMs(attempt: number, retryAfter: string | null): number {
  const retryAfterSec = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) return Math.min(retryAfterSec, 120) * 1000;
  return Math.min(32_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 1000);
}

/**
 * Thin client over the official Gmail REST API with OAuth token refresh,
 * quota-aware rate limiting and exponential backoff.
 */
export class GmailClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly accountId: string) {}

  private async accessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && this.tokenExpiresAt - 60_000 > Date.now()) return this.token;
    const { token, expiresAt } = await getAccessToken(this.accountId, { forceRefresh });
    this.token = token;
    this.tokenExpiresAt = expiresAt;
    return token;
  }

  async request<T>(path: string, query: Record<string, QueryValue>, cost: number): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((item) => params.append(k, item));
      else params.set(k, String(v));
    }
    const qs = params.toString();
    const url = `${API_BASE}/${path}${qs ? `?${qs}` : ""}`;

    let refreshedAfter401 = false;
    let lastProblem = "unknown error";

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await gmailLimiter.take(cost);
      const token = await this.accessToken();

      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          cache: "no-store",
        });
      } catch (e) {
        lastProblem = `network error: ${e instanceof Error ? e.message : String(e)}`;
        await sleep(backoffMs(attempt, null));
        continue;
      }

      if (res.ok) return (await res.json()) as T;

      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string; status?: string; errors?: { reason?: string }[] };
      } | null;
      const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status;
      const message = body?.error?.message ?? res.statusText;
      lastProblem = `HTTP ${res.status}${reason ? ` (${reason})` : ""}: ${message}`;

      if (res.status === 401) {
        if (!refreshedAfter401) {
          refreshedAfter401 = true;
          await this.accessToken(true);
          continue;
        }
        await markNeedsReauth(this.accountId, `Gmail rejected the access token: ${message}`);
        throw new AuthRequiredError();
      }

      const retryable =
        res.status === 429 ||
        res.status >= 500 ||
        (res.status === 403 && reason !== undefined && RETRYABLE_REASONS.has(reason));
      if (retryable) {
        await sleep(backoffMs(attempt, res.headers.get("retry-after")));
        continue;
      }

      throw new GmailApiError(res.status, reason, message);
    }

    if (lastProblem.startsWith("network error")) throw new GmailNetworkError(lastProblem);
    throw new GmailApiError(503, "retriesExhausted", `Gave up after ${MAX_ATTEMPTS} attempts: ${lastProblem}`);
  }

  getProfile() {
    return this.request<GmailProfile>("profile", {}, COST.profile);
  }

  async listLabels(): Promise<GmailLabel[]> {
    const res = await this.request<{ labels?: GmailLabel[] }>("labels", {}, COST.labels);
    return res.labels ?? [];
  }

  /** Label details including messagesTotal / messagesUnread counters. */
  getLabel(id: string) {
    return this.request<GmailLabel>(`labels/${encodeURIComponent(id)}`, {}, COST.labels);
  }

  listMessages(opts: { pageToken?: string; q?: string; maxResults?: number; includeSpamTrash?: boolean } = {}) {
    return this.request<ListMessagesResponse>(
      "messages",
      {
        maxResults: opts.maxResults ?? 500,
        pageToken: opts.pageToken,
        q: opts.q,
        includeSpamTrash: opts.includeSpamTrash ?? false,
      },
      COST.list,
    );
  }

  getMessageMetadata(id: string) {
    return this.request<GmailMessage>(
      `messages/${encodeURIComponent(id)}`,
      { format: "metadata", metadataHeaders: METADATA_HEADERS },
      COST.get,
    );
  }

  async listHistory(opts: { startHistoryId: string; pageToken?: string }) {
    try {
      return await this.request<ListHistoryResponse>(
        "history",
        { startHistoryId: opts.startHistoryId, pageToken: opts.pageToken, maxResults: 500 },
        COST.history,
      );
    } catch (e) {
      // 404 = startHistoryId is outside the available history window.
      if (e instanceof GmailApiError && e.status === 404) throw new HistoryExpiredError();
      throw e;
    }
  }
}

/** Used during the OAuth callback, before an account row exists. */
export async function fetchProfileWithToken(accessToken: string): Promise<GmailProfile> {
  const res = await fetch(`${API_BASE}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GmailApiError(res.status, undefined, `Could not read Gmail profile: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as GmailProfile;
}
