# Social Work Reviewer CMS

Admin dashboard and backend control surface for the Social Work Reviewer mobile app. This project uses Next.js 16, Appwrite authentication, Appwrite TablesDB, and Appwrite Messaging for questionnaire content, review materials, and announcements.

## What This Implements

- Role-based dashboard access: Encoder, Moderator, Admin, and Super Admin, with per-permission checks on every page, action, and API route
- Email/password login plus OAuth entry points for Google and Microsoft
- Reviewer schema includes user profiles and roles
- Reviewer schema includes subjects, topics, and learning materials
- Reviewer schema includes exam categories, questionnaires, and questions
- Reviewer schema includes user answers, study progress, and learning achievements
- Reviewer schema includes community posts, comments, replies, and likes
- Reviewer schema includes announcements and flagged content for moderation
- Generic CRUD pages for every Appwrite table in the CMS schema
- Excel/CSV bulk import for questions, with a preview before anything is saved
- Email, SMS, and push notification dispatch through Appwrite Messaging
- A bootstrap script to create the Appwrite database, tables, columns, and indexes

## The Question Model

| Table | What one row is | Required? |
| --- | --- | --- |
| `exam_categories` | A subject area: name, and whether it is a quiz or a board exam | **Yes** |
| `questionnaires` | An optional lettered set (Set A, Set B, ...) inside a category | No |
| `questions` | One item: prompt, ordered choices, answer position, difficulty, type, optional explanation and image | |

**The category is the parent, not the set.** Real categories differ:

- *Human Behavior and Social Environment* is 100 questions and nothing else. It has no sets, and questions go straight into the category.
- *History, Social Conditions, Issues and CO Drill* splits into Set A, Set B, and Set C. Each set holds its own questions.

So `questions.categoryId` is required and `questions.questionnaireId` is optional; blank means "directly under the category". A category's question count includes its sets.

Two more rules make the rest work:

- **Questions never belong to a subject or topic.** Subjects and topics organize reading material; an exam item is its own artefact with its own lifecycle.
- **Identifiers are generated, never typed.** Every question gets a permanent SKU (`Q-000142`) on first save and keeps it forever, so answer history survives a re-import. Category and set codes are generated too when left blank.

## Adding Questions

**In bulk (the normal way).** Dashboard → **Upload questions**. Pick the category, pick a set only if that category has any, download the sheet, fill it in, upload it back:

- The download is `.xlsx` (with dropdowns and a guide sheet) or `.csv`, and it follows the mode: **Add** gives a blank sheet, **Update** gives the questions already there so you can edit them.
- One row per question. Choices go in their own columns, `A` through `E`; leave the later letters blank for shorter items. `Answer` is a letter, or the choice text, or True/False.
- There is no SKU column. SKUs are assigned on first save and never change.
- Uploading runs a check first: it reports every problem by row and column, and saves nothing until you confirm.

Every upload is **update-or-create, decided per row by its SKU**:

| The row's SKU | What happens |
| --- | --- |
| Filled in (came from a download) | That exact question is updated. Its item number does not move, whatever the `No` column says. |
| Empty | A new question is added at the end, and a SKU is minted for it. |
| Not in this destination | The row is skipped and reported, rather than duplicating whatever it meant to edit. |

There is no mode to choose. Item numbers cannot identify a question — they move the moment anyone sorts or renumbers a sheet — so matching on them meant a file numbered 1, 2, 3 could overwrite three questions its author had never seen.

Item numbers are unique per destination (`categoryId` + set + `order`), enforced by the database. Two people uploading at the same moment both compute the same next number; the index rejects the loser, which then takes the next one.

**One at a time.** The Questions page has an editor with a choice list, a radio button for the answer, and image upload. It runs the same validation as the importer.

**From an old text appendix.** Convert it to a fillable sheet instead of retyping:

```bash
pnpm appwrite:sheet:from-appendices -- --source=sw-foundation-appendices.txt
pnpm appwrite:sheet:from-appendices -- --format=xlsx --out=set-a.xlsx
```

Then upload the result to the right paper.

## Membership

The reviewer is paid, and **Google Play is the only payment method**.

| Table | One row is |
| --- | --- |
| `subscription_plans` | Something for sale: a Play product ID, a price in whole pesos, and how many days it lasts |
| `subscriptions` | One purchased period. **This decides who is premium** |
| `payments` | One charge Play reported: the first purchase and every renewal |
| `access_codes` | A prepaid code, independent of Play, that grants a plan without a charge |

`user_profiles.isPremium` is only a cached answer. Grant access by adding a subscription, never by flipping the flag — `syncMembershipFromSubscriptions` is the one thing that writes the cached fields.

Two rules the mobile app has to follow, both in `MOBILE-SCHEMA-NOTES-v6.md`:

- **Verify purchase tokens server-side** against the Play Developer API. A token from a client is a claim, not a fact.
- **Acknowledge within three days**, or Google automatically refunds the purchase.

Subscriptions that finish need sweeping, since nothing happens when a month simply runs out:

```bash
pnpm appwrite:expire     # run daily
```

Reads are safe in the meantime — `hasActivePremium` checks the expiry date, not just the flag.

## Environment Variables

Copy `.env.example` to `.env` and fill in the Appwrite values.

Required for the dashboard backend:

- `NEXT_PUBLIC_APPWRITE_ENDPOINT`
- `NEXT_PUBLIC_APPWRITE_PROJECT_ID`
- `APPWRITE_API_KEY`
- `APPWRITE_DATABASE_ID`

The way in before anybody has a role:

- `APPWRITE_CMS_SUPER_ADMIN_EMAILS`
- `APPWRITE_CMS_ADMIN_EMAILS`
- `APPWRITE_CMS_MODERATOR_EMAILS`
- `APPWRITE_CMS_ENCODER_EMAILS`

Comma-separated. Each grants that role to anyone signing in with a listed email, before the `user_roles` table is consulted at all.

Set `APPWRITE_CMS_SUPER_ADMIN_EMAILS` on a new install. Only a Super Admin can appoint another Super Admin, so an install with none can never grow one — to avoid that dead end, `APPWRITE_CMS_ADMIN_EMAILS` is treated as the Super Admin list while the super-admin list is empty, and the startup warnings say so.

These lists cannot be revoked from the dashboard. That is deliberate: they are the door that stays open when the one inside the app is locked.

## Appwrite Console Setup

1. Create or open your Appwrite project.
2. Add a Web platform for the CMS URL.
3. Make sure the platform hostname matches the origin you use locally, such as `http://localhost:3000`.
4. Add the dashboard callback URL to your OAuth provider configuration:
   - `http://localhost:3000/api/auth/callback` for local development
   - your production callback URL for deployed environments
5. Enable the auth providers you need:
   - Email/password
   - Google OAuth
   - Microsoft OAuth if you plan to use it

6. Create an API key with at least these scopes:
   - `databases.read`
   - `databases.write`
   - `rows.read`
   - `rows.write`
   - `users.read`
   - `messages.write`

7. Configure Messaging providers in Appwrite if you want SMS or push to work.

## Bootstrap The Schema

After filling `.env`, run:

```bash
pnpm appwrite:bootstrap
```

This creates the database if needed, then creates every table, column, and index in `lib/appwrite/schema.ts`, plus the storage bucket used for question images. It is idempotent: run it again any time the schema changes.

To see what is out of sync without changing anything:

```bash
pnpm appwrite:inspect
```

To remove tables and columns the schema no longer has — the step that clears out renamed columns and retired tables:

```bash
pnpm appwrite:bootstrap -- --prune            # lists what would be deleted
pnpm appwrite:bootstrap -- --prune --confirm  # deletes it
```

Pruning is two-step on purpose. Dropping a column drops its data, and a script cannot tell a retired table from a typo.

To repair rows that predate a required column:

```bash
pnpm appwrite:bootstrap -- --backfill            # lists what would be written
pnpm appwrite:bootstrap -- --backfill --confirm  # writes the schema defaults
```

Adding a required column to a table that already has rows leaves those rows holding `null`, and Appwrite then rejects **every** later write to them — including updates that touch only unrelated fields — with `Missing required attribute`. The row is effectively read-only until something fills it in. Run this after any migration that adds a required column.

Important:

- The bootstrap script creates server-managed tables with no public permissions.
- `--prune` never touches rows in tables the schema still describes, so `user_profiles`, `user_roles`, and the questionnaire tables keep their data.
- Premium content should stay protected behind server-side access rules or Appwrite Functions instead of direct public table reads.
- If your mobile app needs filtered premium-safe reads, expose those through secure APIs or Appwrite Functions.

## Run The CMS

```bash
pnpm dev
```

Open `http://localhost:3000` and sign in with a staff account.

## Access Control

Six roles: two for the audience and four for the team.

| Role | For | Can |
| --- | --- | --- |
| **Student** | Studying for the board exam. The default for a new account. | Nothing in the dashboard. |
| **Member** | Everybody else in the audience — a graduate sitting the board, a licensed social worker, an instructor, a review centre. | Nothing in the dashboard. Identical to Student. |
| **Encoder** | The people typing and uploading questions | Write review content and questions, upload sheets, upload images. No publishing, no deleting, no member or billing data. |
| **Moderator** | The people checking that work | Everything an Encoder can, plus publish, delete content, read member and billing data, and moderate the community. |
| **Admin** | Running the platform | Everything, except erasing collected member records and granting free premium — and cannot appoint another Admin. |
| **Super Admin** | The owner | Everything. The only role that can appoint Admins, erase collected member records, or grant premium access without a payment. |

Two permissions stop at the owner: `members.delete` and `billing.grant`. They are an explicit list in `schema.ts`, not an exception written inline, because the Admin role is derived by *subtracting* from the catalogue — so every permission added later is granted to Admins by default, silently, unless it is named there.

**Student and Member are the same rank — rank 0 — and hold no permissions at all.** Nothing in the dashboard branches on which one somebody has, and nothing should: moving a Student to a Member grants nothing, revokes nothing, and unlocks nothing. Premium access comes from a subscription and only from a subscription. The pair exists because the audience is not one kind of person, and calling a practising social worker a "student" is simply wrong.

For the finer answer — retaker or first-timer, school or agency — read `user_profiles.memberType` below. That is a fact about a person rather than a rung on a ladder, and it is where the detail belongs.

**A Super Admin grants access** from **Staff Access** in the dashboard, by email. The person has to have signed in once so there is an account to attach the role to. Revoking is setting them back to Student or Member, which keeps the record of who had access and who took it away.

### How it works

Roles are named bundles of **permissions**, and permissions are what the code checks — never a role name. Both live in `lib/appwrite/schema.ts` (`cmsPermissionCatalog`, `cmsRoleDefinitions`), so they travel to the mobile project with the rest of the schema and a new role needs no change to any check.

A permission reads `domain.action` — `questions.import`, `billing.view`, `staff.manage`. Each table declares which domain it belongs to, and what a role may do with a table is the answer to two questions at once:

- **`access`** — is this table authored in the dashboard at all? `manage` (the team writes it), `review` (students generate it: read and delete only), `readonly` (the audit log: nobody writes it), `hidden` (not shown).
- **`domain`** — is *this person* the one who does it?

Both have to agree, which is what stops a new permission from quietly opening a create form over data the team does not author.

Every check happens on the server: `requirePermission()` and `requireTablePermission()` in pages and server actions, `authorizeRequest()` in API routes. The UI hides what you cannot do, but hiding is only cosmetic — the guard is what makes it safe.

### Rank, and why it matters

Each role has a rank (Student and Member 0, Encoder 10, Moderator 20, Admin 30, Super Admin 40). **You can only grant a role below your own**, so an Admin can build a team of Encoders and Moderators but cannot mint another Admin. A Super Admin is the exception and may appoint another Super Admin — without that, ownership could never be shared or handed over.

Three more rules, all enforced server-side in `lib/appwrite/staff.ts`:

- Nobody changes their own role. Self-promotion is the obvious abuse; accidental self-demotion is the likelier one, and it locks the owner out.
- Nobody edits the row of somebody at or above their own rank. Demotion is an attack too.
- The last Super Admin cannot be demoted or removed. Appoint another one first.

### Staff Activity

An append-only log of what the team did: who granted access to whom, what was published, what was deleted, which sheets were uploaded. It is `access: "readonly"`, so nothing can edit or delete a row through the dashboard — including a Super Admin. A log the people it records can rewrite is not a log.

### Who the members are is a separate question

A role says what somebody does *in this dashboard*. It says nothing about who they are, and the audience is not only undergraduates — graduates sitting the board, retakers, licensed social workers doing CPD, instructors, and review centres all subscribe.

That lives on the profile, not in the role ladder:

| `user_profiles` field | What it is |
| --- | --- |
| `memberType` | `student`, `graduate`, `retaker`, `professional`, `instructor`, `institution`, `other`. Asked once at sign-up, blank is fine. |
| `schoolOrEmployer` | Free text — the BSSW school, or the agency. |
| `licenseNumber` | PRC licence, for members who have one and choose to give it. |

**It grants nothing and gates nothing.** A licensed social worker and an undergraduate see exactly the same app and hit exactly the same paywall; only a subscription changes that. What `memberType` is for is aiming an announcement at retakers, and knowing who is actually paying.

`announcements.audience` reads both: `all`, `free`, `premium`, and `expired` come from membership, and the rest match a `memberType`.

### None of this reaches the mobile app

Roles decide what the team can do in this dashboard and nothing else. Every signed-in account is an ordinary member in the app, the team's own included, with the same screens and the same paywall. The app must never read `user_roles` or `staff_activity` — see section 14 of `MOBILE-SCHEMA-NOTES-v6.md`.

## Mobile App: Routing A Category

A category either splits into sets or it doesn't, and the app has to know which **before** it decides what screen to show. The answer is on the category row, so listing categories needs no follow-up query:

| Field on `exam_categories` | Meaning |
| --- | --- |
| `setCount` | Published sets in this category. **`0` means go straight to the questions.** |
| `directQuestionCount` | Questions sitting directly under the category, in no set |
| `questionCount` | Everything in the category, sets included |

```ts
if (category.setCount === 0) {
  // Human Behavior and Social Environment: open the questions directly.
  // There are `directQuestionCount` of them.
  openQuestions({ categoryId: category.$id })
} else {
  // History, Social Conditions, Issues and CO Drill: show the Set A / B / C picker.
  const sets = await tablesDB.listRows({
    tableId: 'questionnaires',
    queries: [
      Query.equal('categoryId', category.$id),
      Query.equal('isPublished', true),
      Query.orderAsc('order'),
    ],
  })
}
```

To read the questions themselves:

```ts
// A set's questions
Query.equal('questionnaireId', setId)

// A category's loose questions (no set).
// Appwrite stores an unset string column as "", so isNull will NOT match.
Query.equal('categoryId', categoryId), Query.equal('questionnaireId', '')

// Everything in a category, sets included
Query.equal('categoryId', categoryId)
```

All three counters are maintained by the CMS on every upload, set change, and delete. `setCount` counts only **published** sets, so an unpublished draft never sends the app to a picker with nothing in it. If they ever drift — someone edited rows in the Appwrite console — recompute them:

```bash
pnpm appwrite:bootstrap -- --recount
```

## Notes For The Mobile App

- Premium access is a property of the category: `exam_categories.isPremium`. Individual items can opt out with `questions.isFree` for a hand-picked free sample.
- `questions.questionnaireId` is empty for items that sit directly under a category. Appwrite stores a null string column as `""`, so test for emptiness rather than `isNull`.
- Answers record `questionSku`, not a row ID. Row IDs are reissued when content is re-imported; a SKU is not, so per-item statistics accumulate across content revisions.
- Your mobile app should enforce daily free-question limits and premium unlock checks using `user_profiles.isPremium`, `user_progress`, and your secure backend layer or Appwrite Functions.
- Do not expose premium rows directly with public read permissions. Use a secure backend layer to filter what the mobile app can fetch.
