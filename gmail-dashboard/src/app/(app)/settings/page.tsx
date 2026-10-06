import { CheckCircle2, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { AccountActions } from "@/components/account-actions";
import { AuthNotice } from "@/components/auth-notice";
import { ConfigMissing } from "@/components/config-missing";
import { ConnectCard } from "@/components/connect-card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccountSummary } from "@/lib/accounts";
import { getConfigStatus } from "@/lib/env";
import { GMAIL_READONLY, SCOPE_LABELS } from "@/lib/google/scopes";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SettingsPage({ searchParams }: Props) {
  const params = await searchParams;
  const config = getConfigStatus();
  const account = await getAccountSummary();

  return (
    <>
      <PageHeader title="Settings" description="Account, permissions and privacy." />
      <AuthNotice params={params} />

      {!config.ok && (
        <div className="mb-6">
          <ConfigMissing issues={config.issues} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Google account</CardTitle>
            <CardDescription>Connected through Google OAuth 2.0. Your password is never seen by this app.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {account ? (
              <>
                <Row label="Account">{account.email}</Row>
                <Row label="Status">
                  {account.connected ? (
                    <Badge variant="success"><CheckCircle2 /> Connected</Badge>
                  ) : account.needsReauth ? (
                    <Badge variant="destructive"><XCircle /> Reconnect required</Badge>
                  ) : (
                    <Badge variant="secondary">Disconnected (local data kept)</Badge>
                  )}
                </Row>
                <Row label="Granted scopes">
                  <div className="flex flex-col items-end gap-1">
                    {account.scopes.length === 0 && <span className="text-muted-foreground">None</span>}
                    {account.scopes.map((s) => (
                      <Badge key={s} variant="outline">{SCOPE_LABELS[s] ?? s}</Badge>
                    ))}
                  </div>
                </Row>
                <Row label="Initial sync">{formatDateTime(account.initialSyncCompletedAt)}</Row>
                <Row label="Last sync">{formatDateTime(account.lastSyncAt)}</Row>
                {!account.connected && config.ok && (
                  <Button asChild>
                    <a href="/api/auth/google?mode=readonly">Reconnect with Google</a>
                  </Button>
                )}
              </>
            ) : config.ok ? (
              <ConnectCard />
            ) : (
              <p className="text-muted-foreground">Configure OAuth first.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Cleanup permissions
              {account?.canModify ? (
                <Badge variant="success"><ShieldCheck /> Enabled</Badge>
              ) : (
                <Badge variant="secondary"><ShieldAlert /> Read-only</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Archiving, marking as read and moving to Trash require the <code>gmail.modify</code> scope. It is only
              requested when you enable it here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Every action requires an explicit selection and a confirmation dialog.</li>
              <li>“Delete” always means <strong>move to Trash</strong> (recoverable for 30 days in Gmail).</li>
              <li>
                Permanent deletion is impossible: the app never requests the full <code>mail.google.com</code> scope.
              </li>
            </ul>
            {account?.connected && !account.canModify && (
              <Button asChild variant="outline">
                <a href="/api/auth/google?mode=modify">Enable cleanup (grant gmail.modify)</a>
              </Button>
            )}
            {account?.canModify && (
              <p className="text-muted-foreground">
                To return to read-only access, disconnect and reconnect — Google then issues a token with only{" "}
                <code>{GMAIL_READONLY.split("/").pop()}</code>.
              </p>
            )}
            {!account?.connected && <p className="text-muted-foreground">Connect your account first.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Privacy</CardTitle>
            <CardDescription>What this app stores and sends.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Stored locally: sender, subject, date, labels, size, snippet, list/unsubscribe headers.</p>
            <p>Not stored: full message bodies or attachments.</p>
            <p>OAuth tokens are encrypted with AES-256-GCM using your local TOKEN_ENCRYPTION_KEY.</p>
            <p>External AI classification is off and will stay off unless you explicitly enable it (Phase 4).</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
            <CardDescription>These actions affect only this app and its local database — never your Gmail.</CardDescription>
          </CardHeader>
          <CardContent>
            <AccountActions hasTokens={Boolean(account?.connected || account?.needsReauth)} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}
