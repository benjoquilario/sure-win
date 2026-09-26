# account-delete

Deletes the signed-in member's account and their data. Google Play will not
accept a release without a working in-app deletion path, and this is it.

## What it removes

Every row the member owns, in every member table: settings, study sessions,
answers, progress, daily and weekly stats, achievements, bookmarks, blocks
(both directions), announcement reads, likes, comments, replies, reports they
filed, staff role, public profile and private profile. Their own forum posts
go with every comment, reply and like on them. Then the Appwrite user.

The profile row is removed last, so a failure part-way through leaves an
account that can still sign in and retry.

## What it keeps

`subscriptions`, `payments`, `billing_notifications` (financial records, kept
for tax and chargeback disputes, which Play's policy allows) and
`staff_activity` (the dashboard audit trail).

## Console settings

- Runtime: Node 20 or later. Entrypoint `main.js`. Build command `npm install`.
- Execute access: **Users**.
- Scopes: `rows.read`, `rows.write`, `users.write`. The runtime key from those
  scopes is used; `APPWRITE_API_KEY` is only a fallback.
- Timeout: 60 seconds. A heavy forum user can have a lot of rows.

## Variables

`APPWRITE_DATABASE_ID` is required. Every table ID can be overridden with
`<TABLE>_TABLE_ID` (for example `USER_ANSWERS_TABLE_ID`); the defaults are the
schema's own IDs, so normally none are needed.

## App configuration

Set `EXPO_PUBLIC_APPWRITE_ACCOUNT_DELETE_FUNCTION_ID` in the app's `.env` and
in the EAS environment.

## Adding a member table later

Add it to `OWNED_TABLES` in `src/main.js` before shipping. Every table with a
`userId` column in `packages/schema/src/schema.ts` belongs there, except the
ones listed under "What it keeps".
