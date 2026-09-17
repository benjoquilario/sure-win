/**
 * Community maintenance: the counters nobody writes, and the deletes that have
 * to reach further than the row you asked to delete.
 *
 * Two problems live here, and both come from the same place - Appwrite has no
 * joins, no aggregates and no foreign keys, so anything spanning more than one
 * table is application code or it does not happen.
 *
 * **Counters.** `posts.likesCount` and its two siblings are caches of the like
 * tables. Since v4 the app cannot write them: that was the grant that let any
 * member rewrite any other member's post, and it is gone. `recountLikes` is
 * what keeps them honest, and it is safe to run as often as you like.
 *
 * **Deletes.** Delete is owner-only on the community tables, so a post removed
 * by its author would leave comments nobody has permission to clear. The app
 * hides rows instead (`isDeleted`), and the hard delete happens here, with the
 * API key, reaching the whole thread.
 */

import { Query, type TablesDB } from "node-appwrite";

import { appwriteEnv } from "@/lib/appwrite/env";
import { getAdminServices } from "@/lib/appwrite/server";
import {
  getAccessModelPermissions,
  reviewerTableEntries,
  type ReviewerTableKey,
} from "@workspace/schema";

const PAGE_SIZE = 100;

type Row = Record<string, unknown> & { $id: string };

/**
 * Every row matching a query, not the first 25 of them.
 *
 * The same default-page trap as everywhere else in this repo, and the one that
 * matters most here: a recount that reads 25 of 400 likes does not report an
 * error, it reports a wrong number and writes it to the database.
 */
async function listAllRows(
  tables: TablesDB,
  tableId: string,
  queries: string[] = [],
) {
  const all: Row[] = [];
  let cursor: string | null = null;

  for (;;) {
    const page = [...queries, Query.limit(PAGE_SIZE)];

    if (cursor) {
      page.push(Query.cursorAfter(cursor));
    }

    const response = await tables.listRows({
      databaseId: appwriteEnv.databaseId,
      tableId,
      queries: page,
      total: false,
    });

    const rows = response.rows as Row[];

    if (!rows.length) {
      break;
    }

    all.push(...rows);

    if (rows.length < PAGE_SIZE) {
      break;
    }

    cursor = rows[rows.length - 1].$id;
  }

  return all;
}

async function deleteRows(tables: TablesDB, tableId: string, rows: Row[]) {
  for (const row of rows) {
    await tables.deleteRow({
      databaseId: appwriteEnv.databaseId,
      tableId,
      rowId: row.$id,
    });
  }

  return rows.length;
}

/* -------------------------------------------------------------------------- *
 * Counters
 * -------------------------------------------------------------------------- */

/**
 * Rewrites `likesCount` on posts, comments and replies from the like tables.
 *
 * The like row is the truth and this is the cache, so a disagreement is always
 * resolved in the like table's favour. Rows already correct are left alone,
 * which keeps a run over an unchanged database free of writes.
 */
export async function recountLikes() {
  const { tables } = getAdminServices();

  const postLikes = await listAllRows(tables, "post_likes");
  const commentLikes = await listAllRows(tables, "comment_likes");

  const byPost = new Map<string, number>();

  for (const like of postLikes) {
    const postId = String(like.postId ?? "");
    if (postId) byPost.set(postId, (byPost.get(postId) ?? 0) + 1);
  }

  // One table covers both comments and replies, told apart by `targetType`.
  const byComment = new Map<string, number>();
  const byReply = new Map<string, number>();

  for (const like of commentLikes) {
    const targetId = String(like.targetId ?? "");
    if (!targetId) continue;

    const bucket = like.targetType === "reply" ? byReply : byComment;
    bucket.set(targetId, (bucket.get(targetId) ?? 0) + 1);
  }

  const results: Record<string, { checked: number; corrected: number }> = {};

  for (const [tableId, counts] of [
    ["posts", byPost],
    ["comments", byComment],
    ["replies", byReply],
  ] as const) {
    const rows = await listAllRows(tables, tableId);
    let corrected = 0;

    for (const row of rows) {
      const wanted = counts.get(row.$id) ?? 0;
      const current = Number(row.likesCount ?? 0);

      if (wanted === current) {
        continue;
      }

      await tables.updateRow({
        databaseId: appwriteEnv.databaseId,
        tableId,
        rowId: row.$id,
        data: { likesCount: wanted },
      });
      corrected += 1;
    }

    results[tableId] = { checked: rows.length, corrected };
  }

  return results;
}

/* -------------------------------------------------------------------------- *
 * Cascading deletes
 * -------------------------------------------------------------------------- */

/**
 * Removes a post and everything hanging off it.
 *
 * Comments, replies and every like on any of them. Without this a deleted post
 * leaves a thread whose `postId` points at nothing, and because delete is
 * owner-only on those tables, nobody in the app can ever clear it.
 */
export async function purgePost(postId: string) {
  const { tables } = getAdminServices();

  const comments = await listAllRows(tables, "comments", [
    Query.equal("postId", postId),
  ]);

  let replies: Row[] = [];

  for (const comment of comments) {
    replies = replies.concat(
      await listAllRows(tables, "replies", [
        Query.equal("commentId", comment.$id),
      ]),
    );
  }

  const targetIds = new Set([
    ...comments.map((row) => row.$id),
    ...replies.map((row) => row.$id),
  ]);

  const commentLikes = (await listAllRows(tables, "comment_likes")).filter(
    (like) => targetIds.has(String(like.targetId ?? "")),
  );
  const postLikes = await listAllRows(tables, "post_likes", [
    Query.equal("postId", postId),
  ]);

  const removed = {
    replies: await deleteRows(tables, "replies", replies),
    comments: await deleteRows(tables, "comments", comments),
    commentLikes: await deleteRows(tables, "comment_likes", commentLikes),
    postLikes: await deleteRows(tables, "post_likes", postLikes),
  };

  await tables.deleteRow({
    databaseId: appwriteEnv.databaseId,
    tableId: "posts",
    rowId: postId,
  });

  return { ...removed, posts: 1 };
}

/** Removes a comment, its replies, and the likes on all of them. */
export async function purgeComment(commentId: string) {
  const { tables } = getAdminServices();

  const replies = await listAllRows(tables, "replies", [
    Query.equal("commentId", commentId),
  ]);
  const targetIds = new Set([commentId, ...replies.map((row) => row.$id)]);
  const likes = (await listAllRows(tables, "comment_likes")).filter((like) =>
    targetIds.has(String(like.targetId ?? "")),
  );

  const removed = {
    replies: await deleteRows(tables, "replies", replies),
    commentLikes: await deleteRows(tables, "comment_likes", likes),
  };

  await tables.deleteRow({
    databaseId: appwriteEnv.databaseId,
    tableId: "comments",
    rowId: commentId,
  });

  return { ...removed, comments: 1 };
}

/** Removes a reply and the likes on it. */
export async function purgeReply(replyId: string) {
  const { tables } = getAdminServices();

  const likes = (await listAllRows(tables, "comment_likes")).filter(
    (like) => String(like.targetId ?? "") === replyId,
  );

  const removed = {
    commentLikes: await deleteRows(tables, "comment_likes", likes),
  };

  await tables.deleteRow({
    databaseId: appwriteEnv.databaseId,
    tableId: "replies",
    rowId: replyId,
  });

  return { ...removed, replies: 1 };
}

/**
 * Clears rows the app hid but could not remove.
 *
 * `isDeleted` is a soft delete because the app has no permission to do a hard
 * one. This is the other half: it turns those hidden rows into absent ones,
 * cascading each properly. Safe to run on a schedule.
 */
export async function purgeSoftDeleted() {
  const { tables } = getAdminServices();
  const removed = { posts: 0, comments: 0, replies: 0 };

  for (const post of await listAllRows(tables, "posts", [
    Query.equal("isDeleted", true),
  ])) {
    await purgePost(post.$id);
    removed.posts += 1;
  }

  // Comments and replies under a deleted post are already gone by now, so
  // what is left here are the ones a member removed on their own.
  for (const comment of await listAllRows(tables, "comments", [
    Query.equal("isDeleted", true),
  ])) {
    await purgeComment(comment.$id);
    removed.comments += 1;
  }

  for (const reply of await listAllRows(tables, "replies", [
    Query.equal("isDeleted", true),
  ])) {
    await purgeReply(reply.$id);
    removed.replies += 1;
  }

  return removed;
}

/* -------------------------------------------------------------------------- *
 * Account deletion
 * -------------------------------------------------------------------------- */

/**
 * Tables holding a member's own rows, derived rather than listed.
 *
 * A hardcoded list is a list that goes stale the first time somebody adds a
 * table and forgets this file - and the failure mode is data surviving a
 * deletion request, which is the one failure mode that is not allowed to be
 * quiet. Anything on a `member_*` model with a `userId` column is in scope.
 */
function memberOwnedTables(): ReviewerTableKey[] {
  return reviewerTableEntries
    .filter(([, definition]) => {
      const model = definition.accessModel;
      const isMemberTable = model.startsWith("member_");
      const hasUserId = definition.fields.some(
        (field) => field.key === "userId",
      );
      return isMemberTable && hasUserId;
    })
    .map(([key]) => key);
}

/**
 * Financial and audit records, kept on purpose.
 *
 * `subscriptions` and `payments` are what a chargeback, a tax return or a
 * refund dispute is answered from, and Google keeps its own copy regardless.
 * Both are `server_*` models the member cannot reach, so they are outside
 * `memberOwnedTables` already; this constant exists to say the omission was a
 * decision rather than an oversight.
 */
export const RETAINED_ON_DELETE = ["subscriptions", "payments"] as const;

/**
 * Deletes everything an account owns, and reports what it removed.
 *
 * This is the cascade an account-deletion Function calls. It does **not**
 * delete the Appwrite auth account itself - that is `users.delete(userId)`,
 * and it should run last, after this returns, so a failure here leaves an
 * account that can retry rather than orphaned rows nobody can reach.
 *
 * Their posts take their threads with them: comments other members wrote under
 * a deleted member's post go too, because a thread hanging off nothing is not
 * something anybody can moderate or read.
 */
export async function deleteMemberData(userId: string) {
  if (!userId) {
    throw new Error("deleteMemberData needs a user id.");
  }

  const { tables } = getAdminServices();
  const removed: Record<string, number> = {};

  const add = (key: string, count: number) => {
    removed[key] = (removed[key] ?? 0) + count;
  };

  // Their posts first, so the thread cascade runs before the loop below
  // removes their comments individually.
  for (const post of await listAllRows(tables, "posts", [
    Query.equal("userId", userId),
  ])) {
    const counts = await purgePost(post.$id);
    for (const [key, value] of Object.entries(counts)) add(key, value);
  }

  for (const comment of await listAllRows(tables, "comments", [
    Query.equal("userId", userId),
  ])) {
    const counts = await purgeComment(comment.$id);
    for (const [key, value] of Object.entries(counts)) add(key, value);
  }

  for (const reply of await listAllRows(tables, "replies", [
    Query.equal("userId", userId),
  ])) {
    const counts = await purgeReply(reply.$id);
    for (const [key, value] of Object.entries(counts)) add(key, value);
  }

  const alreadyHandled = new Set(["posts", "comments", "replies"]);

  for (const tableKey of memberOwnedTables()) {
    if (alreadyHandled.has(tableKey)) {
      continue;
    }

    const rows = await listAllRows(tables, tableKey, [
      Query.equal("userId", userId),
    ]);
    add(tableKey, await deleteRows(tables, tableKey, rows));
  }

  // Blocks other members placed against this one. They are keyed by the
  // blocker, so the loop above never sees them.
  const blocksAgainst = await listAllRows(tables, "user_blocks", [
    Query.equal("blockedUserId", userId),
  ]);
  add("user_blocks", await deleteRows(tables, "user_blocks", blocksAgainst));

  // Reports they filed stay in the queue with the reporter detached. The
  // moderation record is about the content, not about them, and deleting it
  // would let anyone clear their own reports by deleting their account.
  const reports = await listAllRows(tables, "flagged_content", [
    Query.equal("reportedBy", userId),
  ]);

  for (const report of reports) {
    await tables.updateRow({
      databaseId: appwriteEnv.databaseId,
      tableId: "flagged_content",
      rowId: report.$id,
      data: { reportedBy: "deleted" },
    });
  }

  add("flagged_content_detached", reports.length);

  // The counters on rows that survive - other members' posts this account had
  // liked - are now wrong by however many likes just went.
  await recountLikes();

  return removed;
}

/** The models each table runs under, for the migration report. */
export function describeAccessModels() {
  return reviewerTableEntries.map(([key, definition]) => ({
    table: key,
    model: definition.accessModel,
    ...getAccessModelPermissions(definition.accessModel),
  }));
}
