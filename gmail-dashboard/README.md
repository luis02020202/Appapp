# Gmail Intelligence & Cleanup Dashboard

A local, privacy-first web app that analyzes your Gmail mailbox through the
**official Gmail API** and **Google OAuth 2.0**, and (later) helps you clean it
up safely.

- Runs only on `localhost`; data lives in a local SQLite database.
- Starts with **read-only** access (`gmail.readonly`). Modification access
  (`gmail.modify`) is requested only when you explicitly enable cleanup.
- Never stores full email bodies or your Gmail password. OAuth tokens are
  encrypted at rest (AES-256-GCM).
- Never permanently deletes mail: the app never requests the
  `https://mail.google.com/` scope, so permanent deletion is impossible by
  construction. "Delete" will always mean *move to Trash*.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | OAuth + Gmail connection + mailbox synchronization | ✅ Implemented |
| 2 | Sender / domain analysis | ⏳ Next (data model already in place) |
| 3 | Dashboard KPIs + interactive charts (Recharts) | Planned |
| 4 | Hybrid classification engine (rules first, opt-in LLM) | Planned |
| 5 | Newsletter + unsubscribe detection | Planned (headers already parsed) |
| 6 | Cleanup Center + confirmed bulk actions | Planned |
| 7 | Performance + security hardening | Planned |

## Tech stack

Next.js 15 (App Router) · TypeScript · React 19 · Tailwind CSS v4 · shadcn/ui
components · Lucide icons · Prisma 6 + SQLite · `google-auth-library` (OAuth) ·
Gmail REST API v1. Recharts is added in Phase 3.

## Google Cloud setup (one time)

1. Open <https://console.cloud.google.com/> and create a project (e.g. "Gmail Dashboard").
2. **APIs & Services → Library →** enable **Gmail API**.
3. **Google Auth Platform → Branding:** set an app name and your email.
4. **Audience:** user type **External**, publishing status **Testing**, and
   add your own Gmail address under **Test users**.
5. **Data Access → Add or remove scopes:** add
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.modify` (only used once you enable cleanup)
6. **Clients → Create client →** type **Web application**. Under
   **Authorized redirect URIs** add exactly:
   `http://localhost:3000/api/auth/google/callback`
7. Copy the **Client ID** and **Client secret**.

> **Testing mode caveats.** Gmail scopes are "restricted", so Google shows an
> "unverified app" warning; that's expected for your own personal app (click
> *Advanced → Go to …*). In Testing mode, **refresh tokens expire after 7
> days**; the app detects this and asks you to reconnect, and your local data
> is kept. You can avoid it by publishing the app ("In production") for
> personal use, which keeps the unverified warning.

## Run locally

Requires Node.js ≥ 20.9.

```bash
cd gmail-dashboard
cp .env.example .env
npm install
npm run gen:key            # paste the output into TOKEN_ENCRYPTION_KEY in .env
# fill GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env
npx prisma migrate dev --name init   # creates prisma/gmail-dashboard.db
npm run dev
```

Open **<http://localhost:3000>** (use `localhost`, not `127.0.0.1`, so it
matches the registered redirect URI).

Other scripts: `npm run build && npm start` (production mode),
`npm run typecheck`, `npm test` (unit tests for the header parser, needs
Node ≥ 22.18), `npm run db:studio` (browse the local database).

## How to test Phase 1

1. **Config check:** start without `.env`. The dashboard shows a list of the
   missing settings.
2. **Connect:** click *Connect with Google*. Google's consent screen should
   list **only** "View your email messages and settings". After you approve,
   you land on the dashboard with a success banner. *Settings* shows the
   granted scope `gmail.readonly`.
3. **Initial sync:** click *Sync now*. Watch the phases go by (*Reading labels → Discovering
   messages → Detecting attachments → Downloading message metadata*), the
   discovered and processed counters, and the progress bar. When it finishes,
   the KPI cards show totals, unread, attachments and unique senders.
4. **Resumability:** start a sync on a large mailbox and stop the dev server
   (Ctrl+C) partway through. Restart and press *Sync now*. The old run is shown as
   *Interrupted*, and the new run continues with the remaining messages
   instead of starting over.
5. **Cancel:** press *Cancel* during a sync. The status becomes *Cancelled* and
   everything fetched so far stays.
6. **Incremental sync:** send yourself an email, mark another as read, then
   *Sync now*. The run mode is `incremental`, *Discovered* counts only new
   messages, and the read state is updated.
7. **Full resync:** reconciles deletions. Messages that are gone from Gmail are
   flagged (`removedAt`), never deleted locally.
8. **Token expiry:** revoke access at <https://myaccount.google.com/permissions>
   and then *Sync now*. A "Google authorization expired" banner with
   *Reconnect* appears, and the local data is untouched.
9. **Incremental consent:** *Settings → Enable cleanup* asks Google for
   `gmail.modify` only. Phase 1 has no action that uses it yet.
10. **Disconnect / Delete local data:** both require confirmation. Neither
    touches Gmail.
11. **Inspect data:** `npm run db:studio` shows the `Message` rows contain metadata only.

## Architecture

```
gmail-dashboard/
├── prisma/schema.prisma        # Account, Label, Message, MessageLabel, SyncRun, SyncError
├── scripts/generate-key.mjs    # TOKEN_ENCRYPTION_KEY generator
├── tests/parse.test.ts         # node:test unit tests for header parsing
└── src/
    ├── middleware.ts           # localhost Host allowlist + same-origin check for POST APIs
    ├── app/
    │   ├── (app)/…             # sidebar layout + pages (dashboard, settings, phase placeholders)
    │   └── api/
    │       ├── auth/google/            # GET: start OAuth (?mode=readonly|modify), PKCE + state
    │       ├── auth/google/callback/   # GET: verify state, exchange code, store encrypted tokens
    │       ├── auth/disconnect/        # POST: revoke at Google, delete tokens, keep data
    │       ├── data/delete/            # POST {"confirm":"DELETE"}: wipe local DB
    │       └── sync/ (+ /status, /cancel)  # POST start, GET progress, POST cancel
    ├── components/             # shadcn/ui primitives + app components
    └── lib/
        ├── env.ts              # zod-validated configuration
        ├── crypto.ts           # AES-256-GCM token encryption
        ├── accounts.ts         # account + token refresh (deduplicated, invalid_grant → reauth)
        ├── google/             # OAuth client, scopes
        ├── gmail/              # REST client (rate limit, backoff), types, parsing
        └── sync/               # sync engine + status aggregation
```

### Synchronization design

- **Full sync:** first `users.getProfile` to capture the `historyId` checkpoint.
  Then `users.messages.list` pages through every message in batches of 500 and
  stores lightweight "stub" rows. Then `users.messages.get?format=metadata` runs
  for each stub, requesting only a fixed set of headers. Attachment presence
  comes from a `has:attachment` list query, because metadata format exposes no
  MIME parts.
- **Incremental sync:** `users.history.list` from the stored `historyId` adds
  new messages, flags deleted ones and applies label changes (read/unread,
  archive, trash) as deltas. If Gmail answers 404 because the history window
  expired, it falls back to a full sync automatically.
- **Resumable:** metadata is fetched for any row without `metadataFetchedAt` on
  every run, so interrupted syncs continue where they stopped. The history
  checkpoint only advances after its changes are persisted.
- **Never loses data:** messages missing from Gmail get `removedAt` and
  `removedReason` (`deleted`, `trash`, `spam` or `missing`) instead of being
  deleted.
- **Quota-aware:** a token bucket keeps usage under Gmail's 250 units/s per-user
  limit (`get` = 5 units). 429s, 5xx and `rateLimitExceeded` are retried with
  exponential backoff plus jitter, honoring `Retry-After`. A 401 forces one token
  refresh. `invalid_grant` marks the account *needs reauth*.
- **Partial failures:** one malformed or unreachable message is recorded in
  `SyncError` and retried up to 3 times. If a whole batch fails because the
  network is down, the run stops cleanly instead of burning retries.

### Swapping SQLite for PostgreSQL

Change `provider = "postgresql"` in `prisma/schema.prisma`, set
`DATABASE_URL`, and create a fresh migration. The schema avoids
SQLite-specific features: labels are a join table, and enum-like values are
strings.
