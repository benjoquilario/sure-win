"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { importQuestionsAction } from "@/lib/actions/questions";
import {
  emptyImportState,
  type QuestionImportState,
} from "@/lib/questions/import-state";
import {
  MAX_IMPORT_ROWS,
  QUESTION_SHEET_COLUMNS,
} from "@/lib/questions/spreadsheet";
import type { SheetIssue } from "@/lib/questions/spreadsheet";
import { cn } from "@/lib/utils";

export type ImportCategoryOption = {
  id: string;
  title: string;
  questionCount: number;
  sets: Array<{ id: string; label: string; questionCount: number }>;
};

type QuestionImportCardProps = {
  categories: ImportCategoryOption[];
  initialCategoryId?: string;
  initialSetId?: string;
  /** Drops the card chrome for use inside a dialog. */
  bare?: boolean;
};

/** The value the Select uses for "no set" - Select cannot hold an empty string. */
const NO_SET_VALUE = "__no_set__";

function IssueList({
  issues,
  total,
  tone,
}: {
  issues: readonly SheetIssue[];
  total: number;
  tone: "error" | "warning";
}) {
  if (!issues.length) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p
        className={
          tone === "error"
            ? "text-xs font-semibold uppercase tracking-[0.18em] text-destructive"
            : "text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
        }
      >
        {tone === "error" ? "Fix these rows" : "Worth a look"}
        {total > issues.length ? ` (showing ${issues.length} of ${total})` : ""}
      </p>
      <ul className="space-y-1.5 text-sm">
        {issues.map((issue, index) => (
          <li
            key={`${issue.rowNumber}-${issue.column ?? ""}-${index}`}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border border-border/70 bg-muted/30 px-3 py-2"
          >
            <span className="font-mono text-xs text-muted-foreground">
              Row {issue.rowNumber}
              {issue.column ? ` - column ${issue.column}` : ""}
            </span>
            <span className="text-foreground/90">{issue.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Download, fill in, upload - with the destination chosen right here.
 *
 * The category is the destination; the set picker only appears when the chosen
 * category actually has sets, so the common case is two clicks and a file.
 */
export function QuestionImportCard({
  categories,
  initialCategoryId = "",
  initialSetId = "",
  bare = false,
}: QuestionImportCardProps) {
  const [state, formAction, pending] = useActionState<
    QuestionImportState,
    FormData
  >(importQuestionsAction, emptyImportState);

  const [categoryId, setCategoryId] = React.useState(
    initialCategoryId || categories[0]?.id || "",
  );
  const [setId, setSetId] = React.useState(initialSetId);
  const [fileName, setFileName] = React.useState("");
  const [showGuide, setShowGuide] = React.useState(false);
  /** The destination the current preview was checked against. */
  const [checkedFor, setCheckedFor] = React.useState("");
  const formRef = React.useRef<HTMLFormElement>(null);
  const [, startTransition] = React.useTransition();

  /**
   * Submits explicitly rather than through a submit button's name/value.
   *
   * The intent decides whether anything is written, so it is set on the
   * FormData here instead of depending on which element the browser reports as
   * the submitter - the difference between a preview and a save is not
   * something to leave to that.
   */
  const submit = React.useCallback(
    (intent: "preview" | "import", destination: string) => {
      const form = formRef.current;

      if (!form) {
        return;
      }

      const data = new FormData(form);
      data.set("intent", intent);
      setCheckedFor(destination);
      startTransition(() => formAction(data));
    },
    [formAction],
  );

  const category = categories.find((entry) => entry.id === categoryId);
  const sets = category?.sets ?? [];
  const selectedSet = sets.find((entry) => entry.id === setId);
  // A set id from another category must not survive a category change.
  const effectiveSetId = selectedSet ? setId : "";
  const destination = `${categoryId}|${effectiveSetId}`;
  // A preview taken against a different destination no longer describes what
  // pressing Import would do, so it stops counting as one.
  const readyToImport =
    state.status === "preview" &&
    !state.errors.length &&
    checkedFor === destination;
  const staleCheck =
    state.status === "preview" && !state.errors.length && !readyToImport;

  const destinationLabel = category
    ? selectedSet
      ? `${category.title} - ${selectedSet.label}`
      : category.title
    : "";
  const destinationCount = selectedSet
    ? selectedSet.questionCount
    : (category?.questionCount ?? 0);

  /**
   * The download always carries what is already there, SKUs included.
   *
   * That is what makes a round trip safe: the rows come back knowing which
   * questions they are, so editing them updates rather than duplicates.
   */
  const sheetHref = (format: "xlsx" | "csv") => {
    const params = new URLSearchParams({
      categoryId,
      format,
      content: "current",
    });

    if (effectiveSetId) {
      params.set("setId", effectiveSetId);
    }

    return `/api/questions/sheet?${params.toString()}`;
  };

  if (!categories.length) {
    return (
      <Card className="border-border/80 bg-card/80">
        <CardHeader>
          <CardTitle className="text-2xl">Upload questions</CardTitle>
          <CardDescription className="mt-2 text-sm leading-7">
            Create an exam category first. That is the only thing questions
            need - sets are optional and most categories never use them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="rounded-full"
            nativeButton={false}
            render={<Link href="/dashboard/exam_categories" />}
          >
            Create an exam category
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "border-border/80 bg-card/80",
        bare &&
          "gap-0 overflow-visible rounded-none bg-transparent py-0 shadow-none ring-0",
      )}
    >
      {bare ? null : (
        <CardHeader>
          <Badge className="w-fit uppercase tracking-[0.26em] text-[10px]">
            Excel and CSV upload
          </Badge>
          <CardTitle className="mt-3 text-2xl">Upload questions</CardTitle>
          <CardDescription className="mt-2 text-sm leading-7">
            Pick where the questions go, download the sheet with its heading
            row, fill one row per question, and upload it back. SKUs are
            assigned for you, and up to {MAX_IMPORT_ROWS} rows go in one file.
          </CardDescription>
        </CardHeader>
      )}

      <CardContent className={cn("space-y-6", bare && "p-0")}>
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            1. Where do these questions go?
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="import-category">Exam category</Label>
              <Select
                value={categoryId}
                onValueChange={(value) => {
                  setCategoryId(String(value ?? ""));
                  setSetId("");
                }}
              >
                <SelectTrigger id="import-category">
                  {category ? (
                    category.title
                  ) : (
                    <SelectValue placeholder="Pick a category" />
                  )}
                </SelectTrigger>
                <SelectContent>
                  {categories.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.title} ({option.questionCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {sets.length ? (
              <div className="space-y-2">
                <Label htmlFor="import-set">Set</Label>
                <Select
                  value={effectiveSetId || NO_SET_VALUE}
                  onValueChange={(value) =>
                    setSetId(value === NO_SET_VALUE ? "" : String(value ?? ""))
                  }
                >
                  <SelectTrigger id="import-set">
                    {selectedSet ? selectedSet.label : "No set"}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SET_VALUE}>
                      No set - straight into the category
                    </SelectItem>
                    {sets.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label} ({option.questionCount})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex items-end">
                <p className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-3 text-xs leading-5 text-muted-foreground">
                  This category has no sets, so the questions go straight into
                  it. Add sets only if you need Set A, B, and C.
                </p>
              </div>
            )}
          </div>

          {destinationLabel ? (
            <p className="text-sm text-muted-foreground">
              Uploading into <span className="text-foreground">{destinationLabel}</span>
              , which has {destinationCount}{" "}
              {destinationCount === 1 ? "question" : "questions"} today.
            </p>
          ) : null}
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            2. Download the sheet
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="default"
              size="sm"
              className="rounded-full"
              disabled={!categoryId}
              nativeButton={false}
              render={<a href={sheetHref("xlsx")} download />}
            >
              Excel (.xlsx)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={!categoryId}
              nativeButton={false}
              render={<a href={sheetHref("csv")} download />}
            >
              CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => setShowGuide((current) => !current)}
            >
              {showGuide ? "Hide column guide" : "What goes in each column?"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The questions already here, ready to edit. Keep the SKU column
            exactly as it is - it is what matches each row back to its
            question. Add new questions as fresh rows with an empty SKU.
          </p>

          {showGuide ? (
            <div className="overflow-x-auto rounded-2xl border border-border/70">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-28">Column</TableHead>
                    <TableHead className="w-24">Required</TableHead>
                    <TableHead>What to put in it</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {QUESTION_SHEET_COLUMNS.map((column) => (
                    <TableRow key={`${column.key}-${column.header}`}>
                      <TableCell className="font-mono text-xs">
                        {column.header}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {column.required ? "Required" : "Optional"}
                      </TableCell>
                      <TableCell className="text-sm text-foreground/90">
                        {column.help}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>

        <form ref={formRef} action={formAction} className="space-y-4">
          <input type="hidden" name="categoryId" value={categoryId} />
          <input type="hidden" name="setId" value={effectiveSetId} />

          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            3. Upload it back
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="question-sheet-file">Filled-in file</Label>
              <input
                id="question-sheet-file"
                name="file"
                type="file"
                accept=".xlsx,.xlsm,.csv,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => {
                  const picked = event.currentTarget.files?.[0];
                  setFileName(picked?.name ?? "");

                  // Check as soon as a file is chosen. Making the encoder press
                  // a button just to be told the file is fine is the step that
                  // gets mistaken for "it imported".
                  if (picked) {
                    submit("preview", destination);
                  }
                }}
                className="w-full cursor-pointer rounded-xl border border-input bg-input/40 px-3 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground"
              />
              <p className="text-xs text-muted-foreground">
                {fileName ||
                  "Excel .xlsx or .csv. Save older .xls files as .xlsx first."}
              </p>
            </div>

            <div className="flex items-end">
              <p className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-3 text-xs leading-5 text-muted-foreground">
                Rows keep their SKU, so each one updates the question it came
                from. A row with an empty SKU is added as a new question.
              </p>
            </div>
          </div>

          {/* The save step, spelled out. Checking a file writes nothing, and
              this is the only control that does. */}
          {readyToImport ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-primary/60 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">
                  Checked - nothing has been saved yet
                </p>
                <p className="text-xs text-muted-foreground">
                  {state.totals?.rows ?? 0} questions are ready for{" "}
                  {destinationLabel}. Press Import to write them.
                </p>
              </div>

              <Button
                type="button"
                size="lg"
                className="rounded-full"
                disabled={pending}
                onClick={() => submit("import", destination)}
              >
                {pending
                  ? "Saving..."
                  : `Import ${state.totals?.rows ?? 0} questions`}
              </Button>
            </div>
          ) : null}

          {staleCheck ? (
            <p className="rounded-2xl border border-border/70 bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
              The destination changed since this file was checked. Check it
              again before importing.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant={readyToImport ? "outline" : "default"}
              className="rounded-full"
              disabled={pending || !categoryId}
              onClick={() => submit("preview", destination)}
            >
              {pending
                ? "Reading..."
                : readyToImport
                  ? "Check again"
                  : "Check the file"}
            </Button>

            {state.status === "imported" ? (
              <Button
                type="button"
                variant="ghost"
                className="rounded-full"
                onClick={() => {
                  formRef.current?.reset();
                  setFileName("");
                  setCheckedFor("");
                }}
              >
                Upload another file
              </Button>
            ) : null}
          </div>
        </form>

        {state.message ? (
          <Alert
            variant={state.status === "error" ? "destructive" : "default"}
            className="rounded-2xl"
          >
            <AlertTitle>
              {state.status === "error"
                ? "Nothing was saved"
                : state.status === "imported"
                  ? "Upload finished"
                  : "Ready to import"}
            </AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}

        {state.totals ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-full px-3">
              {state.totals.rows} rows read
            </Badge>
            <Badge variant="secondary" className="rounded-full px-3">
              {state.totals.create} new
            </Badge>
            <Badge variant="secondary" className="rounded-full px-3">
              {state.totals.update} updated
            </Badge>
            {state.totals.unknown ? (
              <Badge
                variant="outline"
                className="rounded-full px-3 text-destructive"
              >
                {state.totals.unknown} unknown SKU
              </Badge>
            ) : null}
            {state.totals.skipped ? (
              <Badge variant="outline" className="rounded-full px-3">
                {state.totals.skipped} blank rows skipped
              </Badge>
            ) : null}
          </div>
        ) : null}

        <IssueList issues={state.errors} total={state.errorCount} tone="error" />
        <IssueList
          issues={state.warnings}
          total={state.warningCount}
          tone="warning"
        />

        {state.totals?.unknown ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-destructive">
              Rows with an unknown SKU
            </p>
            <p className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-sm">
              {state.totals.unknown}{" "}
              {state.totals.unknown === 1 ? "row names" : "rows name"} a
              question that is not in this destination. They were skipped -
              clear the SKU to add them as new questions, or check you picked
              the right category.
            </p>
          </div>
        ) : null}

        {state.result?.failures.length ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-destructive">
              Rows that could not be saved
            </p>
            <ul className="space-y-1.5 text-sm">
              {state.result.failures.map((failure) => (
                <li
                  key={failure}
                  className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2"
                >
                  {failure}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {state.preview.length ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Preview
              {state.totals && state.totals.rows > state.preview.length
                ? ` (first ${state.preview.length} of ${state.totals.rows})`
                : ""}
            </p>
            <div className="overflow-x-auto rounded-2xl border border-border/70">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-16">Item</TableHead>
                    <TableHead className="w-24">Action</TableHead>
                    <TableHead>Question</TableHead>
                    <TableHead className="w-20">Answer</TableHead>
                    <TableHead className="w-28">Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.preview.map((row) => (
                    <TableRow key={`${row.rowNumber}-${row.order}`}>
                      <TableCell className="font-mono text-xs">
                        {row.order}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.action === "create" ? "secondary" : "outline"
                          }
                          className="rounded-full px-2 text-[11px]"
                        >
                          {row.action === "create" ? "New" : "Update"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-md text-sm">
                        <span className="line-clamp-2">{row.prompt}</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.answer}{" "}
                        <span className="text-muted-foreground">
                          of {row.choiceCount}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.questionType === "true_false"
                          ? "true-false"
                          : "mcq"}
                        , {row.difficulty}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
