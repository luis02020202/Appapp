import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const MESSAGES: Record<string, string> = {
  access_denied: "You cancelled the Google sign-in. Nothing was changed.",
  not_configured: "OAuth is not configured. Fill in .env and restart the server.",
  state_missing: "The sign-in session expired or cookies are blocked. Please try again.",
  state_mismatch: "Security check failed (state mismatch). Please start the sign-in again.",
  missing_code: "Google did not return an authorization code. Please try again.",
  scope_denied: "Gmail read access was not granted. Tick the Gmail permission on Google's consent screen.",
  different_account: "A different Google account is already connected. Delete local data first to switch accounts.",
  no_refresh_token:
    "Google did not issue a refresh token. Remove the app at myaccount.google.com/permissions and connect again.",
  exchange_failed: "Could not complete sign-in with Google.",
};

type Params = Record<string, string | string[] | undefined>;

export function AuthNotice({ params }: { params: Params }) {
  const get = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const error = get("auth_error");
  const connected = get("connected");

  if (error) {
    const detail = get("detail");
    const expected = get("expected");
    return (
      <Alert variant="destructive" className="mb-6">
        <AlertTriangle />
        <AlertTitle>Google sign-in failed</AlertTitle>
        <AlertDescription>
          <p>{MESSAGES[error] ?? `Google returned: ${error}`}</p>
          {expected && <p>Connected account: {expected}</p>}
          {detail && <p className="font-mono text-xs">{detail}</p>}
        </AlertDescription>
      </Alert>
    );
  }
  if (connected) {
    return (
      <Alert variant="success" className="mb-6">
        <CheckCircle2 />
        <AlertTitle>{connected === "modify" ? "Cleanup permissions granted" : "Gmail connected"}</AlertTitle>
        <AlertDescription>
          {connected === "modify"
            ? "The app may now archive, label and move messages to Trash — but only after you confirm each action."
            : "Start your first synchronization below."}
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}
