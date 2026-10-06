/** Google no longer accepts our credentials; the user must reconnect. */
export class AuthRequiredError extends Error {
  constructor(message = "Google authorization expired or was revoked. Please reconnect your account.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

/** Non-retryable (or retries exhausted) Gmail API error. */
export class GmailApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly reason: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

export class GmailNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailNetworkError";
  }
}

/** startHistoryId is too old for users.history.list (HTTP 404); a full sync is required. */
export class HistoryExpiredError extends Error {
  constructor() {
    super("Gmail history checkpoint expired; falling back to full synchronization.");
    this.name = "HistoryExpiredError";
  }
}

export class SyncCancelledError extends Error {
  constructor() {
    super("Synchronization cancelled by user.");
    this.name = "SyncCancelledError";
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
