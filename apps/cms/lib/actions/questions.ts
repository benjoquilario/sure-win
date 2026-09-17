"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/appwrite/auth";
import { recordStaffActivity } from "@/lib/appwrite/staff";
import { hasAppwriteServerEnv } from "@/lib/appwrite/env";
import {
  applyQuestionImport,
  deleteQuestionRecord,
  planQuestionImport,
  saveQuestionRecord,
  toErrorMessage,
} from "@/lib/appwrite/questions";
import { toChoiceLabel } from "@workspace/schema";
import {
  emptyImportState,
  type ImportPreviewRow,
  type QuestionFormState,
  type QuestionImportState,
} from "@/lib/questions/import-state";
import {
  parseDelimitedText,
  parseQuestionRow,
  parseQuestionSheet,
  type ParsedQuestionRow,
} from "@/lib/questions/spreadsheet";
import {
  MAX_UPLOAD_BYTES,
  detectSheetFileKind,
  readWorkbookMatrix,
} from "@/lib/questions/workbook";

/** Caps on what travels back to the browser; the counts stay exact. */
const MAX_REPORTED_ISSUES = 60;
const MAX_PREVIEW_ROWS = 25;

function failState(
  message: string,
  overrides: Partial<QuestionImportState> = {},
): QuestionImportState {
  return { ...emptyImportState, status: "error", message, ...overrides };
}

async function readSheetMatrix(file: File): Promise<string[][]> {
  const kind = detectSheetFileKind(file);

  if (kind === "xlsx") {
    return readWorkbookMatrix(await file.arrayBuffer());
  }

  if (kind === "csv") {
    return parseDelimitedText(await file.text());
  }

  throw new Error(
    "Unsupported file type. Upload the .xlsx or .csv template. (An old .xls file has to be re-saved as .xlsx first.)",
  );
}

/**
 * Checks a file, and on the second pass writes it.
 *
 * One action for both because the file itself is the state: the browser
 * resubmits the same upload with `intent=import`, so nothing has to be parked
 * on the server between the preview and the commit.
 */
export async function importQuestionsAction(
  _previousState: QuestionImportState,
  formData: FormData,
): Promise<QuestionImportState> {
  const cmsUser = await requirePermission(
    "questions.import",
    "/dashboard/questions",
  );

  if (!hasAppwriteServerEnv()) {
    return failState("Appwrite server credentials are not configured.");
  }

  const categoryId = String(formData.get("categoryId") ?? "").trim();
  const setId = String(formData.get("setId") ?? "").trim();
  const intent = String(formData.get("intent") ?? "preview");
  const file = formData.get("file");

  if (!categoryId) {
    return failState("Pick the exam category this file belongs to.", {
    });
  }

  if (!(file instanceof File) || file.size === 0) {
    return failState("Choose a filled-in .xlsx or .csv file first.", {});
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return failState(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      { fileName: file.name },
    );
  }

  let matrix: string[][];

  try {
    matrix = await readSheetMatrix(file);
  } catch (error) {
    return failState(toErrorMessage(error), {
      fileName: file.name,
    });
  }

  const parsed = parseQuestionSheet(matrix);
  const base: QuestionImportState = {
    ...emptyImportState,
    fileName: file.name,
    errors: parsed.errors.slice(0, MAX_REPORTED_ISSUES),
    warnings: parsed.warnings.slice(0, MAX_REPORTED_ISSUES),
    errorCount: parsed.errors.length,
    warningCount: parsed.warnings.length,
  };

  if (parsed.errors.length) {
    return {
      ...base,
      status: "error",
      message: `${parsed.errors.length} ${parsed.errors.length === 1 ? "row needs" : "rows need"} fixing before this file can be imported. Nothing was saved.`,
    };
  }

  if (!parsed.questions.length) {
    return {
      ...base,
      status: "error",
      message: "The file has a header row but no questions under it.",
    };
  }

  const plan = await planQuestionImport(categoryId, setId, parsed.questions);

  if (!plan) {
    return failState("That exam category no longer exists.", {
      fileName: file.name,
    });
  }

  const totals = {
    rows: parsed.questions.length,
    create: plan.createCount,
    update: plan.updateCount,
    unknown: plan.unknownSkus.length,
    skipped: parsed.skippedRows,
  };

  const preview: ImportPreviewRow[] = plan.entries
    .slice(0, MAX_PREVIEW_ROWS)
    .map((entry, index) => {
      const row = plan.rows[index];

      return {
        rowNumber: entry.rowNumber,
        order: entry.order,
        action: entry.action,
        prompt: entry.prompt,
        answer: row ? toChoiceLabel(row.answerIndex) : "",
        choiceCount: row?.choices.length ?? 0,
        questionType: row?.questionType ?? "multiple_choice",
        difficulty: row?.difficulty ?? "medium",
      };
    });

  if (intent !== "import") {
    return {
      ...base,
      status: "preview",
      message: [
        totals.update ? `${totals.update} will be updated` : "",
        totals.create ? `${totals.create} will be added` : "",
      ]
        .filter(Boolean)
        .join(", ")
        .concat(
          ` from ${file.name}. Nothing has been saved yet.`,
        ),
      preview,
      totals,
    };
  }

  // plan.rows, not parsed.questions: blank item numbers were resolved against
  // the destination during planning, and the originals still hold the blanks.
  const result = await applyQuestionImport(plan, plan.rows).catch((error) => {
    throw new Error(toErrorMessage(error));
  });

  await recordStaffActivity({
    actor: cmsUser,
    action: "questions_imported",
    summary: `Uploaded ${file.name} to ${plan.resolved.label}: ${result.updated} updated, ${result.created} added`,
    targetTable: "questions",
    targetId: categoryId,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/upload");
  revalidatePath("/dashboard/questions");
  revalidatePath("/dashboard/questionnaires");
  revalidatePath("/dashboard/exam_categories");

  const summary = [
    result.updated ? `${result.updated} updated` : "",
    result.created ? `${result.created} added` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return {
    ...base,
    status: result.failures.length ? "error" : "imported",
    message: result.failures.length
      ? `${summary || "Nothing saved"}, but ${result.failures.length} ${result.failures.length === 1 ? "row" : "rows"} failed to save.`
      : `${summary || "No changes"}. ${plan.resolved.label} now has ${result.questionCount} questions.`,
    preview,
    totals,
    result: {
      created: result.created,
      updated: result.updated,
      deleted: result.deleted,
      questionCount: result.questionCount,
      failures: result.failures
        .slice(0, MAX_REPORTED_ISSUES)
        .map((failure) => `Item ${failure.order}: ${failure.message}`),
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Manual editor                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Saves one hand-typed question.
 *
 * The form is run through the same validator as an uploaded row, so a question
 * typed in the dashboard and the same question uploaded in a sheet can never
 * end up held to different rules.
 */
export async function saveQuestionAction(
  _previousState: QuestionFormState,
  formData: FormData,
): Promise<QuestionFormState> {
  const cmsUser = await requirePermission(
    formData.get("rowId") ? "questions.edit" : "questions.create",
    "/dashboard/questions",
  );

  if (!hasAppwriteServerEnv()) {
    return {
      status: "error",
      message: "Appwrite server credentials are not configured.",
      errors: [],
    };
  }

  const rowId = String(formData.get("rowId") ?? "").trim() || null;
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  const setId = String(formData.get("setId") ?? "").trim() || null;

  if (!categoryId) {
    return {
      status: "error",
      message: "Pick the exam category this question belongs to.",
      errors: [],
    };
  }

  const choices = formData
    .getAll("choice")
    .map((value) => String(value ?? "").trim());
  const answerIndex = Number.parseInt(
    String(formData.get("answerIndex") ?? "0"),
    10,
  );

  const parsed = parseQuestionRow({
    rowNumber: 0,
    fallbackOrder: 1,
    // The editor writes one question at a time; the SKU column belongs to the
    // sheet, and this row's identity is the row id it was opened from.
    sku: "",
    order: String(formData.get("order") ?? ""),
    prompt: String(formData.get("prompt") ?? ""),
    choices,
    // The editor knows the position; the validator speaks letters.
    answer: Number.isFinite(answerIndex) ? toChoiceLabel(answerIndex) : "",
    questionType: String(formData.get("questionType") ?? "mcq"),
    difficulty: String(formData.get("difficulty") ?? "medium"),
    explanation: String(formData.get("explanation") ?? ""),
    imageUrl: String(formData.get("imageUrl") ?? ""),
    isFree: formData.get("isFree") === "true" ? "yes" : "no",
  });

  if (!parsed.question) {
    return {
      status: "error",
      message: "Fix the highlighted fields and save again.",
      errors: parsed.errors,
    };
  }

  const question: ParsedQuestionRow = parsed.question;
  let savedId: string;

  try {
    const saved = await saveQuestionRecord(rowId, {
      categoryId,
      setId,
      order: question.order,
      prompt: question.prompt,
      questionType: question.questionType,
      difficulty: question.difficulty,
      choices: question.choices,
      answerIndex: question.answerIndex,
      explanation: question.explanation,
      imageUrl: question.imageUrl,
      isFree: question.isFree,
    });

    savedId = saved.id || rowId || "";
  } catch (error) {
    return {
      status: "error",
      message: toErrorMessage(error),
      errors: [],
    };
  }

  await recordStaffActivity({
    actor: cmsUser,
    action: rowId ? "record_updated" : "record_created",
    summary: `${rowId ? "Edited" : "Wrote"} question ${question.order}: ${question.prompt.slice(0, 120)}`,
    targetTable: "questions",
    targetId: savedId,
  });

  revalidatePath("/dashboard/questions");
  revalidatePath("/dashboard/upload");
  revalidatePath("/dashboard/exam_categories");

  redirect(
    savedId
      ? `/dashboard/questions/${savedId}?success=saved`
      : `/dashboard/questions?success=saved`,
  );
}

export async function deleteQuestionAction(formData: FormData) {
  const cmsUser = await requirePermission(
    "questions.delete",
    "/dashboard/questions",
  );

  const rowId = String(formData.get("rowId") ?? "").trim();

  if (!rowId) {
    redirect("/dashboard/questions?error=Missing question");
  }

  const record = await deleteQuestionRecord(rowId);
  const categoryId = String(record?.categoryId ?? "");

  await recordStaffActivity({
    actor: cmsUser,
    action: "record_deleted",
    summary: `Deleted question ${record?.sku ?? rowId}`,
    targetTable: "questions",
    targetId: rowId,
  });

  revalidatePath("/dashboard/questions");
  revalidatePath("/dashboard/upload");
  revalidatePath("/dashboard/exam_categories");

  redirect(
    categoryId
      ? `/dashboard/questions?categoryId=${categoryId}&success=deleted`
      : "/dashboard/questions?success=deleted",
  );
}
