# Google Play billing audit

Written 2026-10-29, against `1c381fc`. Read out of the code and checked against
the live Appwrite project (`pnpm appwrite:billing:check` plus read-only row
counts). Follows on from section 1 of
[remaining-work.md](../remaining-work.md#1-payments), which is still accurate
where this page does not contradict it.

The short version: the server side is mostly done but has four bugs to fix
before taking real money. The mobile app cannot take a payment yet, and none of
the Google setup exists.

> **Update, later on 2026-10-29.** The four bugs below are fixed in
> `apps/cms/lib/appwrite/billing.ts`, `subscriptions.ts` and
> `app/api/billing/verify/route.ts`. The mobile checkout is built on `expo-iap`
> (`apps/mobile/lib/billing/play-billing.ts`, `hooks/use-play-checkout.ts`,
> `hooks/use-restore-play-purchases.ts`, wired into `app/premium.tsx`), with
> launch-time restore, pending-payment handling and a Manage in Google Play
> link. What remains is the **Setup outside the code** list, a new EAS build
> (the app now has a native billing module), and the release blockers.

---

## Google Play Billing, not Google Pay

A premium subscription sold inside an Android app distributed on Play has to go
through **Google Play Billing**. Google Pay (the wallet) is not something to
integrate; it is one of the payment methods Play's own checkout sheet offers the
buyer, alongside cards and carrier billing. The code is already built for Play
Billing, which is correct.

## The flow, as designed

```
app: Subscribe
  -> Play checkout sheet                       (not built - see "Mobile")
  -> Play returns a purchaseToken
  -> POST {CMS}/api/billing/verify             apps/cms/app/api/billing/verify/route.ts
       Authorization: Bearer <Appwrite JWT>    member comes from the JWT, never the body
  -> purchases.subscriptionsv2.get             apps/cms/lib/appwrite/google-play.ts
  -> acknowledge (3-day refund deadline)
  -> write subscriptions + payments rows       apps/cms/lib/appwrite/subscriptions.ts
  -> sync user_profiles.isPremium / premiumUntil
  -> app re-reads the profile; premium unlocks

Google -> Pub/Sub push -> POST {CMS}/api/billing/notifications?token=...
  renewals, cancellations, grace period, on hold, refunds
```

## Where it stands

| Piece | State |
| --- | --- |
| Server: verify, acknowledge, notifications, upgrades, refunds | Written. Four bugs, below. |
| Mobile checkout | **Missing.** No Play Billing library installed; the button is a hard-coded `disabled` "Checkout coming soon" ([premium.tsx:395](../../apps/mobile/app/premium.tsx#L395)); [`verifyPurchase()`](../../apps/mobile/lib/billing/verify.ts#L101) is called by nothing. |
| CMS credentials | **None set.** `pnpm appwrite:billing:check` reports `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_PACKAGE_NAME` and `GOOGLE_PLAY_PUBSUB_TOKEN` all missing, so `/api/billing/verify` answers 503 and `/api/billing/notifications` refuses every message. |
| `subscription_plans` | **0 rows.** The Premium screen shows "Plans unavailable", and a real purchase would hit bug 2. |
| `subscriptions` | 2 rows, both `manual/active` (CMS grants). |
| `payments`, `billing_notifications`, `access_codes` | 0 rows each. |
| Package name | `com.surewin.mobile` in [app.json](../../apps/mobile/app.json) and [.env.billing.example](../../apps/cms/.env.billing.example) - they match. |
| Obfuscated account id | App ([account-id.ts](../../apps/mobile/lib/billing/account-id.ts)) and server ([billing.ts:232](../../apps/cms/lib/appwrite/billing.ts#L232)) both compute `sha256("surewin:" + userId)` - they match. |

---

## Bugs to fix before taking real money

### 1. A pending purchase grants premium

Play reports `SUBSCRIPTION_STATE_PENDING` for payment methods that settle later
(cash at a convenience store, some carrier billing). The buyer has not paid yet,
and may never.

- [billing.ts:125-134](../../apps/cms/lib/appwrite/billing.ts#L125) refuses only
  `expired`, `on_hold` and `paused`. `pending` (and `UNSPECIFIED`, which
  [google-play.ts:419](../../apps/cms/lib/appwrite/google-play.ts#L419) also maps
  to `pending`) falls through to acknowledge and grant.
- [subscriptions.ts:446](../../apps/cms/lib/appwrite/subscriptions.ts#L446)
  writes every new subscription as `status: "active"`, whatever Play said.
- [`stateGrantsAccess()`](../../apps/cms/lib/appwrite/google-play.ts#L425) is
  exactly the check that is missing, and nothing calls it.

**Fix:** refuse any state for which `stateGrantsAccess()` is false, before
acknowledging - `409` with `subscriptionStatus: "pending"` so the app can show
"payment pending". When the buyer pays, Play sends `SUBSCRIPTION_PURCHASED` and
the app's launch-time re-verify (see Mobile) grants it.

### 2. A member can be charged and get nothing

[billing.ts:141](../../apps/cms/lib/appwrite/billing.ts#L141) acknowledges the
purchase, then [billing.ts:156](../../apps/cms/lib/appwrite/billing.ts#L156)
calls `applyGooglePurchase`, which throws when no plan row matches the product
([subscriptions.ts:738](../../apps/cms/lib/appwrite/subscriptions.ts#L738)).
Nothing catches it: [verify/route.ts:89](../../apps/cms/app/api/billing/verify/route.ts#L89)
has no try/catch. Against today's empty `subscription_plans`:

1. member pays
2. Google is told the purchase was honoured - so it will **not** auto-refund
3. the grant throws, the route returns a bare 500
4. member has paid and has no access

**Fix:** look the plan up *before* acknowledging and return a JSON `503` if it
is missing, so the purchase stays unacknowledged (the app retries; Google
refunds after three days if nobody fixes it). Wrap the grant in the route so any
other failure is a JSON `502`/`503` the app reads as `retryLater`.

### 3. Renewals are never recorded as payments

`recordGoogleCharge` runs only from `applyGooglePurchase`
([subscriptions.ts:728](../../apps/cms/lib/appwrite/subscriptions.ts#L728),
[:768](../../apps/cms/lib/appwrite/subscriptions.ts#L768)). The `RENEWED`
branch of `applyGoogleNotification`
([subscriptions.ts:922](../../apps/cms/lib/appwrite/subscriptions.ts#L922))
moves `endsAt` but writes no `payments` row, and nothing ever passes
`kind: "renewal"`. Revenue figures would show month one and nothing after.

**Fix:** on `RENEWED` / `RECOVERED`, record a charge keyed by Play's
`latestOrderId` (renewals get a new order id, `GPA.…..0`, `..1`, …) with
`kind: "renewal"`. The unique index on `orderId` already makes a redelivered
notification harmless.

### 4. Test purchases count as revenue

`isTestPurchase` is read from Play
([google-play.ts:361](../../apps/cms/lib/appwrite/google-play.ts#L361)) and used
nowhere. License-tester purchases - which renew every few minutes - would be
written to `payments` at the full plan price.

**Fix:** flag them on the `payments` / `subscriptions` row, or skip
`recordGoogleCharge` for them, and exclude them from revenue reporting.

### Smaller

- **Ownership check is open.** A purchase with no `obfuscatedExternalAccountId`
  is allowed with a warning
  ([billing.ts:191](../../apps/cms/lib/appwrite/billing.ts#L191)). Deliberate
  while no app build sends it; make it a refusal once the checkout always does.
- **Amounts are the stored price, not the charged one.** `payments.amount` is
  `plan.price`, so regional pricing and intro offers are not reflected.
  `subscriptionsv2.get` does not return a price.
- **`DEFERRED` (type 9) is not applied.** It changes the expiry; the
  notification falls into `default` and `endsAt` is not moved.

---

## Mobile: the checkout that does not exist yet

- [ ] Install a Play Billing library - `react-native-iap` or `expo-iap` - and
      check it ships a Play Billing Library version Google currently accepts for
      new apps. Purchases only work in an EAS build, not Expo Go.
- [ ] Load the subscriptions from Play by product id and show **Play's**
      localized prices; the `subscription_plans` prices are for display only
      until then.
- [ ] Start checkout with `obfuscatedAccountIdAndroid` set from
      `getObfuscatedAccountId(userId)` - without it, bug-list item "ownership
      check is open" stays open.
- [ ] On a purchase update, call `verifyPurchase()` and act on each outcome
      (`granted` -> refetch the profile; `retryLater` -> keep the token;
      `invalid` / `wrongAccount` / `notActive` -> tell the member, never retry).
      **Let the server acknowledge.** Acknowledging on the device first removes
      the three-day safety net if the server then fails.
- [ ] On every launch, list owned purchases and re-verify any that are not
      acknowledged. This is what `retryLater` relies on: without it, a member
      whose network dropped after paying is refunded instead of upgraded.
- [ ] A "payment pending" state, for bug 1's case.
- [ ] A "Manage subscription" link to Play's subscription page.
- [ ] Replace the disabled "Checkout coming soon" button.

`BILLING_SANDBOX_ENABLED=1` on the CMS turns on
`/api/billing/verify/sandbox`, which checks the JWT for real and returns any
documented response on request, so all of the above can be built before Play
products exist. Leave it off in production.

---

## Setup outside the code, in order

- [ ] **Play developer account**, then a **payments (merchant) profile** with
      bank and tax details. Identity checks take days - start first.
- [ ] **Upload a build that includes the billing library** to an internal
      testing track. Play does not allow creating subscription products until
      one has been uploaded.
- [ ] **Create the subscriptions** `premium_monthly`, `premium_6months`,
      `premium_yearly`, each with a base plan matching the seeder
      (PHP 299 / 30 days, PHP 1,299 / 180 days, PHP 2,299 / 365 days -
      [seed-billing-plans.ts](../../apps/cms/scripts/seed-billing-plans.ts)).
      **Product ids are permanent and cannot be reused after deletion.**
- [ ] **Link a Google Cloud project** (Play Console -> Setup -> API access) and
      enable the Google Play Android Developer API.
- [ ] **Service account**: create it, download the JSON key, and grant it *View
      financial data* and *Manage orders and subscriptions* in Play Console.
      Permissions take up to 24 hours; a 401/403 before then is the wait, not a
      bug.
- [ ] **Pub/Sub**: create a topic; give
      `google-play-developer-notifications@system.gserviceaccount.com` the
      Pub/Sub Publisher role on it; create a push subscription to
      `https://<cms-host>/api/billing/notifications?token=<GOOGLE_PLAY_PUBSUB_TOKEN>`;
      register the topic in Play Console -> Monetize -> Monetization setup;
      send the test notification (it is recorded as `ignored`).
- [ ] **Set the three variables on the deployed CMS** - the Appwrite Sites
      environment, not only `apps/cms/.env` - then redeploy:
      `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (base64 of the key file),
      `GOOGLE_PLAY_PACKAGE_NAME=com.surewin.mobile`,
      `GOOGLE_PLAY_PUBSUB_TOKEN` (`openssl rand -hex 32`).
- [ ] **Seed the plans**: `pnpm appwrite:seed:plans` (dry run), then again with
      `--confirm`. Do this before any real purchase - see bug 2.
- [ ] **License testers** (Play Console -> Settings -> License testing), then an
      end-to-end test with test cards: buy, renew, cancel, refund, and a pending
      payment.
- [ ] **Schedule** `pnpm appwrite:expire` and `pnpm appwrite:billing:check`.
      Nothing runs them today - `.github/workflows/` has only `ci.yml` - so the
      unacknowledged-purchase alarm exists but nothing rings it.
- [ ] `pnpm appwrite:billing:check` comes back clean.

## Also blocking release

- **Account deletion.** Play requires it. The `account-delete` Function is not
  deployed (only three Functions exist live), and
  `EXPO_PUBLIC_APPWRITE_ACCOUNT_DELETE_FUNCTION_ID` is not set in
  `apps/mobile/.env`.
- **The `exam-questions` Function runtime.** Premium questions are served only
  through it, and on 2026-10-29 it was failing every call on the `node-26`
  runtime (`fetch failed`). It needs Node 22 and a redeploy - see
  [functions/exam-questions/README.md](../../functions/exam-questions/README.md).
  `premium-material-access` is on `node-26` too.
- **Play Console policy pages**: a privacy policy and the Data safety form,
  which has to declare purchase history.

---

## Suggested order

1. Start the Play Console account - it is the long pole.
2. Fix the four server bugs.
3. Build the mobile checkout against the sandbox endpoint.
4. Upload an internal test build -> create the products -> seed the plans ->
   credentials -> Pub/Sub.
5. End-to-end test with license testers.
6. Schedules and account deletion, then production.
