# What is left to do

Written 2026-09-17, against `6827435`. Two questions: what does billing still
need, and what is the actual flow for getting content in. Everything here was
read out of the code; file:line references are so you can check any of it.

The short version: the CMS and the backend are essentially finished. What is
missing is almost entirely **outside** the code - Google Play console setup,
credentials, and one unwritten piece of the mobile app.

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

**The paywall does not protect anything yet.** `questions` is
`accessModel: "app_readonly"` (`packages/schema/src/schema.ts:2922`), which
resolves to `read("users")` - every signed-in member can read every row in the
paid bank, including `answerIndex` and `explanation`. The filtering in
`apps/mobile/lib/content/questions.ts:251` (`applyQuestionPaywall`) runs in the
app, so it is presentation, not enforcement. Anyone who queries Appwrite
directly gets the lot.

This is known and deliberate - Appwrite cannot express "readable only where
`isFree` is true", and locking the table would take the free samples down with
it. The fix is a Function that serves questions, which is listed as unbuilt.
Worth deciding on before charging for access, because it decides whether there
is anything to charge for.

**Account deletion blocks release.** Google Play requires a working deletion
path. The function exists (`functions/account-delete/`) but
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

Three routes, all funnelling through one validator (`parseQuestionRow`), so a
hand-typed question and an uploaded one are held to identical rules.

**Spreadsheet** (the main path) - `.xlsx`, `.xlsm`, `.csv`, `.tsv`, `.txt`.
`.xls` is rejected with "re-save as .xlsx first". Limits: 10 MB, 2000 rows per
file.

The intended loop is **download -> edit -> re-upload**: the export carries SKUs,
so the round trip updates in place rather than duplicating. Download from
`/api/questions/sheet?categoryId=...`. The generated workbook ships with
dropdowns on Type/Difficulty/Free Sample and a second sheet explaining each
column.

Columns (`spreadsheet.ts:75`):

| Header | Required | Notes |
| --- | --- | --- |
| `SKU` | no | **Never type one.** Blank = new question. Present = update that question. |
| `No` | no | Item number. Blank on a new row appends to the end. |
| `Question` | **yes** | Max 5000 chars. |
| `A` `B` `C` `D` `E` | A and B | Up to 8 accepted. A gap (B blank, C filled) is an error, not a silent shift. |
| `Answer` | **yes** | Letter, full choice text, or True/False. |
| `Type` | no | `mcq` or `true-false`. Blank = mcq. |
| `Difficulty` | no | easy/medium/hard. Blank = medium. |
| `Explanation` | no | Shown after answering. |
| `Image` | no | A link, or the `/api/assets/...` path from a CMS upload. |
| `Free Sample` | no | `yes` shows the item to non-premium members. |

Header matching ignores case, spacing and punctuation, and accepts aliases
(`question text`, `correct answer`, `rationale`, ...). Unknown columns are
warnings, not errors. Booleans accept `oo`/`opo`/`hindi`/`wala` as well as
yes/no.

Import is two-pass: upload previews the diff (created / updated / skipped),
then the same file is resubmitted to commit. **Any row-level error aborts the
whole file** - nothing is saved. Writes run 5 at a time and collect per-row
failures rather than throwing, so a network blip mid-upload still reports what
landed.

**Manual entry** - the "Add question" dialog, or "Add question here" from a
category or set page.

**Bulk text conversion** - `pnpm appwrite:sheet:from-appendices` turns a plain
text appendix into a spreadsheet. It writes a file and nothing else; you check
it and upload it normally. Everything comes out as multiple-choice / medium /
not-free, so it is meant to be edited first.

### Matching is by SKU, and the guide sheet says otherwise

The importer matches rows to existing questions **only** by SKU
(`questions.ts:736`). A row with a blank SKU always creates a new question,
whatever its item number.

Two places say the opposite:

- `workbook.ts:291` - the "How to fill this in" sheet inside every downloaded
  workbook: *"Item numbers (No) identify a question when you upload the file
  again: same number means update, new number means add."* This is wrong, and
  it is the sentence an encoder is most likely to read. Following it - typing
  item numbers into a fresh sheet and expecting updates - silently duplicates
  the entire paper.
- `questions.ts:692` - the doc comment above `planQuestionImport` makes the same
  claim, directly above code that does the opposite.

The on-screen copy in the import card is correct. **Worth fixing both lines
before more encoders use this.**

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
| encoder | Create and edit questions and material, import, upload media. Cannot delete or see members/billing. |
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

- `exam_categories.isPublished` - defaults **true**
- `questionnaires.isPublished` - defaults **false** (so a half-finished set
  never reaches students)
- `subjects` / `topics` / `learning_materials` - default true
- `questions` - **no publish column.** Individual questions cannot be held back;
  they go live with their category.

**`content.publish` and `questions.publish` are defined and granted to
moderators, but checked nowhere in the codebase.** `isPublished` is an ordinary
field gated by `*.edit` - so an encoder can publish, which contradicts the role
summary in `schema.ts:316`. Either wire the permission up or correct the
description.

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

**Appwrite Functions.** Three exist (`account-delete`,
`community-post-like-toggle`, `premium-material-access`) and each needs its own
env vars set in the console - they do not share the CMS's. Unbuilt and listed in
the notes: premium question access (see above), access code redemption, Play
purchase verification wrapper.

**Mobile env vars used in code but absent from `.env.example`:**
`EXPO_PUBLIC_APPWRITE_ACCOUNT_DELETE_FUNCTION_ID`,
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
2. Fix the two wrong lines about SKU matching (`workbook.ts:291`,
   `questions.ts:692`) - cheap, and prevents duplicated papers.
3. Create exam categories, upload questions, publish. None of this needs
   billing.
4. Decide on the `questions` paywall. It determines whether premium is worth
   selling.
5. Start the Play developer account - it gates everything else and takes the
   longest.
6. Wire account deletion; Play will not accept a release without it.
7. Play products -> `pnpm appwrite:seed:plans` -> service account -> Pub/Sub.
   **Plans seeded before the first real purchase.**
8. Add a Play Billing library to the app, call `verifyPurchase()`, enable the
   button.
9. Schedule `appwrite:expire` and `appwrite:billing:check`.
