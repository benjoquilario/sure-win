/**
 * The two Functions `google-play-billing-v3.md` asks for, as plain functions.
 *
 *   `verifyAndApplyPurchase()`   Function 1 - the app reports a purchase
 *   `handlePlayNotification()`   Function 2 - Google reports a change
 *
 * Deliberately transport-free. Neither knows about HTTP, Appwrite Function
 * contexts, or Pub/Sub envelopes beyond the shape of the message, so the same
 * body serves a Next.js route handler here and an Appwrite Function in the
 * mobile repo. The wrapper's whole job is to establish *who is calling* and
 * hand over three fields.
 *
 * Everything money-related is one layer down, in `subscriptions.ts`, and
 * everything Google-related is in `google-play.ts`. This file is the seam.
 */

import { createHash } from "node:crypto";

import {
  acknowledgeSubscription,
  getPlayPackageName,
  getSubscriptionPurchase,
  GooglePlayError,
  toSubscriptionStatus,
  type VerifiedPurchase,
} from "@/lib/appwrite/google-play";
import {
  applyGooglePurchase,
  applyGoogleNotification,
  claimPlayNotification,
  finishPlayNotification,
  GOOGLE_NOTIFICATION,
} from "@/lib/appwrite/subscriptions";

export type VerifyPurchaseResult =
  | { ok: true; subscriptionId: string; created: boolean; expiresAt: string }
  | {
      ok: false;
      message: string;
      status: number;
      /**
       * The subscription's real state, when the refusal was *about* its state.
       *
       * Only on `409`. It saves the app a round trip: a purchase refused for
       * being on hold is a screen that wants to say "on hold", and re-reading
       * the profile to find that out would be a second call for something this
       * one already knows.
       */
      subscriptionStatus?: string;
    };

/**
 * Function 1. Verifies a purchase with Google, then grants what it bought.
 *
 * `userId` comes from the caller's JWT and never from the request body. A
 * `userId` in the body would be a request to grant premium to whoever the
 * caller names, which is not a thing a purchase endpoint should be able to do.
 *
 * Safe to call repeatedly with the same token, because it has to be: the app
 * retries on next launch when the network drops after payment, and Play keeps
 * re-reporting an unacknowledged purchase until it is acknowledged. A second
 * call updates the row the first one made.
 */
export async function verifyAndApplyPurchase(input: {
  userId: string;
  purchaseToken: string;
  productId: string;
  orderId?: string;
  /**
   * What the app attached to the purchase, if it is willing to tell us
   * separately. Only used to produce a clearer message - the check that
   * matters compares Play's own copy against `userId`.
   */
  expectedObfuscatedAccountId?: string;
}): Promise<VerifyPurchaseResult> {
  if (!input.userId) {
    return { ok: false, message: "Not signed in.", status: 401 };
  }

  if (!input.purchaseToken || !input.productId) {
    return {
      ok: false,
      message: "purchaseToken and productId are both required.",
      status: 400,
    };
  }

  let purchase: VerifiedPurchase;

  try {
    purchase = await getSubscriptionPurchase(input.purchaseToken);
  } catch (error) {
    const message =
      error instanceof GooglePlayError
        ? error.message
        : "Could not reach Google to verify that purchase.";

    // A token Play does not recognise is the client's problem; anything else
    // is ours, and the app should retry rather than tell the member no.
    const status =
      error instanceof GooglePlayError && error.status === 404 ? 400 : 502;

    return { ok: false, message, status };
  }

  // The product the app claims must be the product Play says was bought.
  // Otherwise a cheap plan's token could be presented against an expensive one.
  if (purchase.productId && purchase.productId !== input.productId) {
    return {
      ok: false,
      message: "That purchase is for a different product.",
      status: 400,
    };
  }

  // The purchase must belong to the account asking for it. Without this, a
  // token lifted from another member's device - or simply shared - grants
  // premium to whoever posts it first.
  const ownershipProblem = checkOwnership(input.userId, purchase, input.expectedObfuscatedAccountId);

  if (ownershipProblem) {
    return { ok: false, message: ownershipProblem, status: 403 };
  }

  const status = toSubscriptionStatus(purchase.state);

  if (status === "expired" || status === "on_hold" || status === "paused") {
    return {
      ok: false,
      message: `That subscription is ${status.replace(/_/g, " ")}.`,
      status: 409,
      subscriptionStatus: status,
    };
  }

  // Acknowledge BEFORE granting, so the three-day refund clock is stopped even
  // if writing the rows then fails. The reverse order risks a member who has
  // access and a purchase Google refunds out from under them.
  let acknowledged = purchase.isAcknowledged;

  if (!acknowledged) {
    try {
      await acknowledgeSubscription(purchase.productId || input.productId, input.purchaseToken);
      acknowledged = true;
    } catch (error) {
      // Do not fail the request. The member paid, and access is the thing they
      // are owed; an unacknowledged purchase is caught by the alarm in
      // `pnpm appwrite:billing:check` while there are still days to fix it.
      console.error(
        "[billing] acknowledge failed for a purchase that is about to be granted:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const applied = await applyGooglePurchase({
    userId: input.userId,
    productId: purchase.productId || input.productId,
    purchaseToken: input.purchaseToken,
    orderId: purchase.orderId || input.orderId || "",
    autoRenewing: purchase.autoRenewing,
    isAcknowledged: acknowledged,
    expiresAt: purchase.expiresAt || undefined,
    basePlanId: purchase.basePlanId || undefined,
    offerId: purchase.offerId || undefined,
    linkedPurchaseToken: purchase.linkedPurchaseToken || undefined,
    obfuscatedAccountId: purchase.obfuscatedAccountId || undefined,
  });

  return {
    ok: true,
    subscriptionId: applied.subscriptionId,
    created: applied.created,
    expiresAt: purchase.expiresAt,
  };
}

/**
 * Whether this purchase belongs to this member.
 *
 * Play returns whatever the app attached at checkout. If the app attached
 * nothing the field is blank, and there is nothing to check - so this is a
 * check that only works once the app is setting the obfuscated account
 * identifier, which is why that is on the mobile list rather than optional.
 */
function checkOwnership(
  userId: string,
  purchase: VerifiedPurchase,
  expected?: string,
) {
  if (!purchase.obfuscatedAccountId) {
    // Nothing to compare against. Logged rather than refused: refusing would
    // break every purchase made by an app build that predates the change.
    console.warn(
      "[billing] purchase carries no obfuscatedExternalAccountId, so it cannot be tied to an account.",
    );
    return null;
  }

  const claimed = expected?.trim();

  if (claimed && claimed !== purchase.obfuscatedAccountId) {
    return "That purchase does not belong to this account.";
  }

  // The app derives the identifier from the account id, so the server can
  // recompute it and compare. Both forms are accepted because the raw id was
  // the obvious first implementation and is not wrong, only less private.
  const expectedForUser = obfuscatedAccountIdFor(userId);

  if (
    purchase.obfuscatedAccountId !== expectedForUser &&
    purchase.obfuscatedAccountId !== userId
  ) {
    return "That purchase does not belong to this account.";
  }

  return null;
}

/**
 * The identifier the app should attach to a purchase for a member.
 *
 * Stable, derived, and not the account id itself - Play can see this value,
 * and an Appwrite user id is a real identifier for a real person. A truncated
 * HMAC-shaped digest is enough to recognise our own members without handing
 * Google a way to correlate them.
 *
 * The app has to compute the same thing. Exported so there is one definition
 * rather than two that drift.
 */
export function obfuscatedAccountIdFor(userId: string) {
  if (!userId) {
    return "";
  }

  // Play caps this at 64 characters; a sha256 hex digest is exactly 64.
  return createHash("sha256").update(`surewin:${userId}`).digest("hex");
}

export type NotificationResult = {
  ok: boolean;
  handled: boolean;
  reason?: string;
};

type PubSubEnvelope = {
  message?: { data?: string; messageId?: string; publishTime?: string };
  subscription?: string;
};

type DeveloperNotification = {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string;
  subscriptionNotification?: {
    notificationType?: number;
    purchaseToken?: string;
    subscriptionId?: string;
  };
  oneTimeProductNotification?: { purchaseToken?: string; sku?: string };
  voidedPurchaseNotification?: { purchaseToken?: string; orderId?: string };
  testNotification?: { version?: string };
};

/**
 * Function 2. Applies one Real-Time Developer Notification.
 *
 * **Always resolves.** Pub/Sub retries anything that is not a 2xx for seven
 * days, so the caller should answer 200 to everything this returns and only
 * let a genuine crash produce a 500. A message that cannot be applied is
 * recorded as `failed` in `billing_notifications` and dealt with by a person;
 * asking Google to redeliver it forever does not help.
 */
export async function handlePlayNotification(
  envelope: PubSubEnvelope,
): Promise<NotificationResult> {
  const encoded = envelope?.message?.data;
  const messageId = envelope?.message?.messageId ?? "";

  if (!encoded) {
    return { ok: true, handled: false, reason: "No message data." };
  }

  let notification: DeveloperNotification;

  try {
    notification = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8"),
    ) as DeveloperNotification;
  } catch {
    return { ok: false, handled: false, reason: "Message data is not JSON." };
  }

  // A message about somebody else's app is not ours to act on.
  try {
    const expected = getPlayPackageName();

    if (notification.packageName && notification.packageName !== expected) {
      return {
        ok: true,
        handled: false,
        reason: `Ignored a notification for ${notification.packageName}.`,
      };
    }
  } catch {
    // No package configured. Carry on rather than dropping real notifications.
  }

  const subscription = notification.subscriptionNotification;
  const voided = notification.voidedPurchaseNotification;
  const purchaseToken =
    subscription?.purchaseToken ?? voided?.purchaseToken ?? "";

  const kind = notification.testNotification
    ? ("test" as const)
    : voided
      ? ("voided" as const)
      : notification.oneTimeProductNotification
        ? ("one_time" as const)
        : ("subscription" as const);

  // Claim first. Pub/Sub is at-least-once, and this is what makes the second
  // copy of a cancellation a no-op instead of a second cancellation.
  const claim = await claimPlayNotification({
    messageId,
    notificationType: subscription?.notificationType,
    notificationKind: kind,
    purchaseToken,
    productId: subscription?.subscriptionId,
    orderId: voided?.orderId,
    packageName: notification.packageName,
    publishedAt: notification.eventTimeMillis
      ? new Date(Number(notification.eventTimeMillis)).toISOString()
      : envelope.message?.publishTime,
    payload: notification,
  });

  if (!claim.claimed) {
    return { ok: true, handled: false, reason: claim.reason };
  }

  const notificationId = claim.notificationId;

  // The Play Console test message names no purchase and must change nothing.
  if (kind === "test") {
    await finishPlayNotification(notificationId, { status: "ignored" });
    return { ok: true, handled: false, reason: "Test notification." };
  }

  if (!purchaseToken) {
    await finishPlayNotification(notificationId, {
      status: "ignored",
      error: "No purchase token in the notification.",
    });
    return { ok: true, handled: false, reason: "No purchase token." };
  }

  try {
    // Ask Play for the current expiry rather than inferring one. A renewal
    // applied without it leaves the row active with last month's end date,
    // which reads as no access to somebody who has just been charged.
    let expiresAt: string | undefined;
    let autoRenewing: boolean | undefined;

    if (kind === "subscription") {
      try {
        const current = await getSubscriptionPurchase(purchaseToken);
        expiresAt = current.expiresAt || undefined;
        autoRenewing = current.autoRenewing;
      } catch (error) {
        // Not fatal. The status change still applies; only the date is lost,
        // and the next notification will carry it.
        console.warn(
          "[billing] could not re-read a purchase while applying a notification:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    const applied = await applyGoogleNotification({
      notificationType:
        subscription?.notificationType ??
        // A voided purchase has no type of its own; it means the same as
        // REVOKED, which is what the handler already knows how to apply.
        (voided ? GOOGLE_NOTIFICATION.REVOKED : 0),
      purchaseToken,
      expiresAt,
      autoRenewing,
    });

    if (!applied.ok) {
      await finishPlayNotification(notificationId, {
        status: "failed",
        error: applied.reason,
      });
      return { ok: false, handled: false, reason: applied.reason };
    }

    await finishPlayNotification(notificationId, {
      status: "applied",
      subscriptionId: applied.subscriptionId,
      userId: applied.userId,
    });

    return { ok: true, handled: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishPlayNotification(notificationId, {
      status: "failed",
      error: message,
    });
    return { ok: false, handled: false, reason: message };
  }
}
