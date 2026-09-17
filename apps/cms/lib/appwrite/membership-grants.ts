/**
 * Granting premium by hand, and taking it back.
 *
 * The one place in the dashboard that creates paid access without a payment:
 * a scholarship, a partner school, a support case where somebody paid and the
 * purchase did not land. Everything here is `source: "manual"`.
 *
 * Two rules shape the whole file.
 *
 * **A grant is a subscription, not a flag.** It goes through the same
 * `subscriptions` table and the same `syncMembershipFromSubscriptions` as a
 * Play purchase, so a granted member expires on schedule, appears in the
 * subscriber counts, and reads identically to the app. Setting
 * `user_profiles.isPremium` directly would produce access that no sweep can
 * end and no report can see.
 *
 * **A grant may never touch a paid subscription.** Revoking is scoped to rows
 * this feature created. Google owns a Play subscription's lifecycle; a
 * dashboard button that cancelled one would leave the member paying for access
 * we had taken away, and Play would keep charging them.
 */

import { ID, Query } from "node-appwrite";

import { appwriteEnv, hasAppwriteServerEnv } from "@/lib/appwrite/env";
import {
  getReviewerTableDefinition,
  serverOwnedRowPermissions,
} from "@workspace/schema";
import { getAdminServices } from "@/lib/appwrite/server";
import {
  listPlans,
  listSubscriptionsForUser,
  logActivity,
  resolveCurrentSubscription,
  syncMembershipFromSubscriptions,
  syncPlanSubscriberCounts,
} from "@/lib/appwrite/subscriptions";

const PROFILES = getReviewerTableDefinition("user_profiles").tableId;
const SUBSCRIPTIONS = getReviewerTableDefinition("subscriptions").tableId;

/** Sources this feature is allowed to end. Never `google_play`. */
const REVOCABLE_SOURCES = ["manual", "promo"] as const;

export class GrantError extends Error {}

export type MemberSearchResult = {
  userId: string;
  name: string;
  email: string;
  /** Blank when the account has no profile row yet. */
  profileId: string;
  isPremium: boolean;
  premiumUntil: string;
  planName: string;
  subscriptionStatus: string;
  /** True when access came from a purchase, which must not be revoked here. */
  hasPaidSubscription: boolean;
};

/**
 * Finds members by name or email.
 *
 * Searches Appwrite Auth rather than `user_profiles`, for two reasons: the
 * profile table has no fulltext index on name or email, and an account that
 * never finished creating its profile still needs to be findable — that is
 * exactly the support case a manual grant is for.
 */
export async function searchMembers(term: string): Promise<MemberSearchResult[]> {
  const query = term.trim();

  if (!hasAppwriteServerEnv() || query.length < 2) {
    return [];
  }

  const { users, tables } = getAdminServices();

  const found = await users.list({
    queries: [Query.limit(20)],
    search: query,
  });

  if (!found.users.length) {
    return [];
  }

  // One query for every profile, rather than one per account.
  const profiles = await tables.listRows({
    databaseId: appwriteEnv.databaseId,
    tableId: PROFILES,
    queries: [
      Query.equal(
        "userId",
        found.users.map((user) => user.$id),
      ),
      Query.limit(100),
    ],
  });

  const byUser = new Map(
    (profiles.rows as Record<string, unknown>[]).map((row) => [
      String(row.userId ?? ""),
      row,
    ]),
  );

  const results: MemberSearchResult[] = [];

  for (const user of found.users) {
    const profile = byUser.get(user.$id);
    const subscriptions = await listSubscriptionsForUser(user.$id);
    const current = resolveCurrentSubscription(subscriptions);

    results.push({
      userId: user.$id,
      name: user.name || "(no name)",
      email: user.email || "",
      profileId: profile ? String(profile.$id) : "",
      isPremium: Boolean(current),
      premiumUntil: current?.endsAt ?? "",
      planName: current?.planName ?? "",
      subscriptionStatus: String(profile?.subscriptionStatus ?? "none"),
      hasPaidSubscription: subscriptions.some(
        (item) => item.source === "google_play",
      ),
    });
  }

  return results;
}

export type GrantInput = {
  userId: string;
  /** Optional. When absent the grant stands on its own with a stated length. */
  planId?: string;
  /** Days of access. Ignored when a plan is chosen and the plan has its own. */
  days?: number;
  /** Why. Required — a free membership with no reason is one nobody can audit. */
  reason: string;
  /** Who did it, for the note and the timeline. */
  actorEmail: string;
};

/**
 * Grants premium access without a payment.
 *
 * Works with **no plans authored**, which matters because
 * `subscription_plans` is empty until the Play products exist — and the first
 * thing anybody wants from this screen is to comp an account today. A plan is
 * used when one is chosen, and a plain dated grant is written when it is not.
 *
 * Extends rather than replaces: someone with three weeks left who is granted a
 * month ends up with seven weeks, not four. Starting from today would quietly
 * take away time they already had.
 */
export async function grantPremium(input: GrantInput) {
  if (!hasAppwriteServerEnv()) {
    throw new GrantError("Appwrite is not configured.");
  }

  const userId = input.userId.trim();
  const reason = input.reason.trim();

  if (!userId) {
    throw new GrantError("Pick a member first.");
  }

  if (!reason) {
    throw new GrantError(
      "Say why. A free membership with no reason recorded is one nobody can explain later.",
    );
  }

  const { tables, users } = getAdminServices();

  // The account has to exist. Granting to a mistyped id would create a
  // subscription nobody owns and nobody can find.
  try {
    await users.get({ userId });
  } catch {
    throw new GrantError("That account does not exist.");
  }

  const plans = input.planId ? await listPlans() : [];
  const plan = input.planId
    ? plans.find((candidate) => candidate.id === input.planId)
    : undefined;

  if (input.planId && !plan) {
    throw new GrantError("That plan does not exist.");
  }

  const days = plan?.durationDays ?? Number(input.days ?? 0);

  if (!Number.isFinite(days) || days < 0 || days > 3650) {
    throw new GrantError("Give a length between 0 and 3650 days.");
  }

  const now = new Date();
  const existing = resolveCurrentSubscription(
    await listSubscriptionsForUser(userId),
    now,
  );

  const startsAt = existing?.endsAt ? new Date(existing.endsAt) : now;
  const endsAt =
    days > 0
      ? new Date(startsAt.getTime() + days * 86_400_000)
      : null; // 0 days is a lifetime grant, and has no end date.

  const created = await tables.createRow({
    databaseId: appwriteEnv.databaseId,
    tableId: SUBSCRIPTIONS,
    rowId: ID.unique(),
    // `server_private`: the row carries the member's read grant, or their own
    // membership screen cannot see the thing they were just given.
    permissions: serverOwnedRowPermissions(userId),
    data: {
      userId,
      planId: plan?.id ?? null,
      planName: plan?.name ?? "Granted access",
      status: "active",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt ? endsAt.toISOString() : null,
      autoRenew: false,
      source: "manual",
      amountPaid: 0,
      currency: plan?.currency ?? "PHP",
      autoRenewing: false,
      isAcknowledged: false,
      note: `Granted by ${input.actorEmail}: ${reason}`,
      createdAt: now.toISOString(),
    },
  });

  await syncMembershipFromSubscriptions(userId);
  await syncPlanSubscriberCounts();

  await logActivity({
    userId,
    type: existing ? "subscription_renewed" : "subscription_started",
    title: plan ? `${plan.name} granted` : "Premium access granted",
    detail: endsAt
      ? `Access until ${endsAt.toISOString().slice(0, 10)}`
      : "Lifetime access",
    referenceId: String(created.$id),
    amount: 0,
  });

  return {
    subscriptionId: String(created.$id),
    endsAt: endsAt ? endsAt.toISOString() : "",
    extended: Boolean(existing),
  };
}

/**
 * Ends the grants this feature created. Leaves purchases alone.
 *
 * Refuses outright when the member's access came from Play: that subscription
 * is Google's to end, the member is still being charged for it, and taking the
 * access away here would take something they are paying for.
 */
export async function revokePremium(input: {
  userId: string;
  reason: string;
  actorEmail: string;
}) {
  if (!hasAppwriteServerEnv()) {
    throw new GrantError("Appwrite is not configured.");
  }

  const userId = input.userId.trim();
  const reason = input.reason.trim();

  if (!userId) {
    throw new GrantError("Pick a member first.");
  }

  if (!reason) {
    throw new GrantError("Say why this is being taken back.");
  }

  const { tables } = getAdminServices();
  const subscriptions = await listSubscriptionsForUser(userId);
  const current = resolveCurrentSubscription(subscriptions);

  if (current && current.source === "google_play") {
    throw new GrantError(
      "That member's access came from a Google Play purchase. It cannot be revoked here — they are still being charged for it, and cancelling belongs to Google. Refund it in Play Console instead.",
    );
  }

  const revocable = subscriptions.filter(
    (item) =>
      (REVOCABLE_SOURCES as readonly string[]).includes(item.source) &&
      (item.status === "active" || item.status === "in_grace_period"),
  );

  if (!revocable.length) {
    throw new GrantError("That member has no granted access to take back.");
  }

  const now = new Date().toISOString();

  for (const subscription of revocable) {
    const row = (await tables.getRow({
      databaseId: appwriteEnv.databaseId,
      tableId: SUBSCRIPTIONS,
      rowId: subscription.id,
    })) as unknown as Record<string, unknown>;

    const previous = String(row.note ?? "").trim();
    const line = `Revoked by ${input.actorEmail}: ${reason}`;

    await tables.updateRow({
      databaseId: appwriteEnv.databaseId,
      tableId: SUBSCRIPTIONS,
      rowId: subscription.id,
      data: {
        status: "expired",
        endsAt: now,
        cancelledAt: now,
        // Appended. The reason it was granted is worth as much as the reason
        // it was taken back, and more once somebody asks about it.
        note: previous ? `${previous}\n${line}` : line,
      },
    });
  }

  await syncMembershipFromSubscriptions(userId);
  await syncPlanSubscriberCounts();

  await logActivity({
    userId,
    type: "subscription_expired",
    title: "Granted access ended",
    detail: reason,
  });

  return { revoked: revocable.length };
}

/** The member's grant history, newest first, for the detail panel. */
export async function listGrantsForMember(userId: string) {
  if (!hasAppwriteServerEnv() || !userId) {
    return [];
  }

  const subscriptions = await listSubscriptionsForUser(userId);

  return subscriptions
    .slice()
    .sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1))
    .map((item) => ({
      id: item.id,
      planName: item.planName || "Granted access",
      status: item.status,
      source: item.source,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      amountPaid: item.amountPaid,
      currency: item.currency,
    }));
}
