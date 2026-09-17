/**
 * v4 data migration: split the public half off `user_profiles`.
 *
 * `pnpm appwrite:bootstrap` handles everything that can be derived from the
 * schema - tables, columns, indexes, permissions, and the `isDeleted` backfill
 * via `--backfill`. It cannot invent rows, and v4 needs one: every existing
 * member has a `user_profiles` row and no `user_public_profiles` row, so until
 * this runs the community feed has no author to render.
 *
 * How this is meant to be run:
 *
 *   pnpm appwrite:migrate:v4              # dry run, changes nothing
 *   pnpm appwrite:migrate:v4 --confirm    # apply
 *
 * Dry run is the default deliberately. A migration you cannot read before it
 * runs is one you find out about afterwards.
 *
 * It is idempotent: a member who already has a public row is skipped, not
 * rewritten, so re-running after a partial failure resumes rather than
 * duplicates. The unique index on `userId` is the backstop if that is ever
 * wrong.
 */

import { Client, ID, Query, TablesDB } from "node-appwrite";

import { appwriteEnv } from "../lib/appwrite/env";
import {
  getReviewerTableDefinition,
  isMemberType,
  ownedRowPermissions,
} from "@workspace/schema";

const PROFILES = getReviewerTableDefinition("user_profiles").tableId;
const PUBLIC_PROFILES =
  getReviewerTableDefinition("user_public_profiles").tableId;

const PAGE_SIZE = 100;

function hasFlag(name: string) {
  return process.argv.slice(2).includes(`--${name}`);
}

type Row = Record<string, unknown> & { $id: string };

async function listAll(tables: TablesDB, tableId: string) {
  const all: Row[] = [];
  let cursor: string | null = null;

  for (;;) {
    const queries = [Query.limit(PAGE_SIZE)];

    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }

    const response = await tables.listRows({
      databaseId: appwriteEnv.databaseId,
      tableId,
      queries,
      total: false,
    });

    const rows = response.rows as Row[];

    if (!rows.length) break;

    all.push(...rows);

    if (rows.length < PAGE_SIZE) break;

    cursor = rows[rows.length - 1].$id;
  }

  return all;
}

async function main() {
  const confirmed = hasFlag("confirm");
  const apiKey = process.env.APPWRITE_API_KEY;

  if (!apiKey) {
    console.error(
      "APPWRITE_API_KEY is not set. Run through pnpm so .env is loaded.",
    );
    process.exitCode = 1;
    return;
  }

  const client = new Client()
    .setEndpoint(appwriteEnv.endpoint)
    .setProject(appwriteEnv.projectId)
    .setKey(apiKey);
  const tables = new TablesDB(client);

  console.log(
    confirmed
      ? "v4 migration: applying."
      : "v4 migration: DRY RUN. Nothing will be written. Add --confirm to apply.",
  );
  console.log(`database ${appwriteEnv.databaseId}\n`);

  // Precondition: the destination table has to exist, which means bootstrap
  // has to have run first. Saying so beats a 404 halfway through.
  try {
    await tables.getTable({
      databaseId: appwriteEnv.databaseId,
      tableId: PUBLIC_PROFILES,
    });
  } catch {
    console.error(
      `Table ${PUBLIC_PROFILES} does not exist. Run pnpm appwrite:bootstrap first.`,
    );
    process.exitCode = 1;
    return;
  }

  const profiles = await listAll(tables, PROFILES);
  const existing = await listAll(tables, PUBLIC_PROFILES);
  const done = new Set(existing.map((row) => String(row.userId ?? "")));

  console.log(
    `${profiles.length} profile(s), ${existing.length} public row(s) already present.\n`,
  );

  let created = 0;
  let skipped = 0;
  let noUser = 0;

  for (const profile of profiles) {
    const userId = String(profile.userId ?? "").trim();

    if (!userId) {
      // A profile with no account behind it cannot be granted to anybody, and
      // a public row nobody owns is one nobody can correct.
      console.log(`  ! ${profile.$id}: no userId, skipped`);
      noUser += 1;
      continue;
    }

    if (done.has(userId)) {
      skipped += 1;
      continue;
    }

    const rawType = String(profile.memberType ?? "");
    const data = {
      userId,
      // The public name falls back to the account id rather than to an empty
      // string: a blank byline in a thread is worse than an ugly one, and the
      // member can change it.
      displayName: String(profile.fullName ?? "").trim() || `Member ${userId.slice(-6)}`,
      avatarUrl: String(profile.avatarUrl ?? "").trim() || null,
      memberType: isMemberType(rawType) ? rawType : null,
      createdAt:
        String(profile.createdAt ?? "").trim() ||
        String(profile.$createdAt ?? new Date().toISOString()),
    };

    console.log(
      `  ${confirmed ? "+" : "would add"} ${userId} -> "${data.displayName}"${
        data.memberType ? ` (${data.memberType})` : ""
      }`,
    );

    if (!confirmed) {
      created += 1;
      continue;
    }

    try {
      await tables.createRow({
        databaseId: appwriteEnv.databaseId,
        tableId: PUBLIC_PROFILES,
        rowId: ID.unique(),
        // The member owns their public row: they are the one who edits their
        // name and picture, and nobody else should be able to.
        permissions: ownedRowPermissions(userId),
        data,
      });
      created += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // The unique index doing its job. Another run got there first.
      if (message.includes("already exists") || message.includes("unique")) {
        skipped += 1;
        continue;
      }

      console.error(`  ! ${userId}: ${message}`);
      process.exitCode = 1;
    }
  }

  console.log("");
  console.log(
    confirmed
      ? `Done. ${created} public profile(s) created, ${skipped} already present, ${noUser} unusable.`
      : `Dry run. ${created} would be created, ${skipped} already present, ${noUser} unusable.`,
  );

  if (!confirmed && created > 0) {
    console.log("Re-run with --confirm to apply.");
  }

  if (confirmed) {
    const after = await listAll(tables, PUBLIC_PROFILES);
    const missing = profiles.filter(
      (profile) =>
        String(profile.userId ?? "") &&
        !after.some((row) => row.userId === profile.userId),
    );

    console.log(
      missing.length
        ? `VERIFY FAILED: ${missing.length} profile(s) still have no public row.`
        : "Verified: every profile has a public row.",
    );

    if (missing.length) {
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
