import { ID, Query } from "node-appwrite";

import { appwriteEnv, hasAppwriteServerEnv } from "@/lib/appwrite/env";
import {
  DEFAULT_ROLE,
  canGrantRole,
  canManageStaffMember,
  getRoleLabel,
  getRoleRank,
  isStaffRole,
  reviewerCmsSchema,
  toCmsRole,
  type CmsRole,
} from "@workspace/schema";
import { getAdminServices } from "@/lib/appwrite/server";
import type { CmsUser } from "@/lib/appwrite/auth";

const ROLES_TABLE = reviewerCmsSchema.user_roles.tableId;
const ACTIVITY_TABLE = reviewerCmsSchema.staff_activity.tableId;

export type StaffMember = {
  rowId: string;
  userId: string;
  role: CmsRole;
  email: string;
  name: string;
  grantedBy: string;
  grantedAt: string;
  note: string;
};

/**
 * Thrown when a rule about who may do what to whom is broken.
 *
 * A distinct type so actions can turn it into a sentence for the person who
 * hit it, instead of a stack trace or a generic failure - every one of these
 * is a policy decision worth explaining.
 */
export class StaffPolicyError extends Error {}

function toStaffMember(row: Record<string, unknown>): StaffMember {
  return {
    rowId: String(row.$id ?? ""),
    userId: String(row.userId ?? ""),
    role: toCmsRole(row.role),
    email: String(row.email ?? ""),
    name: String(row.name ?? ""),
    grantedBy: String(row.grantedBy ?? ""),
    grantedAt: String(row.grantedAt ?? ""),
    note: String(row.note ?? ""),
  };
}

/**
 * Everyone with a role row, highest rank first.
 *
 * Students with a leftover row are kept in the list rather than filtered out:
 * "this person used to have access" is exactly what someone auditing the team
 * wants to see, and hiding it would make a revocation look like a deletion.
 */
export async function listStaffMembers(): Promise<StaffMember[]> {
  if (!hasAppwriteServerEnv()) {
    return [];
  }

  const { tables } = getAdminServices();
  const members: StaffMember[] = [];
  let cursor: string | null = null;

  for (;;) {
    const queries = [Query.limit(100)];

    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }

    const page = await tables.listRows({
      databaseId: appwriteEnv.databaseId,
      tableId: ROLES_TABLE,
      queries,
    });

    for (const row of page.rows) {
      members.push(toStaffMember(row as unknown as Record<string, unknown>));
    }

    if (page.rows.length < 100) {
      break;
    }

    cursor = String(page.rows[page.rows.length - 1].$id);
  }

  return members.sort(
    (left, right) =>
      getRoleRank(right.role) - getRoleRank(left.role) ||
      left.email.localeCompare(right.email),
  );
}

export async function findStaffRow(userId: string) {
  if (!hasAppwriteServerEnv() || !userId) {
    return null;
  }

  const { tables } = getAdminServices();
  const result = await tables.listRows({
    databaseId: appwriteEnv.databaseId,
    tableId: ROLES_TABLE,
    queries: [Query.equal("userId", userId), Query.limit(1)],
  });

  const row = result.rows[0];
  return row ? toStaffMember(row as unknown as Record<string, unknown>) : null;
}

/** How many super admins exist, so the last one cannot be demoted away. */
export async function countSuperAdmins() {
  if (!hasAppwriteServerEnv()) {
    return 0;
  }

  const { tables } = getAdminServices();
  const result = await tables.listRows({
    databaseId: appwriteEnv.databaseId,
    tableId: ROLES_TABLE,
    queries: [Query.equal("role", "super_admin"), Query.limit(1)],
  });

  return result.total;
}

/**
 * Writes one line into the log, and never fails the action that caused it.
 *
 * A dropped audit line is bad; a role change that half-happened because the
 * log was unreachable is worse. The log records what was done, so it is
 * written after the deed, and its failure is reported rather than raised.
 */
export async function recordStaffActivity(input: {
  actor: Pick<CmsUser, "account" | "role"> | null;
  action: string;
  summary: string;
  targetTable?: string;
  targetId?: string;
}) {
  if (!hasAppwriteServerEnv() || !input.actor) {
    return;
  }

  try {
    const { tables } = getAdminServices();

    await tables.createRow({
      databaseId: appwriteEnv.databaseId,
      tableId: ACTIVITY_TABLE,
      rowId: ID.unique(),
      data: {
        actorId: input.actor.account.$id,
        actorEmail: input.actor.account.email ?? "",
        actorRole: input.actor.role,
        action: input.action,
        summary: input.summary.slice(0, 500),
        targetTable: input.targetTable ?? "",
        targetId: input.targetId ?? "",
        occurredAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("staff activity not recorded", error);
  }
}

export async function listStaffActivity(limit = 50) {
  if (!hasAppwriteServerEnv()) {
    return [];
  }

  try {
    const { tables } = getAdminServices();
    const result = await tables.listRows({
      databaseId: appwriteEnv.databaseId,
      tableId: ACTIVITY_TABLE,
      queries: [Query.orderDesc("occurredAt"), Query.limit(limit)],
    });

    return result.rows as unknown as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

/**
 * Every rule about changing somebody's role, in one place.
 *
 * Kept together deliberately: these only work as a set, and a check that lives
 * next to the form it guards is a check the next form forgets.
 */
export async function assertRoleChangeAllowed(input: {
  actor: CmsUser;
  targetUserId: string;
  nextRole: CmsRole;
  currentRole: CmsRole;
}) {
  const { actor, targetUserId, nextRole, currentRole } = input;

  if (!canManageStaffMember(actor.role, currentRole)) {
    throw new StaffPolicyError(
      currentRole === actor.role
        ? `A ${getRoleLabel(actor.role)} cannot change another ${getRoleLabel(currentRole)}. Ask a Super Admin.`
        : `Your role cannot change a ${getRoleLabel(currentRole)}.`,
    );
  }

  if (!canGrantRole(actor.role, nextRole)) {
    throw new StaffPolicyError(
      `You can only grant a role below your own, so ${getRoleLabel(nextRole)} is out of reach.`,
    );
  }

  // Nobody edits their own row. Promotion would be the obvious abuse, but
  // accidental self-demotion is the likelier one, and it locks the owner out.
  if (targetUserId === actor.account.$id) {
    throw new StaffPolicyError(
      "You cannot change your own role. Ask another Super Admin.",
    );
  }

  // The install must keep a way back in.
  if (currentRole === "super_admin" && nextRole !== "super_admin") {
    const remaining = await countSuperAdmins();

    if (remaining <= 1) {
      throw new StaffPolicyError(
        "This is the only Super Admin. Appoint another one before changing this.",
      );
    }
  }
}

export async function assertStaffRowRemovable(input: {
  actor: CmsUser;
  member: StaffMember;
}) {
  const { actor, member } = input;

  if (!canManageStaffMember(actor.role, member.role)) {
    throw new StaffPolicyError(
      `Your role cannot remove a ${getRoleLabel(member.role)}.`,
    );
  }

  if (member.userId === actor.account.$id) {
    throw new StaffPolicyError("You cannot remove your own access.");
  }

  if (member.role === "super_admin" && (await countSuperAdmins()) <= 1) {
    throw new StaffPolicyError(
      "This is the only Super Admin. Appoint another one first.",
    );
  }
}

/**
 * Finds the account a role is about to be granted to.
 *
 * By email, because that is what somebody adding a colleague actually has -
 * and because requiring the Appwrite user ID means going and finding it in a
 * console, which is how people end up pasting the wrong one.
 */
export async function findAccountByEmail(email: string) {
  const normalized = email.trim().toLowerCase();

  if (!normalized || !hasAppwriteServerEnv()) {
    return null;
  }

  const { users } = getAdminServices();
  const result = await users.list({
    queries: [Query.equal("email", normalized), Query.limit(1)],
  });

  return result.users[0] ?? null;
}

/**
 * Grants, changes, or revokes dashboard access, after checking every rule.
 *
 * Revoking is setting somebody back to Student rather than deleting the row,
 * so the history of who had access and who took it away survives.
 */
export async function setStaffRole(input: {
  actor: CmsUser;
  email: string;
  role: CmsRole;
  note?: string;
}) {
  if (!hasAppwriteServerEnv()) {
    throw new StaffPolicyError("Appwrite server credentials are not configured.");
  }

  const account = await findAccountByEmail(input.email);

  if (!account) {
    throw new StaffPolicyError(
      `No account is registered to ${input.email.trim()}. They have to sign in to the app once before they can be given access.`,
    );
  }

  const existing = await findStaffRow(account.$id);
  const currentRole = existing?.role ?? DEFAULT_ROLE;

  await assertRoleChangeAllowed({
    actor: input.actor,
    targetUserId: account.$id,
    nextRole: input.role,
    currentRole,
  });

  const { tables } = getAdminServices();
  const data = {
    userId: account.$id,
    role: input.role,
    email: account.email ?? input.email.trim().toLowerCase(),
    name: account.name ?? "",
    grantedBy: input.actor.account.email ?? input.actor.account.$id,
    grantedAt: new Date().toISOString(),
    note: (input.note ?? existing?.note ?? "").slice(0, 500),
  };

  if (existing) {
    await tables.updateRow({
      databaseId: appwriteEnv.databaseId,
      tableId: ROLES_TABLE,
      rowId: existing.rowId,
      data,
    });
  } else {
    await tables.createRow({
      databaseId: appwriteEnv.databaseId,
      tableId: ROLES_TABLE,
      rowId: ID.unique(),
      data,
    });
  }

  const who = account.email || account.name || account.$id;
  const action = !isStaffRole(input.role)
    ? "role_revoked"
    : existing && isStaffRole(currentRole)
      ? "role_changed"
      : "role_granted";

  await recordStaffActivity({
    actor: input.actor,
    action,
    summary:
      action === "role_revoked"
        ? `Revoked dashboard access from ${who} (was ${getRoleLabel(currentRole)})`
        : action === "role_changed"
          ? `Changed ${who} from ${getRoleLabel(currentRole)} to ${getRoleLabel(input.role)}`
          : `Granted ${who} the ${getRoleLabel(input.role)} role`,
    targetTable: "user_roles",
    targetId: account.$id,
  });

  return { userId: account.$id, role: input.role, action };
}
