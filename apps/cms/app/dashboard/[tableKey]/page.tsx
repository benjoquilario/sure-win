import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Query } from "node-appwrite";

import { LearningMaterialsSubjectFilter } from "@/components/dashboard/learning-materials-subject-filter";
import { QuestionDialog } from "@/components/dashboard/question-dialog";
import { QuestionnaireFilter } from "@/components/dashboard/questionnaire-filter";
import { RecordDialog } from "@/components/dashboard/record-dialog";
import { ContentSteps } from "@/components/dashboard/content-steps";
import { RowTable } from "@/components/dashboard/row-table";
import { SetupSteps } from "@/components/dashboard/setup-steps";
import { DashboardRowTableSkeleton } from "@/components/dashboard/loading-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  listSubjectSummaries,
  listTopicSummaries,
} from "@/lib/appwrite/content";
import {
  getLearningMaterialsSubjectFilterData,
  getRelationOptionsForTable,
  listCmsRows,
} from "@/lib/appwrite/cms";
import {
  formatSetLabel,
  getNextItemNumbers,
  getSetupCounts,
  hasNoSet,
  listExamCategories,
  listQuestionSets,
} from "@/lib/appwrite/questions";
import {
  getReviewerTableDefinition,
  getTableAccess,
  isReviewerTableKey,
  roleCanUseTable,
  type CmsRole,
} from "@workspace/schema";
import { requireCmsUser } from "@/lib/appwrite/auth";
import { StaffAccessPanel } from "@/components/dashboard/staff-access-panel";
import { listStaffMembers } from "@/lib/appwrite/staff";

type TablePageProps = {
  params: Promise<{ tableKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type TableKey = Parameters<typeof listCmsRows>[0];
type TableRows = Awaited<ReturnType<typeof listCmsRows>>;
type RelationOptions = Awaited<ReturnType<typeof getRelationOptionsForTable>>;
type LearningMaterialsSubjectFilterData = Awaited<
  ReturnType<typeof getLearningMaterialsSubjectFilterData>
>;
type QuestionSets = Awaited<ReturnType<typeof listQuestionSets>>;

function resolveSearchParamValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return String(value[0] ?? "").trim();
  }

  return String(value ?? "").trim();
}

async function listLearningMaterialsRowsByFilters(
  selectedSubjectId: string,
  selectedTopicId: string,
  filterDataPromise: Promise<LearningMaterialsSubjectFilterData>,
) {
  if (!selectedSubjectId && !selectedTopicId) {
    return listCmsRows("learning_materials", { limit: 200 });
  }

  const filterData = await filterDataPromise;
  const selectedSubjectTopicIds = selectedSubjectId
    ? (filterData.topicIdsBySubjectId[selectedSubjectId] ?? [])
    : [];

  if (selectedTopicId) {
    // A topic outside the chosen subject is a stale URL, not a filter.
    if (selectedSubjectId && !selectedSubjectTopicIds.includes(selectedTopicId)) {
      return [] as TableRows;
    }

    return listCmsRows("learning_materials", {
      limit: 200,
      queries: [Query.equal("topicId", [selectedTopicId])],
    });
  }

  // One equality on the denormalised subjectId, rather than an IN filter over
  // every topic id in the subject - which grew with the content and broke
  // outright once a subject had more topics than the query could carry.
  return listCmsRows("learning_materials", {
    limit: 200,
    queries: [Query.equal("subjectId", [selectedSubjectId])],
  });
}

/**
 * Questions are read through a category, and optionally one of its sets.
 *
 * `setId=none` is a real filter, not a missing one: it means the questions that
 * sit directly under the category, which for most categories is all of them.
 */
async function listQuestionRowsByFilters(
  selectedCategoryId: string,
  selectedSetId: string,
) {
  if (selectedCategoryId && selectedSetId === "none") {
    // Filtered in memory: Appwrite stores "no set" as an empty string, which
    // `Query.isNull` does not match. See `hasNoSet`.
    const categoryRows = await listCmsRows("questions", {
      limit: 500,
      queries: [Query.equal("categoryId", [selectedCategoryId])],
    });

    return categoryRows.filter(hasNoSet);
  }

  if (selectedSetId) {
    return listCmsRows("questions", {
      limit: 500,
      queries: [Query.equal("questionnaireId", [selectedSetId])],
    });
  }

  if (selectedCategoryId) {
    return listCmsRows("questions", {
      limit: 500,
      queries: [Query.equal("categoryId", [selectedCategoryId])],
    });
  }

  return listCmsRows("questions", { limit: 100 });
}

export default async function TablePage({
  params,
  searchParams,
}: TablePageProps) {
  const { tableKey } = await params;

  if (!isReviewerTableKey(tableKey)) {
    notFound();
  }

  const access = getTableAccess(tableKey);

  if (access === "hidden") {
    notFound();
  }

  // Two things decide what this page offers: whether the table is authored
  // here at all, and whether this particular person is the one who authors it.
  const cmsUser = await requireCmsUser();

  if (!roleCanUseTable(cmsUser.role, tableKey, "view")) {
    redirect("/dashboard?error=Your%20role%20does%20not%20allow%20that.");
  }

  const canCreate = roleCanUseTable(cmsUser.role, tableKey, "create");
  const canEdit = roleCanUseTable(cmsUser.role, tableKey, "edit");
  const canDelete = roleCanUseTable(cmsUser.role, tableKey, "delete");
  // Read-only tables show what students produced; there is nothing to author.
  const isCollected = access !== "manage";

  const resolvedSearchParams = await searchParams;
  const isLearningMaterials = tableKey === "learning_materials";
  const isQuestions = tableKey === "questions";
  // The three tables that only make sense in order, so each one says so.
  const isAssessmentSetup =
    isQuestions ||
    tableKey === "questionnaires" ||
    tableKey === "exam_categories";
  // The content tables have the same ordering problem, so they say so too.
  const isContentSetup =
    isLearningMaterials || tableKey === "subjects" || tableKey === "topics";

  const selectedSubjectId = isLearningMaterials
    ? resolveSearchParamValue(resolvedSearchParams.subjectId)
    : "";
  const selectedTopicId = isLearningMaterials
    ? resolveSearchParamValue(resolvedSearchParams.topicId)
    : "";
  const selectedCategoryId = isQuestions
    ? resolveSearchParamValue(resolvedSearchParams.categoryId)
    : "";
  const selectedSetId = isQuestions
    ? resolveSearchParamValue(resolvedSearchParams.setId)
    : "";

  const relationOptionsPromise = getRelationOptionsForTable(tableKey);
  const learningMaterialsFilterPromise = isLearningMaterials
    ? getLearningMaterialsSubjectFilterData()
    : null;
  const setsPromise = isQuestions ? listQuestionSets() : null;

  const rowsPromise =
    isLearningMaterials && learningMaterialsFilterPromise
      ? listLearningMaterialsRowsByFilters(
          selectedSubjectId,
          selectedTopicId,
          learningMaterialsFilterPromise,
        )
      : isQuestions
        ? listQuestionRowsByFilters(selectedCategoryId, selectedSetId)
        : listCmsRows(tableKey);

  const definition = getReviewerTableDefinition(tableKey);
  const success = resolveSearchParamValue(resolvedSearchParams.success);
  const error = resolveSearchParamValue(resolvedSearchParams.error);

  return (
    <main className="space-y-6">
      <Card className="border-border/80 bg-card/80">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Badge className="uppercase tracking-[0.3em] text-[10px]">
                {definition.group}
              </Badge>
              <CardTitle className="mt-2 text-3xl">{definition.name}</CardTitle>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
                {definition.description}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canCreate && tableKey !== "user_roles" ? (
                <Suspense
                  fallback={
                    <Button className="rounded-full" disabled>
                      Add new
                    </Button>
                  }
                >
                  {isQuestions && setsPromise ? (
                    <AddQuestionSection
                      selectedCategoryId={selectedCategoryId}
                      selectedSetId={selectedSetId}
                      setsPromise={setsPromise}
                    />
                  ) : (
                    <AddRecordSection
                      tableKey={tableKey}
                      relationOptionsPromise={relationOptionsPromise}
                    />
                  )}
                </Suspense>
              ) : null}

              <Button
                variant="outline"
                className="rounded-full"
                nativeButton={false}
                render={<Link href="/dashboard" />}
              >
                Back to overview
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

          {error ? (
            <Alert variant="destructive" className="mt-5">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {isCollected ? (
            <Alert className="mt-5">
              <AlertDescription>
                {access === "readonly"
                  ? "This is a record of what the team did. Nothing here can be edited or removed, including by a Super Admin - a log the people it describes can rewrite is not a log."
                  : "This is data your members produced, shown here to read. There is nothing to add by hand - rows appear as they use the app."}
              </AlertDescription>
            </Alert>
          ) : null}

          {!isCollected && !canCreate && !canEdit ? (
            <Alert className="mt-5">
              <AlertDescription>
                You can read this table but not change it. Ask an Admin if you
                need to edit here.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardHeader>
      </Card>

      {tableKey === "user_roles" ? (
        <Suspense fallback={null}>
          <StaffAccessSection actorRole={cmsUser.role} canManage={canCreate} />
        </Suspense>
      ) : null}

      {isQuestions && setsPromise ? (
        <Suspense fallback={null}>
          <QuestionFilterSection
            selectedCategoryId={selectedCategoryId}
            selectedSetId={selectedSetId}
            setsPromise={setsPromise}
          />
        </Suspense>
      ) : null}

      {isLearningMaterials && learningMaterialsFilterPromise ? (
        <Suspense fallback={null}>
          <LearningMaterialsFilterSection
            selectedSubjectId={selectedSubjectId}
            selectedTopicId={selectedTopicId}
            filterDataPromise={learningMaterialsFilterPromise}
          />
        </Suspense>
      ) : null}

      {/* The steps card is guidance for someone with nothing yet, so it sits
          under the table and only while the table is empty. */}
      {isAssessmentSetup || isContentSetup ? (
        <Suspense fallback={null}>
          <StepsWhenEmptySection
            rowsPromise={rowsPromise}
            kind={isAssessmentSetup ? "assessment" : "content"}
          />
        </Suspense>
      ) : null}

      {/* Staff access has a page of its own above; the generic row table
          would only repeat it, with none of the rules that make it safe. */}
      {tableKey === "user_roles" ? null : (
        <Suspense fallback={<DashboardRowTableSkeleton />}>
          <TableRowsSection
            tableKey={tableKey}
            canEdit={canEdit}
            canDelete={canDelete}
            rowsPromise={rowsPromise}
            relationOptionsPromise={relationOptionsPromise}
          />
        </Suspense>
      )}
    </main>
  );
}

async function AddRecordSection({
  tableKey,
  relationOptionsPromise,
}: {
  tableKey: TableKey;
  relationOptionsPromise: Promise<RelationOptions>;
}) {
  const relationOptions = await relationOptionsPromise;

  return <RecordDialog tableKey={tableKey} relationOptions={relationOptions} />;
}

/** Shows the steps card only while there is nothing in the table yet. */
async function StepsWhenEmptySection({
  rowsPromise,
  kind,
}: {
  rowsPromise: Promise<TableRows>;
  kind: "assessment" | "content";
}) {
  const rows = await rowsPromise;

  if (rows.length) {
    return null;
  }

  return kind === "assessment" ? (
    <SetupStepsSection />
  ) : (
    <ContentStepsSection />
  );
}

async function SetupStepsSection() {
  const counts = await getSetupCounts();

  return (
    <SetupSteps
      categoryCount={counts.categoryCount}
      setCount={counts.setCount}
      questionCount={counts.questionCount}
      activeCategoryId={counts.firstCategoryId}
    />
  );
}

async function ContentStepsSection() {
  const [subjects, topics] = await Promise.all([
    listSubjectSummaries(),
    listTopicSummaries(),
  ]);

  return (
    <ContentSteps
      subjectCount={subjects.length}
      topicCount={topics.length}
      materialCount={subjects.reduce(
        (total, subject) => total + subject.materialCount,
        0,
      )}
      activeSubjectId={subjects[0]?.id}
    />
  );
}

async function QuestionFilterSection({
  selectedCategoryId,
  selectedSetId,
  setsPromise,
}: {
  selectedCategoryId: string;
  selectedSetId: string;
  setsPromise: Promise<QuestionSets>;
}) {
  const [sets, categories] = await Promise.all([
    setsPromise,
    listExamCategories(),
  ]);

  const selectedSet = sets.find((set) => set.id === selectedSetId);
  // A chosen set implies its category, even when the URL only names the set.
  const effectiveCategoryId = selectedSet?.categoryId ?? selectedCategoryId;
  const categorySets = effectiveCategoryId
    ? sets.filter((set) => set.categoryId === effectiveCategoryId)
    : [];

  const uploadParams = new URLSearchParams();

  if (effectiveCategoryId) {
    uploadParams.set("categoryId", effectiveCategoryId);
  }

  if (selectedSet) {
    uploadParams.set("setId", selectedSet.id);
  }

  return (
    <QuestionnaireFilter
      categories={categories.map((category) => ({
        value: category.id,
        label: category.title,
        hint: `${category.questionCount} items`,
      }))}
      sets={categorySets.map((set) => ({
        value: set.id,
        label: formatSetLabel(set),
        hint: `${set.questionCount} items`,
      }))}
      selectedCategoryId={effectiveCategoryId}
      selectedSetId={selectedSetId}
      selectedCategoryLabel={
        categories.find((category) => category.id === effectiveCategoryId)
          ?.title ?? ""
      }
      uploadHref={
        effectiveCategoryId
          ? `/dashboard/upload?${uploadParams.toString()}`
          : "/dashboard/upload"
      }
    />
  );
}

async function AddQuestionSection({
  selectedCategoryId,
  selectedSetId,
  setsPromise,
}: {
  selectedCategoryId: string;
  selectedSetId: string;
  setsPromise: Promise<QuestionSets>;
}) {
  const [sets, categories, nextItemNumbers] = await Promise.all([
    setsPromise,
    listExamCategories(),
    getNextItemNumbers(),
  ]);

  const startingSetId = selectedSetId === "none" ? "" : selectedSetId;
  // Prefilled from the destination, not from the rows on screen: a filtered
  // list can be showing a subset, and continuing from that would collide.
  const nextOrder = startingSetId
    ? (nextItemNumbers.bySet[startingSetId] ?? 1)
    : (nextItemNumbers.byCategory[selectedCategoryId] ?? 1);

  const setsFor = (categoryId: string) =>
    sets.filter((set) => set.categoryId === categoryId);

  return (
    <QuestionDialog
      nextItemNumbers={nextItemNumbers}
      initialCategoryId={selectedCategoryId}
      initialSetId={startingSetId}
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
        categoryId: selectedCategoryId,
        setId: startingSetId,
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

async function LearningMaterialsFilterSection({
  selectedSubjectId,
  selectedTopicId,
  filterDataPromise,
}: {
  selectedSubjectId: string;
  selectedTopicId: string;
  filterDataPromise: Promise<LearningMaterialsSubjectFilterData>;
}) {
  const filterData = await filterDataPromise;
  const selectedSubject = filterData.subjects.find(
    (subject) => subject.value === selectedSubjectId,
  );
  const selectedSubjectTopics = selectedSubjectId
    ? (filterData.topicsBySubjectId[selectedSubjectId] ?? [])
    : [];
  const selectedTopic = selectedSubjectTopics.find(
    (topic) => topic.value === selectedTopicId,
  );

  return (
    <LearningMaterialsSubjectFilter
      subjects={filterData.subjects}
      topics={selectedSubjectTopics}
      selectedSubjectId={selectedSubjectId}
      selectedTopicId={selectedTopic?.value ?? ""}
      selectedSubjectLabel={selectedSubject?.label ?? ""}
      selectedTopicLabel={selectedTopic?.label ?? ""}
      selectedTopicCount={selectedSubjectTopics.length}
    />
  );
}

async function StaffAccessSection({
  actorRole,
  canManage,
}: {
  actorRole: CmsRole;
  canManage: boolean;
}) {
  return (
    <StaffAccessPanel
      actorRole={actorRole}
      canManage={canManage}
      members={await listStaffMembers()}
    />
  );
}

async function TableRowsSection({
  tableKey,
  canEdit,
  canDelete,
  rowsPromise,
  relationOptionsPromise,
}: {
  tableKey: TableKey;
  canEdit: boolean;
  canDelete: boolean;
  rowsPromise: Promise<TableRows>;
  relationOptionsPromise: Promise<RelationOptions>;
}) {
  const [rows, relationOptions] = await Promise.all([
    rowsPromise,
    relationOptionsPromise,
  ]);

  return (
    <RowTable
      tableKey={tableKey}
      canEdit={canEdit}
      canDelete={canDelete}
      rows={rows}
      relationOptions={relationOptions}
      emptyMessage={
        tableKey === "questions"
          ? "No questions here yet. Create an exam category and a questionnaire first, then open that paper to upload a filled-in Excel or CSV sheet."
          : undefined
      }
    />
  );
}
