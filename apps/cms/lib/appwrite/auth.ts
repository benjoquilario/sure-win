import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Models, Query } from "node-appwrite";

import {
  appwriteEnv,
  hasAppwritePublicEnv,
  hasAppwriteServerEnv,
} from "@/lib/appwrite/env";
import {
  DEFAULT_ROLE,
  getRolePermissions,
  getRoleRank,
  isStaffRole,
  reviewerCmsSchema,
  roleCanUseTable,
  roleHasPermission,
  toCmsRole,
  type CmsPermission,
  type CmsRole,
  type CmsTableAction,
  type ReviewerTableKey,
} from "@workspace/schema";
import { getAdminServices, getSessionServices } from "@/lib/appwrite/server";

export type { CmsPermission, CmsRole };

export type CmsUser = {
  account: Models.User<Models.Preferences>;
  role: CmsRole;
  /**
   * Resolved once per request and carried around, rather than re-derived at
   * every check. It is also what a client component gets: a list of strings is
   * safe to serialise, and it means a button can ask the same question the
   * server action will ask.
   */
  permissions: readonly CmsPermission[];
  /**
   * `env` means the role came from an email list in the environment - the way
   * back in when nobody has dashboard access yet. Those roles cannot be
   * revoked from the UI, so it is worth showing.
   */
  source: "table" | "env";
};

/**
 * The floor an email list grants, before the roles table is consulted.
 *
 * `APPWRITE_CMS_ADMIN_EMAILS` stands in for the super admin list when that one
 * is empty, because the alternative is an install where nobody can ever
 * appoint an owner: only a super admin may create a super admin.
 */
function resolveEmailRole(email: string | undefined): CmsRole | null {
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail) {
    return null;
  }

  if (appwriteEnv.superAdminEmails.includes(normalizedEmail)) {
    return "super_admin";
  }

  if (appwriteEnv.adminEmails.includes(normalizedEmail)) {
    return appwriteEnv.superAdminEmails.length ? "admin" : "super_admin";
  }

  if (appwriteEnv.moderatorEmails.includes(normalizedEmail)) {
    return "moderator";
  }

  if (appwriteEnv.encoderEmails.includes(normalizedEmail)) {
    return "encoder";
  }

  return null;
}

/** Whether this person belongs in the dashboard at all. */
export function canAccessCms(role: CmsRole) {
  return isStaffRole(role);
}

/** The question every guard asks. */
export function can(
  cmsUser: Pick<CmsUser, "permissions"> | null,
  permission: CmsPermission,
) {
  return Boolean(cmsUser?.permissions.includes(permission));
}

export function canUseTable(
  cmsUser: Pick<CmsUser, "role"> | null,
  tableKey: ReviewerTableKey,
  action: CmsTableAction,
) {
  return Boolean(cmsUser && roleCanUseTable(cmsUser.role, tableKey, action));
}

export async function getSessionSecret() {
  const cookieStore = await cookies();
  return cookieStore.get(appwriteEnv.sessionCookieName)?.value ?? null;
}

export async function setSessionCookie(secret: string) {
  const cookieStore = await cookies();

  cookieStore.set(appwriteEnv.sessionCookieName, secret, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(appwriteEnv.sessionCookieName);
}

export async function getCurrentAccount() {
  if (!hasAppwritePublicEnv()) {
    return null;
  }

  const sessionSecret = await getSessionSecret();

  if (!sessionSecret) {
    return null;
  }

  try {
    const { account } = getSessionServices(sessionSecret);
    return await account.get();
  } catch {
    return null;
  }
}

export async function getCurrentCmsUser(): Promise<CmsUser | null> {
  const account = await getCurrentAccount();

  if (!account) {
    return null;
  }

  return resolveCmsUserFromAccount(account);
}

/** The role stored for one account, or the default when there is no row. */
export async function readStoredRole(userId: string): Promise<CmsRole> {
  if (!hasAppwriteServerEnv()) {
    return DEFAULT_ROLE;
  }

  try {
    const { tables } = getAdminServices();
    const result = await tables.listRows({
      databaseId: appwriteEnv.databaseId,
      tableId: reviewerCmsSchema.user_roles.tableId,
      queries: [Query.equal("userId", userId), Query.limit(1)],
    });

    return toCmsRole(result.rows[0]?.role);
  } catch {
    return DEFAULT_ROLE;
  }
}

/**
 * Works out what someone may do, from the two places a role can come from.
 *
 * The higher of the two wins. The environment therefore sets a floor that the
 * table can raise but never lower, which is the property that matters: without
 * it, anyone who reached `staff.manage` could demote the owner by editing a
 * row and lock everybody out of their own install.
 */
export async function resolveCmsUserFromAccount(
  account: Models.User<Models.Preferences>,
): Promise<CmsUser | null> {
  const roleFromEnv = resolveEmailRole(account.email);
  const roleFromTable = await readStoredRole(account.$id);

  const usesEnv =
    roleFromEnv !== null &&
    getRoleRank(roleFromEnv) >= getRoleRank(roleFromTable);
  const role = usesEnv ? (roleFromEnv as CmsRole) : roleFromTable;

  if (!isStaffRole(role)) {
    return null;
  }

  return {
    account,
    role,
    permissions: getRolePermissions(role),
    source: usesEnv ? "env" : "table",
  };
}

export async function requireCmsUser() {
  const cmsUser = await getCurrentCmsUser();

  if (!cmsUser || !canAccessCms(cmsUser.role)) {
    redirect("/login?error=unauthorized");
  }

  return cmsUser;
}

/**
 * The guard for a page or a server action.
 *
 * A missing permission sends someone back where they came from with a
 * sentence, rather than a blank 403: they are staff, they simply do not do
 * this part of the job, and the dashboard should say so.
 */
export async function requirePermission(
  permission: CmsPermission,
  fallbackPath = "/dashboard",
) {
  const cmsUser = await requireCmsUser();

  if (!roleHasPermission(cmsUser.role, permission)) {
    redirect(
      `${fallbackPath}?error=${encodeURIComponent(
        "Your role does not allow that.",
      )}`,
    );
  }

  return cmsUser;
}

export async function requireTablePermission(
  tableKey: ReviewerTableKey,
  action: CmsTableAction,
  fallbackPath = "/dashboard",
) {
  const cmsUser = await requireCmsUser();

  if (!roleCanUseTable(cmsUser.role, tableKey, action)) {
    redirect(
      `${fallbackPath}?error=${encodeURIComponent(
        "Your role does not allow that.",
      )}`,
    );
  }

  return cmsUser;
}

/**
 * The same check for an API route, which answers with a status code instead of
 * a redirect. Returns the user, or the response to send back.
 */
export async function authorizeRequest(permission: CmsPermission) {
  const cmsUser = await getCurrentCmsUser();

  if (!cmsUser || !canAccessCms(cmsUser.role)) {
    return { cmsUser: null, error: { message: "Unauthorized.", status: 401 } };
  }

  if (!roleHasPermission(cmsUser.role, permission)) {
    return {
      cmsUser: null,
      error: { message: "Your role does not allow that.", status: 403 },
    };
  }

  return { cmsUser, error: null };
}
