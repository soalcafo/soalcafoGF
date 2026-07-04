"use client";

import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { NavLinks, type NavItem } from "./nav-links";
import { SpaceSwitcher } from "./space-switcher";
import type { MembershipSummary } from "@/lib/auth/types";

export function AppShell({
  brand,
  navTitle,
  items,
  userLabel,
  signOutLabel,
  signOutAction,
  memberships = [],
  activeMembershipId = null,
  switchAction,
  switchLabel = "",
  children,
}: {
  brand: string;
  navTitle: string;
  items: NavItem[];
  userLabel: string;
  signOutLabel: string;
  signOutAction: () => Promise<void>;
  memberships?: MembershipSummary[];
  activeMembershipId?: string | null;
  switchAction?: (formData: FormData) => Promise<void>;
  switchLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {navTitle}
      </div>
      <NavLinks items={items} onNavigate={() => setOpen(false)} />
    </div>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-4">
        <div className="md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={navTitle}>
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">{navTitle}</SheetTitle>
              {sidebar}
            </SheetContent>
          </Sheet>
        </div>
        <span className="font-semibold">{brand}</span>
        <div className="ml-auto flex items-center gap-3">
          {switchAction ? (
            <SpaceSwitcher
              memberships={memberships}
              activeMembershipId={activeMembershipId}
              action={switchAction}
              label={switchLabel}
            />
          ) : null}
          <span className="hidden text-sm text-muted-foreground sm:inline">{userLabel}</span>
          <form action={signOutAction}>
            <Button variant="outline" size="sm" type="submit">
              {signOutLabel}
            </Button>
          </form>
        </div>
      </header>
      <div className="flex">
        <aside className="hidden w-64 shrink-0 border-r border-border md:block">{sidebar}</aside>
        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
