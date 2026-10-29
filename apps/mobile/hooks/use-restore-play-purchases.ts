import { useEffect, useRef } from "react"
import { useAuth } from "@/contexts/auth-context"

import {
  isPlayBillingSupported,
  restorePlayPurchases,
} from "@/lib/billing/play-billing"
import { isBillingApiConfigured } from "@/lib/billing/verify"
import { getMembership } from "@/lib/member/membership"

/**
 * Finishes purchases a previous session could not, once per signed-in launch.
 *
 * A member can pay and lose the network before the app reports the token.
 * Play keeps that purchase unacknowledged and the server never heard of it;
 * left alone, Google refunds it after three days and the member never got
 * what they paid for. Running this on launch closes that gap.
 *
 * Waits for the profile so it knows whether the member already has access:
 * without it, only unacknowledged purchases are re-sent; with no access, every
 * owned subscription is, which also repairs a grant that failed after the
 * server acknowledged.
 */
export function useRestorePlayPurchases() {
  const userId = useAuth((state) => state.user?.$id ?? null)
  const hasProfile = useAuth((state) => state.profile !== null)
  const isPremium = useAuth((state) => getMembership(state.profile).isPremium)
  const refreshProfile = useAuth((state) => state.refreshProfile)
  const ranFor = useRef<string | null>(null)

  useEffect(() => {
    if (
      !isPlayBillingSupported ||
      !isBillingApiConfigured() ||
      !userId ||
      !hasProfile ||
      ranFor.current === userId
    ) {
      return
    }

    ranFor.current = userId

    restorePlayPurchases(userId, { force: !isPremium })
      .then((result) => {
        if (result.granted > 0) {
          void refreshProfile()
        }
      })
      .catch(() => {
        // Silent: the premium screen's Restore purchase button is the
        // visible path, and the next launch tries again.
      })
  }, [hasProfile, isPremium, refreshProfile, userId])
}
