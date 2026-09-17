/**
 * Server-side reads and writes for the question bank.
 *
 * The unit questions belong to is the CATEGORY. A set (Set A, Set B, ...) is an
 * optional subdivision, so every read and write here is scoped by a target of
 * "this category, and either this set or no set at all". Categories that never
 * split into sets - which is most of them - simply never carry a set.
 *
 * Appwrite gives us neither joins nor transactions, and both absences shape
 * this file: categories are stitched to sets in memory, and an import is
 * written row by row with per-row failures collected rather than thrown, so a
 * network blip halfway through a 100-item upload reports what landed instead of
 * pretending nothing happened.
 */

import { AppwriteException, ID, Query } from "node-appwrite";

import { appwriteEnv, hasAppwriteServerEnv } from "@/lib/appwrite/env";
import {
  getReviewerTableDefinition,
  nextFreeSetCode,
  type QuestionnaireMode,
  type QuestionnaireSetCode,
  type ReviewerTableData,
} from "@workspace/schema";
import { getAdminServices } from "@/lib/appwrite/server";
import type { ParsedQuestionRow } from "@/lib/questions/spreadsheet";

const CATEGORIES_TABLE = getReviewerTableDefinition("exam_categories").tableId;
const SETS_TABLE = getReviewerTableDefinition("questionnaires").tableId;
const QUESTIONS_TABLE = getReviewerTableDefinition("questions").tableId;
const ANSWERS_TABLE = getReviewerTableDefinition("user_answers").tableId;

/** Appwrite caps a single page well below the size of a board exam. */
const PAGE_SIZE = 100;
/** Enough parallelism to import a 100-item paper quickly, not enough to rate-limit. */
const WRITE_CONCURRENCY = 5;

export type QuestionRecord = ReviewerTableData<"questions"> & {
  $id: string;
  $createdAt?: string;
  $updatedAt?: string;
};

export type ExamCategorySummary = {
  id: string;
  title: string;
  code: string;
  mode: QuestionnaireMode;
  order: number;
  /** Everything in the category, sets included. */
  questionCount: number;
  /** Published sets. 0 means the app opens the questions directly. */
  setCount: number;
  /** Questions sitting directly under the category, in no set. */
  directQuestionCount: number;
  isPremium: boolean;
  isPublished: boolean;
};

export type QuestionSetSummary = {
  id: string;
  code: string;
  /** Blank unless the set was given a name of its own. */
  title: string;
  setCode: QuestionnaireSetCode;
  categoryId: string;
  categoryTitle: string;
  categoryCode: string;
  order: number;
  questionCount: number;
  isPublished: boolean;
};

/**
 * Where questions are being read from or written to.
 *
 * A null `setId` is not "unset" - it means the questions sit directly under the
 * category, which is a real and common place for them to be.
 */
export type QuestionTarget = {
  categoryId: string;
  setId: string | null;
};

export type ResolvedTarget = {
  target: QuestionTarget;
  category: ExamCategorySummary;
  set: QuestionSetSummary | null;
  /** "Human Behavior and Social Environment" or "... - Set A". */
  label: string;
  /** Short handle used for the downloaded file name. */
  code: string;
};

/** "Set A", or the set's own name when it has one. */
export function formatSetLabel(set: QuestionSetSummary) {
  return set.title || `Set ${set.setCode}`;
}

export function formatTargetLabel(
  category: { title: string },
  set: QuestionSetSummary | null,
) {
  return set ? `${category.title} - ${formatSetLabel(set)}` : category.title;
}

function toPlainRow<T>(row: unknown): T {
  return JSON.parse(JSON.stringify(row)) as T;
}

/**
 * Reads every matching row, a page at a time.
 *
 * Cursor paging rather than offset: offsets shift under concurrent writes, and
 * an import that skips a row because someone else added one is the kind of bug
 * that shows up as a missing exam question months later.
 */
async function listAllRows<T>(
  tableId: string,
  queries: string[] = [],
  hardLimit = 10000,
): Promise<T[]> {
  const { tables } = getAdminServices();
  const rows: T[] = [];
  let cursor: string | null = null;

  while (rows.length < hardLimit) {
    const pageQueries = [...queries, Query.limit(PAGE_SIZE)];

    if (cursor) {
      pageQueries.push(Query.cursorAfter(cursor));
    }

    const response = await tables.listRows({
      databaseId: appwriteEnv.databaseId,
      tableId,
      queries: pageQueries,
    });

    if (!response.rows.length) {
      break;
    }

    rows.push(...response.rows.map((row) => toPlainRow<T>(row)));
    cursor = String(
      (response.rows[response.rows.length - 1] as { $id: string }).$id,
    );

    if (response.rows.length < PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    },
  );

  await Promise.all(runners);
  return results;
}

/* -------------------------------------------------------------------------- */
/*  Reads                                                                     */
/* -------------------------------------------------------------------------- */

export async function listExamCategories(): Promise<ExamCategorySummary[]> {
  if (!hasAppwriteServerEnv()) {
    return [];
  }

  try {
    const rows = await listAllRows<Record<string, unknown>>(CATEGORIES_TABLE, [
      Query.orderAsc("order"),
    ]);

    return rows.map((row) => ({
      id: String(row.$id),
      title: String(row.title ?? "").trim() || String(row.$id),
      code: String(row.code ?? "").trim(),
      mode: (row.mode === "quiz" ? "quiz" : "board_exam") as QuestionnaireMode,
      order: Number(row.order ?? 1),
      questionCount: Number(row.questionCount ?? 0),
      setCount: Number(row.setCount ?? 0),
      directQuestionCount: Number(row.directQuestionCount ?? 0),
      isPremium: row.isPremium === true,
      isPublished: row.isPublished !== false,
    }));
  } catch {
    return [];
  }
}

export async function listQuestionSets(): Promise<QuestionSetSummary[]> {
  if (!hasAppwriteServerEnv()) {
    return [];
  }

  try {
    const [categories, sets] = await Promise.all([
      listExamCategories(),
      listAllRows<Record<string, unknown>>(SETS_TABLE, [Query.orderAsc("order")]),
    ]);

    const categoryById = new Map(
      categories.map((category) => [category.id, category]),
    );

    return sets.map((row) => {
      const categoryId = String(row.categoryId ?? "").trim();
      const category = categoryById.get(categoryId);

      return {
        id: String(row.$id),
        code: String(row.code ?? "").trim(),
        title: String(row.title ?? "").trim(),
        setCode: (String(row.setCode ?? "A").trim() ||
          "A") as QuestionnaireSetCode,
        categoryId,
        categoryTitle: category?.title ?? "Uncategorized",
        categoryCode: category?.code ?? "",
        order: Number(row.order ?? 1),
        questionCount: Number(row.questionCount ?? 0),
        isPublished: row.isPublished !== false,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Turns a raw category/set pair into everything the UI and importer need.
 *
 * A set id that does not belong to the given category is dropped rather than
 * honoured, so a stale URL cannot quietly write Set A's questions into another
 * category.
 */
export async function resolveTarget(
  categoryId: string,
  setId: string,
): Promise<ResolvedTarget | null> {
  if (!categoryId) {
    return null;
  }

  const [categories, sets] = await Promise.all([
    listExamCategories(),
    setId ? listQuestionSets() : Promise.resolve([]),
  ]);

  const category = categories.find((entry) => entry.id === categoryId);

  if (!category) {
    return null;
  }

  const set =
    sets.find((entry) => entry.id === setId && entry.categoryId === categoryId) ??
    null;

  return {
    target: { categoryId: category.id, setId: set?.id ?? null },
    category,
    set,
    label: formatTargetLabel(category, set),
    code: set?.code || category.code || category.title,
  };
}

/**
 * True when a question sits directly under its category rather than in a set.
 *
 * Appwrite stores a null on an optional string column as an empty string, so
 * `Query.isNull` never matches one and cannot be used to find these rows. The
 * check is done in memory instead, which also copes with rows written before
 * the column existed.
 */
export function hasNoSet(record: Record<string, unknown>) {
  return !String(record.questionnaireId ?? "").trim();
}

/** One target's items, in the order a student sees them. */
export async function listQuestionRecords(
  target: QuestionTarget,
): Promise<QuestionRecord[]> {
  if (!hasAppwriteServerEnv() || !target.categoryId) {
    return [];
  }

  try {
    if (target.setId) {
      return await listAllRows<QuestionRecord>(QUESTIONS_TABLE, [
        Query.equal("questionnaireId", [target.setId]),
        Query.orderAsc("order"),
      ]);
    }

    const categoryRows = await listAllRows<QuestionRecord>(QUESTIONS_TABLE, [
      Query.equal("categoryId", [target.categoryId]),
      Query.orderAsc("order"),
    ]);

    return categoryRows.filter(hasNoSet);
  } catch {
    return [];
  }
}

/** Every question in a category, sets included. Used by the browse list. */
export async function listCategoryQuestions(
  categoryId: string,
): Promise<QuestionRecord[]> {
  if (!hasAppwriteServerEnv() || !categoryId) {
    return [];
  }

  try {
    return await listAllRows<QuestionRecord>(QUESTIONS_TABLE, [
      Query.equal("categoryId", [categoryId]),
      Query.orderAsc("order"),
    ]);
  } catch {
    return [];
  }
}

export async function getQuestionRecord(
  rowId: string,
): Promise<QuestionRecord | null> {
  if (!hasAppwriteServerEnv() || !rowId) {
    return null;
  }

  try {
    const { tables } = getAdminServices();
    const row = await tables.getRow({
      databaseId: appwriteEnv.databaseId,
      tableId: QUESTIONS_TABLE,
      rowId,
    });

    return toPlainRow<QuestionRecord>(row);
  } catch {
    return null;
  }
}

/** Counts for the setup guide, from the denormalised totals. */
export async function getSetupCounts() {
  const [categories, sets] = await Promise.all([
    listExamCategories(),
    listQuestionSets(),
  ]);

  return {
    categoryCount: categories.length,
    setCount: sets.length,
    questionCount: categories.reduce(
      (total, category) => total + category.questionCount,
      0,
    ),
    firstCategoryId: categories[0]?.id ?? "",
  };
}

/* -------------------------------------------------------------------------- */
/*  Codes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Initials of a title, capped: "History, Social Conditions, Issues and CO"
 * becomes HSCI.
 *
 * Small words are dropped so the result reads like something a person would
 * have chosen, which matters because these codes end up in file names and in
 * messages between whoever is encoding and whoever is checking.
 */
function toInitials(title: string, maxLength: number) {
  const skip = new Set(["and", "of", "the", "in", "for", "on", "to", "a", "an"]);
  const words = title
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word && !skip.has(word.toLowerCase()));

  const initials = words
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, maxLength);

  return initials || "GEN";
}

async function findFreeCode(
  tableId: string,
  base: string,
  maxLength: number,
): Promise<string> {
  const { tables } = getAdminServices();
  const trimmedBase = base.slice(0, maxLength) || "GEN";

  for (let attempt = 0; attempt < 50; attempt += 1) {
    // First choice is the bare code; collisions get -2, -3, and so on.
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const candidate = `${trimmedBase.slice(0, maxLength - suffix.length)}${suffix}`;

    try {
      const response = await tables.listRows({
        databaseId: appwriteEnv.databaseId,
        tableId,
        queries: [Query.equal("code", [candidate]), Query.limit(1)],
      });

      if (!response.rows.length) {
        return candidate;
      }
    } catch {
      // If the lookup itself fails, hand back the candidate: the unique index
      // is the real check, and a failed read should not block saving.
      return candidate;
    }
  }

  return `${trimmedBase.slice(0, maxLength - 7)}-${Date.now().toString(36).slice(-5)}`;
}

export async function generateExamCategoryCode(title: string) {
  return findFreeCode(CATEGORIES_TABLE, toInitials(title, 8), 16);
}

export async function generateSetCode(
  categoryId: string,
  setCode: string,
  title: string,
) {
  const categories = await listExamCategories();
  const category = categories.find((entry) => entry.id === categoryId);
  const prefix = category?.code || toInitials(category?.title ?? title, 8);

  return findFreeCode(SETS_TABLE, `${prefix}-${setCode || "A"}`, 24);
}

/**
 * The next unused set letter in a category: A, B, ... Z, AA, and onward.
 *
 * Sets are not capped at a fixed list of letters, so this walks the sequence
 * until it finds one the category is not already using - filling a gap left by
 * a deleted set before moving past the end.
 *
 * @param excludeSetId Ignore this set's own letter, so re-saving it is not a
 *   collision with itself.
 */
export async function nextSetCodeForCategory(
  categoryId: string,
  excludeSetId = "",
) {
  const sets = await listQuestionSets();
  const taken = sets
    .filter((set) => set.categoryId === categoryId && set.id !== excludeSetId)
    .map((set) => set.setCode);

  return nextFreeSetCode(taken);
}

/* -------------------------------------------------------------------------- */
/*  SKUs                                                                      */
/* -------------------------------------------------------------------------- */

const SKU_PREFIX = "Q-";
const SKU_DIGITS = 6;
const SKU_PATTERN = /^Q-(\d+)$/;

export function formatSku(sequence: number) {
  return `${SKU_PREFIX}${String(sequence).padStart(SKU_DIGITS, "0")}`;
}

export function parseSkuSequence(sku: unknown): number | null {
  const match = SKU_PATTERN.exec(String(sku ?? "").trim());
  const digits = match?.[1];

  if (!digits) {
    return null;
  }

  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function peekHighestSku(
  tableId: string,
  column: string,
): Promise<number> {
  try {
    const { tables } = getAdminServices();
    const response = await tables.listRows({
      databaseId: appwriteEnv.databaseId,
      tableId,
      queries: [Query.orderDesc(column), Query.limit(1)],
    });

    const row = response.rows[0] as Record<string, unknown> | undefined;
    return parseSkuSequence(row?.[column]) ?? 0;
  } catch {
    return 0;
  }
}

/**
 * The next free SKU number.
 *
 * Zero-padding is what makes this cheap: `Q-000009` sorts before `Q-000010`,
 * so the highest SKU is a single indexed read rather than a scan of the bank.
 *
 * It reads the answer history too, not just the live questions. Taking the
 * high-water mark from `questions` alone would restart numbering after someone
 * emptied a category, and the reissued SKU would inherit the deleted question's
 * statistics - the exact thing a permanent identifier exists to prevent. The
 * unique index remains the real guarantee; see `createQuestionWithSku`.
 */
async function peekNextSkuSequence(): Promise<number> {
  const [fromQuestions, fromAnswers] = await Promise.all([
    peekHighestSku(QUESTIONS_TABLE, "sku"),
    peekHighestSku(ANSWERS_TABLE, "questionSku"),
  ]);

  return Math.max(fromQuestions, fromAnswers) + 1;
}

function isConflict(error: unknown) {
  return error instanceof AppwriteException && error.code === 409;
}

/**
 * Creates a question, minting SKUs until the unique index accepts one.
 *
 * Two admins importing at once would otherwise both read the same "next"
 * number. The index rejects the loser with a 409 and it simply takes the next
 * number, which is why nothing here needs a lock or a counter row.
 */
/**
 * Creates a question, retrying until the unique indexes accept it.
 *
 * Two things on a question row are "the next free value": its SKU, and - when
 * appending - its item number. Two imports running at once will both read the
 * same "next" for either, and the loser gets a 409. Appwrite does not say which
 * constraint failed, so a retry simply takes the next value for both; that
 * converges immediately and needs no lock, no counter row, and no serialising
 * of uploads.
 *
 * `allocateOrder` supplies a REPLACEMENT number after a collision - it is not
 * consulted on the first attempt, which uses the number the plan worked out.
 * Calling it up front would throw that plan away and renumber every row.
 *
 * Pass null when the number is pinned and must not move. Retrying would just
 * re-collide, so those fail with a message rather than landing elsewhere.
 */
async function createQuestionWithSku(
  data: Record<string, unknown>,
  allocateSku: () => number,
  allocateOrder: (() => number) | null = null,
  attempts = 8,
): Promise<{ id: string; sku: string; order: number }> {
  const { tables } = getAdminServices();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const sku = formatSku(allocateSku());
    const order =
      attempt === 0 || !allocateOrder
        ? Number(data.order ?? 1)
        : allocateOrder();

    try {
      const created = await tables.createRow({
        databaseId: appwriteEnv.databaseId,
        tableId: QUESTIONS_TABLE,
        rowId: ID.unique(),
        data: { ...data, sku, order },
      });

      return { id: String((created as { $id: string }).$id), sku, order };
    } catch (error) {
      if (!isConflict(error)) {
        throw error;
      }

      lastError = error;

      if (!allocateOrder && attempt >= 2) {
        throw new Error(
          `Item ${order} was taken while this upload was running. Check the file and import again.`,
        );
      }
    }
  }

  throw lastError ?? new Error("Could not allocate a unique SKU.");
}

/* -------------------------------------------------------------------------- */
/*  Import                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * An upload is always update-or-create, decided per row by its SKU.
 *
 * There is no mode to choose. A row carrying a SKU updates that exact
 * question; a row with an empty SKU is a new one. Nothing else can identify a
 * question reliably - item numbers move whenever anyone sorts or renumbers a
 * sheet, and matching on them meant a file numbered 1, 2, 3 could overwrite
 * three questions its author had never seen.
 */

export type ImportPlanEntry = {
  rowNumber: number;
  order: number;
  prompt: string;
  action: "create" | "update";
  existingId?: string;
  existingSku?: string;
};

export type ImportPlan = {
  resolved: ResolvedTarget;
  /**
   * The parsed rows with their final item numbers.
   *
   * Always import these, never the rows handed to `planQuestionImport` - the
   * originals still carry whatever the spreadsheet said.
   */
  rows: ParsedQuestionRow[];
  entries: ImportPlanEntry[];
  /** Rows naming a SKU that is not in this destination. Nothing is done with them. */
  unknownSkus: ImportPlanEntry[];
  createCount: number;
  updateCount: number;
};

export type ImportFailure = {
  rowNumber: number;
  order: number;
  message: string;
};

export type ImportResult = {
  created: number;
  updated: number;
  deleted: number;
  failures: ImportFailure[];
  questionCount: number;
};

function toQuestionData(row: ParsedQuestionRow, target: QuestionTarget) {
  return {
    categoryId: target.categoryId,
    // Written as "" rather than null for "no set", because that is what
    // Appwrite stores either way - being explicit keeps reads predictable.
    questionnaireId: target.setId ?? "",
    order: row.order,
    prompt: row.prompt,
    questionType: row.questionType,
    difficulty: row.difficulty,
    choices: row.choices,
    answerIndex: row.answerIndex,
    explanation: row.explanation || null,
    imageUrl: row.imageUrl || null,
    isFree: row.isFree,
  } satisfies Record<string, unknown>;
}

/**
 * Diffs a parsed file against what is already in the target.
 *
 * Matching is by item number, not by row position or by prompt text: it is the
 * only key an encoder controls and can see, so "row 12 updates question 12"
 * stays true even after they sort the sheet or fix a typo in the wording.
 */
export async function planQuestionImport(
  categoryId: string,
  setId: string,
  rows: readonly ParsedQuestionRow[],
): Promise<ImportPlan | null> {
  const resolved = await resolveTarget(categoryId, setId);

  if (!resolved) {
    return null;
  }

  const existing = await listQuestionRecords(resolved.target);
  const existingBySku = new Map(
    existing.map((record) => [String(record.sku ?? "").toUpperCase(), record]),
  );

  const takenOrders = new Set<number>(
    existing.map((record) => Number(record.order ?? 0)),
  );
  let nextOrder =
    existing.reduce(
      (highest, record) => Math.max(highest, Number(record.order ?? 0)),
      0,
    ) + 1;

  const takeNextOrder = () => {
    while (takenOrders.has(nextOrder)) {
      nextOrder += 1;
    }

    takenOrders.add(nextOrder);
    return nextOrder;
  };

  const unknownSkus: ImportPlanEntry[] = [];

  const entries: ImportPlanEntry[] = [];
  const resolvedRows: ParsedQuestionRow[] = [];

  for (const row of rows) {
    const match = row.sku ? existingBySku.get(row.sku) : undefined;

    if (row.sku && !match) {
      // A SKU we did not issue for this destination. Creating a new question
      // would duplicate whatever the author meant to edit, so it is reported.
      unknownSkus.push({
        rowNumber: row.rowNumber,
        order: row.order,
        prompt: row.prompt,
        action: "create",
      });
      continue;
    }

    if (match) {
      // An update keeps the question where it is. The No column is for reading
      // order; a row that moved in the spreadsheet did not move in the paper.
      resolvedRows.push({ ...row, order: Number(match.order ?? row.order) });
      entries.push({
        rowNumber: row.rowNumber,
        order: Number(match.order ?? row.order),
        prompt: row.prompt,
        action: "update",
        existingId: match.$id,
        existingSku: String(match.sku ?? ""),
      });
      continue;
    }

    const order = row.orderProvided && !takenOrders.has(row.order)
      ? (takenOrders.add(row.order), row.order)
      : takeNextOrder();

    resolvedRows.push({ ...row, order });
    entries.push({
      rowNumber: row.rowNumber,
      order,
      prompt: row.prompt,
      action: "create",
    });
  }

  return {
    resolved,
    rows: resolvedRows,
    entries,
    unknownSkus,
    createCount: entries.filter((entry) => entry.action === "create").length,
    updateCount: entries.filter((entry) => entry.action === "update").length,
  };
}

export async function applyQuestionImport(
  plan: ImportPlan,
  rows: readonly ParsedQuestionRow[],
): Promise<ImportResult> {
  const { tables } = getAdminServices();
  const failures: ImportFailure[] = [];
  const entryByRow = new Map(plan.entries.map((entry) => [entry.rowNumber, entry]));
  const target = plan.resolved.target;

  let nextSequence = await peekNextSkuSequence();
  const allocateSku = () => {
    const sequence = nextSequence;
    nextSequence += 1;
    return sequence;
  };

  // Shared across the run so the concurrency retry moves forward rather than
  // re-offering a number another row in this batch just took.
  let nextAppendOrder =
    plan.entries.reduce((highest, entry) => Math.max(highest, entry.order), 0) +
    1;
  const allocateOrder = () => {
    const order = nextAppendOrder;
    nextAppendOrder += 1;
    return order;
  };

  let created = 0;
  let updated = 0;

  await mapWithConcurrency(rows, WRITE_CONCURRENCY, async (row) => {
    const entry = entryByRow.get(row.rowNumber);

    if (!entry) {
      return;
    }

    const data = toQuestionData({ ...row, order: entry.order }, target);

    try {
      if (entry.existingId) {
        // An update never touches `sku` or `order`: the SKU is the identity
        // and the item number is where the question already sits.
        const { ...fields } = data;
        delete (fields as Record<string, unknown>).order;

        await tables.updateRow({
          databaseId: appwriteEnv.databaseId,
          tableId: QUESTIONS_TABLE,
          rowId: entry.existingId,
          data: fields,
        });
        updated += 1;
        return;
      }

      await createQuestionWithSku(data, allocateSku, allocateOrder);
      created += 1;
    } catch (error) {
      failures.push({
        rowNumber: row.rowNumber,
        order: entry.order,
        message: toErrorMessage(error),
      });
    }
  });

  const { count: questionCount, warnings } = await syncQuestionCounts(target);

  for (const warning of warnings) {
    failures.push({ rowNumber: 0, order: 0, message: warning });
  }

  return { created, updated, deleted: 0, failures, questionCount };
}

export function toErrorMessage(error: unknown) {
  if (error instanceof AppwriteException) {
    return error.message || `Appwrite error ${error.code}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error.";
}

async function countRows(queries: string[]) {
  const { tables } = getAdminServices();
  const response = await tables.listRows({
    databaseId: appwriteEnv.databaseId,
    tableId: QUESTIONS_TABLE,
    queries: [...queries, Query.limit(1)],
    total: true,
  });

  return Number(response.total ?? 0);
}

/**
 * Recounts a target and writes the totals back.
 *
 * The counts are denormalised so a listing does not have to count rows per
 * category; this is the one place allowed to set them, and it counts rather
 * than increments so a partially failed import still leaves a true number.
 * A set import updates two totals: the set's own, and its category's, which
 * spans every set plus the loose questions.
 */
async function countPublishedSets(categoryId: string) {
  const { tables } = getAdminServices();
  const response = await tables.listRows({
    databaseId: appwriteEnv.databaseId,
    tableId: SETS_TABLE,
    queries: [
      Query.equal("categoryId", [categoryId]),
      Query.equal("isPublished", [true]),
      Query.limit(1),
    ],
    total: true,
  });

  return Number(response.total ?? 0);
}

/**
 * Recomputes a category's rollups and, when a set is involved, the set's own.
 *
 * Everything is counted rather than incremented, so a partially failed import
 * still leaves true numbers. Failures are collected instead of thrown: the
 * questions are already saved by the time this runs, and a bookkeeping error
 * should not make a finished import look like a failed one.
 */
export async function syncCategoryRollups(categoryId: string) {
  const { tables } = getAdminServices();
  const warnings: string[] = [];

  const [questionCount, directQuestionCount, setCount] = await Promise.all([
    countRows([Query.equal("categoryId", [categoryId])]),
    // "" is how Appwrite stores "no set"; see `hasNoSet`.
    countRows([
      Query.equal("categoryId", [categoryId]),
      Query.equal("questionnaireId", [""]),
    ]),
    countPublishedSets(categoryId),
  ]);

  try {
    await tables.updateRow({
      databaseId: appwriteEnv.databaseId,
      tableId: CATEGORIES_TABLE,
      rowId: categoryId,
      data: { questionCount, directQuestionCount, setCount },
    });
  } catch (error) {
    warnings.push(
      `Could not update the counters on the category: ${toErrorMessage(error)}`,
    );
  }

  return { questionCount, directQuestionCount, setCount, warnings };
}

export async function syncQuestionCounts(target: QuestionTarget) {
  const { tables } = getAdminServices();
  const category = await syncCategoryRollups(target.categoryId);
  const warnings = [...category.warnings];

  if (!target.setId) {
    return { count: category.directQuestionCount, warnings };
  }

  const setTotal = await countRows([
    Query.equal("questionnaireId", [target.setId]),
  ]);

  try {
    await tables.updateRow({
      databaseId: appwriteEnv.databaseId,
      tableId: SETS_TABLE,
      rowId: target.setId,
      data: { questionCount: setTotal },
    });
  } catch (error) {
    warnings.push(
      `Could not update the counter on the set: ${toErrorMessage(error)}`,
    );
  }

  return { count: setTotal, warnings };
}

/* -------------------------------------------------------------------------- */
/*  Single-question writes (the manual editor)                                */
/* -------------------------------------------------------------------------- */

export type QuestionInput = {
  categoryId: string;
  setId: string | null;
  order: number;
  prompt: string;
  questionType: "multiple_choice" | "true_false";
  difficulty: "easy" | "medium" | "hard";
  choices: string[];
  answerIndex: number;
  explanation: string;
  imageUrl: string;
  isFree: boolean;
};

export async function saveQuestionRecord(
  rowId: string | null,
  input: QuestionInput,
) {
  const { tables } = getAdminServices();
  const resolved = await resolveTarget(input.categoryId, input.setId ?? "");

  if (!resolved) {
    throw new Error("Pick the exam category this question belongs to.");
  }

  const data = {
    ...toQuestionData(
      {
        rowNumber: 0,
        sku: "",
        orderProvided: true,
        order: input.order,
        prompt: input.prompt,
        questionType: input.questionType,
        difficulty: input.difficulty,
        choices: input.choices,
        answerIndex: input.answerIndex,
        explanation: input.explanation,
        imageUrl: input.imageUrl,
        isFree: input.isFree,
      },
      resolved.target,
    ),
  };

  if (rowId) {
    await tables.updateRow({
      databaseId: appwriteEnv.databaseId,
      tableId: QUESTIONS_TABLE,
      rowId,
      data,
    });

    await syncQuestionCounts(resolved.target);

    return { id: rowId, sku: "" };
  }

  let nextSequence = await peekNextSkuSequence();
  const created = await createQuestionWithSku(data, () => {
    const sequence = nextSequence;
    nextSequence += 1;
    return sequence;
  });

  await syncQuestionCounts(resolved.target);

  return created;
}

export async function deleteQuestionRecord(rowId: string) {
  const { tables } = getAdminServices();
  const record = await getQuestionRecord(rowId);

  await tables.deleteRow({
    databaseId: appwriteEnv.databaseId,
    tableId: QUESTIONS_TABLE,
    rowId,
  });

  if (record?.categoryId) {
    await syncQuestionCounts({
      categoryId: String(record.categoryId),
      setId: record.questionnaireId ? String(record.questionnaireId) : null,
    });
  }

  return record;
}

/** Highest item number already used in a target. 0 when it is empty. */
export async function getHighestItemNumber(target: QuestionTarget) {
  const records = await listQuestionRecords(target);

  return records.reduce(
    (highest, record) => Math.max(highest, Number(record.order ?? 0)),
    0,
  );
}

/** Next free item number in a target, so the editor can prefill it. */
export async function getNextItemNumber(target: QuestionTarget) {
  return (await getHighestItemNumber(target)) + 1;
}

export type NextItemNumbers = {
  /** Keyed by category id: the next number for questions with no set. */
  byCategory: Record<string, number>;
  /** Keyed by set id. */
  bySet: Record<string, number>;
};

/**
 * The next item number for every destination at once.
 *
 * The editor needs this the moment someone picks a category from a dropdown -
 * far too late to go and ask the server - so the whole map is sent with the
 * page. Numbering continues from the highest number already used rather than
 * from the count, because a paper numbered 6..60 has 55 questions and its next
 * item is 61, not 56.
 */
export async function getNextItemNumbers(): Promise<NextItemNumbers> {
  const byCategory: Record<string, number> = {};
  const bySet: Record<string, number> = {};

  if (!hasAppwriteServerEnv()) {
    return { byCategory, bySet };
  }

  const [categories, sets] = await Promise.all([
    listExamCategories(),
    listQuestionSets(),
  ]);

  await Promise.all([
    ...categories.map(async (category) => {
      byCategory[category.id] = await getNextItemNumber({
        categoryId: category.id,
        setId: null,
      });
    }),
    ...sets.map(async (set) => {
      bySet[set.id] = await getNextItemNumber({
        categoryId: set.categoryId,
        setId: set.id,
      });
    }),
  ]);

  return { byCategory, bySet };
}
