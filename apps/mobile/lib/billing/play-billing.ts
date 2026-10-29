import Constants from "expo-constants"
import type {
  ProductSubscriptionAndroid,
  Purchase,
  SubscriptionOffer,
} from "expo-iap"
import { Linking } from "react-native"

import type { SubscriptionPlan } from "../member/plans"
import { getObfuscatedAccountId } from "./account-id"
import {
  getBillingUnavailableReason,
  loadExpoIap,
  type BillingUnavailableReason,
} from "./native-modules"
import { verifyPurchase, type VerifyOutcome } from "./verify"

/**
 * ─── Google Play Billing ──────────────────────────────────────────────────
 *
 * The app's half of a purchase, and nothing more. Play runs the checkout and
 * hands back a token; the CMS verifies that token with Google, acknowledges
 * it and grants the membership (`apps/cms/lib/appwrite/billing.ts`). This
 * module never grants, never acknowledges, and never trusts its own reading
 * of a purchase — premium is whatever `user_profiles` says once the server
 * has answered.
 *
 * **The app deliberately does not acknowledge.** The server does, after it
 * has checked the purchase and before it grants. Acknowledging here first
 * would remove the three-day safety net: a purchase the server then failed to
 * record would never be refunded. So `finishTransaction` is not called for
 * subscriptions.
 *
 * Android only. iOS has no App Store products configured, so the premium
 * screen says so instead of offering a checkout that cannot open.
 *
 * `expo-iap` is never imported here except for types: it is loaded through
 * `native-modules.ts`, so an app build without it turns billing off instead
 * of crashing on launch.
 */

/** Android, on a build that includes the Play Billing module. */
export const isPlayBillingSupported = loadExpoIap() !== null

/** Null when billing works; otherwise why not, for the screen to say. */
export const playBillingUnavailableReason: BillingUnavailableReason | null =
  getBillingUnavailableReason()

export type { BillingUnavailableReason }

/** One plan, as Play will actually sell it. */
export type PlayOffer = {
  productId: string
  basePlanId: string | null
  /** What `requestPurchase` needs to open this exact base plan. */
  offerToken: string
  /** Localized, regional, and the amount actually charged. */
  formattedPrice: string
}

let connection: Promise<boolean> | null = null

/**
 * One store connection for the life of the app. Retried on the next call if
 * it failed, so a launch without Play Services does not poison every later
 * attempt.
 */
export function ensurePlayConnection(): Promise<boolean> {
  const iap = loadExpoIap()

  if (!iap) {
    return Promise.resolve(false)
  }

  if (!connection) {
    // Inside `then`, so even a synchronous throw from the native side lands in
    // the `catch` below instead of escaping to the caller.
    connection = Promise.resolve()
      .then(() => iap.initConnection())
      .then(Boolean)
      .catch(() => {
        connection = null
        return false
      })
  }

  return connection
}

function isAndroidSubscription(
  item: unknown
): item is ProductSubscriptionAndroid {
  const candidate = item as Partial<ProductSubscriptionAndroid> | null

  return (
    candidate?.platform === "android" &&
    candidate.type === "subs" &&
    Array.isArray(candidate.subscriptionOffers)
  )
}

/**
 * The plain base plan, not a promotional offer layered on it.
 *
 * A base plan's own offer has one pricing phase; free trials and intro prices
 * add more. Picking the single-phase one keeps the price on the button equal
 * to the price on the receipt, and `googleBasePlanId` narrows it when a
 * product carries more than one base plan.
 */
function pickBaseOffer(
  product: ProductSubscriptionAndroid,
  basePlanId: string | null
): SubscriptionOffer | null {
  const offers = product.subscriptionOffers.filter(
    (offer) =>
      Boolean(offer.offerTokenAndroid) &&
      (!basePlanId || offer.basePlanIdAndroid === basePlanId)
  )

  return (
    offers.find(
      (offer) => offer.pricingPhasesAndroid?.pricingPhaseList.length === 1
    ) ??
    offers[0] ??
    null
  )
}

/** The recurring price: the last pricing phase, after any intro phases. */
function recurringPrice(offer: SubscriptionOffer) {
  const phases = offer.pricingPhasesAndroid?.pricingPhaseList ?? []
  return phases[phases.length - 1]?.formattedPrice || offer.displayPrice
}

/**
 * Play's offers for the CMS plans, keyed by plan id.
 *
 * A plan missing from the result is one Play does not sell — the product id
 * is wrong, or it is not active in Play Console — and the screen must not
 * offer a checkout for it.
 */
export async function loadPlayOffers(
  plans: SubscriptionPlan[]
): Promise<Map<string, PlayOffer>> {
  const offers = new Map<string, PlayOffer>()
  const skus = [
    ...new Set(plans.map((plan) => plan.googleProductId).filter(Boolean)),
  ]

  const iap = loadExpoIap()

  if (!iap || skus.length === 0 || !(await ensurePlayConnection())) {
    return offers
  }

  const products = (
    (await iap.fetchProducts({ skus, type: "subs" })) ?? []
  ).filter(isAndroidSubscription)

  for (const plan of plans) {
    const product = products.find((item) => item.id === plan.googleProductId)
    const offer = product ? pickBaseOffer(product, plan.googleBasePlanId) : null

    if (product && offer?.offerTokenAndroid) {
      offers.set(plan.id, {
        productId: product.id,
        basePlanId: offer.basePlanIdAndroid ?? null,
        offerToken: offer.offerTokenAndroid,
        formattedPrice: recurringPrice(offer),
      })
    }
  }

  return offers
}

/**
 * Opens Play's checkout sheet. The outcome arrives on the purchase listeners,
 * not as this promise's value.
 *
 * The obfuscated account id is what lets the server refuse a token lifted
 * from somebody else's purchase (`checkOwnership` in billing.ts).
 */
export async function requestPlaySubscription(
  offer: PlayOffer,
  userId: string
) {
  const iap = loadExpoIap()

  if (!iap) {
    throw new Error("Google Play Billing is not available in this app build.")
  }

  const obfuscatedAccountId = await getObfuscatedAccountId(userId)

  await iap.requestPurchase({
    type: "subs",
    request: {
      google: {
        skus: [offer.productId],
        subscriptionOffers: [
          { sku: offer.productId, offerToken: offer.offerToken },
        ],
        obfuscatedAccountId,
      },
    },
  })
}

/** Sends one purchase to the CMS. Safe to repeat; the server is idempotent. */
export function reportPlayPurchase(
  purchase: Purchase,
  userId: string
): Promise<VerifyOutcome> {
  const orderId =
    "transactionId" in purchase
      ? (purchase.transactionId ?? undefined)
      : undefined

  return verifyPurchase({
    purchaseToken: purchase.purchaseToken ?? "",
    productId: purchase.productId,
    orderId,
    userId,
  })
}

export type RestoreResult = { granted: number; pending: number; found: number }

/**
 * Re-reports subscriptions Play says this device owns.
 *
 * Covers the one failure a checkout cannot: the network dropping between
 * paying and reporting. Play keeps an unacknowledged purchase in the owned
 * list, so the next launch finds it here and finishes the job. `force` also
 * re-reports acknowledged ones, for a member whose access is missing even
 * though Play says they paid (a grant that failed after acknowledging).
 */
export async function restorePlayPurchases(
  userId: string,
  options: { force?: boolean } = {}
): Promise<RestoreResult> {
  const result: RestoreResult = { granted: 0, pending: 0, found: 0 }
  const iap = loadExpoIap()

  if (!iap || !(await ensurePlayConnection())) {
    return result
  }

  const purchases = await iap.getAvailablePurchases()

  for (const purchase of purchases) {
    if (purchase.purchaseState === "pending") {
      result.pending += 1
      continue
    }

    if (purchase.purchaseState !== "purchased" || !purchase.purchaseToken) {
      continue
    }

    result.found += 1

    const acknowledged =
      "isAcknowledgedAndroid" in purchase && purchase.isAcknowledgedAndroid

    if (acknowledged && !options.force) {
      continue
    }

    const outcome = await reportPlayPurchase(purchase, userId)

    if (outcome.kind === "granted") {
      result.granted += 1
    }
  }

  return result
}

/**
 * Listens for checkout results. Returns the unsubscribe; a no-op on a build
 * without the module, where no checkout can have opened.
 */
export function subscribeToPlayPurchases(handlers: {
  onPurchase: (purchase: Purchase) => void
  /** Pass straight to `isPlayCancellation` / `describePlayError`. */
  onError: (error: unknown) => void
}) {
  const iap = loadExpoIap()

  if (!iap) {
    return () => {}
  }

  // Registered while a screen renders, so a failure here must not throw: that
  // is exactly how "Cannot find native module 'ExpoIap'" took the premium
  // screen down before the module was checked for up front.
  try {
    const updated = iap.purchaseUpdatedListener(handlers.onPurchase)
    const failed = iap.purchaseErrorListener(handlers.onError)

    return () => {
      updated.remove()
      failed.remove()
    }
  } catch {
    return () => {}
  }
}

/** True when the member backed out of Play's sheet — not an error to show. */
export function isPlayCancellation(error: unknown) {
  return loadExpoIap()?.isUserCancelledError(error) ?? false
}

/** A sentence a member can act on, for any checkout failure. */
export function describePlayError(error: unknown) {
  const iap = loadExpoIap()

  if (iap) {
    try {
      return iap.getUserFriendlyErrorMessage(
        error as Parameters<typeof iap.getUserFriendlyErrorMessage>[0]
      )
    } catch {
      // Fall through to the generic message.
    }
  }

  return error instanceof Error && error.message
    ? error.message
    : "Google Play could not complete the purchase. Try again."
}

/**
 * Play's own subscription page — the only place a member can cancel or
 * change a payment method. Falls back to the plain URL when no product is
 * known or the deep link is refused.
 */
export async function openPlaySubscriptions(productId?: string) {
  const packageName = Constants.expoConfig?.android?.package ?? undefined
  const iap = loadExpoIap()

  if (iap && productId && packageName) {
    try {
      await iap.deepLinkToSubscriptions({
        packageNameAndroid: packageName,
        skuAndroid: productId,
      })
      return
    } catch {
      // Fall through to the URL.
    }
  }

  await Linking.openURL(
    packageName
      ? `https://play.google.com/store/account/subscriptions?package=${packageName}`
      : "https://play.google.com/store/account/subscriptions"
  )
}
