# What is left to do

Written 2026-09-17, against `6827435`. Two questions: what does billing still
need, and what is the actual flow for getting content in. Everything here was
read out of the code; file:line references are so you can check any of it.

Updated 2026-09-26: the paywall Function, the publish permissions, the SKU
docs, safe moves and deletes, and the account-delete rewrite are done - each
section says what is fixed and what, if anything, is still waiting on a
rollout. Line numbers from the first pass may have drifted.

The short version: the CMS and the backend are essentially finished. What is
missing is almost entirely **outside** the code - Google Play console setup,
credentials, and one unwritten piece of the mobile app.

> Looking for how to actually upload questions? That is its own page, written
> for the people who do it: **[uploading-questions.md](uploading-questions.md)**.

---

## 1. Payments

### Where it actually stands

The server side is complete. `apps/cms/lib/appwrite/google-play.ts` (432 lines)
talks to the Play Developer API with a hand-rolled service-account JWT flow;
`billing.ts` and `subscriptions.ts` (1209 lines) handle verification, renewals,
refunds, upgrades and exactly-once Pub/Sub delivery. No stubs, no TODOs.

The mobile side cannot take a payment. There is **no Play Billing library
installed** - not `react-native-iap`, not `expo-in-app-purchases`, nothing - and
the checkout button is literally `disabled`:

```tsx
// apps/mobile/app/premium.tsx:258
<Button className="h-11 rounded-md" disabled>
  <Text>Checkout coming soon</Text>
</Button>
```

`apps/mobile/lib/billing/verify.ts` is written, correct, and **called by
nothing**. It is waiting for a purchase flow that does not exist yet.

### Credentials needed

Three required, one optional. Template with full notes:
`apps/cms/.env.billing.example`. None are currently set - `apps/cms/.env` has
zero `GOOGLE_PLAY` entries, so `/api/billing/verify` answers 503 today.

| Variable | What it is | Where to get it |
| --- | --- | --- |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Private key used to mint OAuth tokens for the Play Developer API. Raw JSON or base64 (base64 is safer - the key is mostly newlines). | Google Cloud Console -> IAM -> Service Accounts -> download JSON key |
| `GOOGLE_PLAY_PACKAGE_NAME` | `com.surewin.mobile`. Already matches `apps/mobile/app.json`. Permanent once published. | Play Console |
| `GOOGLE_PLAY_PUBSUB_TOKEN` | Shared secret in the Pub/Sub push URL. Pub/Sub cannot send an Appwrite session, so this authenticates the endpoint. | You invent it: `openssl rand -hex 32` |
| `BILLING_SANDBOX_ENABLED` | Optional. Turns on a mock verify endpoint that touches no database, so the app can build checkout before Play products exist. Leave off in production. | n/a |

Verify with `pnpm appwrite:billing:check`.

### Console setup, in order

Step 1 is the long pole - budget days, not hours.

1. **Play developer account** - US$25 plus identity checks.
2. **Merchant account** in Play Console (bank and tax details).
3. **Link a Cloud project**: Play Console -> Setup -> API access. Enable the
   Google Play Android Developer API.
4. **Create the service account**, download the JSON.
5. **Grant it Play permissions**: *View financial data* and *Manage orders and
   subscriptions*. This takes **up to 24 hours to take effect** -
   `google-play.ts:285` emits that exact message on a 401/403, so a failure
   here looks like a bug but is just the wait.
6. **Create the subscription products.** IDs the seeder expects:
   `premium_monthly`, `premium_6months`, `premium_yearly`. **Product IDs are
   permanent and cannot be reused after deletion** - create them in the console
   before seeding anything.
7. **Seed the plan rows**: `pnpm appwrite:seed:plans` (dry run by default),
   then again with `--confirm`.
8. **Pub/Sub topic** in Google Cloud; grant Google's publisher account rights on
   it; register the topic in Play Console -> Monetize -> Monetization setup.
9. **Push subscription** pointing at
   `https://<cms-host>/api/billing/notifications?token=<GOOGLE_PLAY_PUBSUB_TOKEN>`.
10. Set the three variables on the CMS host and re-run the check script.

Not needed: the Play licensing key (server-side verification supersedes it), and
any other payment provider - digital goods must go through Play Billing.

### Three things to fix before taking real money

**Seed the plans first - this one costs money if you get it wrong.**
`applyGooglePurchase` throws when no plan row matches the Play product
(`subscriptions.ts:740`), and nothing catches it
(`billing.ts:156`, `verify/route.ts` has no try/catch). The purchase is
**acknowledged before** the grant (`billing.ts:143`, deliberately - it stops the
3-day refund clock). So against an empty `subscription_plans` table the sequence
is: member pays -> Google is told the purchase is good -> the grant throws ->
member gets a 500 and no access, and the acknowledgement means it will not
auto-refund. `subscription_plans` is empty today.

**The paywall - fixed in code, not yet rolled out.** It used to protect
nothing: `questions` was `app_readonly`, so every signed-in member could read
the whole paid bank, `answerIndex` and `explanation` included, and the app's
own filtering was presentation, not enforcement. Appwrite cannot express
"readable only where `isFree` is true, or where the reader pays", so the table
could not simply be locked without taking the free samples down with it.

That Function now exists: `functions/exam-questions/`. It runs with its own API
key, serves only published categories and sets, and gives a member without
active premium the `isFree` rows of a premium category and nothing else. The
schema has moved `questions` to `accessModel: "server_only"` (see the comment
on the table in `packages/schema/src/schema.ts`), so once bootstrapped, the
Function is the only way in. **The order matters**, because bootstrapping
removes `read("users")` and breaks any build still reading the table directly:

1. Deploy `functions/exam-questions` and note its id.
2. Set `EXPO_PUBLIC_APPWRITE_EXAM_QUESTIONS_FUNCTION_ID`, ship the build that
   reads through the Function, and let it be adopted.
3. Only then `pnpm appwrite:bootstrap`.

Until step 3 the paywall is still the old one.

**Account deletion blocks release.** Google Play requires a working deletion
path. `functions/account-delete/` has been rewritten: it now removes the
member's rows from every member table (sessions, answers, progress, stats,
achievements, bookmarks, blocks, likes, posts and their threads, comments,
replies, reports, roles, both profiles) and keeps only the financial records
and the staff audit trail - see its README. It was also moved to
`node-appwrite` 22, the SDK the rest of the repo uses; the old `^14.1.0` pin
predates the `TablesDB` API the function calls. (`community-post-like-toggle`
and `premium-material-access` got the same bump.) What still blocks release:
`EXPO_PUBLIC_APPWRITE_ACCOUNT_DELETE_FUNCTION_ID` is unset, so the app cannot
call it.

### Also missing

- Nothing runs `pnpm appwrite:expire` or `pnpm appwrite:billing:check` on a
  schedule. `.github/workflows/` has only `ci.yml`. The 3-day unacknowledged
  purchase alarm exists but nothing rings it.
- No purchase-restore on launch. `verify.ts` is written to be retried on next
  launch; no launch hook calls it.
- Ownership checking is open by design until the app sends the digest: a blank
  `obfuscatedAccountId` logs a warning and **allows** the purchase
  (`billing.ts:191`). Inert today because nothing calls the endpoint.

---

## 2. Content flows

### The shape of it

Two independent trees. They do not connect, and the schema says not to connect
them (`schema.ts:2646`).

```
Questions                          Reading material
---------                          ----------------
exam_categories   (required)       subjects   (STEP 1)
  |-- questionnaires  (optional)     |-- topics   (STEP 2)
  |     \__ questions                      \__ learning_materials  (STEP 3)
  \__ questions  (questionnaireId = "")
```

**To add a question, the only thing that must exist is an exam category.** Sets
are for categories that split into Set A / Set B; most never use them. The UI
says so when the table is empty (`question-import-card.tsx:202`).

Note `questionnaireId` is `""` for a question directly under a category, not
null - Appwrite stores unset optional strings as empty, so `Query.isNull` never
matches. Query `Query.equal("questionnaireId", "")`.

### Getting questions in

**The encoder's guide is [uploading-questions.md](uploading-questions.md).**
What follows is only what a developer needs to know about the mechanism.

Three routes - spreadsheet upload, the manual "Add question" dialog, and the
`appwrite:sheet:from-appendices` text converter - all funnel through one
validator (`parseQuestionRow`), so hand-typed and uploaded questions are held to
identical rules.

The import is two-pass. The browser uploads once to preview the diff, then
resubmits the same file to commit; nothing is parked server-side between the
two. Any row-level error aborts the whole file. Writes run 5 at a time and
collect per-row failures rather than throwing, so a connection drop mid-upload
still reports what landed. An import never deletes.

Matching is **by SKU only** (`questions.ts:736`). A blank SKU always creates.
Updates never touch `sku` or `order`, so re-sorting the sheet cannot renumber a
paper. New SKUs come from a high-water mark read from both `questions.sku` and
`user_answers.questionSku`, so emptying a category cannot reissue a SKU that
would inherit a deleted question's answer history.

Concurrency safety rests on a unique index on
`(categoryId, questionnaireId, order)` - `createQuestionWithSku` retries on 409
rather than serialising. Counts on `exam_categories` and `questionnaires` are
recounted, never incremented.

### SKU matching is now documented correctly (fixed)

Two places used to say item numbers identify a question on re-upload: the "How
to fill this in" tab inside every downloaded workbook (`workbook.ts`), and the
doc comment above `planQuestionImport` (`questions.ts`). Following the workbook
- typing item numbers into a fresh sheet - silently duplicated the paper. Both
now say what the code and the import card say: the SKU is the only match, a
blank SKU creates, and the No column is reading order only.

Item numbers are also parsed strictly now. `"1.5"` used to become 15 and `"-3"`
became 3; anything but a whole number from 1 to 100000 (a trailing `.0` from an
Excel numeric cell is fine) is now a row error on the No column.

### Moving and deleting (fixed)

- **Deleting a category or set is refused while anything is in it** - a set
  with questions, a category with sets or questions - with a message saying
  how many. It is refused rather than cascaded on purpose: one click should not
  take a paper's SKUs and answer history with it. Counts are live queries, not
  the cached counters.
- **Moving a question** to another set or category takes the next free item
  number there (or the number typed, if the editor changed it and it is free),
  retries on a 409 like an import does, and recounts both the old and the new
  place. A set that is not in the chosen category is an error, not silently
  dropped.
- **Moving a set** to another category is allowed only while it is empty; it
  gets the next free letter in its new category and both categories are
  recounted. A set with questions is refused.
- Counters and other read-only fields are no longer echoed back by the record
  form, and the server ignores them if they are sent.

### Images

`QuestionEditor` uploads to `/api/assets/upload` (needs `media.upload`, images
only, 8 MB cap, bucket auto-created with antivirus on). What is stored on the
question is the **relative** `/api/assets/<fileId>` path, not a full URL, so
images survive moving between environments. The mobile app prefixes
`EXPO_PUBLIC_CMS_BASE_URL` to resolve them - **unset that and every image
renders blank**.

One caveat: `GET /api/assets/[fileId]` has no auth check. That is deliberate
(the app fetches images without a CMS session), but it means any uploaded asset
is readable by anyone with the file ID.

### Who can do what

Six roles. `student` and `member` both have zero dashboard access.

| Role | Can |
| --- | --- |
| encoder | Create and edit questions and material, import, upload media. Cannot publish, unpublish, delete, or see members/billing. |
| moderator | Encoder plus delete, publish, moderate community, read members and billing. |
| admin | Everything except `members.delete` and `billing.grant`. |
| super_admin | Everything. Only role that can appoint admins. |

Enforced at four layers (sidebar, page guard, server action, API route) - server
actions re-check independently because they are reachable without loading the
page. Role comes from `user_roles` or an env email list, whichever is **higher**;
the env list is a floor the table can raise but never lower, so nobody with
`staff.manage` can lock the owner out. Set `APPWRITE_CMS_SUPER_ADMIN_EMAILS`
before going live.

### Publishing is a switch, not a workflow

There is no draft -> review -> approved pipeline. Each row has an `isPublished`
boolean:

- `exam_categories.isPublished` - defaults **false** (it used to default true,
  so an encoder's brand-new, empty category went live on save; existing rows
  keep what they store)
- `questionnaires.isPublished` - defaults **false** (so a half-finished set
  never reaches students)
- `subjects` / `topics` / `learning_materials` - default true
- `questions` - **no publish column.** Individual questions cannot be held back;
  they go live with their category.

**The publish permissions are wired up (fixed).** `saveCmsRecord` now requires
`questions.publish` to change `isPublished` on a category or set, and
`content.publish` on a subject, topic or material (`getPublishPermission` in
the schema). Only a *change* needs it - an encoder can still edit a live row -
and creating a row already visible counts as a change. For someone without it,
the form locks the switch, starting new rows hidden, so the defaults above do
not trip them up.

### Exam settings (schema only - the app does not read them yet)

- `exam_categories` and `questionnaires` have optional `timeLimitMinutes`
  (0-600; blank or 0 means the app's 0.6 minutes per item) and `passingScore`
  (1-100; blank means 75). On a set, blank means "use the category's".
- `study_sessions` has optional `questionLimit`, `timeLimitSeconds`,
  `questionSource`, `difficultyFilter`, `shuffleQuestions` and
  `shuffleChoices`, so an unfinished session can resume with exactly the
  settings it started with.

All are optional, so existing rows stay valid; they exist in Appwrite after the
next `pnpm appwrite:bootstrap`.

### What the app relies on

- `category.setCount` decides routing: `0` opens questions directly, `>0` shows
  the set picker. It counts published sets only. The CMS recomputes it on every
  upload and set change - do not hand-edit it.
- Every query needs an explicit `Query.limit`, or Appwrite silently returns 25
  rows.
- `order` is unique per (category, set) but has gaps and may not start at 1.
  Sort by it; never index an array with it.
- Filter `isPublished` at every level.

Full contract: `docs/schema/MOBILE-SCHEMA-NOTES-v6.md`.

---

## 3. Everything else outstanding

**Appwrite Functions.** Four exist (`account-delete`,
`community-post-like-toggle`, `exam-questions`, `premium-material-access`) and
each needs its own env vars set in the console - they do not share the CMS's.
Unbuilt and listed in the notes: access code redemption, Play purchase
verification wrapper.

**Mobile env vars used in code but absent from `.env.example`:**
`EXPO_PUBLIC_APPWRITE_ACCOUNT_DELETE_FUNCTION_ID`,
`EXPO_PUBLIC_APPWRITE_EXAM_QUESTIONS_FUNCTION_ID` (new - the `exam-questions`
Function; see the rollout order under Payments),
`EXPO_PUBLIC_APPWRITE_ANDROID_PACKAGE`, `EXPO_PUBLIC_APPWRITE_IOS_BUNDLE_ID`,
`EXPO_PUBLIC_APPWRITE_WEB_PLATFORM`, `EXPO_PUBLIC_APP_SCHEME`. The EAS
production profile sets none of the Appwrite variables either - they have to
come from EAS environment variables or a build ships with empty config.

**Lint fails**: 20 errors in the CMS (mostly
`components/editor/tiptap-rich-text-field.tsx`), 15 in mobile. All React
Compiler correctness rules - "Cannot create components during render", "Calling
setState synchronously within an effect". Pre-existing, not from the
restructure. CI runs lint `continue-on-error: true`, so it is not blocking
anything today.

**Empty tables**: `subscription_plans` (blocks purchases, see above) and
`announcements` (the app shows placeholder news data until the first real one).

**Password recovery** is unconfigured - needs SMTP and a redirect URL in the
Appwrite console.

**Dead config**: `row-table.tsx:46` lists a `mode` column for `questionnaires`,
which has no such field. Silently dropped, so the Sets table renders one column
fewer than intended.

---

## Suggested order

1. Set `APPWRITE_CMS_SUPER_ADMIN_EMAILS` and deploy the CMS, so there is a way
   in.
2. ~~Fix the two wrong lines about SKU matching~~ - done.
3. Create exam categories, upload questions, publish (a moderator or above
   publishes). None of this needs billing.
4. Roll out the `questions` paywall in the order under Payments: deploy
   `exam-questions`, ship the app with its function id, then bootstrap.
5. Start the Play developer account - it gates everything else and takes the
   longest.
6. Wire account deletion; Play will not accept a release without it.
7. Play products -> `pnpm appwrite:seed:plans` -> service account -> Pub/Sub.
   **Plans seeded before the first real purchase.**
8. Add a Play Billing library to the app, call `verifyPurchase()`, enable the
   button.
9. Schedule `appwrite:expire` and `appwrite:billing:check`.
