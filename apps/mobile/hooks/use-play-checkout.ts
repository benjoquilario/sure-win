import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@/contexts/auth-context"

import {
  describePlayError,
  isPlayBillingSupported,
  isPlayCancellation,
  loadPlayOffers,
  playBillingUnavailableReason,
  reportPlayPurchase,
  requestPlaySubscription,
  restorePlayPurchases,
  subscribeToPlayPurchases,
  type PlayOffer,
} from "@/lib/billing/play-billing"
import type { VerifyOutcome } from "@/lib/billing/verify"
import type { SubscriptionPlan } from "@/lib/member/plans"

/**
 * ─── The premium checkout ─────────────────────────────────────────────────
 *
 * Drives one screen's purchase: loads Play's offers for the CMS plans, opens
 * the checkout, reports the result to the CMS, and refreshes the profile when
 * the server grants. The member is premium when `user_profiles` says so —
 * never because this hook saw a purchase.
 *
 *   unsupported  not Android, so there is no Play to buy from
 *   connecting   reaching Play and loading prices
 *   ready        offers loaded; checkout can open
 *   unavailable  Play answered, but sells none of these plans
 *   purchasing   Play's sheet is open
 *   verifying    the server is checking the purchase
 *   pending      paid with a pay-later method; Google has not confirmed it
 *   failed       something went wrong — see `notice`
 */

export type CheckoutStatus =
  | "unsupported"
  | "connecting"
  | "ready"
  | "unavailable"
  | "purchasing"
  | "verifying"
  | "pending"
  | "failed"

export type CheckoutNotice = { tone: "info" | "error"; text: string }

const PENDING_NOTICE: CheckoutNotice = {
  tone: "info",
  text: "Your payment is pending. Premium unlocks as soon as Google confirms it.",
}

const RETRY_NOTICE: CheckoutNotice = {
  tone: "info",
  text: "Payment received. Activation did not finish yet — it will complete automatically, or tap Restore purchase.",
}

export function usePlayCheckout(plans: SubscriptionPlan[]) {
  const userId = useAuth((state) => state.user?.$id ?? null)
  const refreshProfile = useAuth((state) => state.refreshProfile)

  const [offers, setOffers] = useState<Map<string, PlayOffer>>(() => new Map())
  const [status, setStatus] = useState<CheckoutStatus>(
    isPlayBillingSupported ? "connecting" : "unsupported"
  )
  const [notice, setNotice] = useState<CheckoutNotice | null>(null)

  // Listeners outlive renders; they read the current user through a ref
  // rather than re-subscribing every time it changes.
  const userIdRef = useRef(userId)
  useEffect(() => {
    userIdRef.current = userId
  }, [userId])

  useEffect(() => {
    if (!isPlayBillingSupported || plans.length === 0) {
      return
    }

    let cancelled = false

    loadPlayOffers(plans)
      .then((loaded) => {
        if (!cancelled) {
          setOffers(loaded)
          setStatus(loaded.size > 0 ? "ready" : "unavailable")
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("unavailable")
        }
      })

    return () => {
      cancelled = true
    }
  }, [plans])

  const applyOutcome = useCallback(
    async (outcome: VerifyOutcome) => {
      switch (outcome.kind) {
        case "granted":
          // The profile is the entitlement. Re-reading it is what flips the
          // screen to "You're on Premium".
          await refreshProfile()
          setNotice(null)
          setStatus("ready")
          return
        case "retryLater":
          setNotice(RETRY_NOTICE)
          setStatus("failed")
          return
        case "notActive":
          if (outcome.status === "pending") {
            setNotice(PENDING_NOTICE)
            setStatus("pending")
            return
          }
          setNotice({ tone: "error", text: outcome.message })
          setStatus("failed")
          return
        default:
          setNotice({ tone: "error", text: outcome.message })
          setStatus("failed")
      }
    },
    [refreshProfile]
  )

  useEffect(() => {
    if (!isPlayBillingSupported) {
      return
    }

    return subscribeToPlayPurchases({
      onPurchase: (purchase) => {
        if (purchase.purchaseState === "pending") {
          setNotice(PENDING_NOTICE)
          setStatus("pending")
          return
        }

        const currentUserId = userIdRef.current

        if (purchase.purchaseState !== "purchased" || !currentUserId) {
          return
        }

        setNotice(null)
        setStatus("verifying")

        void reportPlayPurchase(purchase, currentUserId).then(applyOutcome)
      },
      onError: (error) => {
        if (isPlayCancellation(error)) {
          setStatus("ready")
          return
        }

        setNotice({ tone: "error", text: describePlayError(error) })
        setStatus("failed")
      },
    })
  }, [applyOutcome])

  const offerFor = useCallback(
    (planId: string) => offers.get(planId) ?? null,
    [offers]
  )

  const purchase = useCallback(
    async (plan: SubscriptionPlan) => {
      const offer = offers.get(plan.id)

      if (!offer || !userId) {
        return
      }

      setNotice(null)
      setStatus("purchasing")

      try {
        await requestPlaySubscription(offer, userId)
      } catch (error) {
        if (isPlayCancellation(error)) {
          setStatus("ready")
          return
        }

        setNotice({ tone: "error", text: describePlayError(error) })
        setStatus("failed")
      }
    },
    [offers, userId]
  )

  const restore = useCallback(async () => {
    if (!userId) {
      return
    }

    setNotice(null)
    setStatus("verifying")

    try {
      const result = await restorePlayPurchases(userId, { force: true })

      if (result.granted > 0) {
        await refreshProfile()
        setStatus("ready")
        return
      }

      if (result.pending > 0) {
        setNotice(PENDING_NOTICE)
        setStatus("pending")
        return
      }

      setNotice({
        tone: "info",
        text:
          result.found > 0
            ? "Your Google Play subscription was found, but it could not be activated. Try again shortly."
            : "No Google Play subscription was found for this device's Google account.",
      })
      setStatus(offers.size > 0 ? "ready" : "unavailable")
    } catch {
      setNotice({
        tone: "error",
        text: "Could not reach Google Play. Check your connection and try again.",
      })
      setStatus("failed")
    }
  }, [offers.size, refreshProfile, userId])

  return {
    isSupported: isPlayBillingSupported,
    /** `platform` off Android, `build` when this app build lacks billing. */
    unavailableReason: playBillingUnavailableReason,
    status,
    notice,
    offerFor,
    purchase,
    restore,
    /** True while a request is in flight; the checkout button stays locked. */
    isBusy:
      status === "connecting" ||
      status === "purchasing" ||
      status === "verifying",
  }
}
