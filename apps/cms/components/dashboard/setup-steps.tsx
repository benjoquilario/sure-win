import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type SetupStepsProps = {
  categoryCount: number;
  setCount: number;
  questionCount: number;
  /** Preselects the upload destination when one is already in context. */
  activeCategoryId?: string;
};

type Step = {
  title: string;
  optional: boolean;
  what: string;
  example: string;
  href: string;
  action: string;
  status: string;
  done: boolean;
};

/**
 * The order of operations, on screen.
 *
 * Only two steps are ever required - make a category, upload a sheet - and the
 * middle one is marked optional rather than numbered, because numbering it
 * implies everyone has to do it. Most categories are one straight run of
 * questions with no sets at all.
 */
export function SetupSteps({
  categoryCount,
  setCount,
  questionCount,
  activeCategoryId,
}: SetupStepsProps) {
  const uploadHref = activeCategoryId
    ? `/dashboard/upload?categoryId=${activeCategoryId}`
    : "/dashboard/upload";

  const steps: Step[] = [
    {
      title: "Create the exam category",
      optional: false,
      what: "The subject area. Its name and whether it is a quiz or a board exam - that is all that is required.",
      example: "Human Behavior and Social Environment",
      href: "/dashboard/exam_categories",
      action: categoryCount ? "Add another" : "Create the first one",
      status: `${categoryCount} created`,
      done: categoryCount > 0,
    },
    {
      title: "Add sets",
      optional: true,
      what: "Only if this category splits into Set A, Set B, Set C. Skip it entirely otherwise - questions can go straight into the category.",
      example: "History, Social Conditions, Issues and CO Drill: Sets A, B, C",
      href: "/dashboard/questionnaires",
      action: setCount ? "Manage sets" : "Add sets if you need them",
      status: setCount ? `${setCount} created` : "not needed for most",
      done: true,
    },
    {
      title: "Upload the questions",
      optional: false,
      what: "Pick the category, download the Excel sheet with its heading row, fill one row per question, upload it back.",
      example: "100 rows in, 100 questions out, no SKU typed",
      href: uploadHref,
      action: categoryCount ? "Upload questions" : "Finish step 1 first",
      status: `${questionCount} questions`,
      done: questionCount > 0,
    },
  ];

  // The first required step still outstanding is the one to highlight.
  const currentTitle = steps.find((step) => !step.optional && !step.done)?.title;

  return (
    <Card className="border-border/80 bg-card/80">
      <CardHeader>
        <Badge className="w-fit uppercase tracking-[0.3em] text-[10px]">
          Adding questions
        </Badge>
        <CardTitle className="mt-3 text-2xl">
          A category, then a spreadsheet
        </CardTitle>
        <CardDescription className="mt-2 text-sm leading-7">
          Questions belong to a category. Sets are an optional extra for the few
          categories that split into Set A, B, and C.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ol className="grid gap-4 lg:grid-cols-3">
          {steps.map((step, index) => {
            const isCurrent = step.title === currentTitle;

            return (
              <li
                key={step.title}
                className={cn(
                  "flex flex-col gap-3 rounded-2xl border p-5",
                  isCurrent
                    ? "border-primary/60 bg-primary/5"
                    : step.optional
                      ? "border-dashed border-border/70 bg-muted/15"
                      : "border-border/70 bg-muted/25",
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      step.optional
                        ? "border border-dashed border-border bg-transparent text-muted-foreground"
                        : step.done
                          ? "bg-secondary text-secondary-foreground"
                          : isCurrent
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground",
                    )}
                  >
                    {step.optional ? "-" : step.done ? "OK" : index === 0 ? 1 : 2}
                  </span>
                  <p className="text-sm font-semibold">{step.title}</p>
                  {step.optional ? (
                    <Badge
                      variant="outline"
                      className="rounded-full px-2 text-[10px] uppercase tracking-[0.16em]"
                    >
                      Optional
                    </Badge>
                  ) : null}
                </div>

                <p className="text-sm leading-6 text-muted-foreground">
                  {step.what}
                </p>

                <p className="rounded-xl bg-muted/50 px-3 py-2 text-xs leading-5 text-foreground/80">
                  <span className="text-muted-foreground">Example: </span>
                  {step.example}
                </p>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-1">
                  <span className="text-xs text-muted-foreground">
                    {step.status}
                  </span>

                  <Button
                    variant={isCurrent ? "default" : "outline"}
                    size="sm"
                    className="rounded-full"
                    nativeButton={false}
                    render={<Link href={step.href} />}
                  >
                    {step.action}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
