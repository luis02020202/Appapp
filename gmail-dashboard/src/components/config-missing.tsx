import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ConfigMissing({ issues }: { issues: string[] }) {
  return (
    <Alert variant="warning">
      <AlertTriangle />
      <AlertTitle>Google OAuth is not configured yet</AlertTitle>
      <AlertDescription>
        <p>
          Copy <code>.env.example</code> to <code>.env</code>, fill in your OAuth client and encryption key, then restart
          the dev server. See README → “Google Cloud setup”.
        </p>
        <ul className="mt-1 list-disc pl-5">
          {issues.map((i) => (
            <li key={i}>
              <code>{i}</code>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
