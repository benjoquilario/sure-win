const sdk = require("node-appwrite")

/**
 * ─── Exam questions gateway ───────────────────────────────────────────────
 *
 * The only way the app reads the question bank.
 *
 * `questions` used to be `app_readonly`, which resolves to `read("users")`:
 * every signed-in member could list every row in the paid bank, answer keys and
 * explanations included, by calling Appwrite directly. The app's own paywall
 * only decided what to *draw*. Appwrite permissions cannot express "readable
 * only where `isFree` is true, or where the reader pays", so the table is now
 * `server_only` and this function decides what leaves the database.
 *
 * Three rules, all enforced here rather than trusted from the caller:
 *
 *   1. Published only. A hidden category or a draft set returns 404, so a stale
 *      deep link or a hand-built request cannot open unfinished content.
 *   2. Premium by date, not just flag. `isPremium` is a cached flag the nightly
 *      sweep flips; `premiumUntil` is the truth. Mirrors `hasActivePremium` in
 *      @workspace/schema (which this function cannot import - Appwrite bundles
 *      the function directory on its own).
 *   3. A member who does not pay for a premium category receives the rows
 *      marked `isFree` and nothing else - plus the total, so the app can say
 *      how much is behind the paywall without shipping any of it.
 *
 * Actions (POST, JSON body):
 *
 *   { action: "paper", categoryId, setId?, cursor?, pageSize? }
 *   { action: "search", query, limit? }
 *   { action: "bank" }
 */

const DATABASE_ID =
  process.env.APPWRITE_DATABASE_ID || process.env.APPWRITE_FUNCTION_DATABASE_ID
const API_ENDPOINT =
  process.env.APPWRITE_API_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_API_ENDPOINT
const PROJECT_ID =
  process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_FUNCTION_PROJECT_ID
const API_KEY = process.env.APPWRITE_API_KEY

const TABLES = {
  userProfiles: process.env.USER_PROFILES_TABLE_ID || "user_profiles",
  categories: process.env.EXAM_CATEGORIES_TABLE_ID || "exam_categories",
  sets: process.env.QUESTIONNAIRES_TABLE_ID || "questionnaires",
  questions: process.env.QUESTIONS_TABLE_ID || "questions",
}

/** Appwrite caps a single page at this many rows. */
const PAGE_LIMIT = 100
/** One call returns at most this many questions; the app pages through the rest. */
const DEFAULT_PAGE_SIZE = 300
const MAX_PAGE_SIZE = 500
/** Appwrite rejects an `equal` with more values than this. */
const MAX_QUERY_VALUES = 100
const MAX_SEARCH_RESULTS = 25

/** Every column the app renders. Nothing else leaves the database. */
const QUESTION_COLUMNS = [
  "$id",
  "sku",
  "categoryId",
  "questionnaireId",
  "order",
  "prompt",
  "questionType",
  "difficulty",
  "choices",
  "answerIndex",
  "explanation",
  "imageUrl",
  "isFree",
]

const SEARCH_COLUMNS = [
  "$id",
  "sku",
  "categoryId",
  "questionnaireId",
  "prompt",
  "difficulty",
  "isFree",
]

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function hasActivePremium(profile, now = new Date()) {
  if (!profile || profile.isPremium !== true) {
    return false
  }

  if (!profile.premiumUntil) {
    return true
  }

  const until = new Date(profile.premiumUntil).getTime()
  return Number.isFinite(until) && until > now.getTime()
}

function parseBody(rawBody) {
  if (!rawBody) {
    return {}
  }

  if (typeof rawBody === "object") {
    return rawBody
  }

  try {
    const parsed = JSON.parse(rawBody)
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function readString(value, maxLength = 64) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function chunk(values, size) {
  const chunks = []

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }

  return chunks
}

function createContext(req) {
  // The runtime key (x-appwrite-key) is scoped by the function's own settings,
  // so it is preferred over a long-lived key in the environment.
  const key =
    req.headers["x-appwrite-key"] || req.headers["X-Appwrite-Key"] || API_KEY

  if (!API_ENDPOINT || !PROJECT_ID || !DATABASE_ID || !key) {
    throw new HttpError(
      500,
      "Function is not configured. Set APPWRITE_DATABASE_ID, and grant the function the rows.read scope (or set APPWRITE_API_KEY)."
    )
  }

  const client = new sdk.Client()
    .setEndpoint(API_ENDPOINT)
    .setProject(PROJECT_ID)
    .setKey(key)

  const tablesDB = new sdk.TablesDB(client)

  return {
    tablesDB,
    list(tableId, queries) {
      return tablesDB.listRows({ databaseId: DATABASE_ID, tableId, queries })
    },
    async get(tableId, rowId) {
      try {
        return await tablesDB.getRow({
          databaseId: DATABASE_ID,
          tableId,
          rowId,
        })
      } catch (caught) {
        if (caught && caught.code === 404) {
          return null
        }

        throw caught
      }
    },
  }
}

async function listAllRows(ctx, tableId, queries) {
  const rows = []
  let cursor = null

  for (;;) {
    const page = await ctx.list(tableId, [
      ...queries,
      sdk.Query.limit(PAGE_LIMIT),
      ...(cursor ? [sdk.Query.cursorAfter(cursor)] : []),
    ])

    rows.push(...page.rows)

    if (page.rows.length < PAGE_LIMIT) {
      return rows
    }

    cursor = page.rows[page.rows.length - 1].$id
  }
}

async function countRows(ctx, tableId, queries) {
  const page = await ctx.list(tableId, [...queries, sdk.Query.limit(1)])
  return page.total
}

async function loadViewer(ctx, userId) {
  const { rows } = await ctx.list(TABLES.userProfiles, [
    sdk.Query.equal("userId", userId),
    sdk.Query.select(["isPremium", "premiumUntil"]),
    sdk.Query.limit(1),
  ])

  return { isPremium: hasActivePremium(rows[0]) }
}

/** Published categories and the published sets inside them. */
async function loadPublishedCatalogue(ctx) {
  const categories = await listAllRows(ctx, TABLES.categories, [
    sdk.Query.equal("isPublished", true),
    sdk.Query.select(["$id", "isPremium"]),
  ])

  const categoryIds = categories.map((category) => category.$id)
  const sets = []

  for (const ids of chunk(categoryIds, MAX_QUERY_VALUES)) {
    sets.push(
      ...(await listAllRows(ctx, TABLES.sets, [
        sdk.Query.equal("categoryId", ids),
        sdk.Query.equal("isPublished", true),
        sdk.Query.select(["$id", "categoryId"]),
      ]))
    )
  }

  return {
    categoryIds,
    freeCategoryIds: categories
      .filter((category) => category.isPremium !== true)
      .map((category) => category.$id),
    // "" is how a question directly under its category stores "no set".
    destinationIds: ["", ...sets.map((set) => set.$id)],
  }
}

// ─── Actions ────────────────────────────────────────────────────────────────

async function servePaper(ctx, viewer, body) {
  const categoryId = readString(body.categoryId)
  const setId = readString(body.setId)
  const cursor = readString(body.cursor)
  const pageSize = Math.min(
    Math.max(Number.parseInt(body.pageSize, 10) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  )

  if (!categoryId) {
    throw new HttpError(400, "categoryId is required.")
  }

  const category = await ctx.get(TABLES.categories, categoryId)

  if (!category || category.isPublished !== true) {
    throw new HttpError(404, "This category is not available.")
  }

  let set = null

  if (setId) {
    set = await ctx.get(TABLES.sets, setId)

    // A set from another category is a stale or forged link: opening it would
    // show one category's paywall above another's questions.
    if (!set || set.isPublished !== true || set.categoryId !== categoryId) {
      throw new HttpError(404, "This set is not available.")
    }
  }

  const entitled = category.isPremium !== true || viewer.isPremium
  const scope = [
    sdk.Query.equal("categoryId", categoryId),
    sdk.Query.equal("questionnaireId", setId),
  ]

  // Item order is unique per destination (idx_question_target_order), so it
  // is a stable sort for cursor paging on its own.
  const questions = []
  let nextCursor = cursor || null

  while (questions.length < pageSize) {
    const want = Math.min(PAGE_LIMIT, pageSize - questions.length)
    const page = await ctx.list(TABLES.questions, [
      ...scope,
      ...(entitled ? [] : [sdk.Query.equal("isFree", true)]),
      sdk.Query.select(QUESTION_COLUMNS),
      sdk.Query.orderAsc("order"),
      sdk.Query.limit(want),
      ...(nextCursor ? [sdk.Query.cursorAfter(nextCursor)] : []),
    ])

    questions.push(...page.rows)

    if (page.rows.length < want) {
      nextCursor = null
      break
    }

    nextCursor = page.rows[page.rows.length - 1].$id
  }

  // Only the first page pays for the count; later pages already know it.
  const total = cursor ? null : await countRows(ctx, TABLES.questions, scope)

  return {
    ok: true,
    entitled,
    isSample: !entitled,
    total,
    nextCursor,
    questions: questions.map(toQuestionPayload),
  }
}

async function searchQuestions(ctx, viewer, body) {
  const term = readString(body.query, 120)
  const limit = Math.min(
    Math.max(Number.parseInt(body.limit, 10) || 12, 1),
    MAX_SEARCH_RESULTS
  )

  if (term.length < 2) {
    return { ok: true, results: [] }
  }

  const catalogue = await loadPublishedCatalogue(ctx)

  if (catalogue.categoryIds.length === 0) {
    return { ok: true, results: [] }
  }

  const access = viewer.isPremium
    ? []
    : [
        catalogue.freeCategoryIds.length > 0
          ? sdk.Query.or([
              sdk.Query.equal("isFree", true),
              sdk.Query.equal(
                "categoryId",
                catalogue.freeCategoryIds.slice(0, MAX_QUERY_VALUES)
              ),
            ])
          : sdk.Query.equal("isFree", true),
      ]

  const results = []

  // Chunked because `equal` takes at most 100 values. Real catalogues fit in
  // one chunk; the loop is for the day they do not.
  for (const categoryIds of chunk(catalogue.categoryIds, MAX_QUERY_VALUES)) {
    for (const destinationIds of chunk(
      catalogue.destinationIds,
      MAX_QUERY_VALUES
    )) {
      if (results.length >= limit) {
        break
      }

      const { rows } = await ctx.list(TABLES.questions, [
        sdk.Query.search("prompt", term),
        sdk.Query.equal("categoryId", categoryIds),
        sdk.Query.equal("questionnaireId", destinationIds),
        ...access,
        sdk.Query.select(SEARCH_COLUMNS),
        sdk.Query.limit(limit - results.length),
      ])

      results.push(...rows)
    }
  }

  return {
    ok: true,
    results: results.slice(0, limit).map((row) => ({
      id: row.$id,
      sku: row.sku || "",
      categoryId: row.categoryId || "",
      questionnaireId: row.questionnaireId || "",
      prompt: row.prompt || "",
      difficulty: row.difficulty || "medium",
      isFree: row.isFree === true,
    })),
  }
}

/** How many published items the bank holds - the denominator for coverage. */
async function countBank(ctx) {
  const catalogue = await loadPublishedCatalogue(ctx)
  let total = 0

  for (const categoryIds of chunk(catalogue.categoryIds, MAX_QUERY_VALUES)) {
    for (const destinationIds of chunk(
      catalogue.destinationIds,
      MAX_QUERY_VALUES
    )) {
      total += await countRows(ctx, TABLES.questions, [
        sdk.Query.equal("categoryId", categoryIds),
        sdk.Query.equal("questionnaireId", destinationIds),
      ])
    }
  }

  return { ok: true, total }
}

function toQuestionPayload(row) {
  return {
    $id: row.$id,
    sku: row.sku || "",
    categoryId: row.categoryId || "",
    questionnaireId: row.questionnaireId || "",
    order: row.order ?? 1,
    prompt: row.prompt || "",
    questionType: row.questionType || "multiple_choice",
    difficulty: row.difficulty || "medium",
    choices: Array.isArray(row.choices) ? row.choices : [],
    answerIndex: row.answerIndex ?? 0,
    explanation: row.explanation || "",
    imageUrl: row.imageUrl || "",
    isFree: row.isFree === true,
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

const ACTIONS = {
  paper: servePaper,
  search: searchQuestions,
  bank: countBank,
}

const handler = async ({ req, res, log, error }) => {
  if (req.method !== "POST") {
    return res.json({ ok: false, message: "Use POST." }, 405)
  }

  // Appwrite sets this from the caller's session. It cannot be supplied by the
  // client, which is what makes it safe to base the entitlement on.
  const userId =
    req.headers["x-appwrite-user-id"] || req.headers["X-Appwrite-User-Id"]

  if (!userId) {
    return res.json({ ok: false, message: "Sign in to open questions." }, 401)
  }

  const body = parseBody(req.bodyJson ?? req.body)

  if (!body) {
    return res.json({ ok: false, message: "Body must be JSON." }, 400)
  }

  const action = ACTIONS[readString(body.action) || "paper"]

  if (!action) {
    return res.json({ ok: false, message: "Unknown action." }, 400)
  }

  try {
    const ctx = createContext(req)
    const viewer = await loadViewer(ctx, userId)
    const payload = await action(ctx, viewer, body)

    return res.json(payload)
  } catch (caught) {
    if (caught instanceof HttpError) {
      return res.json({ ok: false, message: caught.message }, caught.status)
    }

    const message = caught instanceof Error ? caught.message : String(caught)
    error(`exam-questions failed for ${userId}: ${message}`)
    log(caught && caught.stack ? caught.stack : message)

    // The detail stays in the function log; members get a generic message.
    return res.json(
      { ok: false, message: "Questions could not be loaded. Try again." },
      500
    )
  }
}

module.exports = handler
module.exports.default = handler
