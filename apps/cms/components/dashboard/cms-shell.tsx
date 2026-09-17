import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { CmsSidebarNav } from "@/components/dashboard/cms-sidebar-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { logout } from "@/lib/actions/auth";
import { getDashboardNavigationGroups } from "@/lib/dashboard/navigation";
import { cn } from "@/lib/utils";
import { getRoleLabel } from "@workspace/schema";
import type { CmsUser } from "@/lib/appwrite/auth";

/**
 * The width every dashboard page sits in.
 *
 * Defined once and applied by the shell, so no page can drift: a table that
 * chose its own container would line up with nothing above or below it. The
 * cap is wide enough that a five-column table is not squeezed into the middle
 * third of a large monitor, and still stops short of edge-to-edge, which makes
 * long rows tiring to scan.
 */
const DASHBOARD_CONTAINER =
  "mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8";

type CmsShellProps = {
  cmsUser: CmsUser;
  children: React.ReactNode;
};

export function CmsShell({ cmsUser, children }: CmsShellProps) {
  // The sidebar is built for this person, not for the schema: a link they
  // cannot follow is worse than a missing one.
  const sidebarGroups = getDashboardNavigationGroups(cmsUser.role).map((group) => ({
    key: group.key,
    label: group.label,
    tables: group.tables.map(([tableKey, definition]) => ({
      tableKey,
      name: definition.name,
    })),
  }));

  // Owner-only, and decided here rather than in the sidebar: the permission
  // list is already resolved on this request, and a link nobody else can see
  // is one nobody else has to be told they may not use.
  const extraShortcuts = cmsUser.permissions.includes("billing.grant")
    ? [{ href: "/dashboard/premium", label: "Grant premium" }]
    : [];

  return (
    <SidebarProvider>
      <Sidebar variant="inset">
        <SidebarHeader className="border-b border-sidebar-border/70">
          <div className="flex flex-col gap-2 px-2 py-1">
            <Badge
              variant="secondary"
              className="w-fit uppercase tracking-[0.3em] text-[10px]"
            >
              Reviewer CMS
            </Badge>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-sidebar-foreground">
                Social Work Reviewer
              </p>
              {/* <p className="text-xs leading-5 text-sidebar-foreground/70">
                Appwrite-backed content management for subjects, review
                materials, questionnaires, and moderation.
              </p> */}
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <CmsSidebarNav groups={sidebarGroups} extraShortcuts={extraShortcuts} />
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border/70">
          <div className="flex flex-col gap-3 rounded-lg border border-sidebar-border/70 bg-sidebar-accent/30 p-3">
            <div className="flex flex-col gap-1">
              <p className="truncate text-sm font-semibold text-sidebar-foreground">
                {cmsUser.account.name || cmsUser.account.email}
              </p>
              {cmsUser.account.name ? (
                <p className="truncate text-xs text-sidebar-foreground/70">
                  {cmsUser.account.email}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="uppercase tracking-[0.18em]">
                {getRoleLabel(cmsUser.role)}
              </Badge>
              {cmsUser.source === "env" ? (
                <Badge
                  variant="outline"
                  className="uppercase tracking-[0.14em] text-[10px]"
                  title="Granted by an email list in the environment, so it cannot be revoked from this dashboard."
                >
                  From env
                </Badge>
              ) : null}
            </div>
            <form action={logout}>
              <Button type="submit" variant="outline" className="w-full">
                Sign out
              </Button>
            </form>
          </div>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-h-svh">
        {/* The header shares the content's width so the title lines up with the
            page below it rather than floating off to the left. */}
        <header className="flex h-14 shrink-0 items-center border-b border-border/70">
          <div className={cn(DASHBOARD_CONTAINER, "flex items-center gap-3 py-0")}>
            <SidebarTrigger className="-ml-1" />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <p className="truncate text-sm font-semibold">
                Social Work Reviewer CMS
              </p>
            </div>
            <ThemeToggle />
          </div>
        </header>

        <div className={cn(DASHBOARD_CONTAINER, "flex flex-1 flex-col py-6")}>
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
