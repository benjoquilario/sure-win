import { requireOptionalNativeModule } from "expo"
import type * as ExpoCrypto from "expo-crypto"
import type * as ExpoIap from "expo-iap"
import { Platform } from "react-native"

/**
 * ─── Billing's native modules, loaded only when the build has them ────────
 *
 * `expo-crypto` and `expo-iap` need native code that exists only in an app
 * binary built after they were added. On an older development build (or Expo
 * Go) they fail with "Cannot find native module 'ExpoCrypto'" /
 * "'ExpoIap'" — and they fail at different moments:
 *
 *   expo-crypto  throws as soon as the package is imported.
 *   expo-iap     imports fine, because it resolves its native module lazily
 *                through a Proxy, then throws on the first real call — which
 *                is the purchase listener the premium screen registers while
 *                it renders. Catching the import alone missed it.
 *
 * So the native module is checked for FIRST, with `requireOptionalNativeModule`,
 * which answers null instead of throwing. Only a build that actually contains
 * it gets the package at all. Without it, billing reports itself unavailable
 * and the rest of the app is untouched; installing a new build turns it on.
 *
 * `require` with a literal path is still bundled by Metro; only its evaluation
 * is deferred.
 */

type ExpoCryptoModule = typeof ExpoCrypto
type ExpoIapModule = typeof ExpoIap

/** Why Play Billing is off: wrong platform, or this build lacks the module. */
export type BillingUnavailableReason = "platform" | "build"

let cryptoModule: ExpoCryptoModule | null | undefined
let iapModule: ExpoIapModule | null | undefined

function hasNativeModule(name: string) {
  try {
    return requireOptionalNativeModule(name) != null
  } catch {
    return false
  }
}

function noteMissing(name: string) {
  // `info`, not `warn`: this is the expected state of an older dev build, and
  // a yellow LogBox box reads like a bug. The premium screen says it plainly.
  if (__DEV__) {
    console.info(
      `[billing] ${name} is not in this app build, so billing is off. Rebuild (eas build or npx expo run:android) to turn it on.`
    )
  }
}

export function loadExpoCrypto(): ExpoCryptoModule | null {
  if (cryptoModule === undefined) {
    if (!hasNativeModule("ExpoCrypto")) {
      noteMissing("ExpoCrypto")
      cryptoModule = null
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred on purpose, see above
        cryptoModule = require("expo-crypto") as ExpoCryptoModule
      } catch {
        noteMissing("ExpoCrypto")
        cryptoModule = null
      }
    }
  }

  return cryptoModule
}

/** Null off Android, and on a build without the Play Billing module. */
export function loadExpoIap(): ExpoIapModule | null {
  if (iapModule === undefined) {
    if (Platform.OS !== "android") {
      iapModule = null
    } else if (!hasNativeModule("ExpoIap")) {
      noteMissing("ExpoIap")
      iapModule = null
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred on purpose, see above
        iapModule = require("expo-iap") as ExpoIapModule
      } catch {
        noteMissing("ExpoIap")
        iapModule = null
      }
    }
  }

  return iapModule
}

export function getBillingUnavailableReason(): BillingUnavailableReason | null {
  if (Platform.OS !== "android") {
    return "platform"
  }

  return loadExpoIap() ? null : "build"
}
