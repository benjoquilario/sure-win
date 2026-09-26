import {
  normalizeSetCode,
  type QuestionnaireRowDocument,
} from "@workspace/schema"

import { Query } from "../appwrite"
import { assertContentConfigured, getRowSafe, listAll } from "../db"

/**
 * ─── Sets ─────────────────────────────────────────────────────────────────
 *
 * The table is still called `questionnaires` in Appwrite because renaming it
 * would have meant a data migration. Everywhere a member can see, it is a
 * **set**, and this module is where that translation happens once.
 *
 * `setCode` is a plain string, not an enum: codes run A…Z then AA, AB, … with
 * no ceiling, exactly like spreadsheet columns. An app that validates against
 * five letters breaks on the sixth set.
 */

/**
 * Route id for "the questions directly under the category" when that
 * category also has sets. Appwrite ids cannot start with an underscore, so
 * this can never collide with a real set.
 */
export const DIRECT_SET_ID = "_direct"

export type QuestionSet = {
  id: string
  categoryId: string
  /** "A", "B", … "AA". Normalized, never validated against a fixed list. */
  setCode: string
  /** What the member reads — the stored title, or "Set A" built from the code. */
  title: string
  code: string | null
  description: string
  order: number
  /** Denormalised; accurate as of the last CMS write (gotcha 9). */
  questionCount: number
  isPublished: boolean
  /** null means "use the category's". */
  passingScore: number | null
  /** null means "use the category's". */
  timeLimitMinutes: number | null
}

export function toQuestionSet(row: QuestionnaireRowDocument): QuestionSet {
  const setCode = normalizeSetCode(row.setCode ?? "")
  const storedTitle = row.title?.trim()

  return {
    id: row.$id,
    categoryId: row.categoryId ?? "",
    setCode,
    title: storedTitle || (setCode ? `Set ${setCode}` : "Set"),
    code: row.code?.trim() || null,
    description: row.description?.trim() ?? "",
    order: row.order ?? 1,
    questionCount: row.questionCount ?? 0,
    isPublished: row.isPublished === true,
    passingScore:
      typeof row.passingScore === "number" && row.passingScore > 0
        ? row.passingScore
        : null,
    timeLimitMinutes:
      typeof row.timeLimitMinutes === "number" && row.timeLimitMinutes > 0
        ? row.timeLimitMinutes
        : null,
  }
}

export async function listQuestionSets(
  categoryId: string
): Promise<QuestionSet[]> {
  assertContentConfigured()

  if (!categoryId) {
    return []
  }

  const rows = await listAll(
    "questionnaires",
    [
      Query.equal("categoryId", categoryId),
      Query.equal("isPublished", true),
      Query.orderAsc("order"),
    ],
    { label: `sets in ${categoryId}` }
  )

  return rows.map(toQuestionSet)
}

export async function getQuestionSet(
  setId: string
): Promise<QuestionSet | null> {
  assertContentConfigured()

  if (!setId) {
    return null
  }

  const row = await getRowSafe("questionnaires", setId)

  // Sets default to unpublished so a half-finished one never reaches
  // students; that only holds if opening one by id checks it too.
  return row && row.isPublished === true ? toQuestionSet(row) : null
}

/** Sets by ID in one request — for history rows that name a set. */
export async function getQuestionSetsByIds(
  setIds: string[]
): Promise<Map<string, QuestionSet>> {
  const unique = Array.from(new Set(setIds.filter(Boolean)))
  const byId = new Map<string, QuestionSet>()

  if (unique.length === 0) {
    return byId
  }

  const rows = await listAll("questionnaires", [Query.equal("$id", unique)], {
    label: "sets by id",
  })

  for (const row of rows) {
    byId.set(row.$id, toQuestionSet(row))
  }

  return byId
}
