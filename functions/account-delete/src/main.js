const sdk = require("node-appwrite")

/**
 * ─── Account deletion ─────────────────────────────────────────────────────
 *
 * Google Play requires an in-app path that deletes the account *and* the data
 * attached to it. This removes every row the member owns, then the Appwrite
 * user.
 *
 * What is kept, and why:
 *
 *   subscriptions, payments, billing_notifications
 *     Financial records. Tax and chargeback disputes need them, and Play's
 *     data-deletion policy allows retention "for legitimate reasons such as
 *     security, fraud prevention, or regulatory compliance".
 *   staff_activity
 *     The dashboard audit trail. It names the actor, not the member.
 *
 * Table IDs default to the schema's own. They are overridable because a
 * function is bundled on its own and cannot import @workspace/schema.
 */

const API_ENDPOINT =
  process.env.APPWRITE_API_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_API_ENDPOINT
const PROJECT_ID =
  process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_FUNCTION_PROJECT_ID
const API_KEY = process.env.APPWRITE_API_KEY
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID

const table = (envName, fallback) => process.env[envName] || fallback

/** Every member-owned table, keyed by the column that names the owner. */
const OWNED_TABLES = [
  ["USER_SETTINGS_TABLE_ID", "user_settings", "userId"],
  ["STUDY_SESSIONS_TABLE_ID", "study_sessions", "userId"],
  ["USER_ACTIVITY_LOG_TABLE_ID", "user_activity_log", "userId"],
  ["LEARNING_HISTORY_TABLE_ID", "learning_history", "userId"],
  ["USER_ANSWERS_TABLE_ID", "user_answers", "userId"],
  ["USER_PROGRESS_TABLE_ID", "user_progress", "userId"],
  ["USER_DAILY_ACTIVITY_TABLE_ID", "user_daily_activity", "userId"],
  ["USER_WEEKLY_REPORTS_TABLE_ID", "user_weekly_reports", "userId"],
  ["LEARNING_ACHIEVEMENTS_TABLE_ID", "learning_achievements", "userId"],
  ["USER_BOOKMARKS_TABLE_ID", "user_bookmarks", "userId"],
  ["USER_BLOCKS_TABLE_ID", "user_blocks", "userId"],
  // Blocks *of* this member are meaningless once the account is gone.
  ["USER_BLOCKS_TABLE_ID", "user_blocks", "blockedUserId"],
  ["ANNOUNCEMENT_READS_TABLE_ID", "announcement_reads", "userId"],
  ["POST_LIKES_TABLE_ID", "post_likes", "userId"],
  ["COMMENT_LIKES_TABLE_ID", "comment_likes", "userId"],
  ["REPLIES_TABLE_ID", "replies", "userId"],
  ["COMMENTS_TABLE_ID", "comments", "userId"],
  ["FLAGGED_CONTENT_TABLE_ID", "flagged_content", "reportedBy"],
  ["USER_ROLES_TABLE_ID", "user_roles", "userId"],
  ["USER_PUBLIC_PROFILES_TABLE_ID", "user_public_profiles", "userId"],
  ["USER_PROFILES_TABLE_ID", "user_profiles", "userId"],
].map(([envName, fallback, column]) => ({
  tableId: table(envName, fallback),
  column,
}))

const POSTS = table("POSTS_TABLE_ID", "posts")
const COMMENTS = table("COMMENTS_TABLE_ID", "comments")
const REPLIES = table("REPLIES_TABLE_ID", "replies")
const POST_LIKES = table("POST_LIKES_TABLE_ID", "post_likes")

const PAGE_LIMIT = 100
const MAX_QUERY_VALUES = 100
/** Deletes in flight at once. Enough to be quick, few enough not to be throttled. */
const DELETE_CONCURRENCY = 10

function createTables(req) {
  const key =
    req.headers["x-appwrite-key"] || req.headers["X-Appwrite-Key"] || API_KEY

  if (!API_ENDPOINT || !PROJECT_ID || !DATABASE_ID || !key) {
    throw new Error(
      "Missing configuration. Set APPWRITE_DATABASE_ID and grant the function the rows.read, rows.write and users.write scopes (or set APPWRITE_API_KEY)."
    )
  }

  const client = new sdk.Client()
    .setEndpoint(API_ENDPOINT)
    .setProject(PROJECT_ID)
    .setKey(key)

  return { tablesDB: new sdk.TablesDB(client), users: new sdk.Users(client) }
}

function chunk(values, size) {
  const chunks = []

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }

  return chunks
}

function isMissingTable(caught) {
  // A table this deployment never created is nothing to delete, not a failure.
  return caught && caught.code === 404
}

async function listIds(tablesDB, tableId, queries) {
  const ids = []
  let cursor = null

  for (;;) {
    const page = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId,
      queries: [
        ...queries,
        sdk.Query.select(["$id"]),
        sdk.Query.limit(PAGE_LIMIT),
        ...(cursor ? [sdk.Query.cursorAfter(cursor)] : []),
      ],
    })

    ids.push(...page.rows.map((row) => row.$id))

    if (page.rows.length < PAGE_LIMIT) {
      return ids
    }

    cursor = page.rows[page.rows.length - 1].$id
  }
}

async function deleteIds(tablesDB, tableId, ids) {
  for (const batch of chunk(ids, DELETE_CONCURRENCY)) {
    await Promise.all(
      batch.map((rowId) =>
        tablesDB
          .deleteRow({ databaseId: DATABASE_ID, tableId, rowId })
          .catch((caught) => {
            // Already gone - deleted by a retry or a parallel cleanup.
            if (caught && caught.code === 404) {
              return
            }

            throw caught
          })
      )
    )
  }

  return ids.length
}

async function deleteWhere(tablesDB, tableId, column, values) {
  let deleted = 0

  try {
    for (const valueBatch of chunk(values, MAX_QUERY_VALUES)) {
      const ids = await listIds(tablesDB, tableId, [
        sdk.Query.equal(column, valueBatch),
      ])
      deleted += await deleteIds(tablesDB, tableId, ids)
    }
  } catch (caught) {
    if (isMissingTable(caught)) {
      return 0
    }

    throw caught
  }

  return deleted
}

/**
 * The member's posts go with everything hanging off them, so nobody is left
 * looking at replies to a thread that no longer exists.
 */
async function deleteOwnThreads(tablesDB, userId) {
  const postIds = await listIds(tablesDB, POSTS, [
    sdk.Query.equal("userId", userId),
  ]).catch((caught) => (isMissingTable(caught) ? [] : Promise.reject(caught)))

  if (postIds.length === 0) {
    return { posts: 0, comments: 0, replies: 0, likes: 0 }
  }

  const commentIds = []

  for (const batch of chunk(postIds, MAX_QUERY_VALUES)) {
    commentIds.push(
      ...(await listIds(tablesDB, COMMENTS, [sdk.Query.equal("postId", batch)]))
    )
  }

  const replies = await deleteWhere(tablesDB, REPLIES, "commentId", commentIds)
  const comments = await deleteIds(tablesDB, COMMENTS, commentIds)
  const likes = await deleteWhere(tablesDB, POST_LIKES, "postId", postIds)
  const posts = await deleteIds(tablesDB, POSTS, postIds)

  return { posts, comments, replies, likes }
}

const handler = async ({ req, res, log, error }) => {
  if (req.method !== "POST") {
    return res.json(
      { ok: false, message: "Use POST to delete an account." },
      405
    )
  }

  // Set by Appwrite from the caller's session; a client cannot forge it, so a
  // member can only ever delete themselves.
  const userId =
    req.headers["x-appwrite-user-id"] || req.headers["X-Appwrite-User-Id"]

  if (!userId) {
    return res.json(
      { ok: false, message: "Sign in to delete your account." },
      401
    )
  }

  try {
    const { tablesDB, users } = createTables(req)
    const cleanup = {}

    cleanup.threads = await deleteOwnThreads(tablesDB, userId)

    // Sequential on purpose: `user_profiles` is last, so a failure part-way
    // leaves a member who can still sign in and retry, rather than a login
    // with no profile behind it.
    for (const { tableId, column } of OWNED_TABLES) {
      const key = column === "userId" ? tableId : `${tableId}.${column}`
      cleanup[key] = await deleteWhere(tablesDB, tableId, column, [userId])
    }

    await users.delete({ userId })

    log(`Deleted account ${userId}: ${JSON.stringify(cleanup)}`)

    return res.json({ ok: true, message: "Account deleted.", cleanup })
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    error(`Account deletion failed for ${userId}: ${message}`)

    return res.json(
      {
        ok: false,
        message:
          "Your account could not be fully deleted. Some of your data may already be gone. Please try again to finish.",
      },
      500
    )
  }
}

module.exports = handler
module.exports.default = handler
