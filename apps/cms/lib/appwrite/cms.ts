import { ID, Query } from "node-appwrite";

import {
  appwriteEnv,
  getEnvironmentWarnings,
  hasAppwriteServerEnv,
} from "@/lib/appwrite/env";
import {
  getReviewerTableDefinition,
  reviewerTableEntries,
  type ReviewerTableKey,
} from "@workspace/schema";
import {
  listSubjectSummaries,
  listTopicSummaries,
} from "@/lib/appwrite/content";
import { listAllTables } from "@/lib/appwrite/tables";
import { getDashboardGroupSummary } from "@/lib/dashboard/navigation";
import { getAdminServices } from "@/lib/appwrite/server";

export type CmsRow = Record<string, unknown> & {
  $id: string;
  $createdAt?: string;
  $updatedAt?: string;
};

export type CmsRelationOption = {
  value: string;
  label: string;
};

export type CmsRelationOptionsMap = Partial<
  Record<string, CmsRelationOption[]>
>;

export type LearningMaterialsSubjectFilterData = {
  subjects: Array<
    CmsRelationOption & { topicCount: number; materialCount: number }
  >;
  topicIdsBySubjectId: Record<string, string[]>;
  topicsBySubjectId: Record<string, CmsRelationOption[]>;
};

export type ListCmsRowsOptions = {
  limit?: number;
  queries?: string[];
};

const relationFieldTableMap: Partial<
  Record<ReviewerTableKey, Partial<Record<string, ReviewerTableKey>>>
> = {
  topics: { subjectId: "subjects" },
  learning_materials: { topicId: "topics" },
  learning_history: {
    learningMaterialId: "learning_materials",
    subjectId: "subjects",
    topicId: "topics",
  },
  questionnaires: { categoryId: "exam_categories" },
  questions: {
    questionnaireId: "questionnaires",
    categoryId: "exam_categories",
  },
  user_answers: { questionnaireId: "questionnaires" },
  user_progress: {
    subjectId: "subjects",
    topicId: "topics",
    questionnaireId: "questionnaires",
  },
  user_daily_activity: {
    subjectId: "subjects",
    topicId: "topics",
    questionnaireId: "questionnaires",
  },
  user_weekly_reports: {
    subjectId: "subjects",
    topicId: "topics",
    questionnaireId: "questionnaires",
  },
  learning_achievements: {
    subjectId: "subjects",
    topicId: "topics",
    learningMaterialId: "learning_materials",
  },
  posts: { subjectId: "subjects" },
  comments: { postId: "posts" },
  replies: { commentId: "comments" },
  post_likes: { postId: "posts" },
  comment_likes: { commentId: "comments", replyId: "replies" },
};

const relationDisplayFieldMap: Partial<Record<ReviewerTableKey, string[]>> = {
  subjects: ["name"],
  topics: ["title"],
  learning_materials: ["title"],
  learning_history: ["status", "lastAccessedAt", "learningMaterialId"],
  exam_categories: ["title"],
  questionnaires: ["title"],
  questions: ["prompt"],
  learning_achievements: ["title", "achievementType", "earnedAt"],
  posts: ["title"],
  comments: ["content"],
  replies: ["content"],
};

function toPlainCmsRow(row: unknown): CmsRow {
  return JSON.parse(JSON.stringify(row)) as CmsRow;
}

function getDefaultQueries(tableKey: ReviewerTableKey, limit = 50) {
  const definition = getReviewerTableDefinition(tableKey);
  const sortableField = definition.fields.find((field) => field.key === "order")
    ? "order"
    : definition.fields.find((field) => field.key === "createdAt")
      ? "createdAt"
      : null;

  if (!sortableField) {
    return [Query.limit(limit)];
  }

  return sortableField === "order"
    ? [Query.orderAsc(sortableField), Query.limit(limit)]
    : [Query.orderDesc(sortableField), Query.limit(limit)];
}

function sanitizeLabelPart(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const source = Array.isArray(value) ? value.join(", ") : String(value);
  const withoutTags = source
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!withoutTags) {
    return "";
  }

  return withoutTags.length > 80
    ? `${withoutTags.slice(0, 80)}...`
    : withoutTags;
}

function getRelationLabel(
  row: CmsRow,
  targetTableKey: ReviewerTableKey,
  topicSubjectNameById?: Map<string, string>,
) {
  if (targetTableKey === "topics") {
    const topicTitle = sanitizeLabelPart(row.title);
    const subjectId = String(row.subjectId ?? "").trim();
    const subjectName = subjectId
      ? sanitizeLabelPart(topicSubjectNameById?.get(subjectId))
      : "";

    if (topicTitle && subjectName) {
      return `${topicTitle} (${subjectName})`;
    }

    if (topicTitle) {
      return topicTitle;
    }
  }

  if (targetTableKey === "questionnaires") {
    const title = sanitizeLabelPart(row.title);
    const setCode = sanitizeLabelPart(row.setCode);
    const mode = row.mode === "quiz" ? "Quiz" : "Board Exam";

    if (title) {
      return setCode ? `Set ${setCode} - ${title} (${mode})` : `${title} (${mode})`;
    }
  }

  const displayCandidates = relationDisplayFieldMap[targetTableKey] ?? [];

  for (const candidateKey of displayCandidates) {
    const value = sanitizeLabelPart(row[candidateKey]);

    if (value) {
      return value;
    }
  }

  return row.$id;
}

export async function getRelationOptionsForTable(
  tableKey: ReviewerTableKey,
): Promise<CmsRelationOptionsMap> {
  if (!hasAppwriteServerEnv()) {
    return {};
  }

  const tableRelations = relationFieldTableMap[tableKey];

  if (!tableRelations) {
    return {};
  }

  const { tables } = getAdminServices();
  const entries = Object.entries(tableRelations) as Array<
    [string, ReviewerTableKey]
  >;
  let topicSubjectNameById = new Map<string, string>();

  if (entries.some(([, relatedTableKey]) => relatedTableKey === "topics")) {
    try {
      const subjectDefinition = getReviewerTableDefinition("subjects");
      const subjectResponse = await tables.listRows({
        databaseId: appwriteEnv.databaseId,
        tableId: subjectDefinition.tableId,
        queries: getDefaultQueries("subjects", 300),
      });

      topicSubjectNameById = new Map(
        subjectResponse.rows.map((row) => {
          const plainRow = toPlainCmsRow(row);
          const subjectName = sanitizeLabelPart(plainRow.name);
          return [plainRow.$id, subjectName || plainRow.$id] as const;
        }),
      );
    } catch {
      topicSubjectNameById = new Map<string, string>();
    }
  }

  const resolvedEntries = await Promise.all(
    entries.map(async ([fieldKey, relatedTableKey]) => {
      try {
        const relatedDefinition = getReviewerTableDefinition(relatedTableKey);
        const response = await tables.listRows({
          databaseId: appwriteEnv.databaseId,
          tableId: relatedDefinition.tableId,
          queries: getDefaultQueries(relatedTableKey, 200),
        });

        const options = response.rows
          .map((row) => toPlainCmsRow(row))
          .map((row) => ({
            value: row.$id,
            label: getRelationLabel(row, relatedTableKey, topicSubjectNameById),
          }));

        return [fieldKey, options] as const;
      } catch {
        return [fieldKey, []] as const;
      }
    }),
  );

  return Object.fromEntries(resolvedEntries);
}

export async function getCmsHealth() {
  const warnings = getEnvironmentWarnings();

  if (!hasAppwriteServerEnv()) {
    return {
      warnings,
      databaseReachable: false,
      missingTables: reviewerTableEntries.map(
        ([, definition]) => definition.tableId,
      ),
      existingTables: [] as string[],
    };
  }

  try {
    const { tables } = getAdminServices();
    const existingTables = (
      await listAllTables(tables, appwriteEnv.databaseId)
    ).map((table) => table.$id);
    const missingTables = reviewerTableEntries
      .map(([, definition]) => definition.tableId)
      .filter((tableId) => !existingTables.includes(tableId));

    return {
      warnings,
      databaseReachable: true,
      existingTables,
      missingTables,
    };
  } catch (error) {
    return {
      warnings: [
        ...warnings,
        error instanceof Error
          ? error.message
          : "Failed to reach the Appwrite database.",
      ],
      databaseReachable: false,
      existingTables: [] as string[],
      missingTables: reviewerTableEntries.map(
        ([, definition]) => definition.tableId,
      ),
    };
  }
}

export async function listCmsRows(
  tableKey: ReviewerTableKey,
  options: ListCmsRowsOptions = {},
) {
  if (!hasAppwriteServerEnv()) {
    return [] as CmsRow[];
  }

  try {
    const { tables } = getAdminServices();
    const definition = getReviewerTableDefinition(tableKey);
    const queries = [
      ...(options.queries ?? []),
      ...getDefaultQueries(tableKey, options.limit ?? 50),
    ];
    const result = await tables.listRows({
      databaseId: appwriteEnv.databaseId,
      tableId: definition.tableId,
      queries,
    });
    return result.rows.map((row) => toPlainCmsRow(row));
  } catch {
    return [] as CmsRow[];
  }
}

/**
 * Subjects and their topics for the materials filter, with counts.
 *
 * Counts come from the denormalised rollups rather than being recomputed here,
 * so opening the page is two reads no matter how much content there is.
 */
export async function getLearningMaterialsSubjectFilterData(): Promise<LearningMaterialsSubjectFilterData> {
  if (!hasAppwriteServerEnv()) {
    return {
      subjects: [],
      topicIdsBySubjectId: {},
      topicsBySubjectId: {},
    };
  }

  try {
    const [subjects, topics] = await Promise.all([
      listSubjectSummaries(),
      listTopicSummaries(),
    ]);

    const topicIdsBySubjectId: Record<string, string[]> = {};
    const topicsBySubjectId: Record<string, CmsRelationOption[]> = {};

    for (const topic of topics) {
      if (!topic.subjectId) {
        continue;
      }

      topicIdsBySubjectId[topic.subjectId] ??= [];
      topicsBySubjectId[topic.subjectId] ??= [];

      topicIdsBySubjectId[topic.subjectId].push(topic.id);
      topicsBySubjectId[topic.subjectId].push({
        value: topic.id,
        label: topic.materialCount
          ? `${topic.title} (${topic.materialCount})`
          : topic.title,
      });
    }

    return {
      subjects: subjects.map((subject) => ({
        value: subject.id,
        label: subject.name,
        topicCount: subject.topicCount,
        materialCount: subject.materialCount,
      })),
      topicIdsBySubjectId,
      topicsBySubjectId,
    };
  } catch {
    return {
      subjects: [],
      topicIdsBySubjectId: {},
      topicsBySubjectId: {},
    };
  }
}

export async function getCmsRow(tableKey: ReviewerTableKey, rowId: string) {
  if (!hasAppwriteServerEnv()) {
    return null;
  }

  try {
    const { tables } = getAdminServices();
    const definition = getReviewerTableDefinition(tableKey);
    const row = await tables.getRow({
      databaseId: appwriteEnv.databaseId,
      tableId: definition.tableId,
      rowId,
    });
    return toPlainCmsRow(row);
  } catch {
    return null;
  }
}

export async function saveCmsRow(
  tableKey: ReviewerTableKey,
  rowId: string | null,
  data: Record<string, unknown>,
) {
  const { tables } = getAdminServices();
  const definition = getReviewerTableDefinition(tableKey);

  if (rowId) {
    return tables.updateRow({
      databaseId: appwriteEnv.databaseId,
      tableId: definition.tableId,
      rowId,
      data,
    });
  }

  return tables.createRow({
    databaseId: appwriteEnv.databaseId,
    tableId: definition.tableId,
    rowId: ID.unique(),
    data,
  });
}

/**
 * Deleting a post has to take its thread with it.
 *
 * Appwrite has no foreign keys, so nothing removes the comments and likes that
 * pointed at a row once it is gone - and because delete is owner-only on those
 * tables, no member could clear them afterwards either. The cascade lives in
 * `community.ts`; this routes the three tables that need it.
 */
const CASCADING_DELETES: Partial<
  Record<ReviewerTableKey, (rowId: string) => Promise<unknown>>
> = {
  posts: async (rowId) => (await import("./community")).purgePost(rowId),
  comments: async (rowId) => (await import("./community")).purgeComment(rowId),
  replies: async (rowId) => (await import("./community")).purgeReply(rowId),
};

export async function deleteCmsRow(tableKey: ReviewerTableKey, rowId: string) {
  const { tables } = getAdminServices();
  const definition = getReviewerTableDefinition(tableKey);

  const cascade = CASCADING_DELETES[tableKey];

  if (cascade) {
    return cascade(rowId);
  }

  return tables.deleteRow({
    databaseId: appwriteEnv.databaseId,
    tableId: definition.tableId,
    rowId,
  });
}

export async function getDashboardOverview() {
  const health = await getCmsHealth();

  if (!hasAppwriteServerEnv() || !health.databaseReachable) {
    return {
      health,
      cards: [
        {
          label: "Schema Tables",
          value: String(reviewerTableEntries.length),
          hint: "Expected backend resources",
        },
        {
          label: "Configured Tables",
          value: String(health.existingTables.length),
          hint: "Currently present in Appwrite",
        },
        {
          label: "Missing Tables",
          value: String(health.missingTables.length),
          hint: "Still need to be provisioned",
        },
        { label: "Admin Roles", value: "2", hint: "admin and moderator" },
      ],
      groupSummary: getDashboardGroupSummary(),
    };
  }

  const summaryTables: ReviewerTableKey[] = [
    "exam_categories",
    "questionnaires",
    "questions",
    "learning_materials",
  ];
  const { tables } = getAdminServices();
  const existingTableSet = new Set(health.existingTables);
  const counts = await Promise.all(
    summaryTables.map(async (tableKey) => {
      const definition = getReviewerTableDefinition(tableKey);

      if (!existingTableSet.has(definition.tableId)) {
        return 0;
      }

      const response = await tables.listRows({
        databaseId: appwriteEnv.databaseId,
        tableId: definition.tableId,
        queries: [Query.limit(1)],
        total: true,
      });
      return response.total;
    }),
  );

  return {
    health,
    cards: [
      {
        label: "Exam Categories",
        value: String(counts[0]),
        hint: "Subject areas that group the papers",
      },
      {
        label: "Questionnaires",
        value: String(counts[1]),
        hint: "Quiz and board exam papers",
      },
      {
        label: "Questions",
        value: String(counts[2]),
        hint: "Items across every paper",
      },
      {
        label: "Learning Materials",
        value: String(counts[3]),
        hint: "Review content, notes, PDFs, and videos",
      },
    ],
    groupSummary: getDashboardGroupSummary(),
  };
}
