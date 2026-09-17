"use client";

import { Loader2 } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type SidebarNavigationGroup = {
  key: string;
  label: string;
  tables: Array<{
    tableKey: string;
    name: string;
  }>;
};

type CmsSidebarNavProps = {
  groups: SidebarNavigationGroup[];
  /**
   * Extra links this role may use, decided on the server.
   *
   * Passed in rather than worked out here: this is a client component, and a
   * permission check that runs in the browser is a suggestion.
   */
  extraShortcuts?: { href: string; label: string }[];
};

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarLinkPendingHint({ isActive }: { isActive: boolean }) {
  const { pending } = useLinkStatus();
  const showPending = pending && !isActive;

  return (
    <span
      aria-hidden
      className="ml-auto inline-flex size-4 items-center justify-center"
    >
      <Loader2
        className={cn(
          "size-3.5 transition-opacity duration-150",
          showPending ? "animate-spin opacity-100 text-primary" : "opacity-0",
        )}
      />
    </span>
  );
}

export function CmsSidebarNav({ groups, extraShortcuts = [] }: CmsSidebarNavProps) {
  const pathname = usePathname();
  // Uploading questions is the daily job, so it sits at the top next to
  // Overview rather than behind a table nobody thinks to open.
  const shortcuts = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/upload", label: "Upload questions" },
    ...extraShortcuts,
  ];

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {shortcuts.map((shortcut) => {
              const isActive =
                shortcut.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : isActivePath(pathname, shortcut.href);

              return (
                <SidebarMenuItem key={shortcut.href}>
                  <SidebarMenuButton
                    render={<Link href={shortcut.href} />}
                    isActive={isActive}
                  >
                    {shortcut.label}
                    <SidebarLinkPendingHint isActive={isActive} />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {groups.map((group) => (
        <SidebarGroup key={group.key}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.tables.map((table) => {
                const href = `/dashboard/${table.tableKey}`;
                const isActive = isActivePath(pathname, href);

                return (
                  <SidebarMenuItem key={table.tableKey}>
                    <SidebarMenuButton
                      render={<Link href={href} />}
                      isActive={isActive}
                    >
                      {table.name}
                      <SidebarLinkPendingHint isActive={isActive} />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
