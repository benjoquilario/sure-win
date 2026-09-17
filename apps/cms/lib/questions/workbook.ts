/**
 * Excel side of the question sheet.
 *
 * Server-only: ExcelJS is a Node library and never belongs in a client bundle.
 * Everything about *what* a column means lives in `./spreadsheet`; this file
 * only knows how to get those columns in and out of an .xlsx file.
 */

import ExcelJS from "exceljs";

import {
  DIFFICULTY_SHEET_VALUES,
  QUESTION_SHEET_COLUMNS,
  QUESTION_TYPE_SHEET_VALUES,
  normalizeCell,
  toSheetMatrix,
  type ExportableQuestion,
  type QuestionSheetColumn,
} from "@/lib/questions/spreadsheet";

export const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CSV_MIME_TYPE = "text/csv; charset=utf-8";

const QUESTIONS_SHEET_NAME = "Questions";
const GUIDE_SHEET_NAME = "How to fill this in";

/** Guards a mis-picked file: a 40 MB video should fail fast, not on parse. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type SheetFileKind = "csv" | "xlsx";

/** Decides how to read an upload from its name and reported type, not trust. */
export function detectSheetFileKind(file: {
  name?: string;
  type?: string;
}): SheetFileKind | null {
  const name = (file.name ?? "").toLowerCase();
  const type = (file.type ?? "").toLowerCase();

  if (name.endsWith(".xlsx") || name.endsWith(".xlsm") || type === XLSX_MIME_TYPE) {
    return "xlsx";
  }

  if (
    name.endsWith(".csv") ||
    name.endsWith(".txt") ||
    name.endsWith(".tsv") ||
    type.startsWith("text/")
  ) {
    return "csv";
  }

  // .xls is a different, older format that ExcelJS cannot read.
  return null;
}

/**
 * Flattens the first worksheet to a string matrix.
 *
 * Every cell becomes text on the way out: the parser has one job, and it does
 * it the same whether a number came from a CSV or from a numeric Excel cell.
 */
export async function readWorkbookMatrix(
  data: ArrayBuffer,
): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);

  const worksheet =
    workbook.getWorksheet(QUESTIONS_SHEET_NAME) ?? workbook.worksheets[0];

  if (!worksheet) {
    return [];
  }

  const matrix: string[][] = [];

  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values: string[] = [];
    const cellCount = Math.max(row.cellCount, row.actualCellCount);

    for (let columnIndex = 1; columnIndex <= cellCount; columnIndex += 1) {
      values.push(readCellText(row.getCell(columnIndex).value));
    }

    matrix.push(values);
  });

  return matrix;
}

function readCellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    // Rich text, hyperlinks, formulas, and errors all arrive as objects.
    if ("richText" in value && Array.isArray(value.richText)) {
      return normalizeCell(value.richText.map((part) => part.text).join(""));
    }

    if ("text" in value && typeof value.text === "string") {
      return normalizeCell(value.text);
    }

    if ("result" in value) {
      return readCellText(value.result as ExcelJS.CellValue);
    }

    if ("error" in value) {
      return "";
    }

    return "";
  }

  return normalizeCell(value);
}

export type WorkbookMeta = {
  categoryTitle: string;
  questionnaireTitle: string;
  questionnaireCode: string;
  mode: string;
  setCode?: string | null;
};

/**
 * Builds the .xlsx an encoder actually fills in.
 *
 * Dropdowns on the enumerated columns and a guide sheet in the same file,
 * because the alternative is a wiki page nobody opens and a support thread per
 * batch about whether "Med" is a valid difficulty.
 */
export async function buildQuestionWorkbook(
  questions: readonly ExportableQuestion[],
  meta: WorkbookMeta,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Social Work Reviewer CMS";
  workbook.created = new Date();

  const matrix = toSheetMatrix(questions);
  const [headerRow, ...dataRows] = matrix;
  const sheet = workbook.addWorksheet(QUESTIONS_SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.addRow(headerRow);
  dataRows.forEach((row) => sheet.addRow(row));

  const widths = expandColumnWidths(headerRow.length);

  headerRow.forEach((header, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = widths[index] ?? 20;
    column.alignment = { vertical: "top", wrapText: widths[index] > 20 };
  });

  const heading = sheet.getRow(1);
  heading.font = { bold: true, color: { argb: "FFFFFFFF" } };
  heading.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F2937" },
  };
  heading.alignment = { vertical: "middle" };
  heading.height = 22;

  // Validation covers rows well past the current data so it survives paste-in.
  const validationLastRow = Math.max(dataRows.length, 500) + 1;
  applyListValidation(
    sheet,
    headerRow,
    "Type",
    QUESTION_TYPE_SHEET_VALUES,
    validationLastRow,
    "Use mcq for multiple choice, or true-false.",
  );
  applyListValidation(
    sheet,
    headerRow,
    "Difficulty",
    DIFFICULTY_SHEET_VALUES,
    validationLastRow,
    "Use easy, medium, or hard.",
  );
  applyListValidation(
    sheet,
    headerRow,
    "Free Sample",
    ["yes", "no"],
    validationLastRow,
    "yes shows the item to students without premium access.",
  );

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headerRow.length },
  };

  addGuideSheet(workbook, meta);

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

function expandColumnWidths(columnCount: number) {
  const widths: number[] = [];

  for (const column of QUESTION_SHEET_COLUMNS) {
    widths.push(column.width);
  }

  // `toSheetMatrix` can emit more choice columns than the template ships.
  const extraChoiceColumns = columnCount - widths.length;
  const choiceWidth =
    QUESTION_SHEET_COLUMNS.find(
      (column: QuestionSheetColumn) => column.key === "choice",
    )?.width ?? 34;

  if (extraChoiceColumns > 0) {
    const insertAt = QUESTION_SHEET_COLUMNS.findIndex(
      (column) => column.key === "choice",
    );

    widths.splice(
      insertAt,
      0,
      ...Array.from({ length: extraChoiceColumns }, () => choiceWidth),
    );
  }

  return widths;
}

function applyListValidation(
  sheet: ExcelJS.Worksheet,
  headerRow: readonly string[],
  header: string,
  values: readonly string[],
  lastRow: number,
  prompt: string,
) {
  const columnIndex = headerRow.indexOf(header);

  if (columnIndex === -1) {
    return;
  }

  const columnLetter = sheet.getColumn(columnIndex + 1).letter;

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    sheet.getCell(`${columnLetter}${rowNumber}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${values.join(",")}"`],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: header,
      error: prompt,
    };
  }
}

function addGuideSheet(workbook: ExcelJS.Workbook, meta: WorkbookMeta) {
  const guide = workbook.addWorksheet(GUIDE_SHEET_NAME);
  guide.columns = [
    { key: "column", width: 18 },
    { key: "required", width: 12 },
    { key: "help", width: 90 },
  ];

  const title = guide.addRow([meta.questionnaireTitle]);
  title.font = { bold: true, size: 14 };

  guide.addRow([
    `${meta.categoryTitle} - ${meta.mode}${meta.setCode ? ` - Set ${meta.setCode}` : ""} - code ${meta.questionnaireCode}`,
  ]);
  guide.addRow([]);
  guide.addRow([
    "Fill in the Questions sheet: one row per question. Do not rename or reorder the header row.",
  ]);
  guide.addRow([
    "Item numbers (No) identify a question when you upload the file again: same number means update, new number means add.",
  ]);
  guide.addRow([
    "You never type a SKU. The system assigns one on the first upload and keeps it on every later one, so answer history is never lost.",
  ]);
  guide.addRow([]);

  const header = guide.addRow(["Column", "Required", "What to put in it"]);
  header.font = { bold: true };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE5E7EB" },
  };

  for (const column of QUESTION_SHEET_COLUMNS) {
    const row = guide.addRow([
      column.header,
      column.required ? "Required" : "Optional",
      column.help,
    ]);
    row.alignment = { vertical: "top", wrapText: true };
  }

  return guide;
}
