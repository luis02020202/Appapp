"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox,
  LayoutDashboard,
  Mail,
  Newspaper,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/analysis", label: "Inbox Analysis", icon: Inbox },
  { href: "/senders", label: "Senders", icon: Users },
  { href: "/categories", label: "Categories", icon: Tags },
  { href: "/newsletters", label: "Newsletters", icon: Newspaper },
  { href: "/cleanup", label: "Cleanup Center", icon: Sparkles },
  { href: "/search", label: "Search", icon: Search },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar({ accountEmail, canModify }: { accountEmail: string | null; canModify: boolean }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 border-b border-sidebar-border px-5 py-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Mail className="size-4" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-sidebar-accent-foreground">Gmail Intelligence</div>
          <div className="text-xs text-sidebar-foreground/70">Analysis &amp; Cleanup</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border px-5 py-4 text-xs">
        {accountEmail ? (
          <>
            <div className="truncate font-medium text-sidebar-accent-foreground" title={accountEmail}>
              {accountEmail}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-sidebar-foreground/70">
              <ShieldCheck className="size-3.5" />
              {canModify ? "Read + modify access" : "Read-only access"}
            </div>
          </>
        ) : (
          <div className="text-sidebar-foreground/70">Not connected</div>
        )}
      </div>
    </aside>
  );
}
