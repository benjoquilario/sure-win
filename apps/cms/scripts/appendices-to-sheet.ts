/**
 * Converts a plain-text appendix ("1. question / a. choice / Answer Key:")
 * into the question sheet the dashboard imports.
 *
 * This is the migration path off the old bundled files: run it once per source
 * document, open the result, sanity-check it, then upload it to the right paper
 * in the CMS. It deliberately writes a file instead of talking to Appwrite -
 * the import already has validation, previews, SKUs, and an audit trail, and a
 * second write path would be a second set of rules to keep in sync.
 *
 *   pnpm appwrite:sheet:from-appendices -- --source=sw-foundation-appendices.txt
 *   pnpm appwrite:sheet:from-appendices -- --format=xlsx --out=set-a.xlsx
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  toCsv,
  toSheetMatrix,
  type ExportableQuestion,
} from "../lib/questions/spreadsheet";
import { buildQuestionWorkbook } from "../lib/questions/workbook";

const DEFAULT_SOURCE_FILE = "sw-foundation-appendices.txt";

type ParsedOption = { key: string; text: string };
type ParsedQuestion = {
  number: number;
  text: string;
  options: ParsedOption[];
  correctOptionKey: string;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgValue(name: string) {
  const prefix = `--${name}=`;
  return (
    process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() ||
    null
  );
}

function normalizeText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function cleanText(value: string) {
  // A trailing asterisk marks the correct choice in some of these documents.
  return normalizeText(value).replace(/\s*\*+\s*$/, "").trim();
}

function parseAnswerKeys(rawText: string) {
  const entries: Array<{ primary: string; alternates: string[]; raw: string }> = [];

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line ? /^([A-Fa-f])(?:\s*or\s*([A-Fa-f]))?\b/.exec(line) : null;

    if (!match) {
      continue;
    }

    entries.push({
      primary: String(match[1]).toLowerCase(),
      alternates: match[2] ? [String(match[2]).toLowerCase()] : [],
      raw: line,
    });
  }

  return entries;
}

function parseQuestions(rawText: string) {
  const parsed: Array<{ number: number; text: string; options: ParsedOption[] }> = [];
  let current: { number: number; text: string; options: ParsedOption[] } | null = null;
  let optionIndex = -1;

  const flush = () => {
    if (!current) {
      return;
    }

    const options: ParsedOption[] = [];

    for (const option of current.options) {
      const text = cleanText(option.text);

      if (!text || options.some((item) => item.key === option.key)) {
        continue;
      }

      options.push({ key: option.key, text });
    }

    const text = cleanText(current.text);

    if (!text) {
      fail(`Question ${current.number} has no text.`);
    }

    if (options.length < 2) {
      fail(`Question ${current.number} has fewer than 2 choices.`);
    }

    parsed.push({ number: current.number, text, options });
  };

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const questionMatch = /^(\d+)\.\s*(.*)$/.exec(line);

    if (questionMatch) {
      flush();
      current = {
        number: Number.parseInt(questionMatch[1] ?? "0", 10),
        text: cleanText(questionMatch[2] ?? ""),
        options: [],
      };
      optionIndex = -1;
      continue;
    }

    if (!current) {
      continue;
    }

    const optionMatch = /^([a-fA-F])\.\s*(.*)$/.exec(line);

    if (optionMatch) {
      current.options.push({
        key: String(optionMatch[1]).toLowerCase(),
        text: cleanText(optionMatch[2] ?? ""),
      });
      optionIndex = current.options.length - 1;
      continue;
    }

    if (/^correct(?:\s*answer)?$/i.test(line)) {
      continue;
    }

    // A wrapped line continues whatever it was under.
    if (optionIndex >= 0) {
      const option = current.options[optionIndex];

      if (option) {
        option.text = cleanText(`${option.text} ${line}`);
      }

      continue;
    }

    current.text = cleanText(`${current.text} ${line}`);
  }

  flush();

  return parsed.sort((left, right) => left.number - right.number);
}

function parseAppendix(rawText: string): ParsedQuestion[] {
  const answerKeyMatch = /^\s*Answer Key:\s*$/im.exec(rawText);

  if (!answerKeyMatch || answerKeyMatch.index === undefined) {
    fail("The source file has no 'Answer Key:' section.");
  }

  const questions = parseQuestions(rawText.slice(0, answerKeyMatch.index));
  const answerKeys = parseAnswerKeys(
    rawText.slice(answerKeyMatch.index + answerKeyMatch[0].length),
  );

  if (!answerKeys.length) {
    fail("No answer keys were parsed from the source file.");
  }

  return questions.map((question) => {
    const entry = answerKeys[question.number - 1];

    if (!entry) {
      fail(`No answer key for question ${question.number}.`);
    }

    const correctOptionKey = [entry.primary, ...entry.alternates].find((candidate) =>
      question.options.some((option) => option.key === candidate),
    );

    if (!correctOptionKey) {
      fail(
        `Answer key for question ${question.number} ("${entry.raw}") matches none of its choices.`,
      );
    }

    return { ...question, correctOptionKey };
  });
}

function toExportable(questions: readonly ParsedQuestion[]): ExportableQuestion[] {
  return questions.map((question) => ({
    order: question.number,
    prompt: question.text,
    choices: question.options.map((option) => option.text),
    answerIndex: question.options.findIndex(
      (option) => option.key === question.correctOptionKey,
    ),
    questionType: "multiple_choice",
    difficulty: "medium",
    explanation: "",
    isFree: false,
  }));
}

async function main() {
  const sourcePath = path.resolve(
    process.cwd(),
    parseArgValue("source") || DEFAULT_SOURCE_FILE,
  );

  if (!existsSync(sourcePath)) {
    fail(`Source file not found: ${sourcePath}`);
  }

  const format = (parseArgValue("format") || "csv").toLowerCase();

  if (format !== "csv" && format !== "xlsx") {
    fail(`Unknown format "${format}". Use csv or xlsx.`);
  }

  const questions = toExportable(parseAppendix(readFileSync(sourcePath, "utf8")));
  const defaultOut = `${path.basename(sourcePath, path.extname(sourcePath))}.${format}`;
  const outPath = path.resolve(process.cwd(), parseArgValue("out") || defaultOut);

  if (format === "xlsx") {
    const workbook = await buildQuestionWorkbook(questions, {
      categoryTitle: "Converted from " + path.basename(sourcePath),
      questionnaireTitle: "Questions for import",
      questionnaireCode: "-",
      mode: "board_exam",
      setCode: null,
    });

    writeFileSync(outPath, Buffer.from(workbook));
  } else {
    writeFileSync(outPath, toCsv(toSheetMatrix(questions)), "utf8");
  }

  const choiceCounts = new Map<number, number>();

  for (const question of questions) {
    const count = question.choices?.length ?? 0;
    choiceCounts.set(count, (choiceCounts.get(count) ?? 0) + 1);
  }

  console.log(`Parsed ${questions.length} questions from ${path.basename(sourcePath)}.`);
  console.log(
    `Choices per item: ${[...choiceCounts.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([count, total]) => `${count} choices x${total}`)
      .join(", ")}`,
  );
  console.log(`Wrote ${outPath}`);
  console.log(
    "Next: open the file, set Difficulty and Explanation where you want them, then upload it to the paper in Dashboard > Questionnaires.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
