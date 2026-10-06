import { AppSidebar } from "@/components/app-sidebar";
import { getAccountSummary } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const account = await getAccountSummary();
  return (
    <div className="flex min-h-screen">
      <AppSidebar accountEmail={account?.email ?? null} canModify={account?.canModify ?? false} />
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-7xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
