import { Suspense } from "react";
import Link from "next/link";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DashboardCardsSkeleton } from "@/components/dashboard/loading-state";
import { NotificationForm } from "@/components/dashboard/notification-form";
import { getOverviewData, type OverviewData } from "@/lib/appwrite/overview";
import {
  formatMoney,
  isReviewerTableKey,
  roleCanUseTable,
} from "@workspace/schema";
import { can, requireCmsUser, type CmsUser } from "@/lib/appwrite/auth";

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatNumber(value: number | null) {
  return value === null ? "-" : value.toLocaleString();
}

function formatDate(value: string) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const overviewPromise = getOverviewData();
  const cmsUser = await requireCmsUser();
  const resolvedSearchParams = await searchParams;
  const success = String(resolvedSearchParams.success ?? "");
  const error = String(resolvedSearchParams.error ?? "");

  return (
    <main className="space-y-6">
      <Card className="border-border/80 bg-card/80 backdrop-blur">
        <CardHeader>
          <Badge className="w-fit uppercase tracking-[0.3em] text-[10px]">
            Overview
          </Badge>
          <CardTitle className="mt-3 text-3xl sm:text-4xl">
            How the reviewer is doing
          </CardTitle>
          <CardDescription className="mt-3 max-w-3xl text-sm leading-7 sm:text-base">
            Members, subscriptions, and how much of the reviewer is ready for
            them.
          </CardDescription>

          {success ? (
            <Alert variant="default" className="mt-6">
              <AlertDescription>
                Operation completed: {success.replaceAll("_", " ")}
              </AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive" className="mt-6">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardHeader>
      </Card>

      <Suspense fallback={<DashboardCardsSkeleton />}>
        <OverviewBody overviewPromise={overviewPromise} cmsUser={cmsUser} />
      </Suspense>
    </main>
  );
}

async function OverviewBody({
  overviewPromise,
  cmsUser,
}: {
  overviewPromise: Promise<OverviewData>;
  cmsUser: CmsUser;
}) {
  const data = await overviewPromise;

  // An encoder has no business knowing how many people subscribed, so the
  // headline figures are assembled from what this person may see rather than
  // rendered and then hidden.
  const stats = [
    {
      label: "Members",
      value: formatNumber(data.students),
      hint: "Accounts created in the app",
    },
    {
      label: "Subscribed",
      value: formatNumber(data.premiumStudents),
      hint:
        data.premiumShare === null
          ? "Members with premium access"
          : `${data.premiumShare}% of students`,
      accent: true,
    },
    {
      label: "Revenue, last 30 days",
      value:
        data.revenue30Days === null ? "-" : formatMoney(data.revenue30Days),
      hint:
        data.revenueAllTime === null
          ? "Confirmed payments only"
          : `${formatMoney(data.revenueAllTime)} all time`,
    },
    {
      label: "Active this week",
      value: formatNumber(data.activeThisWeek),
      hint:
        data.accuracy === null
          ? "Members who studied in the last 7 days"
          : `${formatNumber(data.answers)} answers, ${data.accuracy}% correct`,
    },
  ].filter((stat) =>
    stat.label === "Revenue, last 30 days"
      ? can(cmsUser, "billing.view")
      : can(cmsUser, "members.view"),
  );

  return (
    <>
      {stats.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <Card
              key={stat.label}
              className={
                stat.accent
                  ? "border-primary/40 bg-primary/5"
                  : "border-border/80 bg-card/80"
              }
            >
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="mt-3 text-4xl font-semibold tabular-nums">
                  {stat.value}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{stat.hint}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      {can(cmsUser, "questions.view") ? (
        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          {can(cmsUser, "questions.view") ? (
            <Card className="border-border/80 bg-card/80">
              <CardHeader className="border-b border-border/70">
                <CardTitle className="text-lg">Exam categories</CardTitle>
                <CardDescription>
                  {data.questionTotal.toLocaleString()} questions across{" "}
                  {data.categories.length}{" "}
                  {data.categories.length === 1 ? "category" : "categories"}.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {data.categories.length ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead>Category</TableHead>
                          <TableHead className="w-28">Type</TableHead>
                          <TableHead className="w-20 text-right">Sets</TableHead>
                          <TableHead className="w-24 text-right">
                            Questions
                          </TableHead>
                          <TableHead className="w-24">Visible</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.categories.map((category) => (
                          <TableRow key={category.id}>
                            <TableCell className="font-medium">
                              <Link
                                href={`/dashboard/exam_categories/${category.id}`}
                                className="hover:underline"
                              >
                                {category.title}
                              </Link>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {category.mode === "quiz" ? "Quiz" : "Board exam"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {category.setCount || "-"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {category.questionCount}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  category.isPublished ? "secondary" : "outline"
                                }
                                className="rounded-full px-2 text-[11px]"
                              >
                                {category.isPublished ? "Live" : "Hidden"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyRow
                    message="No exam categories yet."
                    href="/dashboard/exam_categories"
                    action="Create one"
                  />
                )}
              </CardContent>
            </Card>
          ) : null}

          {can(cmsUser, "questions.view") ? (
            <Card className="border-border/80 bg-card/80">
              <CardHeader className="border-b border-border/70">
                <CardTitle className="text-lg">Needs attention</CardTitle>
                <CardDescription>
                  {data.tasks.length
                    ? `${data.tasks.length} ${data.tasks.length === 1 ? "thing is" : "things are"} unfinished.`
                    : "Nothing is waiting."}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {data.tasks.length ? (
                  <ul className="divide-y divide-border/70">
                    {data.tasks.slice(0, 8).map((task) => (
                      <li
                        key={`${task.label}-${task.detail}`}
                        className="flex items-center justify-between gap-4 px-6 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {task.label}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {task.detail}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0 rounded-full"
                          nativeButton={false}
                          render={<Link href={task.href} />}
                        >
                          Fix
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-6 py-8 text-sm text-muted-foreground">
                    Every category and topic has content, and nothing has been
                    reported.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </section>
      ) : null}

      {can(cmsUser, "billing.view") ||
        can(cmsUser, "content.view") ||
        can(cmsUser, "members.view") ? (
        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          {can(cmsUser, "billing.view") ? (
            <Card className="border-border/80 bg-card/80">
              <CardHeader className="border-b border-border/70">
                <CardTitle className="text-lg">Plans</CardTitle>
                <CardDescription>
                  {formatNumber(data.activeSubscriptions)} active,{" "}
                  {formatNumber(data.pendingSubscriptions)} waiting on payment.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {data.plans.length ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead>Plan</TableHead>
                          <TableHead className="w-28 text-right">Price</TableHead>
                          <TableHead className="w-24 text-right">Days</TableHead>
                          <TableHead className="w-28 text-right">Members</TableHead>
                          <TableHead className="w-24">On sale</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.plans.map((plan) => (
                          <TableRow key={plan.id}>
                            <TableCell className="font-medium">
                              <Link
                                href={`/dashboard/subscription_plans/${plan.id}`}
                                className="hover:underline"
                              >
                                {plan.name}
                              </Link>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatMoney(plan.price, plan.currency)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {plan.durationDays === 0
                                ? "Lifetime"
                                : plan.durationDays}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {plan.subscriberCount}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={plan.isActive ? "secondary" : "outline"}
                                className="rounded-full px-2 text-[11px]"
                              >
                                {plan.isActive ? "Yes" : "No"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyRow
                    message="No plans yet, so nobody can subscribe."
                    href="/dashboard/subscription_plans"
                    action="Create a plan"
                  />
                )}
              </CardContent>
            </Card>
          ) : null}

          {can(cmsUser, "content.view") ? (
            <Card className="border-border/80 bg-card/80">
              <CardHeader className="border-b border-border/70">
                <CardTitle className="text-lg">Review content</CardTitle>
                <CardDescription>
                  {data.materialTotal.toLocaleString()} materials across{" "}
                  {data.subjects.length}{" "}
                  {data.subjects.length === 1 ? "subject" : "subjects"}.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {data.subjects.length ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead>Subject</TableHead>
                          <TableHead className="w-24 text-right">Topics</TableHead>
                          <TableHead className="w-28 text-right">
                            Materials
                          </TableHead>
                          <TableHead className="w-24">Visible</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.subjects.map((subject) => (
                          <TableRow key={subject.id}>
                            <TableCell className="font-medium">
                              <Link
                                href={`/dashboard/subjects/${subject.id}`}
                                className="hover:underline"
                              >
                                {subject.name}
                              </Link>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {subject.topicCount}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {subject.materialCount}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  subject.isPublished ? "secondary" : "outline"
                                }
                                className="rounded-full px-2 text-[11px]"
                              >
                                {subject.isPublished ? "Live" : "Hidden"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyRow
                    message="No subjects yet."
                    href="/dashboard/subjects"
                    action="Create one"
                  />
                )}
              </CardContent>
            </Card>
          ) : null}

          {can(cmsUser, "members.view") ? (
            <Card className="border-border/80 bg-card/80">
              <CardHeader className="border-b border-border/70">
                <CardTitle className="text-lg">Newest members</CardTitle>
                <CardDescription>
                  {formatNumber(data.premiumStudents)} of{" "}
                  {formatNumber(data.students)} are subscribed.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {data.recentStudents.length ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead>Student</TableHead>
                          <TableHead className="w-32">Plan</TableHead>
                          <TableHead className="w-32">Joined</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.recentStudents.map((student) => (
                          <TableRow key={student.id}>
                            <TableCell>
                              <p className="font-medium">{student.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {student.school || student.email}
                              </p>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={student.isPremium ? "default" : "outline"}
                                className="rounded-full px-2 text-[11px]"
                              >
                                {student.isPremium ? "Premium" : "Free"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDate(student.joinedAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="px-6 py-8 text-sm text-muted-foreground">
                    No student profiles yet.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="border-border/80 bg-card/80">
          <CardHeader className="border-b border-border/70">
            <CardTitle className="text-lg">Everything else</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableBody>
                {[
                  {
                    label: "Active subscriptions",
                    value: data.activeSubscriptions,
                    href: "/dashboard/subscriptions",
                  },
                  {
                    label: "Payments to confirm",
                    value: data.pendingPayments,
                    href: "/dashboard/payments",
                  },
                  {
                    label: "Questions answered",
                    value: data.answers,
                    href: "/dashboard/user_answers",
                  },
                  {
                    label: "Topics",
                    value: data.topics.length,
                    href: "/dashboard/topics",
                  },
                  {
                    label: "Question sets",
                    value: data.sets.length,
                    href: "/dashboard/questionnaires",
                  },
                  {
                    label: "Badges earned",
                    value: data.achievements,
                    href: "/dashboard/learning_achievements",
                  },
                  {
                    label: "Community posts",
                    value: data.posts,
                    href: "/dashboard/posts",
                  },
                  {
                    label: "Comments",
                    value: data.comments,
                    href: "/dashboard/comments",
                  },
                  {
                    label: "Reports to review",
                    value: data.pendingFlags,
                    href: "/dashboard/flagged_content",
                  },
                ]
                  // Each line is a link into a table, so the ones this person
                  // cannot open would only be a list of closed doors.
                  .filter((row) => {
                    const tableKey = row.href.replace("/dashboard/", "");

                    return (
                      isReviewerTableKey(tableKey) &&
                      roleCanUseTable(cmsUser.role, tableKey, "view")
                    );
                  })
                  .map((row) => (
                  <TableRow key={row.label}>
                    <TableCell>
                      <Link href={row.href} className="hover:underline">
                        {row.label}
                      </Link>
                    </TableCell>
                    <TableCell className="w-24 text-right text-lg font-semibold tabular-nums">
                      {formatNumber(
                        typeof row.value === "number" ? row.value : null,
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {can(cmsUser, "announcements.send") ? (
          <Card className="border-border/80 bg-card/80">
            <CardHeader>
              <CardTitle className="text-lg">Send an announcement</CardTitle>
              <CardDescription className="mt-2 text-sm leading-7">
                Email, SMS, or a push notification to your students.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NotificationForm />
            </CardContent>
          </Card>
        ) : null}
      </section>
    </>
  );
}

function EmptyRow({
  message,
  href,
  action,
}: {
  message: string;
  href: string;
  action: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-8">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button
        size="sm"
        className="rounded-full"
        nativeButton={false}
        render={<Link href={href} />}
      >
        {action}
      </Button>
    </div>
  );
}
