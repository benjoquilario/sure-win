/**
 * Membership: who is premium, until when, and why.
 *
 * One rule holds this together - **the `subscriptions` table decides access,
 * and `user_profiles` only caches the answer.** Every write goes through
 * `syncMembershipFromSubscriptions`, so there is exactly one place that can
 * make the cached flag disagree with what someone actually bought.
 *
 * Google Play is the only payment path. That means there is nothing to verify
 * by hand: a purchase token either checks out against the Play Developer API
 * or it does not, and Play tells us about renewals, cancellations, and refunds
 * through Real-Time Developer Notifications.
 *
 * Amounts are whole pesos.
 */

import { createHash } from "node:crypto";

import { ID, Query } from "node-appwrite";

import { appwriteEnv, hasAppwriteServerEnv } from "@/lib/appwrite/env";
import {
  getReviewerTableDefinition,
  serverOwnedRowPermissions,
  type ActivityType,
  type SubscriptionStatus,
} from "@workspace/schema";
import { getAdminServices } from "@/lib/appwrite/server";

const PROFILES_TABLE = getReviewerTableDefinition("user_profiles").tableId;
const PLANS_TABLE = getReviewerTableDefinition("subscription_plans").tableId;
const SUBSCRIPTIONS_TABLE = getReviewerTableDefinition("subscriptions").tableId;
const PAYMENTS_TABLE = getReviewerTableDefinition("payments").tableId;
const CODES_TABLE = getReviewerTableDefinition("access_codes").tableId;
const ACTIVITY_TABLE = getReviewerTableDefinition("user_activity_log").tableId;
const NOTIFICATIONS_TABLE = getReviewerTableDefinition(
  "billing_notifications",
).tableId;

const PAGE_SIZE = 100;

/**
 * The statuses that still let someone in.
 *
 * `in_grace_period` is here because Play says it belongs here: the member paid,
 * their card failed, and Google is retrying while keeping them subscribed.
 * Cutting access at the first failed charge would take away a period they are
 * still entitled to and, in the common case where the retry succeeds, they
 * would never have known anything was wrong.
 *
 * `on_hold` and `paused` are deliberately absent. Both mean Play has stopped
 * the subscription, and access has to stop with it.
 */
const ACCESS_GRANTING_STATUSES: readonly SubscriptionStatus[] = [
  "active",
  "in_grace_period",
];

/**
 * Fingerprints a Play purchase token so it can be indexed.
 *
 * A token needs 1024 characters to be stored whole, and Appwrite will not
 * index a column past 767 - so the column that holds the token and the column
 * that finds it have to be different ones. Every lookup goes through this;
 * `Query.equal('purchaseToken', ...)` has no index behind it and never will.
 *
 * Not a security measure. The token is stored in full beside it, because
 * verifying and acknowledging a purchase needs the real thing.
 */
export function hashPurchaseToken(token: string) {
  return token ? createHash("sha256").update(token).digest("hex") : "";
}

/** Finds the one subscription a purchase token belongs to, or nothing. */
async function findSubscriptionByToken(purchaseToken: string) {
  if (!purchaseToken) {
    return undefined;
  }

  const { tables } = getAdminServices();
  const found = await tables.listRows({
    databaseId: appwriteEnv.databaseId,
    tableId: SUBSCRIPTIONS_TABLE,
    queries: [
      Query.equal("purchaseTokenHash", [hashPurchaseToken(purchaseToken)]),
      Query.limit(1),
    ],
  });

  return found.rows[0] as Record<string, unknown> | undefined;
}

/**
 * Alphabet for printed access codes.
 *
 * No O/0, I/1, or S/5. These get read off a slip of paper and typed by a
 * student in a hurry, and every ambiguous pair is a support message.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";

function toPlainRow<T>(row: unknown): T {
  return JSON.parse(JSON.stringify(row)) as T;
}

async function listAllRows<T>(tableId: string, queries: string[] = []) {
  const { tables } = getAdminServices();
  const rows: T[] = [];
  let cursor: string | null = null;

  for (;;) {
    const pageQueries = [...queries, Query.limit(PAGE_SIZE)];

    if (cursor) {
      pageQueries.push(Query.cursorAfter(cursor));
    }

    const response = await tables.listRows({
      databaseId: appwriteEnv.databaseId,
      tableId,
      queries: pageQueries,
    });

    if (!response.rows.length) {
      break;
    }

    rows.push(...response.rows.map((row) => toPlainRow<T>(row)));
    cursor = String(
      (response.rows[response.rows.length - 1] as { $id: string }).$id,
    );

    if (response.rows.length < PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

export type PlanSummary = {
  id: string;
  name: string;
  code: string;
  googleProductId: string;
  price: number;
  currency: string;
  durationDays: number;
  isRecurring: boolean;
  isActive: boolean;
  isPopular: boolean;
  order: number;
  subscriberCount: number;
};

export type SubscriptionRecord = {
  id: string;
  userId: string;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  startsAt: string;
  endsAt: string;
  amountPaid: number;
  currency: string;
  source: string;
  orderId: string;
};

export async function listPlans(): Promise<PlanSummary[]> {
  if (!hasAppwriteServerEnv()) {
    return [];
  }

  try {
    const rows = await listAllRows<Record<string, unknown>>(PLANS_TABLE, [
      Query.orderAsc("order"),
    ]);

    return rows.map((row) => ({
      id: String(row.$id),
      name: String(row.name ?? "").trim() || String(row.$id),
      code: String(row.code ?? "").trim(),
      price: Number(row.price ?? 0),
      googleProductId: String(row.googleProductId ?? "").trim(),
      currency: String(row.currency ?? "PHP"),
      durationDays: Number(row.durationDays ?? 0),
      isRecurring: row.isRecurring === true,
      isActive: row.isActive !== false,
      isPopular: row.isPopular === true,
      order: Number(row.order ?? 1),
      subscriberCount: Number(row.subscriberCount ?? 0),
    }));
  } catch {
    return [];
  }
}

export async function listSubscriptionsForUser(
  userId: string,
): Promise<SubscriptionRecord[]> {
  if (!hasAppwriteServerEnv() || !userId) {
    return [];
  }

  try {
    const rows = await listAllRows<Record<string, unknown>>(
      SUBSCRIPTIONS_TABLE,
      [Query.equal("userId", [userId])],
    );

    return rows.map((row) => ({
      id: String(row.$id),
      userId: String(row.userId ?? ""),
      planId: String(row.planId ?? ""),
      planName: String(row.planName ?? ""),
      status: (row.status ?? "pending") as SubscriptionStatus,
      startsAt: String(row.startsAt ?? ""),
      endsAt: String(row.endsAt ?? ""),
      amountPaid: Number(row.amountPaid ?? 0),
      currency: String(row.currency ?? "PHP"),
      source: String(row.source ?? "manual"),
      orderId: String(row.orderId ?? ""),
    }));
  } catch {
    return [];
  }
}

/**
 * Picks the subscription that currently grants access, if any.
 *
 * The furthest-reaching active period wins, so stacking a second purchase on
 * top of an unexpired one extends access instead of shortening it. A row with
 * no end date is lifetime and beats every dated one.
 */
export function resolveCurrentSubscription(
  subscriptions: readonly SubscriptionRecord[],
  now: Date = new Date(),
) {
  const active = subscriptions.filter((subscription) => {
    if (!ACCESS_GRANTING_STATUSES.includes(subscription.status)) {
      return false;
    }

    if (!subscription.endsAt) {
      return true;
    }

    const endsAt = new Date(subscription.endsAt);
    return !Number.isNaN(endsAt.getTime()) && endsAt.getTime() > now.getTime();
  });

  if (!active.length) {
    return null;
  }

  return active.reduce((furthest, candidate) => {
    if (!furthest.endsAt || !candidate.endsAt) {
      // Lifetime wins; if both are lifetime either answer is the same.
      return furthest.endsAt ? candidate : furthest;
    }

    return new Date(candidate.endsAt) > new Date(furthest.endsAt)
      ? candidate
      : furthest;
  });
}

/**
 * Recomputes a student's cached membership from their subscriptions.
 *
 * The single writer of `isPremium`, `premiumUntil`, `planName`, and
 * `subscriptionStatus`. Call it after anything that could change access:
 * a new subscription, a confirmed payment, a cancellation, an expiry sweep.
 */
export async function syncMembershipFromSubscriptions(userId: string) {
  if (!hasAppwriteServerEnv() || !userId) {
    return null;
  }

  const { tables } = getAdminServices();
  const subscriptions = await listSubscriptionsForUser(userId);
  const current = resolveCurrentSubscription(subscriptions);

  // The cached field on the profile keeps its five values, and the three Play
  // states added to `subscriptions` are folded into them here rather than
  // widened onto the profile. Every screen in the app reads this field; the one
  // screen that wants the real state reads the subscription row itself, where
  // `on_hold` and `in_grace_period` are the difference between "your payment
  // failed" and "your payment failed and we are still trying".
  const has = (status: SubscriptionStatus) =>
    subscriptions.some((item) => item.status === status);

  const status: string = current
    ? "active"
    : has("pending")
      ? "pending"
      : // Paused is the member's own doing, so it reads as cancelled. On hold
        // is Play giving up on a card, which reads as a lapse.
        has("paused") || has("cancelled")
        ? "cancelled"
        : subscriptions.length
          ? "expired"
          : "none";

  const profiles = await tables.listRows({
    databaseId: appwriteEnv.databaseId,
    tableId: PROFILES_TABLE,
    queries: [Query.equal("userId", [userId]), Query.limit(1)],
  });

  const profile = profiles.rows[0] as { $id?: string } | undefined;

  if (!profile?.$id) {
    return null;
  }

  await tables.updateRow({
    databaseId: appwriteEnv.databaseId,
    tableId: PROFILES_TABLE,
    rowId: profile.$id,
    data: {
      isPremium: Boolean(current),
      premiumUntil: current?.endsAt || null,
      planName: current?.planName || null,
      subscriptionStatus: status,
    },
  });

  return { status, current };
}

export async function logActivity(input: {
  userId: string;
  type: ActivityType;
  title: string;
  detail?: string;
  referenceId?: string;
  amount?: number;
  occurredAt?: string;
}) {
  if (!hasAppwriteServerEnv() || !input.userId) {
    return;
  }

  try {
    const { tables } = getAdminServices();

    await tables.createRow({
      databaseId: appwriteEnv.databaseId,
      tableId: ACTIVITY_TABLE,
      rowId: ID.unique(),
      // Row security is on for this table, and the API key that writes here
      // bypasses it. Without an explicit grant the member's own timeline
      // entry is invisible to the member - no error, just a gap where the
      // billing event should be.
      permissions: serverOwnedRowPermissions(input.userId),
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        detail: input.detail || null,
        referenceId: input.referenceId || null,
        amount: typeof input.amount === "number" ? input.amount : null,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
      },
    });
  } catch {
    // The timeline is a record of what happened, not a gate on it happening.
  }
}

function addDays(from: Date, days: number) {
  const result = new Date(from);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Grants access, extending an unexpired period rather than replacing it.
 *
 * Someone who renews with three weeks left should end up with those three
 * weeks plus the new term; starting from today would quietly take them away.
 */
export async function startSubscription(input: {
  userId: string;
  planId: string;
  source?: string;
  amountPaid?: number;
  accessCodeId?: string;
  note?: string;
  /** Present only for a Play purchase. */
  google?: {
    purchaseToken: string;
    orderId: string;
    productId: string;
    autoRenewing: boolean;
    isAcknowledged: boolean;
    expiresAt?: string;
    /** Which base plan and offer of the product was actually taken. */
    basePlanId?: string;
    offerId?: string;
    /** The token this purchase replaces, on an upgrade or a resubscribe. */
    linkedPurchaseToken?: string;
    /** What the app attached to the purchase to name the buyer. */
    obfuscatedAccountId?: string;
  };
}) {
  const { tables } = getAdminServices();
  const plans = await listPlans();
  const plan = plans.find((candidate) => candidate.id === input.planId);

  if (!plan) {
    throw new Error("That plan does not exist.");
  }

  const now = new Date();
  const existing = resolveCurrentSubscription(
    await listSubscriptionsForUser(input.userId),
    now,
  );

  const startsAt =
    existing && existing.endsAt ? new Date(existing.endsAt) : now;

  // Play's own expiry wins when it gave us one: it accounts for free trials,
  // grace periods, and the exact moment the store will next charge.
  const endsAt = input.google?.expiresAt
    ? new Date(input.google.expiresAt)
    : plan.durationDays > 0
      ? addDays(startsAt, plan.durationDays)
      : null;

  const created = await tables.createRow({
    databaseId: appwriteEnv.databaseId,
    tableId: SUBSCRIPTIONS_TABLE,
    rowId: ID.unique(),
    // `server_private`: no table-level grants, so this row is reachable only
    // by whoever it names. Read and nothing else - the app renders membership
    // from it and must never be able to extend its own.
    permissions: serverOwnedRowPermissions(input.userId),
    data: {
      userId: input.userId,
      planId: plan.id,
      planName: plan.name,
      status: "active",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt ? endsAt.toISOString() : null,
      autoRenew: plan.isRecurring,
      source: input.source ?? "google_play",
      amountPaid:
        typeof input.amountPaid === "number" ? input.amountPaid : plan.price,
      currency: plan.currency,
      accessCodeId: input.accessCodeId || null,
      purchaseToken: input.google?.purchaseToken || null,
      // Written together, always. A row with a token and no fingerprint is
      // invisible to every lookup in this file.
      purchaseTokenHash: input.google?.purchaseToken
        ? hashPurchaseToken(input.google.purchaseToken)
        : null,
      orderId: input.google?.orderId || null,
      productId: input.google?.productId || null,
      basePlanId: input.google?.basePlanId || null,
      offerId: input.google?.offerId || null,
      linkedPurchaseToken: input.google?.linkedPurchaseToken || null,
      linkedPurchaseTokenHash: input.google?.linkedPurchaseToken
        ? hashPurchaseToken(input.google.linkedPurchaseToken)
        : null,
      obfuscatedAccountId: input.google?.obfuscatedAccountId || null,
      autoRenewing: input.google?.autoRenewing ?? false,
      isAcknowledged: input.google?.isAcknowledged ?? false,
      // Recorded only when it is true, so the gap between buying and
      // acknowledging is readable rather than assumed.
      acknowledgedAt: input.google?.isAcknowledged ? now.toISOString() : null,
      note: input.note || null,
      createdAt: now.toISOString(),
    },
  });

  await syncMembershipFromSubscriptions(input.userId);
  await syncPlanSubscriberCounts();

  await logActivity({
    userId: input.userId,
    type: existing ? "subscription_renewed" : "subscription_started",
    title: `${existing ? "Renewed" : "Started"} ${plan.name}`,
    detail: endsAt
      ? `Access until ${endsAt.toISOString().slice(0, 10)}`
      : "Lifetime access",
    referenceId: String((created as { $id: string }).$id),
    amount: typeof input.amountPaid === "number" ? input.amountPaid : plan.price,
  });

  return toPlainRow<Record<string, unknown>>(created);
}

/**
 * Moves finished subscriptions to `expired` and refreshes the affected profiles.
 *
 * A lapse has no event to hang off - nobody presses a button when their month
 * runs out - so something has to come looking. `hasActivePremium` already
 * refuses stale access on read; this keeps the stored state honest for
 * reporting and for the subscriber lists.
 */
export async function expireFinishedSubscriptions(now: Date = new Date()) {
  if (!hasAppwriteServerEnv()) {
    return { expired: 0, users: [] as string[] };
  }

  const { tables } = getAdminServices();
  const due = await listAllRows<Record<string, unknown>>(SUBSCRIPTIONS_TABLE, [
    Query.equal("status", ["active"]),
    Query.lessThan("endsAt", now.toISOString()),
  ]);

  const users = new Set<string>();

  for (const row of due) {
    // A lifetime row has no end date and cannot match, but be explicit.
    if (!row.endsAt) {
      continue;
    }

    await tables.updateRow({
      databaseId: appwriteEnv.databaseId,
      tableId: SUBSCRIPTIONS_TABLE,
      rowId: String(row.$id),
      data: { status: "expired" },
    });

    const userId = String(row.userId ?? "");

    if (userId) {
      users.add(userId);
      await logActivity({
        userId,
        type: "subscription_expired",
        title: `${String(row.planName ?? "Subscription")} ended`,
        referenceId: String(row.$id),
      });
    }
  }

  for (const userId of users) {
    await syncMembershipFromSubscriptions(userId);
  }

  await syncPlanSubscriberCounts();

  return { expired: due.length, users: [...users] };
}

/** Recomputes each plan's active subscriber count. */
export async function syncPlanSubscriberCounts() {
  if (!hasAppwriteServerEnv()) {
    return;
  }

  try {
    const { tables } = getAdminServices();
    const plans = await listPlans();

    for (const plan of plans) {
      const response = await tables.listRows({
        databaseId: appwriteEnv.databaseId,
        tableId: SUBSCRIPTIONS_TABLE,
        queries: [
          Query.equal("planId", [plan.id]),
          Query.equal("status", ["active"]),
          Query.limit(1),
        ],
        total: true,
      });

      await tables.updateRow({
        databaseId: appwriteEnv.databaseId,
        tableId: PLANS_TABLE,
        rowId: plan.id,
        data: { subscriberCount: Number(response.total ?? 0) },
      });
    }
  } catch {
    // A stale count is cosmetic; never let it fail a purchase.
  }
}

/** Generates an unambiguous access code, e.g. `RVW-K7P2-9BQX`. */
export function generateAccessCode(prefix = "RVW") {
  const block = (length: number) =>
    Array.from(
      { length },
      () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
    ).join("");

  return `${prefix}-${block(4)}-${block(4)}`;
}

/**
 * Redeems a code and starts the subscription it grants.
 *
 * Every reason a code can fail returns the same shape, because the app has to
 * tell the student which one it was - "already used" and "expired" are
 * different problems with different fixes.
 */
export async function redeemAccessCode(userId: string, rawCode: string) {
  const { tables } = getAdminServices();
  const code = rawCode.trim().toUpperCase();

  if (!code) {
    return { ok: false as const, reason: "Enter a code." };
  }

  const found = await tables.listRows({
    databaseId: appwriteEnv.databaseId,
    tableId: CODES_TABLE,
    queries: [Query.equal("code", [code]), Query.limit(1)],
  });

  const row = found.rows[0] as Record<string, unknown> | undefined;

  if (!row) {
    return { ok: false as const, reason: "That code was not recognised." };
  }

  if (row.isActive === false) {
    return { ok: false as const, reason: "That code is no longer active." };
  }

  const expiresAt = String(row.expiresAt ?? "");

  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    return { ok: false as const, reason: "That code has expired." };
  }

  const redeemed = Number(row.redeemedCount ?? 0);
  const maximum = Number(row.maxRedemptions ?? 1);

  if (redeemed >= maximum) {
    return { ok: false as const, reason: "That code has already been used." };
  }

  const subscription = await startSubscription({
    userId,
    planId: String(row.planId ?? ""),
    source: "access_code",
    amountPaid: 0,
    accessCodeId: String(row.$id),
    note: `Redeemed code ${code}`,
  });

  await tables.updateRow({
    databaseId: appwriteEnv.databaseId,
    tableId: CODES_TABLE,
    rowId: String(row.$id),
    data: { redeemedCount: redeemed + 1 },
  });

  await logActivity({
    userId,
    type: "code_redeemed",
    title: `Redeemed ${code}`,
    detail: String(row.planName ?? ""),
    referenceId: String(row.$id),
  });

  return { ok: true as const, subscription };
}

/**
 * Applies a verified Google Play purchase.
 *
 * The caller must have already checked the token against the Play Developer
 * API - a purchase token straight from a client is a claim, not a fact, and
 * anyone can send one.
 *
 * The token is the identity of the purchase. Play re-delivers notifications
 * until they are acknowledged, and the app also reports the same purchase on
 * every launch until it is consumed, so this has to be safe to call repeatedly
 * with the same token: the second call updates the row it already made.
 */
export async function applyGooglePurchase(input: {
  userId: string;
  productId: string;
  purchaseToken: string;
  orderId: string;
  autoRenewing: boolean;
  isAcknowledged: boolean;
  expiresAt?: string;
  priceCharged?: number;
  kind?: "initial" | "renewal";
  basePlanId?: string;
  offerId?: string;
  /**
   * Set by Play when this purchase replaces another - an upgrade, a downgrade,
   * or a resubscribe inside the grace window. The old token keeps working
   * until it is closed, so ignoring this leaves the member holding two.
   */
  linkedPurchaseToken?: string;
  obfuscatedAccountId?: string;
}) {
  const { tables } = getAdminServices();

  const already = await findSubscriptionByToken(input.purchaseToken);

  if (already) {
    await tables.updateRow({
      databaseId: appwriteEnv.databaseId,
      tableId: SUBSCRIPTIONS_TABLE,
      rowId: String(already.$id),
      data: {
        status: "active",
        endsAt: input.expiresAt ?? already.endsAt ?? null,
        autoRenewing: input.autoRenewing,
        isAcknowledged: input.isAcknowledged,
        // Only ever set, never cleared: the first acknowledgement is the one
        // that beat the deadline, and a later re-report must not overwrite it.
        acknowledgedAt:
          already.acknowledgedAt ??
          (input.isAcknowledged ? new Date().toISOString() : null),
        orderId: input.orderId || already.orderId || null,
        basePlanId: input.basePlanId || already.basePlanId || null,
        offerId: input.offerId || already.offerId || null,
      },
    });

    await closeReplacedSubscription(input.linkedPurchaseToken);
    await syncMembershipFromSubscriptions(input.userId);
    await recordGoogleCharge({ ...input, subscriptionId: String(already.$id) });

    return { created: false as const, subscriptionId: String(already.$id) };
  }

  const plans = await listPlans();
  const plan = plans.find(
    (candidate) => candidate.googleProductId === input.productId,
  );

  if (!plan) {
    throw new Error(
      `No plan is configured for Play product "${input.productId}".`,
    );
  }

  // Before the new period is written, so the replaced subscription cannot be
  // picked up as the "existing" access the new one extends from.
  await closeReplacedSubscription(input.linkedPurchaseToken);

  const subscription = await startSubscription({
    userId: input.userId,
    planId: plan.id,
    source: "google_play",
    amountPaid: input.priceCharged ?? plan.price,
    google: {
      purchaseToken: input.purchaseToken,
      orderId: input.orderId,
      productId: input.productId,
      autoRenewing: input.autoRenewing,
      isAcknowledged: input.isAcknowledged,
      expiresAt: input.expiresAt,
      basePlanId: input.basePlanId,
      offerId: input.offerId,
      linkedPurchaseToken: input.linkedPurchaseToken,
      obfuscatedAccountId: input.obfuscatedAccountId,
    },
  });

  const subscriptionId = String(subscription.$id);
  await recordGoogleCharge({ ...input, subscriptionId });

  return { created: true as const, subscriptionId };
}

/**
 * Ends the subscription a new purchase replaced.
 *
 * Play does not expire the old token when someone upgrades - it hands over a
 * new one carrying `linkedPurchaseToken` and expects the server to work out
 * that they are the same membership. Skipping this leaves two active rows for
 * one paying member, and because `resolveCurrentSubscription` takes the
 * furthest end date, the one that stops renewing can be the one granting
 * access.
 */
async function closeReplacedSubscription(linkedPurchaseToken?: string) {
  if (!linkedPurchaseToken) {
    return;
  }

  try {
    const { tables } = getAdminServices();
    const row = await findSubscriptionByToken(linkedPurchaseToken);

    if (!row || row.status === "expired" || row.status === "refunded") {
      return;
    }

    const existingNote = String(row.note ?? "").trim();
    const closingNote = "Replaced by an upgrade or resubscribe.";

    await tables.updateRow({
      databaseId: appwriteEnv.databaseId,
      tableId: SUBSCRIPTIONS_TABLE,
      rowId: String(row.$id),
      data: {
        status: "expired",
        autoRenewing: false,
        endsAt: new Date().toISOString(),
        // Appended, never replaced. An admin's note about why this membership
        // was granted or extended is the kind of thing nobody writes twice.
        note: existingNote ? `${existingNote}\n${closingNote}` : closingNote,
      },
    });
  } catch {
    // The new subscription is the one that grants access; a stale old row is
    // untidy, not a reason to fail a purchase the member already paid for.
  }
}

/**
 * Records one charge, keyed by Play's order ID.
 *
 * The unique index on `orderId` is what makes this safe to retry: a redelivered
 * notification hits the constraint instead of adding a second purchase and
 * inflating the revenue figures.
 */
async function recordGoogleCharge(input: {
  userId: string;
  subscriptionId: string;
  orderId: string;
  purchaseToken: string;
  productId: string;
  priceCharged?: number;
  kind?: "initial" | "renewal";
}) {
  if (!input.orderId) {
    return;
  }

  try {
    const { tables } = getAdminServices();
    const plans = await listPlans();
    const plan = plans.find(
      (candidate) => candidate.googleProductId === input.productId,
    );

    await tables.createRow({
      databaseId: appwriteEnv.databaseId,
      tableId: PAYMENTS_TABLE,
      rowId: ID.unique(),
      data: {
        userId: input.userId,
        subscriptionId: input.subscriptionId,
        amount: input.priceCharged ?? plan?.price ?? 0,
        currency: plan?.currency ?? "PHP",
        status: "paid",
        kind: input.kind ?? "initial",
        orderId: input.orderId,
        purchaseToken: input.purchaseToken,
        purchaseTokenHash: hashPurchaseToken(input.purchaseToken),
        productId: input.productId,
        paidAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    });
  } catch {
    // A duplicate orderId means this charge is already recorded, which is the
    // constraint doing its job rather than a failure.
  }
}

/** Play RTDN subscription notification types worth acting on. */
export const GOOGLE_NOTIFICATION = {
  RECOVERED: 1,
  RENEWED: 2,
  CANCELED: 3,
  PURCHASED: 4,
  ON_HOLD: 5,
  IN_GRACE_PERIOD: 6,
  RESTARTED: 7,
  PAUSED: 10,
  REVOKED: 12,
  EXPIRED: 13,
} as const;

/**
 * Applies a Real-Time Developer Notification.
 *
 * Cancelling is not losing access: Play keeps the student subscribed until the
 * period they paid for runs out, and only `EXPIRED` or `REVOKED` ends it. A
 * cancellation that cut access immediately would be taking back something
 * already paid for.
 */
export async function applyGoogleNotification(input: {
  notificationType: number;
  purchaseToken: string;
  /**
   * Play's current expiry for this purchase.
   *
   * **Pass it on every renewal, recovery and restart.** The notification
   * itself does not carry one, so the webhook has to fetch it from
   * `purchases.subscriptionsv2.get` - and a renewal applied without it leaves
   * the row `active` with last month's end date, which reads as no access at
   * all to a member who has just been charged.
   */
  expiresAt?: string;
  autoRenewing?: boolean;
}) {
  const { tables } = getAdminServices();

  const row = await findSubscriptionByToken(input.purchaseToken);

  if (!row) {
    return { ok: false as const, reason: "Unknown purchase token." };
  }

  const userId = String(row.userId ?? "");
  const data: Record<string, unknown> = {
    latestNotificationType: input.notificationType,
    latestNotificationAt: new Date().toISOString(),
  };

  switch (input.notificationType) {
    case GOOGLE_NOTIFICATION.RENEWED:
    case GOOGLE_NOTIFICATION.RECOVERED:
    case GOOGLE_NOTIFICATION.RESTARTED:
      data.status = "active";
      data.autoRenewing = true;
      if (input.expiresAt) {
        data.endsAt = input.expiresAt;
      }
      break;

    case GOOGLE_NOTIFICATION.CANCELED:
      // Still active until the paid period ends.
      data.autoRenewing = false;
      break;

    // The card failed and Play is retrying. The member stays subscribed for
    // the length of the grace period, so access continues - `endsAt` moves
    // only if Play told us where to.
    case GOOGLE_NOTIFICATION.IN_GRACE_PERIOD:
      data.status = "in_grace_period";
      if (input.expiresAt) {
        data.endsAt = input.expiresAt;
      }
      break;

    // Play gave up on the card. This is the one that was silently doing
    // nothing before: the row stayed active with a future end date, so a
    // member whose payment had stopped kept full access until the sweep.
    case GOOGLE_NOTIFICATION.ON_HOLD:
      data.status = "on_hold";
      data.autoRenewing = false;
      data.endsAt = new Date().toISOString();
      break;

    case GOOGLE_NOTIFICATION.PAUSED:
      data.status = "paused";
      data.autoRenewing = false;
      data.endsAt = new Date().toISOString();
      break;

    case GOOGLE_NOTIFICATION.EXPIRED:
      data.status = "expired";
      data.autoRenewing = false;
      break;

    case GOOGLE_NOTIFICATION.REVOKED:
      data.status = "refunded";
      data.autoRenewing = false;
      data.endsAt = new Date().toISOString();
      break;

    default:
      break;
  }

  await tables.updateRow({
    databaseId: appwriteEnv.databaseId,
    tableId: SUBSCRIPTIONS_TABLE,
    rowId: String(row.$id),
    data,
  });

  await syncMembershipFromSubscriptions(userId);
  await syncPlanSubscriberCounts();

  if (input.notificationType === GOOGLE_NOTIFICATION.RENEWED) {
    await logActivity({
      userId,
      type: "subscription_renewed",
      title: `${String(row.planName ?? "Subscription")} renewed`,
      referenceId: String(row.$id),
    });
  }

  if (input.notificationType === GOOGLE_NOTIFICATION.REVOKED) {
    await markChargesRefunded(input.purchaseToken);
    await logActivity({
      userId,
      type: "subscription_refunded",
      title: `${String(row.planName ?? "Subscription")} refunded`,
      detail: "Access ended when Google returned the payment.",
      referenceId: String(row.$id),
    });
  }

  return {
    ok: true as const,
    userId,
    subscriptionId: String(row.$id),
    status: String(data.status ?? row.status ?? ""),
  };
}

/**
 * Marks every charge on a purchase refunded.
 *
 * The rows stay. A refunded charge is still a thing that happened, and deleting
 * it would make the month it was collected in disagree with the month it was
 * given back.
 */
async function markChargesRefunded(purchaseToken: string) {
  if (!purchaseToken) {
    return;
  }

  try {
    const { tables } = getAdminServices();
    const charges = await listAllRows<Record<string, unknown>>(PAYMENTS_TABLE, [
      Query.equal("purchaseTokenHash", [hashPurchaseToken(purchaseToken)]),
    ]);

    const refundedAt = new Date().toISOString();

    for (const charge of charges) {
      if (charge.status === "refunded") {
        continue;
      }

      await tables.updateRow({
        databaseId: appwriteEnv.databaseId,
        tableId: PAYMENTS_TABLE,
        rowId: String(charge.$id),
        data: { status: "refunded", refundedAt },
      });
    }
  } catch {
    // Access has already been withdrawn, which is the part that matters. A
    // charge still reading `paid` overstates the month's revenue; it does not
    // hand anybody something they did not pay for.
  }
}

/**
 * Claims a Play notification, or reports that it has already been handled.
 *
 * Pub/Sub delivers at least once, and a redelivered message is not an error -
 * it is the normal way a slow response, a restart, or a network blip comes
 * back. The unique index on `messageId` is what settles it: the second write
 * loses, and the caller is told to stop rather than applying a cancellation a
 * second time.
 *
 * Call this **before** touching a subscription, and `finishPlayNotification`
 * after.
 */
export async function claimPlayNotification(input: {
  messageId: string;
  notificationType?: number;
  notificationKind?: "subscription" | "one_time" | "voided" | "test";
  purchaseToken?: string;
  productId?: string;
  orderId?: string;
  packageName?: string;
  publishedAt?: string;
  payload?: unknown;
}) {
  if (!input.messageId) {
    return { claimed: false as const, reason: "No message ID." };
  }

  const { tables } = getAdminServices();
  const now = new Date().toISOString();

  const raw =
    typeof input.payload === "string"
      ? input.payload
      : input.payload
        ? JSON.stringify(input.payload)
        : null;

  try {
    const created = await tables.createRow({
      databaseId: appwriteEnv.databaseId,
      tableId: NOTIFICATIONS_TABLE,
      rowId: ID.unique(),
      data: {
        messageId: input.messageId,
        notificationType:
          typeof input.notificationType === "number"
            ? input.notificationType
            : null,
        notificationKind: input.notificationKind ?? "subscription",
        purchaseToken: input.purchaseToken || null,
        purchaseTokenHash: input.purchaseToken
          ? hashPurchaseToken(input.purchaseToken)
          : null,
        productId: input.productId || null,
        orderId: input.orderId || null,
        packageName: input.packageName || null,
        status: "received",
        // Truncated rather than dropped: a payload too big to store is still
        // worth having the front of when something has gone wrong.
        payload: raw ? raw.slice(0, 8000) : null,
        publishedAt: input.publishedAt || null,
        receivedAt: now,
        createdAt: now,
      },
    });

    return { claimed: true as const, notificationId: String(created.$id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // The unique index doing its job. Somebody already has this one.
    if (message.includes("already exists") || message.includes("unique")) {
      return { claimed: false as const, reason: "Already handled." };
    }

    throw error;
  }
}

/** Records how a claimed notification turned out. */
export async function finishPlayNotification(
  notificationId: string,
  outcome: {
    status: "applied" | "ignored" | "failed";
    subscriptionId?: string;
    userId?: string;
    error?: string;
  },
) {
  if (!notificationId) {
    return;
  }

  try {
    const { tables } = getAdminServices();

    await tables.updateRow({
      databaseId: appwriteEnv.databaseId,
      tableId: NOTIFICATIONS_TABLE,
      rowId: notificationId,
      data: {
        status: outcome.status,
        subscriptionId: outcome.subscriptionId || null,
        userId: outcome.userId || null,
        error: outcome.error ? outcome.error.slice(0, 2000) : null,
      },
    });
  } catch {
    // The subscription is already updated; losing the audit line is a smaller
    // failure than telling Pub/Sub to redeliver a message we did apply.
  }
}

/**
 * Active subscriptions Google has not been told about.
 *
 * The single most valuable query on this system. Google **automatically
 * refunds any purchase not acknowledged within three days**, so every row this
 * returns is money leaving on a timer. Run it on a schedule and alarm on a
 * non-empty result; `olderThanHours` exists so the alarm ignores purchases
 * still in flight.
 */
export async function listUnacknowledgedSubscriptions(olderThanHours = 6) {
  if (!hasAppwriteServerEnv()) {
    return [];
  }

  const cutoff = new Date(
    Date.now() - olderThanHours * 60 * 60 * 1000,
  ).toISOString();

  const rows = await listAllRows<Record<string, unknown>>(SUBSCRIPTIONS_TABLE, [
    Query.equal("status", ["active"]),
    Query.equal("isAcknowledged", [false]),
  ]);

  return rows
    .filter((row) => {
      // Access-code and manual grants have nothing to acknowledge.
      if (!row.purchaseToken) {
        return false;
      }

      const created = String(row.createdAt ?? row.$createdAt ?? "");
      return !created || created < cutoff;
    })
    .map((row) => ({
      id: String(row.$id),
      userId: String(row.userId ?? ""),
      planName: String(row.planName ?? ""),
      orderId: String(row.orderId ?? ""),
      purchaseToken: String(row.purchaseToken ?? ""),
      createdAt: String(row.createdAt ?? row.$createdAt ?? ""),
    }));
}
