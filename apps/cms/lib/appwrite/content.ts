/**
 * Server-side reads and writes for review content.
 *
 * Subjects hold topics, topics hold learning materials. The same two problems
 * the assessment side has apply here, and are solved the same way: Appwrite has
 * no joins, so a material carries its `subjectId` as well as its `topicId`; and
 * nobody should have to invent a position, so `order` is assigned when it is
 * left blank.
 */

import { Query } from "node-appwrite";

import { appwriteEnv, hasAppwriteServerEnv } from "@/lib/appwrite/env";
import { getReviewerTableDefinition } from "@workspace/schema";
import { getAdminServices } from "@/lib/appwrite/server";

const SUBJECTS_TABLE = getReviewerTableDefinition("subjects").tableId;
const TOPICS_TABLE = getReviewerTableDefinition("topics").tableId;
const MATERIALS_TABLE = getReviewerTableDefinition("learning_materials").tableId;

const PAGE_SIZE = 100;

export type SubjectSummary = {
  id: string;
  name: string;
  order: number;
  topicCount: number;
  materialCount: number;
  isPublished: boolean;
};

export type TopicSummary = {
  id: string;
  title: string;
  subjectId: string;
  subjectName: string;
  order: number;
  materialCount: number;
  isPublished: boolean;
};

function toPlainRow<T>(row: unknown): T {
  return JSON.parse(JSON.stringify(row)) as T;
}

async function listAllRows<T>(
  tableId: string,
  queries: string[] = [],
): Promise<T[]> {
  const { tables } = getAdminServices();
  const rows: T[] = [];
  let cursor: string | null = null;

  for (;;) {
    const pageQueries = [...queries, Query.limit(PAGE_SIZE)];

    if (cursor) {
      pageQueries.push(Query.cursorAfter(cursor));
    }

    const response = await tables.listRows({
      databaseId: appwriteEnv.databaseId,
      tableId,
      queries: pageQueries,
    });

    if (!response.rows.length) {
      break;
    }

    rows.push(...response.rows.map((row) => toPlainRow<T>(row)));
    cursor = String(
      (response.rows[response.rows.length - 1] as { $id: string }).$id,
    );

    if (response.rows.length < PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

export async function listSubjectSummaries(): Promise<SubjectSummary[]> {
  if (!hasAppwriteServerEnv()) {
    return [];
  }

  try {
    const rows = await listAllRows<Record<string, unknown>>(SUBJECTS_TABLE, [
      Query.orderAsc("order"),
    ]);

    return rows.map((row) => ({
      id: String(row.$id),
      name: String(row.name ?? "").trim() || String(row.$id),
      order: Number(row.order ?? 1),
      topicCount: Number(row.topicCount ?? 0),
      materialCount: Number(row.materialCount ?? 0),
      isPublished: row.isPublished !== false,
    }));
  } catch {
    return [];
  }
}

export async function listTopicSummaries(): Promise<TopicSummary[]> {
  if (!hasAppwriteServerEnv()) {
    return [];
  }

  try {
    const [subjects, topics] = await Promise.all([
      listSubjectSummaries(),
      listAllRows<Record<string, unknown>>(TOPICS_TABLE, [
        Query.orderAsc("order"),
      ]),
    ]);

    const subjectById = new Map(
      subjects.map((subject) => [subject.id, subject]),
    );

    return topics.map((row) => {
      const subjectId = String(row.subjectId ?? "").trim();

      return {
        id: String(row.$id),
        title: String(row.title ?? "").trim() || String(row.$id),
        subjectId,
        subjectName: subjectById.get(subjectId)?.name ?? "Unassigned",
        order: Number(row.order ?? 1),
        materialCount: Number(row.materialCount ?? 0),
        isPublished: row.isPublished !== false,
      };
    });
  } catch {
    return [];
  }
}

async function countRows(tableId: string, queries: string[]) {
  const { tables } = getAdminServices();
  const response = await tables.listRows({
    databaseId: appwriteEnv.databaseId,
    tableId,
    queries: [...queries, Query.limit(1)],
    total: true,
  });

  return Number(response.total ?? 0);
}

/**
 * Recomputes a topic's material count and its subject's rollups.
 *
 * Counted rather than incremented, so a failed write cannot leave a number that
 * drifts further every time. Failures are collected, not thrown: the content
 * itself is already saved by the time this runs.
 */
export async function syncContentCounts(topicId: string, subjectId: string) {
  const { tables } = getAdminServices();
  const warnings: string[] = [];

  const write = async (tableId: string, rowId: string, data: object) => {
    try {
      await tables.updateRow({
        databaseId: appwriteEnv.databaseId,
        tableId,
        rowId,
        data,
      });
    } catch (error) {
      warnings.push(
        `Could not update counters on ${tableId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  if (topicId) {
    const materialCount = await countRows(MATERIALS_TABLE, [
      Query.equal("topicId", [topicId]),
    ]);
    await write(TOPICS_TABLE, topicId, { materialCount });
  }

  if (subjectId) {
    const [topicCount, materialCount] = await Promise.all([
      countRows(TOPICS_TABLE, [Query.equal("subjectId", [subjectId])]),
      countRows(MATERIALS_TABLE, [Query.equal("subjectId", [subjectId])]),
    ]);
    await write(SUBJECTS_TABLE, subjectId, { topicCount, materialCount });
  }

  return warnings;
}

/** The subject a topic belongs to, for stamping onto a material. */
export async function getTopicSubjectId(topicId: string) {
  if (!topicId) {
    return "";
  }

  try {
    const { tables } = getAdminServices();
    const row = await tables.getRow({
      databaseId: appwriteEnv.databaseId,
      tableId: TOPICS_TABLE,
      rowId: topicId,
    });

    return String((row as { subjectId?: unknown }).subjectId ?? "").trim();
  } catch {
    return "";
  }
}

/**
 * The next free position in a list, so nobody has to count rows to add one.
 *
 * Scoped by the parent when there is one: topic 1 of every subject is a
 * different topic, and both are position 1.
 */
export async function getNextContentOrder(
  tableId: string,
  parentField: string | null,
  parentId: string,
) {
  try {
    const { tables } = getAdminServices();
    const response = await tables.listRows({
      databaseId: appwriteEnv.databaseId,
      tableId,
      queries: [
        ...(parentField && parentId
          ? [Query.equal(parentField, [parentId])]
          : []),
        Query.orderDesc("order"),
        Query.limit(1),
      ],
    });

    const highest = Number(
      (response.rows[0] as { order?: unknown } | undefined)?.order ?? 0,
    );

    return (Number.isFinite(highest) ? highest : 0) + 1;
  } catch {
    return 1;
  }
}

/** Positions for every list at once, so a form can prefill without a round trip. */
export async function getContentOrderHints() {
  const [subjects, topics] = await Promise.all([
    listSubjectSummaries(),
    listTopicSummaries(),
  ]);

  const topicOrderBySubject: Record<string, number> = {};
  const materialOrderByTopic: Record<string, number> = {};

  for (const subject of subjects) {
    topicOrderBySubject[subject.id] = 1;
  }

  for (const topic of topics) {
    topicOrderBySubject[topic.subjectId] = Math.max(
      topicOrderBySubject[topic.subjectId] ?? 1,
      topic.order + 1,
    );
    materialOrderByTopic[topic.id] = topic.materialCount + 1;
  }

  return {
    nextSubjectOrder:
      subjects.reduce((highest, subject) => Math.max(highest, subject.order), 0) +
      1,
    topicOrderBySubject,
    materialOrderByTopic,
  };
}

export const CONTENT_TABLE_IDS = {
  subjects: SUBJECTS_TABLE,
  topics: TOPICS_TABLE,
  materials: MATERIALS_TABLE,
};
