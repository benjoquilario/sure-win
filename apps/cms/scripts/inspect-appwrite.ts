/** Read-only. Diffs the live Appwrite database against @workspace/schema (packages/schema/src/schema.ts). */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client, TablesDB } from "node-appwrite";

import {
  getAccessModelPermissions,
  reviewerTableEntries,
} from "@workspace/schema";
import {
  listAllColumns,
  listAllIndexes,
  listAllTables,
} from "../lib/appwrite/tables";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");

  if (!existsSync(envPath)) {
    return;
  }

  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    const separator = line.indexOf("=");

    if (!line || line.startsWith("#") || separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv();

const SYSTEM = new Set([
  "$id",
  "$createdAt",
  "$updatedAt",
  "$permissions",
  "$sequence",
  "$tableId",
  "$databaseId",
]);

async function main() {
  const { appwriteEnv } = await import("../lib/appwrite/env");
  const client = new Client()
    .setEndpoint(appwriteEnv.endpoint)
    .setProject(appwriteEnv.projectId)
    .setKey(appwriteEnv.apiKey);
  const tables = new TablesDB(client);
  const databaseId = appwriteEnv.databaseId;

  const live = await listAllTables(tables, databaseId);
  const liveIds = live.map((table) => table.$id).sort();
  const schemaIds = reviewerTableEntries
    .map(([, definition]) => definition.tableId)
    .sort();

  console.log(`database: ${databaseId}`);
  console.log(`live tables (${liveIds.length}): ${liveIds.join(", ")}`);
  console.log("");

  const missing = schemaIds.filter((id) => !liveIds.includes(id));
  const extra = liveIds.filter((id) => !schemaIds.includes(id as never));

  console.log(`MISSING tables (bootstrap will create): ${missing.join(", ") || "none"}`);

  for (const tableId of extra) {
    const rows = await tables.listRows({
      databaseId,
      tableId,
      queries: [],
      total: true,
    });
    console.log(`EXTRA table (prune would delete): ${tableId} - ${rows.total} rows`);
  }

  console.log("");

  const permissionDrift: string[] = [];

  for (const [, definition] of reviewerTableEntries) {
    const table = live.find((entry) => entry.$id === definition.tableId);

    if (!table) {
      continue;
    }

    const wanted = getAccessModelPermissions(definition.accessModel);
    const livePermissions = new Set(table.$permissions ?? []);
    const matches =
      table.rowSecurity === wanted.rowSecurity &&
      livePermissions.size === wanted.permissions.length &&
      wanted.permissions.every((permission) => livePermissions.has(permission));

    if (matches) {
      continue;
    }

    permissionDrift.push(definition.tableId);
    console.log(`PERMISSION DRIFT ${definition.tableId} (${definition.accessModel})`);
    console.log(
      `  live   rowSecurity=${table.rowSecurity} ${JSON.stringify(table.$permissions ?? [])}`,
    );
    console.log(
      `  schema rowSecurity=${wanted.rowSecurity} ${JSON.stringify(wanted.permissions)}`,
    );
  }

  console.log(
    permissionDrift.length
      ? `${permissionDrift.length} table(s) with permission drift - run pnpm appwrite:bootstrap.`
      : "permissions: all tables match their access model.",
  );
  console.log("");

  for (const [, definition] of reviewerTableEntries) {
    if (!liveIds.includes(definition.tableId)) {
      continue;
    }

    const columns = await listAllColumns(tables, databaseId, definition.tableId);
    const liveKeys = columns
      .map((column) => String(column.key ?? ""))
      .filter((key) => key && !SYSTEM.has(key));
    const schemaKeys = definition.fields.map((field) => field.key);

    const missingColumns = schemaKeys.filter((key) => !liveKeys.includes(key));
    const extraColumns = liveKeys.filter(
      (key) => !schemaKeys.includes(key as never),
    );

    const indexes = await listAllIndexes(tables, databaseId, definition.tableId);
    const liveIndexKeys = indexes.map((index) => String(index.key ?? ""));
    const wantedIndexes = (
      (definition as { indexes?: readonly { key: string }[] }).indexes ?? []
    ).map((index) => index.key);
    const missingIndexes = wantedIndexes.filter(
      (key) => !liveIndexKeys.includes(key),
    );

    const rows = await tables.listRows({
      databaseId,
      tableId: definition.tableId,
      queries: [],
      total: true,
    });

    if (missingColumns.length || extraColumns.length || missingIndexes.length) {
      console.log(`${definition.tableId} (${rows.total} rows)`);

      if (missingColumns.length) {
        console.log(`  + add columns   : ${missingColumns.join(", ")}`);
      }

      if (extraColumns.length) {
        console.log(`  - prune columns : ${extraColumns.join(", ")}`);
      }

      if (missingIndexes.length) {
        console.log(`  + add indexes   : ${missingIndexes.join(", ")}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
