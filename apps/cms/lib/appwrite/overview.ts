/**
 * Numbers for the overview page.
 *
 * Everything here answers a question someone running the reviewer would
 * actually ask - how many students, how many are paying, what is unfinished -
 * rather than reporting on the state of the database, which is the migration
 * script's job and not something an editor can act on.
 *
 * Counts come from the denormalised rollups wherever they exist, and every
 * lookup degrades to null rather than throwing: one unavailable metric should
 * blank one tile, not take down the page.
 */

import { Query } from "node-appwrite";

import { appwriteEnv, hasAppwriteServerEnv } from "@/lib/appwrite/env";
import {
  listSubjectSummaries,
  listTopicSummaries,
} from "@/lib/appwrite/content";
import {
  formatSetLabel,
  listExamCategories,
  listQuestionSets,
} from "@/lib/appwrite/questions";
import { getReviewerTableDefinition } from "@workspace/schema";
import { getAdminServices } from "@/lib/appwrite/server";
import { listPlans } from "@/lib/appwrite/subscriptions";

/**
 * Sums confirmed payments, in centavos.
 *
 * Read rather than counted: the total has to add up amounts, and there is no
 * aggregate query. Capped at a page count that keeps the overview fast - once
 * this stops being enough, the number belongs in a nightly rollup, not here.
 */
async function sumPaidRevenue(since?: string) {
  if (!hasAppwriteServerEnv()) {
    return null;
  }

  try {
    const { tables } = getAdminServices();
    const queries = [Query.equal("status", ["paid"]), Query.limit(100)];

    if (since) {
      queries.push(Query.greaterThanEqual("createdAt", since));
    }

    let total = 0;
    let cursor: string | null = null;

    for (let page = 0; page < 20; page += 1) {
      const pageQueries: string[] = cursor
        ? [...queries, Query.cursorAfter(cursor)]
        : queries;

      const response: Awaited<ReturnType<typeof tables.listRows>> =
        await tables.listRows({
          databaseId: appwriteEnv.databaseId,
          tableId: getReviewerTableDefinition("payments").tableId,
          queries: pageQueries,
        });

      if (!response.rows.length) {
        break;
      }

      for (const row of response.rows as Array<Record<string, unknown>>) {
        total += Number(row.amount ?? 0);
      }

      cursor = String(
        (response.rows[response.rows.length - 1] as { $id: string }).$id,
      );

      if (response.rows.length < 100) {
        break;
      }
    }

    return total;
  } catch {
    return null;
  }
}

export type OverviewStudent = {
  id: string;
  name: string;
  email: string;
  school: string;
  isPremium: boolean;
  joinedAt: string;
};

export type OverviewTask = {
  label: string;
  detail: string;
  href: string;
};

async function countRows(tableKey: Parameters<typeof getReviewerTableDefinition>[0], queries: string[] = []) {
  if (!hasAppwriteServerEnv()) {
    return null;
  }

  try {
    const { tables } = getAdminServices();
    const response = await tables.listRows({
      databaseId: appwriteEnv.databaseId,
      tableId: getReviewerTableDefinition(tableKey).tableId,
      queries: [...queries, Query.limit(1)],
      total: true,
    });

    return Number(response.total ?? 0);
  } catch {
    return null;
  }
}

/** ISO date, N days back, in the `YYYY-MM-DD` shape the activity tables store. */
function isoDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function listRecentStudents(): Promise<OverviewStudent[]> {
  if (!hasAppwriteServerEnv()) {
    return [];
  }

  try {
    const { tables } = getAdminServices();
    const response = await tables.listRows({
      databaseId: appwriteEnv.databaseId,
      tableId: getReviewerTableDefinition("user_profiles").tableId,
      queries: [Query.orderDesc("createdAt"), Query.limit(6)],
    });

    return (response.rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.$id),
      name: String(row.fullName ?? "").trim() || "Unnamed",
      email: String(row.email ?? "").trim(),
      school: String(row.schoolName ?? "").trim(),
      isPremium: row.isPremium === true,
      joinedAt: String(row.createdAt ?? row.$createdAt ?? ""),
    }));
  } catch {
    return [];
  }
}

export async function getOverviewData() {
  const [
    categories,
    sets,
    subjects,
    topics,
    students,
    premiumStudents,
    answers,
    correctAnswers,
    activeThisWeek,
    posts,
    comments,
    pendingFlags,
    achievements,
    recentStudents,
    plans,
    pendingPayments,
    revenueAllTime,
    revenue30Days,
    activeSubscriptions,
    pendingSubscriptions,
  ] = await Promise.all([
    listExamCategories(),
    listQuestionSets(),
    listSubjectSummaries(),
    listTopicSummaries(),
    countRows("user_profiles"),
    countRows("user_profiles", [Query.equal("isPremium", [true])]),
    countRows("user_answers"),
    countRows("user_answers", [Query.equal("isCorrect", [true])]),
    countRows("user_daily_activity", [
      Query.greaterThanEqual("activityDate", isoDaysAgo(7)),
    ]),
    countRows("posts"),
    countRows("comments"),
    countRows("flagged_content", [Query.equal("status", ["pending"])]),
    countRows("learning_achievements"),
    listRecentStudents(),
    listPlans(),
    countRows("payments", [Query.equal("status", ["pending"])]),
    sumPaidRevenue(),
    sumPaidRevenue(isoDaysAgo(30)),
    countRows("subscriptions", [Query.equal("status", ["active"])]),
    countRows("subscriptions", [Query.equal("status", ["pending"])]),
  ]);

  const questionTotal = categories.reduce(
    (total, category) => total + category.questionCount,
    0,
  );
  const materialTotal = subjects.reduce(
    (total, subject) => total + subject.materialCount,
    0,
  );

  const premiumShare =
    students && students > 0 && premiumStudents !== null
      ? Math.round((premiumStudents / students) * 100)
      : null;
  const accuracy =
    answers && answers > 0 && correctAnswers !== null
      ? Math.round((correctAnswers / answers) * 100)
      : null;

  // Everything an editor could act on today, in the order it matters.
  const tasks: OverviewTask[] = [];

  for (const category of categories) {
    if (category.isPublished && category.questionCount === 0) {
      tasks.push({
        label: category.title,
        detail: "Visible to students but has no questions yet",
        href: `/dashboard/upload?categoryId=${category.id}`,
      });
    }

    if (!category.isPublished && category.questionCount > 0) {
      tasks.push({
        label: category.title,
        detail: `${category.questionCount} questions ready, still hidden from the app`,
        href: `/dashboard/exam_categories/${category.id}`,
      });
    }
  }

  for (const set of sets) {
    if (set.questionCount === 0) {
      tasks.push({
        label: `${set.categoryTitle} - ${formatSetLabel(set)}`,
        detail: "Set has no questions yet",
        href: `/dashboard/upload?categoryId=${set.categoryId}&setId=${set.id}`,
      });
    }
  }

  for (const subject of subjects) {
    if (subject.topicCount === 0) {
      tasks.push({
        label: subject.name,
        detail: "Subject has no topics yet",
        href: "/dashboard/topics",
      });
    }
  }

  for (const topic of topics) {
    if (topic.materialCount === 0) {
      tasks.push({
        label: `${topic.subjectName} - ${topic.title}`,
        detail: "Topic has no materials yet",
        href: `/dashboard/learning_materials?subjectId=${topic.subjectId}`,
      });
    }
  }

  if (pendingPayments) {
    tasks.push({
      label: "Payments to confirm",
      detail: `${pendingPayments} ${pendingPayments === 1 ? "student is" : "students are"} waiting on a payment check`,
      href: "/dashboard/payments",
    });
  }

  if (!plans.some((plan) => plan.isActive)) {
    tasks.push({
      label: "No plan on sale",
      detail: "Students have nothing they can buy yet",
      href: "/dashboard/subscription_plans",
    });
  }

  if (pendingFlags) {
    tasks.push({
      label: "Reported content",
      detail: `${pendingFlags} ${pendingFlags === 1 ? "report" : "reports"} waiting for review`,
      href: "/dashboard/flagged_content",
    });
  }

  return {
    students,
    premiumStudents,
    premiumShare,
    activeThisWeek,
    answers,
    correctAnswers,
    accuracy,
    achievements,
    posts,
    comments,
    pendingFlags,
    categories,
    sets,
    subjects,
    topics,
    questionTotal,
    materialTotal,
    recentStudents,
    plans,
    pendingPayments,
    revenueAllTime,
    revenue30Days,
    activeSubscriptions,
    pendingSubscriptions,
    tasks,
  };
}

export type OverviewData = Awaited<ReturnType<typeof getOverviewData>>;
