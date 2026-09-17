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

export type ContentStepsProps = {
  subjectCount: number;
  topicCount: number;
  materialCount: number;
  /** Preselects the browse filter when a subject is already in context. */
  activeSubjectId?: string;
};

/**
 * The order review content has to be built in, on screen.
 *
 * A material needs a topic and a topic needs a subject, but a list of tables
 * says nothing about that. Whoever is writing the notes should not have to
 * learn it by hitting an empty dropdown.
 */
export function ContentSteps({
  subjectCount,
  topicCount,
  materialCount,
  activeSubjectId,
}: ContentStepsProps) {
  const steps = [
    {
      number: 1,
      title: "Create the subject",
      what: "What a student browses. Its name is the only thing required.",
      example: "Human Behavior and Social Environment",
      href: "/dashboard/subjects",
      action: subjectCount ? "Add another" : "Create the first one",
      status: `${subjectCount} ${subjectCount === 1 ? "subject" : "subjects"}`,
      done: subjectCount > 0,
    },
    {
      number: 2,
      title: "Add topics",
      what: "The chapters inside that subject. Materials hang off these.",
      example: "Theories of Human Development",
      href: "/dashboard/topics",
      action: subjectCount
        ? topicCount
          ? "Add another"
          : "Create the first one"
        : "Finish step 1 first",
      status: `${topicCount} ${topicCount === 1 ? "topic" : "topics"}`,
      done: topicCount > 0,
    },
    {
      number: 3,
      title: "Write the materials",
      what: "A written note typed in the editor, or a link to a PDF or video.",
      example: "Erikson's Stages - written note",
      href: activeSubjectId
        ? `/dashboard/learning_materials?subjectId=${activeSubjectId}`
        : "/dashboard/learning_materials",
      action: topicCount ? "Add a material" : "Finish step 2 first",
      status: `${materialCount} ${materialCount === 1 ? "material" : "materials"}`,
      done: materialCount > 0,
    },
  ];

  const currentStep = steps.find((step) => !step.done)?.number ?? 0;

  return (
    <Card className="border-border/80 bg-card/80">
      <CardHeader>
        <Badge className="w-fit uppercase tracking-[0.3em] text-[10px]">
          Review content
        </Badge>
        <CardTitle className="mt-3 text-2xl">Subject, topic, material</CardTitle>
        <CardDescription className="mt-2 text-sm leading-7">
          Reading material only. Exam questions live under Exam Categories and
          are not connected to any of this.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ol className="grid gap-4 lg:grid-cols-3">
          {steps.map((step) => {
            const isCurrent = step.number === currentStep;

            return (
              <li
                key={step.number}
                className={cn(
                  "flex flex-col gap-3 rounded-2xl border p-5",
                  isCurrent
                    ? "border-primary/60 bg-primary/5"
                    : "border-border/70 bg-muted/25",
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      step.done
                        ? "bg-secondary text-secondary-foreground"
                        : isCurrent
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {step.done ? "OK" : step.number}
                  </span>
                  <p className="text-sm font-semibold">{step.title}</p>
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
