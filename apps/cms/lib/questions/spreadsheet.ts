/**
 * The question spreadsheet contract.
 *
 * One row is one question. Choices live in their own columns (A, B, C, ...)
 * rather than packed into a single cell, because the people filling this in
 * work in Excel: a cell per choice is visible, sortable, and spell-checkable,
 * while a packed cell needs Alt+Enter to edit and tends to lose its line breaks
 * the moment someone round-trips the file through another tool.
 *
 * Nothing here touches Appwrite or `node:` APIs - it is text in, records out,
 * so the same code validates the browser preview and the server import.
 */

import {
  fromChoiceLabel,
  toChoiceLabel,
  type QuestionDifficulty,
  type QuestionType,
} from "@workspace/schema";

/** Choice columns shipped in the template. The parser accepts up to `MAX_CHOICES`. */
export const TEMPLATE_CHOICE_COUNT = 5;
export const MAX_CHOICES = 8;
export const MAX_PROMPT_LENGTH = 5000;
export const MAX_EXPLANATION_LENGTH = 5000;
export const MAX_CHOICE_LENGTH = 2000;
export const MAX_IMAGE_LENGTH = 2048;
/** A hard stop so a mis-picked file cannot become a 50k-row write loop. */
export const MAX_IMPORT_ROWS = 2000;

export type QuestionSheetColumnKey =
  | "sku"
  | "order"
  | "prompt"
  | "choice"
  | "answer"
  | "questionType"
  | "difficulty"
  | "explanation"
  | "imageUrl"
  | "isFree";

type FixedColumnKey = Exclude<QuestionSheetColumnKey, "choice">;

export type QuestionSheetColumn = {
  key: QuestionSheetColumnKey;
  /** Header written into the template. */
  header: string;
  /** Zero-based choice position, for `key: "choice"` columns only. */
  choiceIndex?: number;
  required: boolean;
  width: number;
  help: string;
  /** Extra headers accepted on import. Never written out. */
  aliases?: readonly string[];
};

function choiceColumn(index: number): QuestionSheetColumn {
  const label = toChoiceLabel(index);

  return {
    key: "choice",
    header: label,
    choiceIndex: index,
    required: index < 2,
    width: 34,
    help:
      index < 2
        ? `Choice ${label}. A and B are required; leave later letters blank for shorter items.`
        : `Choice ${label}. Leave blank if the item has fewer choices.`,
    aliases: [`choice ${label}`, `option ${label}`],
  };
}

export const QUESTION_SHEET_COLUMNS: readonly QuestionSheetColumn[] = [
  {
    key: "sku",
    header: "SKU",
    required: false,
    width: 12,
    help: "Filled in for you. Leave a row's SKU alone to update that question, and leave it EMPTY on a new row. Do not invent one.",
    aliases: ["id", "question id", "item id"],
  },
  {
    key: "order",
    header: "No",
    required: false,
    width: 6,
    help: "Item number, for reading order. Changing it on a row that already has a SKU does nothing - the question keeps its place. Blank on a new row means it goes to the end.",
    aliases: ["number", "item", "item no", "q no", "question no"],
  },
  {
    key: "prompt",
    header: "Question",
    required: true,
    width: 60,
    help: "The question as the student reads it.",
    aliases: ["prompt", "question text"],
  },
  ...Array.from({ length: TEMPLATE_CHOICE_COUNT }, (_, index) =>
    choiceColumn(index),
  ),
  {
    key: "answer",
    header: "Answer",
    required: true,
    width: 10,
    help: "The correct choice, as a letter (A, B, C...). The full choice text or True/False also works.",
    aliases: ["correct", "correct answer", "key", "answer key"],
  },
  {
    key: "questionType",
    header: "Type",
    required: false,
    width: 14,
    help: "mcq or true-false. Blank means mcq.",
    aliases: ["question type", "item type"],
  },
  {
    key: "difficulty",
    header: "Difficulty",
    required: false,
    width: 12,
    help: "easy, medium, or hard. Blank means medium.",
    aliases: ["level"],
  },
  {
    key: "explanation",
    header: "Explanation",
    required: false,
    width: 60,
    help: "Optional rationale shown after the student answers.",
    aliases: ["rationale", "explanations", "reason"],
  },
  {
    key: "imageUrl",
    header: "Image",
    required: false,
    width: 34,
    help: "Optional. Paste a link to the figure, or the /api/assets/... path from a CMS upload.",
    aliases: ["image url", "figure", "photo", "picture"],
  },
  {
    key: "isFree",
    header: "Free Sample",
    required: false,
    width: 12,
    help: "yes to show this item to non-premium students. Blank means no.",
    aliases: ["free", "sample", "preview"],
  },
] as const;

/**
 * The SKU is the identity of a question, and the sheet carries it.
 *
 * A downloaded row comes back with its SKU, so an upload knows precisely which
 * question each row is - not "whatever is currently item 12", which moves the
 * moment anyone sorts or renumbers. An empty SKU means a new question, and the
 * importer mints one; nobody ever types a SKU by hand.
 */
export const QUESTION_SHEET_HEADERS = QUESTION_SHEET_COLUMNS.map(
  (column) => column.header,
);

export const QUESTION_TYPE_SHEET_VALUES = ["mcq", "true-false"] as const;
export const DIFFICULTY_SHEET_VALUES = ["easy", "medium", "hard"] as const;

const QUESTION_TYPE_ALIASES: Record<string, QuestionType> = {
  mcq: "multiple_choice",
  multiplechoice: "multiple_choice",
  multiple: "multiple_choice",
  choice: "multiple_choice",
  multiplechoicequestion: "multiple_choice",
  truefalse: "true_false",
  tf: "true_false",
  boolean: "true_false",
  trueorfalse: "true_false",
};

const DIFFICULTY_ALIASES: Record<string, QuestionDifficulty> = {
  easy: "easy",
  e: "easy",
  simple: "easy",
  beginner: "easy",
  "1": "easy",
  medium: "medium",
  med: "medium",
  m: "medium",
  average: "medium",
  moderate: "medium",
  "2": "medium",
  hard: "hard",
  h: "hard",
  difficult: "hard",
  advanced: "hard",
  "3": "hard",
};

const TRUTHY = new Set(["yes", "y", "true", "1", "oo", "opo", "x"]);
const FALSY = new Set(["no", "n", "false", "0", "hindi", "wala"]);

/** Header/keyword comparison key: case, spaces, and punctuation all ignored. */
function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Cell text cleanup: non-breaking spaces, stray control characters, padding. */
export function normalizeCell(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/* -------------------------------------------------------------------------- */
/*  Delimited text                                                            */
/* -------------------------------------------------------------------------- */

/**
 * RFC 4180 reader, with the two deviations real files have: a UTF-8 BOM from
 * Excel, and semicolon separators from locales where the comma is the decimal
 * mark. Hand-written rather than pulled in as a dependency because the format
 * is small and the failure modes have to produce our own messages.
 */
export function parseDelimitedText(input: string): string[][] {
  const text = input.replace(/^\ufeff/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };

  const endRow = () => {
    endField();
    // Blank lines are kept so row numbers still match what Excel shows; the
    // sheet parser skips them. Trailing blanks are trimmed below, so a file
    // ending in a newline does not report a phantom empty row.
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }

        quoted = false;
        index += 1;
        continue;
      }

      field += character;
      index += 1;
      continue;
    }

    if (character === '"' && field === "") {
      quoted = true;
      index += 1;
      continue;
    }

    if (character === delimiter) {
      endField();
      index += 1;
      continue;
    }

    if (character === "\r") {
      index += text[index + 1] === "\n" ? 2 : 1;
      endRow();
      continue;
    }

    if (character === "\n") {
      index += 1;
      endRow();
      continue;
    }

    field += character;
    index += 1;
  }

  if (field !== "" || row.length) {
    endRow();
  }

  while (rows.length && rows[rows.length - 1].every((value) => value === "")) {
    rows.pop();
  }

  return rows;
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";

  // Counted outside quotes only: a comma inside a quoted question is not a column.
  const counts = [",", ";", "\t"].map((candidate) => {
    let quoted = false;
    let count = 0;

    for (const character of firstLine) {
      if (character === '"') {
        quoted = !quoted;
      } else if (!quoted && character === candidate) {
        count += 1;
      }
    }

    return { candidate, count };
  });

  const best = counts.reduce((winner, item) =>
    item.count > winner.count ? item : winner,
  );

  return best.count > 0 ? best.candidate : ",";
}

function escapeCsvField(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Serializes a matrix to CSV. The BOM is what makes Excel read it as UTF-8. */
export function toCsv(rows: readonly (readonly string[])[]) {
  const body = rows
    .map((row) => row.map((value) => escapeCsvField(value ?? "")).join(","))
    .join("\r\n");

  return `\ufeff${body}\r\n`;
}

/* -------------------------------------------------------------------------- */
/*  Header mapping                                                            */
/* -------------------------------------------------------------------------- */

export type SheetHeaderMap = Record<FixedColumnKey, number | null> & {
  /** File column index per choice position, in choice order. */
  choices: number[];
  unknownHeaders: string[];
};

export function mapSheetHeaders(headerRow: readonly string[]): SheetHeaderMap {
  const map: SheetHeaderMap = {
    sku: null,
    order: null,
    prompt: null,
    answer: null,
    questionType: null,
    difficulty: null,
    explanation: null,
    imageUrl: null,
    isFree: null,
    choices: [],
    unknownHeaders: [],
  };

  const choiceColumns: Array<{ choiceIndex: number; columnIndex: number }> = [];

  headerRow.forEach((rawHeader, columnIndex) => {
    const key = normalizeKey(normalizeCell(rawHeader));

    if (!key) {
      return;
    }

    // A bare letter header ("A", "B") is a choice column; so is "Choice A".
    const choiceIndex = resolveChoiceHeader(key);

    if (choiceIndex !== null) {
      choiceColumns.push({ choiceIndex, columnIndex });
      return;
    }

    const column = QUESTION_SHEET_COLUMNS.find(
      (candidate) =>
        candidate.key !== "choice" &&
        (normalizeKey(candidate.header) === key ||
          (candidate.aliases ?? []).some((alias) => normalizeKey(alias) === key)),
    );

    if (!column) {
      map.unknownHeaders.push(normalizeCell(rawHeader));
      return;
    }

    const fixedKey = column.key as FixedColumnKey;

    // First column wins, so a duplicated header cannot silently shadow the real one.
    if (map[fixedKey] === null) {
      map[fixedKey] = columnIndex;
    }
  });

  map.choices = choiceColumns
    .sort((left, right) => left.choiceIndex - right.choiceIndex)
    .map((entry) => entry.columnIndex);

  return map;
}

function resolveChoiceHeader(normalizedKey: string): number | null {
  const label = /^(?:choice|option)?([a-z])$/.exec(normalizedKey)?.[1];

  if (!label) {
    return null;
  }

  const index = fromChoiceLabel(label);

  return index !== null && index < MAX_CHOICES ? index : null;
}

/* -------------------------------------------------------------------------- */
/*  Row parsing                                                               */
/* -------------------------------------------------------------------------- */

export type SheetIssue = {
  /** Row number as Excel shows it, so an encoder can jump straight to it. */
  rowNumber: number;
  column: string | null;
  message: string;
};

export type ParsedQuestionRow = {
  rowNumber: number;
  /** Blank for a new question; otherwise the question this row updates. */
  sku: string;
  order: number;
  /**
   * False when the No column was left blank.
   *
   * The parser cannot resolve a blank number on its own - "next free" depends
   * on what is already in the destination, which only the importer knows - so
   * it records that the number was not given and lets the plan assign one.
   */
  orderProvided: boolean;
  prompt: string;
  questionType: QuestionType;
  difficulty: QuestionDifficulty;
  choices: string[];
  answerIndex: number;
  explanation: string;
  imageUrl: string;
  isFree: boolean;
};

export type ParsedQuestionSheet = {
  questions: ParsedQuestionRow[];
  errors: SheetIssue[];
  warnings: SheetIssue[];
  /** Blank rows, reported so a short import is never a surprise. */
  skippedRows: number;
  unknownHeaders: string[];
};

export function parseQuestionSheet(
  matrix: readonly (readonly string[])[],
): ParsedQuestionSheet {
  const errors: SheetIssue[] = [];
  const warnings: SheetIssue[] = [];
  const questions: ParsedQuestionRow[] = [];
  let skippedRows = 0;

  const headerRowIndex = matrix.findIndex((row) =>
    row.some((cell) => normalizeKey(normalizeCell(cell)) !== ""),
  );

  if (headerRowIndex === -1) {
    return {
      questions,
      errors: [
        {
          rowNumber: 1,
          column: null,
          message: "The file is empty. Download the template and fill it in.",
        },
      ],
      warnings,
      skippedRows: 0,
      unknownHeaders: [],
    };
  }

  const headers = mapSheetHeaders(matrix[headerRowIndex] ?? []);

  if (headers.prompt === null) {
    errors.push({
      rowNumber: headerRowIndex + 1,
      column: "Question",
      message:
        "No Question column found. The first row has to be the template's header row.",
    });
  }

  if (headers.answer === null) {
    errors.push({
      rowNumber: headerRowIndex + 1,
      column: "Answer",
      message: "No Answer column found.",
    });
  }

  if (!headers.choices.length) {
    errors.push({
      rowNumber: headerRowIndex + 1,
      column: "A",
      message: "No choice columns (A, B, C...) found.",
    });
  }

  for (const unknownHeader of headers.unknownHeaders) {
    warnings.push({
      rowNumber: headerRowIndex + 1,
      column: unknownHeader,
      message: `Column "${unknownHeader}" is not part of the template and was ignored.`,
    });
  }

  if (errors.length) {
    return {
      questions,
      errors,
      warnings,
      skippedRows,
      unknownHeaders: headers.unknownHeaders,
    };
  }

  const dataRows = matrix.slice(headerRowIndex + 1);

  if (dataRows.length > MAX_IMPORT_ROWS) {
    return {
      questions,
      errors: [
        {
          rowNumber: headerRowIndex + 1,
          column: null,
          message: `The file has ${dataRows.length} rows. Split it: one import handles at most ${MAX_IMPORT_ROWS}.`,
        },
      ],
      warnings,
      skippedRows,
      unknownHeaders: headers.unknownHeaders,
    };
  }

  const seenSkus = new Map<string, number>();

  dataRows.forEach((rawRow, dataIndex) => {
    const rowNumber = headerRowIndex + dataIndex + 2;
    const cell = (columnIndex: number | null) =>
      columnIndex === null ? "" : normalizeCell(rawRow[columnIndex]);

    if (rawRow.every((value) => normalizeCell(value) === "")) {
      skippedRows += 1;
      return;
    }

    const parsed = parseQuestionRow({
      rowNumber,
      fallbackOrder: questions.length + 1,
      sku: cell(headers.sku),
      order: cell(headers.order),
      prompt: cell(headers.prompt),
      choices: headers.choices.map((columnIndex) => cell(columnIndex)),
      answer: cell(headers.answer),
      questionType: cell(headers.questionType),
      difficulty: cell(headers.difficulty),
      explanation: cell(headers.explanation),
      imageUrl: cell(headers.imageUrl),
      isFree: cell(headers.isFree),
    });

    errors.push(...parsed.errors);
    warnings.push(...parsed.warnings);

    if (!parsed.question) {
      return;
    }

    // Only a number someone actually typed can be a duplicate; blanks are
    // assigned later, against the destination.
    const duplicateSkuRow = parsed.question.sku
      ? seenSkus.get(parsed.question.sku)
      : undefined;

    if (duplicateSkuRow) {
      errors.push({
        rowNumber,
        column: "SKU",
        message: `${parsed.question.sku} also appears on row ${duplicateSkuRow}. Two rows cannot update the same question.`,
      });
      return;
    }

    if (parsed.question.sku) {
      seenSkus.set(parsed.question.sku, rowNumber);
    }

    questions.push(parsed.question);
  });

  return {
    questions,
    errors,
    warnings,
    skippedRows,
    unknownHeaders: headers.unknownHeaders,
  };
}

type RawQuestionRow = {
  rowNumber: number;
  fallbackOrder: number;
  sku: string;
  order: string;
  prompt: string;
  choices: string[];
  answer: string;
  questionType: string;
  difficulty: string;
  explanation: string;
  imageUrl: string;
  isFree: string;
};

export function parseQuestionRow(raw: RawQuestionRow): {
  question: ParsedQuestionRow | null;
  errors: SheetIssue[];
  warnings: SheetIssue[];
} {
  const errors: SheetIssue[] = [];
  const warnings: SheetIssue[] = [];
  const issue = (column: string | null, message: string) =>
    errors.push({ rowNumber: raw.rowNumber, column, message });
  const warn = (column: string | null, message: string) =>
    warnings.push({ rowNumber: raw.rowNumber, column, message });

  const questionType = resolveQuestionType(raw.questionType);

  if (raw.questionType && !questionType) {
    issue(
      "Type",
      `"${raw.questionType}" is not a question type. Use mcq or true-false.`,
    );
  }

  const resolvedType: QuestionType = questionType ?? "multiple_choice";
  const difficulty = resolveDifficulty(raw.difficulty);

  if (raw.difficulty && !difficulty) {
    issue(
      "Difficulty",
      `"${raw.difficulty}" is not a difficulty. Use easy, medium, or hard.`,
    );
  }

  if (!raw.prompt) {
    issue("Question", "The question is blank.");
  } else if (raw.prompt.length > MAX_PROMPT_LENGTH) {
    issue(
      "Question",
      `The question is ${raw.prompt.length} characters; the limit is ${MAX_PROMPT_LENGTH}.`,
    );
  }

  const choices = resolveChoices(raw.choices, resolvedType, { issue });
  const answerIndex = resolveAnswerIndex(raw.answer, choices, resolvedType);

  if (!raw.answer) {
    issue("Answer", "The answer is blank.");
  } else if (answerIndex === null && choices.length) {
    issue(
      "Answer",
      `"${raw.answer}" does not match a filled-in choice. Use ${choices
        .map((_, index) => toChoiceLabel(index))
        .join(", ")}, or type the choice exactly.`,
    );
  }

  const order = resolveOrder(raw.order, raw.fallbackOrder);

  if (raw.order && order === null) {
    issue("No", `"${raw.order}" is not an item number.`);
  }

  if (raw.explanation.length > MAX_EXPLANATION_LENGTH) {
    issue(
      "Explanation",
      `The explanation is ${raw.explanation.length} characters; the limit is ${MAX_EXPLANATION_LENGTH}.`,
    );
  }

  if (raw.imageUrl.length > MAX_IMAGE_LENGTH) {
    issue("Image", "The image link is too long.");
  }

  // A SKU is either one we issued or a typo. Both are worth catching here,
  // before an upload silently creates a duplicate of an existing question.
  const sku = raw.sku.trim().toUpperCase();

  if (sku && !/^Q-\d{4,}$/.test(sku)) {
    issue(
      "SKU",
      `"${raw.sku}" is not a question ID. Leave it empty for a new question, or paste the one from the downloaded sheet.`,
    );
  }

  const isFree = resolveBoolean(raw.isFree);

  if (raw.isFree && isFree === null) {
    warn("Free Sample", `"${raw.isFree}" is not yes or no; treated as no.`);
  }

  if (errors.length) {
    return { question: null, errors, warnings };
  }

  return {
    question: {
      rowNumber: raw.rowNumber,
      sku,
      order: order ?? raw.fallbackOrder,
      orderProvided: Boolean(raw.order),
      prompt: raw.prompt,
      questionType: resolvedType,
      difficulty: difficulty ?? "medium",
      choices,
      answerIndex: answerIndex ?? 0,
      explanation: raw.explanation,
      imageUrl: raw.imageUrl,
      isFree: isFree ?? false,
    },
    errors,
    warnings,
  };
}

function resolveChoices(
  rawChoices: readonly string[],
  questionType: QuestionType,
  report: { issue: (column: string | null, message: string) => void },
) {
  const filled: string[] = [];
  let sawGap = false;

  rawChoices.forEach((value, index) => {
    if (!value) {
      if (filled.length) {
        sawGap = true;
      }
      return;
    }

    if (sawGap) {
      // B blank but C filled: the letters no longer line up with what the
      // Answer column means, so this is an error rather than a silent shift.
      report.issue(
        toChoiceLabel(index),
        `Choice ${toChoiceLabel(index)} is filled in but an earlier choice is blank. Fill the choices from A downward with no gaps.`,
      );
      return;
    }

    if (value.length > MAX_CHOICE_LENGTH) {
      report.issue(
        toChoiceLabel(index),
        `Choice ${toChoiceLabel(index)} is ${value.length} characters; the limit is ${MAX_CHOICE_LENGTH}.`,
      );
      return;
    }

    filled.push(value);
  });

  if (questionType === "true_false") {
    if (!filled.length) {
      return ["True", "False"];
    }

    if (filled.length !== 2) {
      report.issue(
        "A",
        `A true-false item needs exactly 2 choices; this row has ${filled.length}. Leave the choice columns blank to get True/False automatically.`,
      );
      return filled;
    }
  }

  if (questionType === "multiple_choice" && filled.length < 2) {
    report.issue(
      "A",
      `A multiple-choice item needs at least 2 choices; this row has ${filled.length}.`,
    );
    return filled;
  }

  const seen = new Map<string, number>();

  filled.forEach((value, index) => {
    const key = value.toLowerCase();
    const firstIndex = seen.get(key);

    if (firstIndex === undefined) {
      seen.set(key, index);
      return;
    }

    report.issue(
      toChoiceLabel(index),
      `Choices ${toChoiceLabel(firstIndex)} and ${toChoiceLabel(index)} are the same, so the answer would be ambiguous.`,
    );
  });

  return filled;
}

function resolveAnswerIndex(
  rawAnswer: string,
  choices: readonly string[],
  questionType: QuestionType,
): number | null {
  const answer = rawAnswer.trim();

  if (!answer || !choices.length) {
    return null;
  }

  // Exact choice text wins over the letter reading, so a two-letter-choice
  // item ("A" as an actual option) still resolves to what the encoder meant.
  const textMatch = choices.findIndex(
    (choice) => choice.toLowerCase() === answer.toLowerCase(),
  );

  if (textMatch !== -1) {
    return textMatch;
  }

  if (/^[A-Za-z]$/.test(answer)) {
    const index = fromChoiceLabel(answer);

    if (index !== null && index < choices.length) {
      return index;
    }
  }

  if (questionType === "true_false") {
    const normalized = normalizeKey(answer);

    if (TRUTHY.has(normalized)) {
      const index = choices.findIndex(
        (choice) => normalizeKey(choice) === "true",
      );
      return index === -1 ? null : index;
    }

    if (FALSY.has(normalized)) {
      const index = choices.findIndex(
        (choice) => normalizeKey(choice) === "false",
      );
      return index === -1 ? null : index;
    }
  }

  return null;
}

export function resolveQuestionType(value: string): QuestionType | null {
  const key = normalizeKey(value);
  return key ? (QUESTION_TYPE_ALIASES[key] ?? null) : null;
}

export function resolveDifficulty(value: string): QuestionDifficulty | null {
  const key = normalizeKey(value);
  return key ? (DIFFICULTY_ALIASES[key] ?? null) : null;
}

export function resolveBoolean(value: string): boolean | null {
  const key = normalizeKey(value);

  if (!key) {
    return null;
  }

  if (TRUTHY.has(key)) {
    return true;
  }

  if (FALSY.has(key)) {
    return false;
  }

  return null;
}

function resolveOrder(value: string, fallback: number): number | null {
  if (!value) {
    return fallback;
  }

  const digits = value.replace(/\D/g, "");
  const parsed = Number.parseInt(digits, 10);

  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100000
    ? parsed
    : null;
}

/* -------------------------------------------------------------------------- */
/*  Writing                                                                   */
/* -------------------------------------------------------------------------- */

export type ExportableQuestion = {
  sku?: string | null;
  order?: number | null;
  prompt?: string | null;
  questionType?: string | null;
  difficulty?: string | null;
  choices?: readonly string[] | null;
  answerIndex?: number | null;
  explanation?: string | null;
  imageUrl?: string | null;
  isFree?: boolean | null;
};

/**
 * Column headers plus one row per question, ready for CSV or a worksheet.
 *
 * The same function builds the blank template, the sample, and the export of
 * an existing paper, so a downloaded paper is always re-importable.
 */
export function toSheetMatrix(
  questions: readonly ExportableQuestion[],
): string[][] {
  const choiceCount = Math.max(
    TEMPLATE_CHOICE_COUNT,
    ...questions.map((question) => question.choices?.length ?? 0),
  );

  const header = QUESTION_SHEET_COLUMNS.flatMap((column) => {
    if (column.key !== "choice") {
      return [column.header];
    }

    return column.choiceIndex === 0
      ? Array.from({ length: choiceCount }, (_, index) => toChoiceLabel(index))
      : [];
  });

  const rows = questions.map((question, questionIndex) => {
    const choices = question.choices ?? [];
    const answerIndex = question.answerIndex ?? -1;

    return QUESTION_SHEET_COLUMNS.flatMap((column) => {
      if (column.key === "choice") {
        return column.choiceIndex === 0
          ? Array.from({ length: choiceCount }, (_, index) =>
              normalizeCell(choices[index] ?? ""),
            )
          : [];
      }

      switch (column.key) {
        case "sku":
          return [normalizeCell(question.sku)];
        case "order":
          return [String(question.order ?? questionIndex + 1)];
        case "prompt":
          return [normalizeCell(question.prompt)];
        case "answer":
          return [
            answerIndex >= 0 && answerIndex < choices.length
              ? toChoiceLabel(answerIndex)
              : "",
          ];
        case "questionType":
          return [
            question.questionType === "true_false" ? "true-false" : "mcq",
          ];
        case "difficulty":
          return [normalizeCell(question.difficulty) || "medium"];
        case "explanation":
          return [normalizeCell(question.explanation)];
        case "imageUrl":
          return [normalizeCell(question.imageUrl)];
        case "isFree":
          return [question.isFree ? "yes" : "no"];
        default:
          return [""];
      }
    });
  });

  return [header, ...rows];
}

/** Two filled rows, so the shape of a good row is obvious from the template. */
export const SAMPLE_SHEET_ROWS: readonly ExportableQuestion[] = [
  {
    order: 1,
    prompt:
      "The term community organization originated in ____, where it meant the coordination of existing social services through joint planning and fund-raising.",
    choices: ["United States", "Manila", "Spain", "England"],
    answerIndex: 0,
    questionType: "multiple_choice",
    difficulty: "medium",
    explanation:
      "Community organization as a method traces back to the Charity Organization Societies in the United States.",
    isFree: true,
  },
  {
    order: 2,
    prompt:
      "Republic Act 4373 regulates the practice of social work in the Philippines.",
    choices: ["True", "False"],
    answerIndex: 0,
    questionType: "true_false",
    difficulty: "easy",
    explanation:
      "RA 4373 is the law that regulates social work practice and the operation of social work agencies.",
    isFree: false,
  },
];
