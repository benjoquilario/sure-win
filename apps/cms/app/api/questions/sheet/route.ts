import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/appwrite/auth";
import { hasAppwriteServerEnv } from "@/lib/appwrite/env";
import { listQuestionRecords, resolveTarget } from "@/lib/appwrite/questions";
import {
  SAMPLE_SHEET_ROWS,
  toCsv,
  toSheetMatrix,
  type ExportableQuestion,
} from "@/lib/questions/spreadsheet";
import {
  CSV_MIME_TYPE,
  XLSX_MIME_TYPE,
  buildQuestionWorkbook,
} from "@/lib/questions/workbook";

export const runtime = "nodejs";
/** Every response depends on the signed-in user and live rows. */
export const dynamic = "force-dynamic";

type SheetContent = "current" | "sample" | "blank";

function resolveContent(value: string | null): SheetContent {
  return value === "sample" || value === "blank" ? value : "current";
}

function toFileSlug(code: string) {
  return (
    `${code}-questions`
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "questions"
  );
}

/**
 * Serves the sheet an encoder fills in - the header row and, unless they asked
 * for a blank one, the questions already in the target.
 *
 * Exporting in the same shape the importer reads back is what makes "download,
 * edit, re-upload" the normal way to fix a batch: the item numbers come back
 * unchanged, so every SKU survives the round trip.
 */
export async function GET(request: Request) {
  if (!hasAppwriteServerEnv()) {
    return NextResponse.json(
      { error: "Appwrite server configuration is incomplete." },
      { status: 503 },
    );
  }

  const { error: authError } = await authorizeRequest("questions.view");

  if (authError) {
    return NextResponse.json(
      { error: authError.message },
      { status: authError.status },
    );
  }

  const url = new URL(request.url);
  const categoryId = String(url.searchParams.get("categoryId") ?? "").trim();
  const setId = String(url.searchParams.get("setId") ?? "").trim();
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const content = resolveContent(url.searchParams.get("content"));

  if (!categoryId) {
    return NextResponse.json(
      { error: "Pick an exam category first." },
      { status: 400 },
    );
  }

  const resolved = await resolveTarget(categoryId, setId);

  if (!resolved) {
    return NextResponse.json(
      { error: "That exam category does not exist." },
      { status: 404 },
    );
  }

  let questions: ExportableQuestion[] = [];

  if (content === "current") {
    const records = await listQuestionRecords(resolved.target);

    questions = records.map((record) => ({
      // The SKU goes out with every row: it is what brings the row back to
      // the right question on re-upload.
      sku: String(record.sku ?? ""),
      order: Number(record.order ?? 0),
      prompt: String(record.prompt ?? ""),
      questionType: String(record.questionType ?? "multiple_choice"),
      difficulty: String(record.difficulty ?? "medium"),
      choices: (record.choices ?? []) as string[],
      answerIndex: Number(record.answerIndex ?? 0),
      explanation: String(record.explanation ?? ""),
      imageUrl: String(record.imageUrl ?? ""),
      isFree: record.isFree === true,
    }));

    // An empty target downloads with worked examples rather than bare headers.
    if (!questions.length) {
      questions = [...SAMPLE_SHEET_ROWS];
    }
  } else if (content === "sample") {
    questions = [...SAMPLE_SHEET_ROWS];
  }

  const fileName = `${toFileSlug(resolved.code)}.${format}`;
  const headers = {
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "no-store",
  };

  if (format === "csv") {
    return new NextResponse(toCsv(toSheetMatrix(questions)), {
      headers: { ...headers, "Content-Type": CSV_MIME_TYPE },
    });
  }

  const workbook = await buildQuestionWorkbook(questions, {
    categoryTitle: resolved.category.title,
    questionnaireTitle: resolved.label,
    questionnaireCode: resolved.code,
    mode: resolved.category.mode === "quiz" ? "Quiz" : "Board Exam",
    setCode: resolved.set?.setCode ?? null,
  });

  return new NextResponse(workbook, {
    headers: { ...headers, "Content-Type": XLSX_MIME_TYPE },
  });
}
