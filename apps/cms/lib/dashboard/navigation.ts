import {
  dashboardGroups,
  getTableAccess,
  reviewerTableEntries,
  roleCanUseTable,
  type CmsRole,
  type ReviewerTableKey,
} from "@workspace/schema";

type ReviewerTableDefinition = (typeof reviewerTableEntries)[number][1];

type DashboardGroupKey = (typeof dashboardGroups)[number]["key"];

export type DashboardNavigationGroup = {
  key: DashboardGroupKey;
  label: string;
  tables: Array<[ReviewerTableKey, ReviewerTableDefinition]>;
};

/**
 * Hidden tables are absent from the sidebar entirely.
 *
 * A student's settings and the join rows behind likes have nothing an admin
 * would ever open them for, and an empty group is worse than no group.
 */
const dashboardNavigationGroups: DashboardNavigationGroup[] = dashboardGroups
  .map((group) => ({
    ...group,
    tables: reviewerTableEntries.filter(
      ([tableKey, definition]) =>
        definition.group === group.key && getTableAccess(tableKey) !== "hidden",
    ),
  }))
  .filter((group) => group.tables.length > 0);

/**
 * The sidebar as one role sees it.
 *
 * Filtered rather than disabled: an encoder has no use for a Subscriptions
 * link that refuses them, and a nav full of doors that do not open teaches
 * people to ignore the nav. A group with nothing left in it disappears too.
 */
export function getDashboardNavigationGroups(role?: CmsRole) {
  if (!role) {
    return dashboardNavigationGroups;
  }

  return dashboardNavigationGroups
    .map((group) => ({
      ...group,
      tables: group.tables.filter(([tableKey]) =>
        roleCanUseTable(role, tableKey, "view"),
      ),
    }))
    .filter((group) => group.tables.length > 0);
}

export function getDashboardGroupSummary(role?: CmsRole) {
  return getDashboardNavigationGroups(role).map((group) => ({
    key: group.key,
    label: group.label,
    totalTables: group.tables.length,
  }));
}
