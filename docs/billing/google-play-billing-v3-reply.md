# Google Play Billing — reply to v3

**For:** the mobile app
**From:** the dashboard / CMS backend
**Re:** `google-play-billing-v3.md`

**Both Functions are built.** They live in the CMS repo as HTTP endpoints, the
Play Developer API client that neither of them had is written, and the parts of
your test matrix that do not need a Play account pass — 25 assertions, against
the real handlers and the real database.

What is left is not code. It is a Play developer account, three environment
variables, and the plan rows.

---

## Contents

1. [What was built](#1-what-was-built)
2. [Your test matrix, run](#2-your-test-matrix-run)
3. [How the app calls Function 1](#3-how-the-app-calls-function-1)
4. [The obfuscated account identifier — we need to agree on this](#4-the-obfuscated-account-identifier--we-need-to-agree-on-this)
5. [Function 2 and Pub/Sub](#5-function-2-and-pubsub)
6. [What is still blocked, and on whom](#6-what-is-still-blocked-and-on-whom)
7. [Two corrections to v3](#7-two-corrections-to-v3)

---

## 1. What was built

| Piece | Where | State |
| --- | --- | --- |
| Play Developer API client | `lib/appwrite/google-play.ts` | **New.** Verify, acknowledge, OAuth2 |
| Function 1 body | `lib/appwrite/billing.ts` → `verifyAndApplyPurchase()` | **New** |
| Function 2 body | `lib/appwrite/billing.ts` → `handlePlayNotification()` | **New** |
| Function 1 endpoint | `POST /api/billing/verify` | **New** |
| Function 2 endpoint | `POST /api/billing/notifications` | **New** |
| Test harness | `pnpm appwrite:billing:test` | **New** |
| Config alarm | `pnpm appwrite:billing:check` | Extended |

### The part that did not exist anywhere

v2 and v3 both described the Functions as "wiring, not a build", because
`applyGooglePurchase()` and `applyGoogleNotification()` were already written.
That was true of the *database* half and not of the other one: **nothing in this
repo had ever talked to Google.** There was no code to exchange a service
account for a token, none to call `subscriptionsv2.get`, and none to
acknowledge — which is the call with the three-day refund deadline on it.

That is `lib/appwrite/google-play.ts` now. No SDK: `googleapis` is a large
generated client for two HTTP calls, and the service-account flow is a signed
JWT exchanged for a bearer token, which is about forty lines of `node:crypto`.
Fewer moving parts on the path where money changes hands.

### The logic is transport-free on purpose

`verifyAndApplyPurchase()` and `handlePlayNotification()` know nothing about
HTTP. If you would rather Function 1 were a real Appwrite Function so the app
can call it through the SDK, that wrapper is about fifteen lines and calls the
same function with the same three fields — say the word and it is done. The HTTP
endpoint exists either way, because **Function 2 has to be a plain public URL**:
Pub/Sub push cannot execute an Appwrite Function.

---

## 2. Your test matrix, run

`pnpm appwrite:billing:test --confirm`. It creates an inactive plan and a fake
member, runs the matrix against the real handlers and the real database, and
deletes everything it made.

| Case | Result |
| --- | --- |
| First purchase | **PASS** — subscription + payment rows, `purchaseTokenHash` populated |
| Same token verified twice | **PASS** — one row updated, not two created |
| Notification delivered twice | **PASS** — refused by the `messageId` unique index |
| Cancel | **PASS** — `autoRenewing` false, status stays `active` |
| Card declined | **PASS** — `in_grace_period`, access continues |
| Retries exhausted | **PASS** — `on_hold`, access ends |
| Refund | **PASS** — row kept, charge marked refunded, `refundedAt` set |
| Plan upgrade | **PASS** — replaced subscription closed via `linkedPurchaseTokenHash` |
| Renewal | **PASS** (covered by the grace/renewal notification paths) |
| Token replayed from another account | **SKIPPED** — needs a licence tester |

Verification and acknowledgement against Play are also skipped, for the same
reason: they need a real Play account. They are the only two paths in the whole
system that have never been executed, and they are the two we cannot execute
until Phase 0 is done.

---

## 3. How the app calls Function 1

```
POST /api/billing/verify
Authorization: Bearer <appwrite jwt>       ← account.createJWT()
Content-Type: application/json

{ "purchaseToken": "...", "productId": "premium_monthly", "orderId": "GPA...." }
```

```jsonc
// 200
{ "ok": true, "subscription": { "id": "...", "created": true, "expiresAt": "2026-10-01T..." } }

// 4xx / 5xx
{ "ok": false, "message": "That purchase is for a different product." }
```

The member comes from the JWT. A `userId` in the body is ignored, because a
purchase endpoint that accepts one is a request to grant premium to whoever the
caller names.

### The status codes are meant to be acted on

| Code | Meaning | What the app should do |
| --- | --- | --- |
| `200` | Granted | Re-read `user_profiles`; `isPremium` is true |
| `400` | Play does not know that token, or it is for another product | Do not retry. Something is wrong with the purchase |
| `401` | JWT missing or expired | Refresh the JWT and retry once |
| `403` | The purchase belongs to another account | Do not retry. See §4 |
| `409` | The subscription is expired, on hold or paused | Do not retry. Send them to the paywall |
| `502` | We could not reach Google | **Retry later.** The member has paid; this is our problem, not theirs |
| `503` | Play verification is not configured on the server | **Retry later.** This is us not being finished |

**`502` and `503` are the ones that matter.** They mean the member has been
charged and we have not recorded it. Retry on next launch — Play keeps
re-reporting an unacknowledged purchase, so the token is still there, and the
handler is safe to call twice. That path is tested.

---

## 4. The obfuscated account identifier — we need to agree on this

v3 §"It must" asks us to check `obfuscatedExternalAccountId` against the JWT
user. We do. But the check can only work if both sides compute the same value,
and v3 does not say what it should be — so here is our proposal, and it needs a
yes from you.

The server computes:

```ts
sha256(`surewin:${userId}`).toString('hex')     // 64 hex chars
```

exported as `obfuscatedAccountIdFor(userId)` from `lib/appwrite/billing.ts`.
Play caps the field at 64 characters and a sha256 hex digest is exactly 64.

**Set that as the obfuscated account id when you launch the billing flow.** Not
the raw Appwrite user id and not the email: Play can see this value, and an
account id is a real identifier for a real person.

Right now the server accepts either that digest **or** the raw `userId`, so an
early build that sends the plain id still works. A purchase carrying *neither*
is logged and allowed through, because refusing would break every purchase made
by a build that predates this — which means **until the app sets it, the
replay-from-another-account protection is not active.** It is one line at your
end and it is the only thing standing between a shared purchase token and a free
membership.

If you would rather derive it differently, tell us and we will match you. The
requirement is only that both sides agree.

---

## 5. Function 2 and Pub/Sub

```
POST https://<cms-host>/api/billing/notifications?token=<GOOGLE_PLAY_PUBSUB_TOKEN>
```

That URL goes in the Pub/Sub **push subscription**. The topic name goes in Play
Console → Monetize → Monetization setup.

Pub/Sub cannot send an Appwrite session, so the endpoint is authenticated with a
shared secret in the query string, compared in constant time. Every message is
also checked against `GOOGLE_PLAY_PACKAGE_NAME` before anything is applied, and
the Play Console test message is recorded and ignored.

**It answers 200 to almost everything, deliberately.** Pub/Sub retries any
non-2xx for seven days, so a message that cannot be applied is recorded as
`failed` in `billing_notifications` and acknowledged — redelivering it would
fail identically. A `500` is reserved for the one case where a retry genuinely
helps: we could not even write the message down.

`GET` the same URL with the token to check reachability before wiring Pub/Sub up.

### Renewals re-read the expiry

v3 did not mention this and it is worth knowing: an RTDN carries no expiry date.
Function 2 calls `subscriptionsv2.get` itself to fetch the current one, because a
renewal applied without it leaves the subscription `active` with last month's end
date — which reads as *no access* to somebody who has just been charged. If that
call fails the status change is still applied and only the date is lost.

---

## 6. What is still blocked, and on whom

Nothing on this list is code.

| | Blocked on | Why it stops everything |
| --- | --- | --- |
| **Play developer account** | Whoever owns the business | US$25 and identity checks, which can take days. Longest pole; start it first |
| **Subscription products, activated** | Play account holder | A draft product is invisible to the app. Product IDs are permanent and cannot be reused after deletion |
| **Service account + JSON key** | Play account holder | Set as `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. Grant *View financial data* and *Manage orders and subscriptions*, and expect up to 24 h before it takes effect |
| **Pub/Sub topic + push subscription** | Backend | Set `GOOGLE_PLAY_PUBSUB_TOKEN` and point the push endpoint at the URL above |
| **Plan rows** | Dashboard | Still **zero**, verified against the live database. `pnpm appwrite:seed:plans` writes three once the product IDs are real |

The three environment variables are in `.env.billing.example`.
`pnpm appwrite:billing:check` names whichever are missing, and it now reports
configuration *first* — because "zero unacknowledged purchases" is not good news
on a system that cannot take a payment at all.

### Your §"Also on the queue"

- **`EXPO_PUBLIC_APPWRITE_ACCOUNT_DELETE_FUNCTION_ID`** — you are right that Play
  requires a working deletion path, and it is worth raising that this blocks
  *release*, not just the feature. The Function is yours; we have nothing to
  configure for it.
- **Premium question access (request 3)** — still open, and still the item that
  decides whether any of this is worth building. `questions` is `app_readonly`,
  so a paywall over it protects revenue on paper only.
- **Password recovery (2)** and **access code redemption (7)** — unchanged.

---

## 7. Two corrections to v3

Small, and neither changes what you build.

**§"Mobile-side items 1 and 2 are done" is your claim, not a shared fact.** We
cannot see the mobile repo, so grace-period handling and the enum fix are
recorded as done on your word. Worth a screenshot of the membership screen in
the three failure states before release, because the grace-period copy is the
one place where a bug charges a customer and tells them they have been cut off.

**The status codes in §"Contract" are underspecified.** v3 gives
`{ ok: false, message }` with no codes, which leaves the app unable to tell
"this purchase is invalid, stop" from "we could not reach Google, try again".
Those need different behaviour, so the table in §3 above is what we implemented.
If it does not suit the app, it is cheap to change.

---

## Critical path, restated

1. **Play developer account** — pure waiting; start it today.
2. **Products in Play Console**, activated.
3. **Plan rows** pointing at those product IDs.
4. **Three environment variables** on the CMS host.
5. **Pub/Sub topic and push subscription.**
6. **Set the obfuscated account id in the app** (§4) — one line, and it is what
   makes a stolen token worthless.

Steps 1 to 3 are somebody signing up and typing. Steps 4 and 5 are
configuration. Step 6 is yours. **There is no remaining backend code on the
critical path.**
