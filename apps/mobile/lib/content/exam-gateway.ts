import type { QuestionDocument } from "@workspace/schema"

import {
  APPWRITE_CONFIG,
  createAppwriteContentError,
  ExecutionMethod,
  functions,
} from "../appwrite"

/**
 * ─── The exam-questions Function ──────────────────────────────────────────
 *
 * `questions` is `server_only` once the rollout in functions/exam-questions is
 * done: no member can read the table, so the paid bank, its answer keys and
 * its explanations stay on the server unless the member is entitled to them.
 * This module is the app's only door to it.
 *
 * `isGatewayConfigured()` false means the Function ID is not set. Callers then
 * read the table directly, which keeps a development build working before the
 * Function exists and stops working, loudly, once the table is locked.
 */

export function isGatewayConfigured() {
  return Boolean(APPWRITE_CONFIG.examQuestionsFunctionId)
}

type GatewayFailure = { ok: false; message?: string }

async function callGateway<T extends { ok: true }>(
  body: Record<string, unknown>
): Promise<T> {
  const execution = await functions.createExecution({
    functionId: APPWRITE_CONFIG.examQuestionsFunctionId,
    body: JSON.stringify(body),
    async: false,
    xpath: "/",
    method: ExecutionMethod.POST,
    headers: { "content-type": "application/json" },
  })

  let payload: T | GatewayFailure | null = null

  try {
    payload = JSON.parse(execution.responseBody || "null")
  } catch {
    payload = null
  }

  const status = execution.responseStatusCode ?? 500

  if (status === 404) {
    throw createAppwriteContentError(
      "not-found",
      payload?.ok === false && payload.message
        ? payload.message
        : "This paper is no longer available."
    )
  }

  if (status >= 400 || !payload || payload.ok !== true) {
    throw createAppwriteContentError(
      "request",
      (payload?.ok === false && payload.message) ||
        "Questions could not be loaded. Check your connection and try again."
    )
  }

  return payload
}

type PaperPage = {
  ok: true
  entitled: boolean
  isSample: boolean
  /** Only on the first page. */
  total: number | null
  nextCursor: string | null
  questions: QuestionDocument[]
}

export type GatewayPaper = {
  rows: QuestionDocument[]
  /** Every item in the paper, including the ones withheld from this member. */
  total: number
  /** False when the member receives the free sample only. */
  entitled: boolean
}

/**
 * One paper, all pages. `setId` blank means the items directly under the
 * category.
 */
export async function fetchPaperFromGateway(params: {
  categoryId: string
  setId: string | null
}): Promise<GatewayPaper> {
  const rows: QuestionDocument[] = []
  let cursor: string | null = null
  let total = 0
  let entitled = true

  // Bounded, so a server that kept returning a cursor could not spin forever.
  for (let page = 0; page < 50; page += 1) {
    const result: PaperPage = await callGateway<PaperPage>({
      action: "paper",
      categoryId: params.categoryId,
      setId: params.setId ?? "",
      ...(cursor ? { cursor } : {}),
    })

    rows.push(...result.questions)

    if (page === 0) {
      total = result.total ?? result.questions.length
      entitled = result.entitled
    }

    if (!result.nextCursor) {
      break
    }

    cursor = result.nextCursor
  }

  return { rows, total, entitled }
}

export type GatewaySearchHit = {
  id: string
  sku: string
  categoryId: string
  questionnaireId: string
  prompt: string
  difficulty: string
  isFree: boolean
}

export async function searchQuestionsViaGateway(
  term: string,
  limit: number
): Promise<GatewaySearchHit[]> {
  const result = await callGateway<{ ok: true; results: GatewaySearchHit[] }>({
    action: "search",
    query: term,
    limit,
  })

  return result.results
}

export async function countBankViaGateway(): Promise<number> {
  const result = await callGateway<{ ok: true; total: number }>({
    action: "bank",
  })

  return result.total
}
