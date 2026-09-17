/**
 * Shapes shared by the import/editor server actions and the forms that call
 * them.
 *
 * They live outside the `"use server"` module because that file may only export
 * async functions - a plain constant there is a build error, not a lint nit.
 */

import type { SheetIssue } from "@/lib/questions/spreadsheet";

export type ImportPreviewRow = {
  rowNumber: number;
  order: number;
  action: "create" | "update";
  prompt: string;
  answer: string;
  choiceCount: number;
  questionType: string;
  difficulty: string;
};

export type QuestionImportState = {
  status: "idle" | "preview" | "imported" | "error";
  message: string;
  fileName: string;
  errors: SheetIssue[];
  warnings: SheetIssue[];
  /** Issue counts before truncation, so "showing 60 of 240" stays honest. */
  errorCount: number;
  warningCount: number;
  preview: ImportPreviewRow[];
  totals: {
    rows: number;
    create: number;
    update: number;
    /** Rows naming a SKU this destination does not have. */
    unknown: number;
    skipped: number;
  } | null;
  result: {
    created: number;
    updated: number;
    deleted: number;
    questionCount: number;
    failures: string[];
  } | null;
};

export const emptyImportState: QuestionImportState = {
  status: "idle",
  message: "",
  fileName: "",
  errors: [],
  warnings: [],
  errorCount: 0,
  warningCount: 0,
  preview: [],
  totals: null,
  result: null,
};

export type QuestionFormState = {
  status: "idle" | "error";
  message: string;
  errors: SheetIssue[];
};

export const emptyQuestionFormState: QuestionFormState = {
  status: "idle",
  message: "",
  errors: [],
};

/** Field-level lookup for the editor: which inputs a validation issue touches. */
export function findIssue(issues: readonly SheetIssue[], column: string) {
  return issues.find(
    (issue) => (issue.column ?? "").toLowerCase() === column.toLowerCase(),
  );
}
