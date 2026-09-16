# Google Play Billing — audit and integration runbook

What the app already does with subscriptions, what is genuinely missing, the order
to build the rest in, and every credential Google will ask for.

> **Superseded by [`google-play-billing-v2.md`](google-play-billing-v2.md).** This
> document was written before the billing audit and still says the schema
> migration is pending; it has since been applied. Kept for its Play Console
> walkthrough and credential list, which are unchanged. Where the two disagree,
> v2 is right.

Companion to [`MOBILE-SCHEMA-NOTES-v6.md` §6 and §24](MOBILE-SCHEMA-NOTES-v6.md) —
that document specifies the contract; this one is the plan for meeting it.

---

## Contents

1. [Status at a glance](#1-status-at-a-glance)
2. [What the app does today](#2-what-the-app-does-today)
3. [What the backend still needs](#3-what-the-backend-still-needs)
4. [Managing plans from the dashboard](#4-managing-plans-from-the-dashboard)
5. [What one purchase actually does](#5-what-one-purchase-actually-does)
6. [Build order](#6-build-order)
7. [Credentials Google will ask for](#7-credentials-google-will-ask-for)
8. [Choosing the client library](#8-choosing-the-client-library)
9. [Start here](#9-start-here)

---

## 1. Status at a glance

| | |
| --- | --- |
| Tables ready | **5** — `subscription_plans`, `subscriptions`, `payments`, `access_codes`, `billing_notifications` |
| Entitlement logic | **Done** |
| Server-side purchase handlers | **Written** (in the CMS repo) |
| IAP libraries installed | **0** |
| Plans authored | **0 rows** — confirmed empty; `pnpm appwrite:seed:plans` writes the first three |
| Schema migration | **Pending** — run `pnpm appwrite:bootstrap --confirm` |
| Backend endpoints missing | **2** — verification, notifications |

The billing groundwork is in better shape than the disabled checkout button
suggests. The data model, the entitlement rules, and the server-side purchase
handlers all exist. What is missing sits almost entirely at the two edges: **the
app cannot talk to Play, and Google cannot talk back to you.**

---

## 2. What the app does today

| Piece | Where | State |
| --- | --- | --- |
| **Plan catalogue** — product IDs, price, duration, features, ordering | `subscription_plans` | ✅ Built |
| **Purchase records** — `purchaseToken`, `orderId`, `productId`, `autoRenewing`, `isAcknowledged` | `subscriptions` | ✅ Built |
| **Entitlement check** — date *and* flag, so a lapse ends access immediately | `hooks/use-membership.ts` | ✅ Built |
| **Verify & apply a purchase** — checks the token with Google, writes rows, re-syncs the profile | `applyGooglePurchase()` | ✅ Built |
| **Handle renewals & refunds** | `applyGoogleNotification()` | ✅ Built |
| **Plans authored in the dashboard** | CMS → Billing | ❌ Empty |
| **Play Billing client** — nothing in the app can open a checkout | `package.json` | ❌ Absent |
| **Checkout button** | `app/premium.tsx:258` | ❌ Stub |
| **Verification endpoint** — Function wrapper around the handler that exists | Appwrite Function | ⚠️ Wiring |
| **Notification endpoint** — where Google posts renewals and refunds | HTTP + Pub/Sub | ⚠️ Wiring |

### Nothing else matters until plans exist

`subscription_plans` has **zero rows** — checked against the live database, not
inferred from the notes — and the premium screen renders whatever is in that
table. Until somebody authors the plans, a finished checkout would still have
nothing to sell.

This is no longer a question to answer, but it is still the thing that gates
everything downstream. See §3 for the two ways to author them.

### A separate exposure worth scheduling

`questions` is still `app_readonly`, so any signed-in member can read the whole
paid bank — prompt, choices, `answerIndex`, explanation. The client-side
`Query.equal('isFree', true)` filter stops the app leaking it; it does not stop
anyone who goes looking.

This is not a billing bug, but it is the reason billing is worth less than it
should be, so it belongs on the same plan.

---

## 3. What the backend still needs

### Tables: one new, and one index that billing cannot work without

The four billing tables have been there from the start, and this section used to
say nothing more was needed. That was almost right — and wrong in one place that
would have taken the whole flow down.

| Table | Access model | Holds |
| --- | --- | --- |
| `subscription_plans` | `app_readonly` | What can be bought |
| `subscriptions` | `server_private` | One purchased period of access — the source of truth |
| `payments` | `server_only` | One row per charge |
| `access_codes` | `server_only` | Redeemable codes |
| `billing_notifications` | `server_only` | **New.** Every message Google sent |

Everything below is in `lib/appwrite/schema.ts` and applied by
`pnpm appwrite:bootstrap --confirm`. All four existing billing tables are empty
today, so the migration is additive and carries no data risk — which stops being
true the moment the first person buys something, so run it before that.

#### The one that was broken

`subscriptions.purchaseToken` **had no index**, and both handlers look rows up by
it:

```ts
Query.equal('purchaseToken', [token])   // applyGooglePurchase
Query.equal('purchaseToken', [token])   // applyGoogleNotification
```

Appwrite needs an index to filter on a column. Every purchase and every renewal
notification arrives carrying the token and nothing else, so without
`idx_subscription_token` the first real purchase fails at the point where access
is granted — after the member has paid. It is now **unique**, which is also what
makes re-applying the same purchase update one row instead of granting two.

#### `subscriptions` — columns added

| Column | Why |
| --- | --- |
| `linkedPurchaseToken` | An upgrade or resubscribe arrives as a **new** token pointing at the old one. Play does not close the old subscription; the server has to, or the member holds two |
| `basePlanId`, `offerId` | One product can carry monthly and yearly base plans, and the product ID alone does not say which was bought |
| `obfuscatedAccountId` | What the app attached to the purchase. Verification compares it against the JWT, so a token lifted from another device grants nothing |
| `acknowledgedAt` | When the server acknowledged — against `createdAt`, how close to the three-day deadline it ran |
| `latestNotificationAt` | Pairs with the existing `latestNotificationType`. A subscription that should be renewing and has heard nothing for weeks is a broken webhook |

`status` gained `in_grace_period`, `on_hold` and `paused`. The RTDN handler was
ignoring types 5, 6 and 10 entirely, which meant **a member whose card stopped
working kept full access** until the nightly sweep noticed the date. The cached
`user_profiles.subscriptionStatus` keeps its five values and the new ones fold
into them, so nothing in the app changes.

#### `subscriptions` — indexes added

| Index | Backs |
| --- | --- |
| `idx_subscription_token` (unique) | Every purchase lookup. The one above |
| `idx_subscription_linked_token` | Closing the subscription an upgrade replaced |
| `idx_subscription_acknowledged` | The refund alarm — one query, `pnpm appwrite:billing:check` |

#### `payments`

`refundedAt`, and `idx_payment_token` so a refund notification — which names a
token, not an order — can find the charges to mark. The unique
`idx_payment_order` is untouched: it is what makes Play's redelivered
notifications safe to retry without inflating revenue.

#### `billing_notifications` — the new table

`payments.orderId` already stops a charge being counted twice. But most
notifications carry no charge at all — a cancellation, an expiry, a grace period
— and Pub/Sub is **at-least-once**, so nothing was stopping those from being
applied again and again.

Every message is written here first, keyed on Google's `messageId` with a unique
index. A second copy of one already recorded is dropped before it reaches the
subscription. `claimPlayNotification()` and `finishPlayNotification()` are the
pair to call around the handler.

The duller reason is the one that comes up more often: when a member says *I
paid and I do not have access*, the first question is whether Google ever told
you. Without this table nobody knows.

### Rows: author the plans

`subscription_plans` has zero rows — **checked against the live database, not
assumed**. This is the one piece of *data* missing.

Either author them in the dashboard, or run the seed script and edit from there:

```bash
pnpm appwrite:seed:plans              # dry run, changes nothing
pnpm appwrite:seed:plans --confirm    # apply
```

It writes Monthly / 6 Months / Yearly with `premium_monthly`,
`premium_6months` and `premium_yearly` as the product IDs. **Edit
`scripts/seed-billing-plans.ts` to match whatever you actually created in Play
Console before running it with `--confirm`** — a Play product ID is permanent
and cannot be reused after deletion, so the name is worth five minutes now.

It is idempotent and never overwrites: a plan whose `googleProductId` already
exists is left exactly as it is, so re-running after somebody has edited the
marketing copy in the dashboard does not undo their work.

Per plan, the required fields are:

| Field | Required | Notes |
| --- | --- | --- |
| `name` | ✅ | Shown on the card, e.g. "Premium Monthly" |
| `googleProductId` | ✅ | **Must match the Play Console product ID exactly.** Uniquely indexed |
| `price` | ✅ | Whole pesos — `299` means ₱299, no centavos. A placeholder; Play's price is what is charged |
| `durationDays` | ✅ | `30` monthly, `365` yearly. Drives the "per month" / "per year" copy |
| `currency` | | Defaults to `PHP` |
| `isRecurring` | | Defaults to `true`. Set false for a one-off |
| `features` | | String list rendered as the bullet points |
| `order` | | Defaults to `1`. Card order on the screen |
| `isPopular` | | Defaults to `false`. Badges one card |
| `isActive` | | Defaults to `true`. Turn off to retire a plan; existing subscribers keep working |
| `code`, `description` | | Optional |
| `subscriberCount` | | Server-maintained — do not set by hand |

> The plan cannot be authored until the Play Console product exists, because
> `googleProductId` has to point at something real. Phase 1 before this.

### Functions: two to build

Both wrap logic that is **already written** in the CMS repo. This is wiring, not a
build.

| # | Function | Wraps | Trigger |
| --- | --- | --- | --- |
| 1 | Purchase verification | `applyGooglePurchase()` | Called by the app after checkout |
| 2 | Notification webhook | `applyGoogleNotification()` | HTTP POST from Google Pub/Sub |

**Purchase verification** — contract fixed in `MOBILE-SCHEMA-NOTES-v6.md`:

```
in    { purchaseToken, productId, orderId }
out   { ok: true, subscription }  |  { ok: false, message }
user  from the JWT, never from the body
```

It must verify the token against `purchases.subscriptionsv2.get` **and**
acknowledge the purchase before returning. Needs the service account JSON as an
environment variable.

**Notification webhook** — a plain HTTP endpoint Google can POST to. Must be
reachable publicly and must tolerate re-delivery, since Pub/Sub is at-least-once.

Once the verification Function exists, expose its ID to the app as
`EXPO_PUBLIC_APPWRITE_PURCHASE_VERIFY_FUNCTION_ID` and register it in
`lib/appwrite.ts` beside `communityPostLikeFunctionId`,
`premiumMaterialAccessFunctionId`, and `accountDeleteFunctionId`.

### Also outstanding, from `BACKEND-REQUESTS.md`

Not billing, but the same backend queue and tracked in §19 of the schema notes:

| # | Ask | Why it matters |
| --- | --- | --- |
| 2 | Password recovery — SMTP + redirect URL | Console configuration; no code can substitute for it |
| 3 | Premium question access Function | `questions` stays `app_readonly` until this exists, so the paid bank is readable by any signed-in member. **This is what makes the subscription worth paying for** |
| 7 | Access code redemption Function | `redeemAccessCode()` is written; only the wrapper is missing |

Request 3 is worth pairing with the billing work. Shipping a paywall over content
that is already readable protects revenue on paper only.

---

## 4. Managing plans from the dashboard

**Yes** — for everything except the price actually charged, and the product's
existence. Those two belong to Google, and no dashboard can own them.

Every subscription is defined in **two places that must agree**. Play Console owns
the product and the money; the CMS owns how the plan is presented. The join is
`googleProductId`, uniquely indexed so one Play product can never map to two plans.

| Field | Owned by | Why |
| --- | --- | --- |
| `googleProductId` | Play Console → mirrored in CMS | The product must exist in Play first; the CMS row points at it |
| **Price charged** | Play Console | Localized and regionally priced; Play's string is the real amount |
| `price` | CMS | A placeholder for reporting and the instant before Play answers |
| `name`, `description`, `features` | CMS | Marketing copy, editable without a release |
| `isPopular`, `order` | CMS | Which card is highlighted, and the order they appear in |
| `isActive` | CMS | Retires a plan from the screen; existing subscribers keep working |
| `durationDays` | CMS, must match Play | Drives "per month" / "per year" copy and the saving calculation |

So: create the product in Play Console **once**, then everything a member reads —
name, blurb, feature list, which plan is badged, card order, whether it is offered
at all — is dashboard work from then on, **with no app release**.

Changing a **price** means changing it in Play Console. Editing the CMS `price`
only changes your own reporting figure and the placeholder shown for the moment
before Play responds.

---

## 5. What one purchase actually does

Worth reading before building anything, because two of these steps are
non-negotiable and both are easy to skip and never notice.

| # | Who | What |
| --- | --- | --- |
| 1 | App | Read active plans from `subscription_plans`, ordered by `order` |
| 2 | App → Play | Query product details for each `googleProductId`. Render **Play's** formatted price, not the stored one |
| 3 | App → Play | Launch the billing flow. Google shows its own sheet and takes the payment |
| 4 | App → Server | On the purchase listener, send `{ purchaseToken, productId, orderId }`. User comes from the **JWT**, never the body |
| 5 | Server → Google | **Required.** Verify against `purchases.subscriptionsv2.get`, then call `applyGooglePurchase()` |
| 6 | Server → Google | **3-day deadline.** Acknowledge the purchase |
| 7 | Server | Write `subscriptions`, re-sync the cached fields on the profile |
| 8 | App | Re-read the profile. `isPremium` is now true and the paywall lifts |

### Step 5 is not optional

A purchase token posted by a client is a **claim, not a fact** — anyone can post
one. It must be verified server-side before it grants anything.

### Step 6 is a deadline

**Google automatically refunds any purchase not acknowledged within three days.**
`subscriptions.isAcknowledged` records that the server did it.

> Put an alarm on this. Any active subscription with `isAcknowledged` false is
> money on its way back to the customer. It is the single most useful alarm on this
> system and it costs one query.

The alarm exists now:

```bash
pnpm appwrite:billing:check
```

Read-only. It lists active purchases Google has not been acknowledged for —
ignoring anything under a day old, since those may still be in flight — and any
notification that failed to apply. It exits non-zero when either list is
non-empty, so it can be a cron job that only speaks up when something is wrong.
`idx_subscription_acknowledged` is what keeps it to one query.

### Renewals, cancellations, refunds

Real-Time Developer Notifications, handled by `applyGoogleNotification()`:

| Type | Means | Effect |
| --- | --- | --- |
| `2` RENEWED | Charged again | `endsAt` extended, renewal recorded |
| `3` CANCELED | Auto-renew turned off | **Access continues** until `endsAt` |
| `13` EXPIRED | Period ended | `status: expired` |
| `12` REVOKED | Refunded / charged back | `status: refunded`, access ends now |

**Cancelling is not losing access.** The model already gets this right, and it is
worth protecting in review: a member who turns off auto-renew paid for the period
and keeps it until `endsAt`. Only *expired* or *revoked* ends access early. Read
`autoRenewing` to choose between "Renews on…" and "Access ends…", not `status`.

---

## 6. Build order

Sequenced because of real dependencies, not preference. Products cannot be created
before an app is uploaded; the app cannot see products before it is on a track;
testing cannot happen before testers are enrolled.

### Phase 0 — Get a signed build onto a track · *Play Console*

- [ ] Pay the one-time **US$25** developer registration and complete account checks. New accounts may face extra verification taking days — **start here**.
- [ ] Create the app with package name `com.surewin.mobile` (already set in `app.json`).
- [ ] Build a signed release AAB and upload to **Internal testing**. The `with-release-signing` plugin already handles the upload key.
- [ ] Complete the declarations Play blocks release on — privacy policy, data safety, content rating, target audience.

### Phase 1 — Create the subscription products · *Play Console*

- [ ] **Monetize → Subscriptions → Create subscription.** The product ID is permanent and cannot be reused after deletion — choose carefully, e.g. `premium_monthly`.
- [ ] Add a **base plan** (billing period, renewal type) and set prices, including the Philippines.
- [ ] **Activate** both the subscription and its base plan. A product left in draft is invisible to the app.
- [ ] Author a matching row in the CMS with the same `googleProductId`, plus name, features, ordering.

### Phase 2 — Open the Play Developer API · *Play Console + Google Cloud*

- [ ] **Play Console → Setup → API access.** Link a Google Cloud project.
- [ ] In Google Cloud, enable the **Google Play Android Developer API**.
- [ ] Create a **service account**, then create and download a **JSON key**.
- [ ] Back in Play Console, grant that service account email *View financial data* and *Manage orders and subscriptions*.
- [ ] Permission changes can take up to **24 hours** to take effect. Expect a delay before verification calls succeed.

### Phase 3 — Wrap the handlers in a Function · *Backend*

- [ ] New Appwrite Function following the existing pattern in `functions/`.
- [ ] Contract, per `MOBILE-SCHEMA-NOTES-v6.md`: `{ purchaseToken, productId, orderId }` in; `{ ok, subscription }` or `{ ok: false, message }` out; **userId from the JWT**.
- [ ] Store the service account JSON as a Function environment variable. It never ships in the app.
- [ ] Pass Play's `basePlanId`, `offerId`, `linkedPurchaseToken` and `obfuscatedExternalAccountId` from `subscriptionsv2.get` straight into `applyGooglePurchase()` — the columns are there, and `linkedPurchaseToken` is what closes the subscription an upgrade replaced.
- [ ] Compare `obfuscatedExternalAccountId` against the user in the JWT. A token is a claim; this is what makes it a claim about the right person.
- [ ] Expose the ID as `EXPO_PUBLIC_APPWRITE_PURCHASE_VERIFY_FUNCTION_ID` and register it in `lib/appwrite.ts` beside the other three.

### Phase 4 — Wire the app to Play · *Mobile*

- [ ] Add an IAP library (§7) and its config plugin, which adds the `com.android.vending.BILLING` permission.
- [ ] Replace the disabled button at `app/premium.tsx:258` with a real purchase flow.
- [ ] Show Play's formatted price once product details resolve.
- [ ] Handle the states that are not "success": pending, cancelled, already owned, and network failure *after* payment.
- [ ] **Rebuild the dev client** — this adds native code, so a Metro reload is not enough.

### Phase 5 — Let Google tell you about renewals · *Backend + Play Console*

- [ ] Create a **Pub/Sub topic** in the linked Cloud project; grant Google's publisher account rights to publish to it.
- [ ] Add a **push subscription** pointing at an HTTP endpoint that calls `applyGoogleNotification()`.
- [ ] Enter the topic name in **Play Console → Monetize → Monetization setup**.
- [ ] Wrap the handler in the dedup pair: `claimPlayNotification()` before, `finishPlayNotification()` after. A claim that comes back `{ claimed: false }` has already been handled — return 200 and stop, or Pub/Sub keeps retrying a message you have applied.
- [ ] **Fetch the expiry and pass it as `expiresAt`.** The notification does not carry one, so the webhook has to call `subscriptionsv2.get` itself. A renewal applied without it leaves the subscription `active` with last month's end date — which reads as no access to somebody who has just been charged.
- [ ] Reject any message whose `packageName` is not `com.surewin.mobile`, and ignore the Play Console test message — it names no purchase and must change nothing.
- [ ] Redelivery is normal — Pub/Sub is at-least-once. `idx_payment_order` makes charges safe to retry, and `idx_notification_message` makes everything else safe.

### Phase 6 — Test without spending money · *Play Console*

- [ ] **Setup → License testing.** Add the Google accounts that will test; their purchases are not charged.
- [ ] Testers must also be on the internal testing track **and** have accepted the opt-in link.
- [ ] Install **from Play**, not by sideloading — billing only works for a Play-delivered build.
- [ ] Test renewals on Play's accelerated timers, then the paths that actually break: refund, cancel-then-resubscribe, and a purchase that succeeds while the phone loses signal before the server hears about it.

---

## 7. Credentials Google will ask for

Grouped by where each comes from. **Only the first group belongs anywhere near the
app**; everything else is server-side or console configuration.

### In the app

| Credential | Notes |
| --- | --- |
| Package name | `com.surewin.mobile` — already set, permanent once published |
| Upload key | The keystore read from `~/.gradle/gradle.properties` by `with-release-signing`. Losing it means you cannot ship updates |
| Billing permission | `com.android.vending.BILLING` — added by the IAP library's config plugin, not by hand |
| Product IDs | Not secret. They arrive from `subscription_plans` at runtime, so adding a plan needs no release |

> **No API key belongs in the app.** Everything that can grant membership lives on
> the server. If a credential would let a client mark itself premium, it is in the
> wrong place.

### Server only — never in the repo

| Credential | Notes |
| --- | --- |
| Service account JSON | Downloaded once from Google Cloud. Grants the right to read and acknowledge purchases. Store as a Function environment variable — it is a bearer credential for your revenue |
| Service account email | `name@project.iam.gserviceaccount.com`. This is what you grant permissions to in Play Console |
| Cloud project ID | The project linked under Play Console → Setup → API access |
| Pub/Sub topic | `projects/<project>/topics/<topic>`, entered in Monetization setup |

### Play Console configuration

| Item | Notes |
| --- | --- |
| Developer account | US$25 once, plus identity verification. **The slowest item — start it first** |
| Merchant account | Required to be paid. Bank details, tax information, payments profile |
| Permissions | Service account needs *View financial data* and *Manage orders and subscriptions* |
| License testers | Google accounts that can buy without being charged |
| Declarations | Privacy policy URL, data safety form, content rating, target audience. Release is blocked without them |

### What you do *not* need

| Item | Why not |
| --- | --- |
| Licensing key | The base64 RSA key in Monetization setup is for on-device signature checks. Verifying server-side against the Developer API supersedes it, and is stronger |
| A payments provider | No Stripe, PayPal, or GCash. Google takes the payment and remits to you — in-app digital goods must use Play Billing |
| A subscriptions service | RevenueCat and similar exist to build what you already have. `applyGooglePurchase()` and `applyGoogleNotification()` are written; paying a revenue percentage to replace them is a step backwards |

---

## 8. Choosing the client library

None are managed by the Expo SDK, so none are version-pinned by `npx expo install`
— whichever you pick, pin it yourself and expect to test it against each SDK
upgrade.

| Package | Latest | Notes |
| --- | --- | --- |
| `expo-iap` | 5.5.0 | Actively released; declares an `expo` peer; no extra native peer dependency. **Closest fit for this project** |
| `react-native-iap` | 16.5.0 | Same maintainers, equally current, but pulls `react-native-nitro-modules` as a peer — more native surface to keep working |
| `react-native-purchases` | 10.8.1 | RevenueCat. Solid, but duplicates the backend you already have and charges on revenue |
| `expo-in-app-purchases` | 14.5.0 | The old Expo module. Its version no longer tracks the SDK and it is absent from Expo's bundled module list — **treat as legacy** |

*(Versions checked against npm on 2026-09-01.)*

`expo-iap` is the one to try first. Verify it builds against SDK 57 and the New
Architecture in a throwaway branch before committing — it adds native code, so the
cost of finding out late is a rebuild, not an edit.

---

## 9. Start here

1. **Begin the Play developer account registration.** It is the longest pole and it
   is pure waiting, so it should be running while you do everything else.
2. **Run `pnpm appwrite:bootstrap --confirm`.** It applies the new table, the
   columns, and — the one that matters — the missing index on `purchaseToken`.
   Every billing table is empty today, so this is free right now and stops being
   free the moment somebody buys something.

`subscription_plans` **is** empty; that has been checked against the live
database, so it is no longer a question to answer. Seeding it is Phase 1, after
the Play products exist, because `googleProductId` has to point at something
real.

Everything else is code you control, and most of the hard half is already
written.
