import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { QuestionDialog } from "@/components/dashboard/question-dialog";
import { QuestionEditor } from "@/components/dashboard/question-editor";
import { RecordForm } from "@/components/dashboard/record-form";
import { RowTable } from "@/components/dashboard/row-table";
import {
  DashboardRecordFormSkeleton,
  DashboardRowTableSkeleton,
} from "@/components/dashboard/loading-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getCmsRow, getRelationOptionsForTable } from "@/lib/appwrite/cms";
import {
  formatSetLabel,
  getNextItemNumbers,
  listCategoryQuestions,
  listExamCategories,
  listQuestionRecords,
  listQuestionSets,
} from "@/lib/appwrite/questions";
import {
  getReviewerTableDefinition,
  getTableAccess,
  isReviewerTableKey,
  roleCanUseTable,
} from "@workspace/schema";
import { requireCmsUser } from "@/lib/appwrite/auth";

type RecordPageProps = {
  params: Promise<{ tableKey: string; rowId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type TableKey = Parameters<typeof getCmsRow>[0];
type CmsRowData = Awaited<ReturnType<typeof getCmsRow>>;
type RelationOptions = Awaited<ReturnType<typeof getRelationOptionsForTable>>;

export default async function RecordPage({
  params,
  searchParams,
}: RecordPageProps) {
  const { tableKey, rowId } = await params;

  if (!isReviewerTableKey(tableKey)) {
    notFound();
  }

  // Nothing to edit on a read-only table, so there is no edit page for one.
  if (getTableAccess(tableKey) !== "manage") {
    notFound();
  }

  // Same for a table this person may see but not change: the form would only
  // be a slower way of finding out the save is refused.
  const cmsUser = await requireCmsUser();

  if (!roleCanUseTable(cmsUser.role, tableKey, "edit")) {
    redirect(`/dashboard/${tableKey}?error=Your%20role%20does%20not%20allow%20that.`);
  }

  const relationOptionsPromise = getRelationOptionsForTable(tableKey);
  const [row, resolvedSearchParams] = await Promise.all([
    getCmsRow(tableKey, rowId),
    searchParams,
  ]);

  if (!row) {
    notFound();
  }

  const definition = getReviewerTableDefinition(tableKey);
  const success = String(resolvedSearchParams.success ?? "");
  const isSet = tableKey === "questionnaires";
  const isCategory = tableKey === "exam_categories";
  const isQuestion = tableKey === "questions";
  const uploadHref = isSet
    ? `/dashboard/upload?categoryId=${String(row.categoryId ?? "")}&setId=${row.$id}`
    : `/dashboard/upload?categoryId=${row.$id}`;

  return (
    <main className="space-y-6">
      <Card className="border-border/80 bg-card/80">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Badge className="uppercase tracking-[0.3em] text-[10px]">
                {definition.group}
              </Badge>
              <CardTitle className="mt-2 text-3xl">
                Edit {definition.name}
              </CardTitle>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
                Record ID: {row.$id}
                {typeof row.sku === "string" && row.sku
                  ? ` - SKU ${row.sku}`
                  : ""}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {isSet || isCategory ? (
                <Suspense fallback={null}>
                  <AddQuestionHereSection
                    categoryId={
                      isCategory ? row.$id : String(row.categoryId ?? "")
                    }
                    setId={isSet ? row.$id : ""}
                  />
                </Suspense>
              ) : null}

              <Button
                variant="outline"
                className="rounded-full"
                nativeButton={false}
                render={<Link href={`/dashboard/${tableKey}`} />}
              >
                Back to {definition.name}
              </Button>
            </div>
          </div>

          {success ? (
            <Alert variant="default" className="mt-5">
              <AlertDescription>
                Operation completed: {success.replaceAll("_", " ")}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardHeader>
      </Card>

      <Suspense fallback={<DashboardRecordFormSkeleton />}>
        {isQuestion ? (
          <EditQuestionSection row={row} />
        ) : (
          <EditRecordFormSection
            tableKey={tableKey}
            row={row}
            relationOptionsPromise={relationOptionsPromise}
          />
        )}
      </Suspense>

      {isSet || isCategory ? (
        <Suspense fallback={<DashboardRowTableSkeleton />}>
          <ContainedQuestionsSection
            categoryId={isCategory ? row.$id : String(row.categoryId ?? "")}
            setId={isSet ? row.$id : null}
            isCategory={isCategory}
            uploadHref={uploadHref}
          />
        </Suspense>
      ) : null}
    </main>
  );
}

async function EditRecordFormSection({
  tableKey,
  row,
  relationOptionsPromise,
}: {
  tableKey: TableKey;
  row: NonNullable<CmsRowData>;
  relationOptionsPromise: Promise<RelationOptions>;
}) {
  const relationOptions = await relationOptionsPromise;

  return (
    <RecordForm
      tableKey={tableKey}
      row={row}
      relationOptions={relationOptions}
    />
  );
}

async function EditQuestionSection({
  row,
}: {
  row: NonNullable<CmsRowData>;
}) {
  const [categories, sets, nextItemNumbers] = await Promise.all([
    listExamCategories(),
    listQuestionSets(),
    getNextItemNumbers(),
  ]);
  const questionType =
    row.questionType === "true_false" ? "true_false" : "multiple_choice";
  const difficulty =
    row.difficulty === "easy" || row.difficulty === "hard"
      ? row.difficulty
      : "medium";

  return (
    <QuestionEditor
      nextItemNumbers={nextItemNumbers}
      categories={categories.map((category) => ({
        id: category.id,
        title: category.title,
        sets: sets
          .filter((set) => set.categoryId === category.id)
          .map((set) => ({ id: set.id, label: formatSetLabel(set) })),
      }))}
      values={{
        rowId: row.$id,
        sku: String(row.sku ?? ""),
        categoryId: String(row.categoryId ?? ""),
        setId: String(row.questionnaireId ?? ""),
        order: Number(row.order ?? 1),
        prompt: String(row.prompt ?? ""),
        questionType,
        difficulty,
        choices: Array.isArray(row.choices)
          ? row.choices.map((choice) => String(choice ?? ""))
          : [],
        answerIndex: Number(row.answerIndex ?? 0),
        explanation: String(row.explanation ?? ""),
        imageUrl: String(row.imageUrl ?? ""),
        isFree: row.isFree === true,
      }}
    />
  );
}

/**
 * The same add-questions dialog, already pointed at this category or set.
 *
 * Opening it from the record you are looking at should not then ask you which
 * record you meant.
 */
async function AddQuestionHereSection({
  categoryId,
  setId,
}: {
  categoryId: string;
  setId: string;
}) {
  const [sets, categories, nextItemNumbers] = await Promise.all([
    listQuestionSets(),
    listExamCategories(),
    getNextItemNumbers(),
  ]);

  const setsFor = (id: string) => sets.filter((set) => set.categoryId === id);
  const nextOrder = setId
    ? (nextItemNumbers.bySet[setId] ?? 1)
    : (nextItemNumbers.byCategory[categoryId] ?? 1);

  return (
    <QuestionDialog
      nextItemNumbers={nextItemNumbers}
      initialCategoryId={categoryId}
      initialSetId={setId}
      categories={categories.map((category) => ({
        id: category.id,
        title: category.title,
        questionCount: category.questionCount,
        sets: setsFor(category.id).map((set) => ({
          id: set.id,
          label: formatSetLabel(set),
          questionCount: set.questionCount,
        })),
      }))}
      editorCategories={categories.map((category) => ({
        id: category.id,
        title: category.title,
        sets: setsFor(category.id).map((set) => ({
          id: set.id,
          label: formatSetLabel(set),
        })),
      }))}
      values={{
        rowId: "",
        sku: "",
        categoryId,
        setId,
        order: nextOrder,
        prompt: "",
        questionType: "multiple_choice",
        difficulty: "medium",
        choices: ["", "", "", ""],
        answerIndex: 0,
        explanation: "",
        imageUrl: "",
        isFree: false,
      }}
    />
  );
}

/**
 * The questions this record holds.
 *
 * A category shows everything under it, sets included, because that is what
 * "how many questions do we have for this subject" means. A set shows only its
 * own.
 */
async function ContainedQuestionsSection({
  categoryId,
  setId,
  isCategory,
  uploadHref,
}: {
  categoryId: string;
  setId: string | null;
  isCategory: boolean;
  uploadHref: string;
}) {
  const records = isCategory
    ? await listCategoryQuestions(categoryId)
    : await listQuestionRecords({ categoryId, setId });

  return (
    <RowTable
      tableKey="questions"
      rows={records as unknown as NonNullable<CmsRowData>[]}
      emptyMessage={`No questions here yet. Use "Upload questions here" above (${uploadHref.includes("setId") ? "it goes into this set" : "it goes into this category"}).`}
      caption={
        isCategory
          ? "Every question in this category, sets included, in item order."
          : "Questions in this set, in the order students see them."
      }
    />
  );
}
