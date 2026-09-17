import { Suspense } from "react";
import Link from "next/link";

import { DashboardRecordFormSkeleton } from "@/components/dashboard/loading-state";
import { QuestionImportCard } from "@/components/dashboard/question-import-card";
import { SetupSteps } from "@/components/dashboard/setup-steps";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatSetLabel,
  getSetupCounts,
  listExamCategories,
  listQuestionSets,
} from "@/lib/appwrite/questions";
import { requirePermission } from "@/lib/appwrite/auth";

type UploadPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolveParam(value: string | string[] | undefined) {
  return Array.isArray(value)
    ? String(value[0] ?? "").trim()
    : String(value ?? "").trim();
}

/**
 * The page this whole CMS exists for.
 *
 * It gets its own route rather than living inside a record page, because
 * uploading a batch of questions is the daily job - not something you should
 * have to find by drilling into a table first.
 */
export default async function UploadQuestionsPage({
  searchParams,
}: UploadPageProps) {
  await requirePermission("questions.import");

  const resolved = await searchParams;

  return (
    <main className="space-y-6">
      <Card className="border-border/80 bg-card/80">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Badge className="uppercase tracking-[0.3em] text-[10px]">
                Questions
              </Badge>
              <CardTitle className="mt-2 text-3xl">Upload questions</CardTitle>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
                Download the Excel or CSV sheet, type the questions into it, and
                upload it back. Everything is checked before anything is saved.
              </p>
            </div>

            <Button
              variant="outline"
              className="rounded-full"
              nativeButton={false}
              render={<Link href="/dashboard/questions" />}
            >
              Browse existing questions
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Suspense fallback={<DashboardRecordFormSkeleton />}>
        <UploadSection
          initialCategoryId={resolveParam(resolved.categoryId)}
          initialSetId={resolveParam(resolved.setId)}
        />
      </Suspense>
    </main>
  );
}

async function UploadSection({
  initialCategoryId,
  initialSetId,
}: {
  initialCategoryId: string;
  initialSetId: string;
}) {
  const [categories, sets, counts] = await Promise.all([
    listExamCategories(),
    listQuestionSets(),
    getSetupCounts(),
  ]);

  const options = categories.map((category) => ({
    id: category.id,
    title: category.title,
    questionCount: category.questionCount,
    sets: sets
      .filter((set) => set.categoryId === category.id)
      .map((set) => ({
        id: set.id,
        label: formatSetLabel(set),
        questionCount: set.questionCount,
      })),
  }));

  return (
    <>
      <QuestionImportCard
        categories={options}
        initialCategoryId={initialCategoryId}
        initialSetId={initialSetId}
      />

      {counts.categoryCount === 0 ? (
        <SetupSteps
          categoryCount={counts.categoryCount}
          setCount={counts.setCount}
          questionCount={counts.questionCount}
          activeCategoryId={counts.firstCategoryId}
        />
      ) : null}
    </>
  );
}
