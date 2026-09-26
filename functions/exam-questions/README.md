# exam-questions

Serves the question bank to the mobile app. With this deployed, the
`questions` table is `server_only` and no client can read it directly, so the
paywall is enforced by the server instead of only drawn by the app.

## What it enforces

- **Published only.** A category with `isPublished = false`, or a set that is
  unpublished or belongs to a different category, returns 404.
- **Premium by date.** `isPremium` is true *and* `premiumUntil` is empty or in
  the future. It is the same rule as `hasActivePremium` in `@workspace/schema`.
- **Free samples only for non-members.** In a premium category a member who
  does not pay gets the rows with `isFree = true`, plus `total` so the app can
  say how many are locked.

## Actions

All `POST` with a JSON body. The caller must be signed in (Appwrite supplies
`x-appwrite-user-id`; the client cannot set it).

| Body | Returns |
| --- | --- |
| `{ "action": "paper", "categoryId": "...", "setId": "" }` | `{ ok, entitled, isSample, total, nextCursor, questions[] }`. `setId` blank means the questions directly under the category. Pass `cursor: nextCursor` to get the next page (300 per call by default, `pageSize` up to 500). `total` is only sent on the first page. |
| `{ "action": "search", "query": "social work law" }` | `{ ok, results[] }`, published and entitled items only, at most 25. |
| `{ "action": "bank" }` | `{ ok, total }`, the number of published items. |

## Console settings

- Runtime: Node 20 or later. Entrypoint `main.js`. Build command `npm install`.
- Execute access: **Users** (any signed-in member).
- Scopes: `rows.read` (older consoles call it `documents.read`). The runtime key
  from those scopes is used; `APPWRITE_API_KEY` is only a fallback.
- Timeout: 30 seconds is plenty.

## Variables

| Variable | Required | Default |
| --- | --- | --- |
| `APPWRITE_DATABASE_ID` | yes | |
| `APPWRITE_API_KEY` | no, if scopes are granted | |
| `USER_PROFILES_TABLE_ID` | no | `user_profiles` |
| `EXAM_CATEGORIES_TABLE_ID` | no | `exam_categories` |
| `QUESTIONNAIRES_TABLE_ID` | no | `questionnaires` |
| `QUESTIONS_TABLE_ID` | no | `questions` |

Endpoint and project ID come from Appwrite's built-in
`APPWRITE_FUNCTION_API_ENDPOINT` / `APPWRITE_FUNCTION_PROJECT_ID`.

## Rollout order

This order matters. Get it wrong and the app shows no questions.

1. Deploy this function and note its ID.
2. Set `EXPO_PUBLIC_APPWRITE_EXAM_QUESTIONS_FUNCTION_ID` in the app's `.env`
   and in the EAS environment, then ship that build.
3. **Only then** run `pnpm appwrite:bootstrap`. It moves `questions` to
   `server_only`, which removes the direct read the old builds depend on.

If the function ID is unset, the app falls back to reading the table directly.
That keeps development working before the function exists, and stops working
on purpose once step 3 has run.
