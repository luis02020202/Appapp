import { Mail, MailOpen, Paperclip, Users } from "lucide-react";
import { AuthNotice } from "@/components/auth-notice";
import { ConfigMissing } from "@/components/config-missing";
import { ConnectCard } from "@/components/connect-card";
import { PageHeader } from "@/components/page-header";
import { SyncPanel } from "@/components/sync-panel";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { getSyncStatus } from "@/lib/sync/status";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DashboardPage({ searchParams }: Props) {
  const params = await searchParams;
  const status = await getSyncStatus();
  const account = status.account;

  return (
    <>
      <PageHeader title="Dashboard" description="Mailbox overview and synchronization status." />
      <AuthNotice params={params} />

      {!status.configured ? (
        <ConfigMissing issues={status.configIssues} />
      ) : !account || (!account.connected && !account.needsReauth) ? (
        <ConnectCard reconnect={Boolean(account)} />
      ) : (
        <div className="space-y-6">
          <Snapshot accountId={account.id} />
          <SyncPanel initial={status} />
        </div>
      )}
    </>
  );
}

/** Phase 1 snapshot straight from the local database. Full KPIs/charts arrive in Phase 3. */
async function Snapshot({ accountId }: { accountId: string }) {
  const where = { accountId, removedAt: null, metadataFetchedAt: { not: null } };
  const [total, unread, attachments, senders] = await Promise.all([
    prisma.message.count({ where }),
    prisma.message.count({ where: { ...where, isUnread: true } }),
    prisma.message.count({ where: { ...where, hasAttachments: true } }),
    prisma.$queryRaw<{ n: bigint | number }[]>`
      SELECT COUNT(DISTINCT "senderEmail") AS n FROM "Message"
      WHERE "accountId" = ${accountId} AND "removedAt" IS NULL AND "metadataFetchedAt" IS NOT NULL`,
  ]);

  const kpis = [
    { label: "Emails analyzed", value: total, icon: Mail },
    { label: "Unread", value: unread, icon: MailOpen },
    { label: "With attachments", value: attachments, icon: Paperclip },
    { label: "Unique senders", value: Number(senders[0]?.n ?? 0), icon: Users },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {kpis.map(({ label, value, icon: Icon }) => (
        <Card key={label} className="gap-0 py-5">
          <CardContent className="flex items-start justify-between">
            <div>
              <div className="text-sm text-muted-foreground">{label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(value)}</div>
            </div>
            <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Icon className="size-4" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
