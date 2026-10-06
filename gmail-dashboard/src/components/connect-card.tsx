import { Database, Eye, KeyRound, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const POINTS = [
  { icon: Eye, text: "Read-only access (gmail.readonly). Nothing in Gmail can be changed until you explicitly enable cleanup." },
  { icon: Database, text: "Only message metadata (sender, subject, date, labels, size, snippet) is stored — never full bodies." },
  { icon: Lock, text: "Everything stays on this computer in a local SQLite database. No data is sent to third parties." },
  { icon: KeyRound, text: "OAuth tokens are encrypted at rest. Your Gmail password is never seen or stored." },
];

export function ConnectCard({ reconnect = false }: { reconnect?: boolean }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-lg">{reconnect ? "Reconnect your Gmail account" : "Connect your Gmail account"}</CardTitle>
        <CardDescription>
          Sign in with Google to analyze your mailbox through the official Gmail API.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {POINTS.map(({ icon: Icon, text }) => (
          <div key={text} className="flex gap-3 text-sm">
            <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{text}</span>
          </div>
        ))}
      </CardContent>
      <CardFooter>
        {/* Plain link: OAuth needs a full-page navigation, not a client fetch. */}
        <Button asChild size="lg">
          <a href="/api/auth/google?mode=readonly">{reconnect ? "Reconnect with Google" : "Connect with Google"}</a>
        </Button>
      </CardFooter>
    </Card>
  );
}
