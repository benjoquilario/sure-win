/**
 * Brings the Appwrite project in line with `@workspace/schema` (packages/schema/src/schema.ts).
 *
 *   pnpm appwrite:bootstrap              create what is missing (safe, additive)
 *   pnpm appwrite:bootstrap -- --prune   also list what the schema no longer has
 *   pnpm appwrite:bootstrap -- --prune --confirm   and delete it
 *
 * Pruning is opt-in and two-step on purpose: dropping a column drops its data,
 * and the difference between "this table is gone from the schema" and "someone
 * mistyped a table name" is not something a script can tell.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  AppwriteException,
  Client,
  Compression,
  IndexType,
  OrderBy,
  Query,
  Storage,
  TablesDB,
} from "node-appwrite";

import {
  findOversizedIndexes,
  getAccessModelPermissions,
  reviewerTableEntries,
  type CmsFieldDefinition,
  type CmsIndexDefinition,
  type CmsTableDefinition,
} from "@workspace/schema";
import {
  listAllColumns,
  listAllIndexes,
  listAllTables,
} from "../lib/appwrite/tables";

type ExistingColumn = Awaited<ReturnType<TablesDB["getColumn"]>>;

const legacyOptionalColumns = [
  { tableId: "questions", key: "topicId" },
] as const;

/** Appwrite adds these itself; they are not schema drift. */
const SYSTEM_COLUMN_KEYS = new Set([
  "$id",
  "$createdAt",
  "$updatedAt",
  "$permissions",
  "$sequence",
  "$tableId",
  "$databaseId",
]);

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function loadLocalEnvFile() {
  const envPath = path.join(process.cwd(), ".env");

  if (!existsSync(envPath)) {
    return;
  }

  const fileContent = readFileSync(envPath, "utf8");

  for (const rawLine of fileContent.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadLocalEnvFile();

let envModulePromise: Promise<typeof import("../lib/appwrite/env")> | null =
  null;

function getEnvModule() {
  envModulePromise ??= import("../lib/appwrite/env");
  return envModulePromise;
}

function fail(message: string): never {
  throw new Error(message);
}

async function createAdminClient() {
  const { appwriteEnv, hasAppwritePublicEnv, hasAppwriteServerEnv } =
    await getEnvModule();

  if (!hasAppwritePublicEnv() || !hasAppwriteServerEnv()) {
    fail(
      "Missing Appwrite environment variables. Fill .env before running pnpm appwrite:bootstrap or pnpm appwrite:migrate.",
    );
  }

  return new Client()
    .setEndpoint(appwriteEnv.endpoint)
    .setProject(appwriteEnv.projectId)
    .setKey(appwriteEnv.apiKey);
}

function isConflict(error: unknown) {
  return error instanceof AppwriteException && error.code === 409;
}

function isUnsupportedDefault(error: unknown) {
  return (
    error instanceof AppwriteException &&
    error.code === 400 &&
    error.type === "column_default_unsupported"
  );
}

function isColumnLimitExceeded(error: unknown) {
  return (
    error instanceof AppwriteException &&
    error.code === 400 &&
    error.type === "column_limit_exceeded"
  );
}

function isNotFound(error: unknown) {
  return error instanceof AppwriteException && error.code === 404;
}

async function updateColumnRequiredState(
  tables: TablesDB,
  databaseId: string,
  tableId: string,
  key: string,
  existingColumn: ExistingColumn,
  required: boolean,
  field?: CmsFieldDefinition,
) {
  /**
   * Dispatch on the format first, then the type.
   *
   * Appwrite reports an enum as `type: "string", format: "enum"`. Switching on
   * the type alone sends every enum into the string branch, and
   * `updateStringColumn` does not carry `elements` - so an "update the enum
   * values" call would quietly turn the column into free text and drop the
   * white-list it existed for.
   */
  const columnFormat = String((existingColumn as { format?: string }).format ?? "")
    .trim()
    .toLowerCase();
  const columnType =
    columnFormat === "enum"
      ? "enum"
      : String((existingColumn as { type?: string }).type ?? "")
          .trim()
          .toLowerCase();
  const existingDefault = (existingColumn as { default?: unknown }).default;
  /**
   * Appwrite refuses a default on a required column - `column_default_unsupported`
   * - and refuses it whatever the value is, `""` included. Every branch below
   * therefore has to leave the default out when the column is required, not
   * just the numeric ones that happened to hit it first.
   *
   * The trap is that this switch dispatches on `type`, and an enum's type is
   * `string`. A required enum lands in the string branch, so guarding only the
   * enum branch fixes nothing.
   */
  const stringDefault = required
    ? (null as unknown as string)
    : typeof existingDefault === "string"
      ? existingDefault
      : "";

  /**
   * A numeric default has to sit inside the column's own min/max.
   *
   * Falling back to 0 looks harmless until the column is `min: 1` - a position
   * in a list, say - and Appwrite rejects the whole update with "Value must be
   * a valid range between 1 and 9,999". The schema's declared default is the
   * right answer; the column's bounds are the backstop.
   */
  const numberDefault = (() => {
    const candidate =
      typeof field?.defaultValue === "number"
        ? field.defaultValue
        : typeof existingDefault === "number"
          ? existingDefault
          : (field?.min ?? 0);

    const lowerBounded =
      typeof field?.min === "number" ? Math.max(candidate, field.min) : candidate;

    return typeof field?.max === "number"
      ? Math.min(lowerBounded, field.max)
      : lowerBounded;
  })();
  const booleanDefault = required
    ? (null as unknown as boolean)
    : typeof existingDefault === "boolean"
      ? existingDefault
      : false;
  const datetimeDefault = required
    ? undefined
    : typeof existingDefault === "string"
      ? existingDefault
      : (null as unknown as string);

  if (!columnType) {
    throw new Error(`Column ${tableId}.${key} has an unknown type.`);
  }

  switch (columnType) {
    case "boolean": {
      await tables.updateBooleanColumn({
        databaseId,
        tableId,
        key,
        required,
        xdefault: booleanDefault,
      });
      return;
    }
    case "integer": {
      await tables.updateIntegerColumn({
        databaseId,
        tableId,
        key,
        required,
        min: field?.min,
        max: field?.max,
        // Appwrite rejects a default on a required column.
        xdefault: required ? undefined : numberDefault,
      });
      return;
    }
    case "float": {
      await tables.updateFloatColumn({
        databaseId,
        tableId,
        key,
        required,
        min: field?.min,
        max: field?.max,
        xdefault: required ? undefined : numberDefault,
      });
      return;
    }
    case "datetime": {
      await tables.updateDatetimeColumn({
        databaseId,
        tableId,
        key,
        required,
        xdefault: datetimeDefault,
      });
      return;
    }
    case "enum": {
      const elements =
        field?.kind === "enum" && field.options?.length
          ? [...field.options]
          : Array.isArray((existingColumn as { elements?: unknown }).elements)
            ? ((existingColumn as { elements: string[] }).elements ?? [])
            : [];

      if (!elements.length) {
        throw new Error(
          `Cannot update enum column ${tableId}.${key} without enum elements.`,
        );
      }

      /**
       * A required column may not carry a default - Appwrite answers
       * `column_default_unsupported` and the whole run stops. So a required
       * enum is updated without one, and the schema's `defaultValue` stays
       * what it always was for these: the value the application fills in.
       *
       * The stored default is only reused when it is still a legal value.
       * Renaming an enum member (`student` -> `member`) leaves the old default
       * pointing at a value that no longer exists, and sending it back rejects
       * the very update that was meant to fix it.
       */
      // `null`, not `undefined`: the SDK requires the parameter to be present,
      // and Appwrite reads null as "this column has no default" - which is the
      // only thing a required column is allowed to have.
      const enumDefault = required
        ? (null as unknown as string)
        : typeof existingDefault === "string" &&
            elements.includes(existingDefault)
          ? existingDefault
          : typeof field?.defaultValue === "string" &&
              elements.includes(field.defaultValue)
            ? field.defaultValue
            : String(elements[0]);

      await tables.updateEnumColumn({
        databaseId,
        tableId,
        key,
        elements,
        required,
        xdefault: enumDefault,
      });
      return;
    }
    case "string": {
      await tables.updateStringColumn({
        databaseId,
        tableId,
        key,
        required,
        xdefault: stringDefault,
      });
      return;
    }
    case "varchar": {
      await tables.updateVarcharColumn({
        databaseId,
        tableId,
        key,
        required,
        xdefault: stringDefault,
      });
      return;
    }
    case "text": {
      await tables.updateTextColumn({
        databaseId,
        tableId,
        key,
        required,
        xdefault: stringDefault,
      });
      return;
    }
    case "mediumtext": {
      await tables.updateMediumtextColumn({
        databaseId,
        tableId,
        key,
        required,
        xdefault: stringDefault,
      });
      return;
    }
    case "longtext": {
      await tables.updateLongtextColumn({
        databaseId,
        tableId,
        key,
        required,
        xdefault: stringDefault,
      });
      return;
    }
    default: {
      throw new Error(
        `Column ${tableId}.${key} has unsupported type "${columnType}" for required-state updates.`,
      );
    }
  }
}

/**
 * Compares a live column's shape against the schema's.
 *
 * Only `required` was ever reconciled before, which let a much worse drift sit
 * silently: a column that is still an enum after the schema turned it into a
 * free string keeps rejecting values the app now considers legal, and nothing
 * says so. Appwrite cannot change a column's format in place, so this reports
 * what it cannot fix.
 */
function describeColumnDrift(
  existingColumn: ExistingColumn,
  field: CmsFieldDefinition,
) {
  const format = String((existingColumn as { format?: string }).format ?? "");
  const liveElements = Array.isArray(
    (existingColumn as { elements?: unknown }).elements,
  )
    ? ((existingColumn as { elements: string[] }).elements ?? [])
    : [];
  const wantsEnum = field.kind === "enum";
  const isEnum = format === "enum";

  if (wantsEnum && !isEnum) {
    return { kind: "recreate" as const, reason: "schema wants an enum, live column is plain" };
  }

  if (!wantsEnum && isEnum) {
    return {
      kind: "recreate" as const,
      reason: `live column is still an enum limited to [${liveElements.join(", ")}], schema wants a free ${field.kind}`,
    };
  }

  if (wantsEnum && isEnum) {
    const wanted = [...(field.options ?? [])];
    const same =
      wanted.length === liveElements.length &&
      wanted.every((value, index) => value === liveElements[index]);

    if (!same) {
      return {
        kind: "update-enum" as const,
        reason: `enum values differ: live [${liveElements.join(", ")}] vs schema [${wanted.join(", ")}]`,
      };
    }
  }

  return null;
}

async function tableRowCount(tables: TablesDB, tableId: string) {
  const { appwriteEnv } = await getEnvModule();
  const response = await tables.listRows({
    databaseId: appwriteEnv.databaseId,
    tableId,
    queries: [Query.limit(1)],
    total: true,
  });

  return Number(response.total ?? 0);
}

/**
 * Drops and recreates a column whose format the schema changed.
 *
 * Refuses when the table has rows: recreating drops the column's data, and no
 * migration script should make that call on its own.
 */
/** How many rows this script will carry across a column rebuild. */
const MAX_PRESERVED_ROWS = 500;

async function recreateColumn(
  tables: TablesDB,
  tableId: string,
  field: CmsFieldDefinition,
  confirmed: boolean,
) {
  const { appwriteEnv } = await getEnvModule();
  const rows = await tableRowCount(tables, tableId);

  if (rows > MAX_PRESERVED_ROWS) {
    console.log(
      `  Cannot recreate ${tableId}.${field.key} automatically: ${rows} rows is more than this script will carry across a rebuild. Migrate it by hand.`,
    );
    return;
  }

  if (!confirmed) {
    console.log(
      `  would recreate ${tableId}.${field.key}` +
        (rows ? ` (reading ${rows} value(s) back afterwards)` : " (table is empty)"),
    );
    return;
  }

  /**
   * Read the column's values before dropping it, and write them back after.
   *
   * Appwrite cannot change a column's type in place, so a rebuild is the only
   * way - and a rebuild drops the data. Holding the values in memory across it
   * is what turns "migrate this by hand" into something the script can do,
   * within a row count small enough to be safe.
   */
  const preserved: Array<{ rowId: string; value: unknown }> = [];

  if (rows > 0) {
    let cursor: string | null = null;

    for (;;) {
      const queries = [Query.limit(100)];

      if (cursor) {
        queries.push(Query.cursorAfter(cursor));
      }

      const page: Awaited<ReturnType<TablesDB["listRows"]>> =
        await tables.listRows({
          databaseId: appwriteEnv.databaseId,
          tableId,
          queries,
        });

      if (!page.rows.length) {
        break;
      }

      for (const row of page.rows as Array<Record<string, unknown>>) {
        const value = row[field.key];

        if (value !== null && value !== undefined && value !== "") {
          preserved.push({ rowId: String(row.$id), value });
        }
      }

      cursor = String(
        (page.rows[page.rows.length - 1] as { $id: string }).$id,
      );

      if (page.rows.length < 100) {
        break;
      }
    }

    console.log(`  held ${preserved.length} value(s) from ${tableId}.${field.key}`);
  }

  await tables.deleteColumn({
    databaseId: appwriteEnv.databaseId,
    tableId,
    key: field.key,
  });

  // Appwrite deletes columns asynchronously; recreating too soon conflicts.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await tables.getColumn({
        databaseId: appwriteEnv.databaseId,
        tableId,
        key: field.key,
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      if (isNotFound(error)) {
        break;
      }

      throw error;
    }
  }

  await ensureColumn(tables, tableId, field);

  if (!preserved.length) {
    console.log(`  recreated ${tableId}.${field.key}`);
    return;
  }

  // The new column is created asynchronously; writing to it too soon fails.
  await waitForColumns(tables, tableId, [field.key]);

  let restored = 0;

  for (const entry of preserved) {
    try {
      await tables.updateRow({
        databaseId: appwriteEnv.databaseId,
        tableId,
        rowId: entry.rowId,
        data: { [field.key]: entry.value },
      });
      restored += 1;
    } catch (error) {
      // An enum rebuild can reject a value the old free-text column allowed.
      // Say which row, so it can be fixed rather than silently lost.
      console.log(
        `  could not restore ${tableId}.${field.key} on ${entry.rowId} (value ${JSON.stringify(entry.value)}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  console.log(
    `  recreated ${tableId}.${field.key}, restored ${restored}/${preserved.length} value(s)`,
  );
}

async function ensureExistingColumnMatchesField(
  tables: TablesDB,
  tableId: string,
  field: CmsFieldDefinition,
) {
  const { appwriteEnv } = await getEnvModule();

  let existingColumn: ExistingColumn;

  try {
    existingColumn = await tables.getColumn({
      databaseId: appwriteEnv.databaseId,
      tableId,
      key: field.key,
    });
  } catch (error) {
    if (isNotFound(error)) {
      console.log(`  Column ${tableId}.${field.key} not found after conflict.`);
      return;
    }

    throw error;
  }

  const drift = describeColumnDrift(existingColumn, field);

  if (drift?.kind === "update-enum") {
    await updateColumnRequiredState(
      tables,
      appwriteEnv.databaseId,
      tableId,
      field.key,
      existingColumn,
      Boolean(field.required),
      field,
    );
    console.log(`  Updated enum values on ${tableId}.${field.key}: ${drift.reason}`);
    return;
  }

  if (drift?.kind === "recreate") {
    console.log(`  DRIFT ${tableId}.${field.key}: ${drift.reason}`);
    await recreateColumn(tables, tableId, field, hasFlag("confirm"));
    return;
  }

  const desiredRequired = Boolean(field.required);

  if (existingColumn.required === desiredRequired) {
    console.log(`  Column ${tableId}.${field.key} already exists.`);
    return;
  }

  if (desiredRequired) {
    console.log(
      `  Column ${tableId}.${field.key} required mismatch detected; skipping automatic tightening to required.`,
    );
    return;
  }

  await updateColumnRequiredState(
    tables,
    appwriteEnv.databaseId,
    tableId,
    field.key,
    existingColumn,
    desiredRequired,
    field,
  );

  console.log(
    `  Updated column ${tableId}.${field.key} required=${String(desiredRequired)}.`,
  );
}

async function ensureLegacyColumnIsOptional(
  tables: TablesDB,
  tableId: string,
  key: string,
) {
  const { appwriteEnv } = await getEnvModule();

  let existingColumn: ExistingColumn;

  try {
    existingColumn = await tables.getColumn({
      databaseId: appwriteEnv.databaseId,
      tableId,
      key,
    });
  } catch (error) {
    if (isNotFound(error)) {
      console.log(`  Legacy column ${tableId}.${key} not found; skipping.`);
      return;
    }

    throw error;
  }

  if (!existingColumn.required) {
    console.log(`  Legacy column ${tableId}.${key} already optional.`);
    return;
  }

  await updateColumnRequiredState(
    tables,
    appwriteEnv.databaseId,
    tableId,
    key,
    existingColumn,
    false,
  );

  console.log(`  Updated legacy column ${tableId}.${key} required=false.`);
}

async function ensureDatabase(tables: TablesDB) {
  const { appwriteEnv } = await getEnvModule();

  try {
    await tables.get({ databaseId: appwriteEnv.databaseId });
    console.log(`Database ${appwriteEnv.databaseId} already exists.`);
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 404) {
      await tables.create({
        databaseId: appwriteEnv.databaseId,
        name: "Social Work Reviewer",
        enabled: true,
      });
      console.log(`Created database ${appwriteEnv.databaseId}.`);
      return;
    }

    throw error;
  }
}

/**
 * Permissions are unordered in Appwrite but come back in whatever order they
 * were written, so compare them as sets.
 */
function samePermissions(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) {
    return false;
  }

  const left = new Set(a);
  return b.every((permission) => left.has(permission));
}

/**
 * Creates the table if it is missing, and reconciles its permissions if it is
 * not.
 *
 * The reconcile half is the one that matters. The dashboard reads through an
 * API key, which bypasses permissions, so a table whose grants are wrong looks
 * completely healthy here and returns `user_unauthorized` to every request the
 * mobile app makes. Leaving permissions to be set by hand in the console means
 * the only place that discrepancy shows up is a support message.
 */
async function ensureTable(tables: TablesDB, definition: CmsTableDefinition) {
  const { appwriteEnv } = await getEnvModule();
  const { tableId, name, accessModel } = definition;
  const wanted = getAccessModelPermissions(accessModel);

  let existing: Awaited<ReturnType<TablesDB["getTable"]>>;

  try {
    existing = await tables.getTable({
      databaseId: appwriteEnv.databaseId,
      tableId,
    });
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 404) {
      await tables.createTable({
        databaseId: appwriteEnv.databaseId,
        tableId,
        name,
        enabled: true,
        rowSecurity: wanted.rowSecurity,
        permissions: [...wanted.permissions],
      });
      console.log(`Created table ${tableId} (${accessModel}).`);
      return;
    }

    throw error;
  }

  const permissionsMatch = samePermissions(
    existing.$permissions ?? [],
    wanted.permissions,
  );
  const rowSecurityMatches = existing.rowSecurity === wanted.rowSecurity;

  if (permissionsMatch && rowSecurityMatches) {
    console.log(`Table ${tableId} already exists (${accessModel}).`);
    return;
  }

  console.log(`Table ${tableId} permissions drifted from ${accessModel}:`);
  console.log(
    `  was  rowSecurity=${existing.rowSecurity} ${JSON.stringify(existing.$permissions ?? [])}`,
  );
  console.log(
    `  now  rowSecurity=${wanted.rowSecurity} ${JSON.stringify(wanted.permissions)}`,
  );

  await tables.updateTable({
    databaseId: appwriteEnv.databaseId,
    tableId,
    name: existing.name,
    enabled: existing.enabled,
    rowSecurity: wanted.rowSecurity,
    permissions: [...wanted.permissions],
  });
}

async function ensureColumn(
  tables: TablesDB,
  tableId: string,
  field: CmsFieldDefinition,
) {
  const { appwriteEnv } = await getEnvModule();

  function getStringColumnSize(sizeOverride?: number) {
    if (typeof sizeOverride === "number") {
      return sizeOverride;
    }

    return (
      field.size ??
      (field.kind === "text" || field.kind === "richtext" ? 20000 : 255)
    );
  }

  function getFallbackSizes(baseSize: number) {
    return [12000, 10000, 8000, 6000, 4000, 3000, 2000, 1000, 512, 255].filter(
      (size) => size < baseSize,
    );
  }

  async function createColumn(
    withDefaultValue: boolean,
    sizeOverride?: number,
  ) {
    if (field.kind === "integer") {
      await tables.createIntegerColumn({
        databaseId: appwriteEnv.databaseId,
        tableId,
        key: field.key,
        required: Boolean(field.required),
        min: field.min,
        max: field.max,
        xdefault:
          withDefaultValue && typeof field.defaultValue === "number"
            ? field.defaultValue
            : undefined,
      });
      return;
    }

    if (field.kind === "float") {
      await tables.createFloatColumn({
        databaseId: appwriteEnv.databaseId,
        tableId,
        key: field.key,
        required: Boolean(field.required),
        min: field.min,
        max: field.max,
        xdefault:
          withDefaultValue && typeof field.defaultValue === "number"
            ? field.defaultValue
            : undefined,
      });
      return;
    }

    if (field.kind === "boolean") {
      await tables.createBooleanColumn({
        databaseId: appwriteEnv.databaseId,
        tableId,
        key: field.key,
        required: Boolean(field.required),
        xdefault:
          withDefaultValue && typeof field.defaultValue === "boolean"
            ? field.defaultValue
            : undefined,
      });
      return;
    }

    if (field.kind === "datetime") {
      await tables.createDatetimeColumn({
        databaseId: appwriteEnv.databaseId,
        tableId,
        key: field.key,
        required: Boolean(field.required),
      });
      return;
    }

    /**
     * Enums were being created as plain string columns.
     *
     * There was no branch for them, so every `kind: "enum"` fell through to
     * `createStringColumn` and Appwrite accepted any value at all - the
     * white-list existed in the schema file and nowhere in the database. New
     * columns are now real enums; existing ones are reported as drift and only
     * recreated automatically while their table is still empty, because
     * recreating a column drops what is in it.
     */
    if (field.kind === "enum" && field.options?.length) {
      await tables.createEnumColumn({
        databaseId: appwriteEnv.databaseId,
        tableId,
        key: field.key,
        elements: [...field.options],
        required: Boolean(field.required),
        xdefault:
          withDefaultValue && typeof field.defaultValue === "string"
            ? field.defaultValue
            : undefined,
      });
      return;
    }

    const size = getStringColumnSize(sizeOverride);

    await tables.createStringColumn({
      databaseId: appwriteEnv.databaseId,
      tableId,
      key: field.key,
      size,
      required: Boolean(field.required),
      xdefault:
        withDefaultValue && typeof field.defaultValue === "string"
          ? field.defaultValue
          : undefined,
      array: field.kind === "string[]",
    });
  }

  async function createColumnWithFallback(withDefaultValue: boolean) {
    try {
      await createColumn(withDefaultValue);
      return false;
    } catch (error) {
      const supportsSizeFallback =
        field.kind === "string" ||
        field.kind === "text" ||
        field.kind === "richtext" ||
        field.kind === "enum" ||
        field.kind === "string[]";

      if (!isColumnLimitExceeded(error) || !supportsSizeFallback) {
        throw error;
      }

      const baseSize = getStringColumnSize();
      const fallbackSizes = getFallbackSizes(baseSize);

      for (const fallbackSize of fallbackSizes) {
        try {
          await createColumn(withDefaultValue, fallbackSize);
          console.log(
            `  Added column ${tableId}.${field.key} with reduced size ${fallbackSize} due to Appwrite column limits.`,
          );
          return true;
        } catch (fallbackError) {
          if (!isColumnLimitExceeded(fallbackError)) {
            throw fallbackError;
          }
        }
      }

      throw error;
    }
  }

  try {
    const usedFallback = await createColumnWithFallback(true);

    if (!usedFallback) {
      console.log(`  Added column ${tableId}.${field.key}`);
    }
  } catch (error) {
    if (isConflict(error)) {
      await ensureExistingColumnMatchesField(tables, tableId, field);
      return;
    }

    if (isUnsupportedDefault(error) && field.defaultValue !== undefined) {
      try {
        await createColumnWithFallback(false);
        console.log(
          `  Added column ${tableId}.${field.key} without default value (Appwrite does not support defaults for this required column).`,
        );
      } catch (retryError) {
        if (isConflict(retryError)) {
          // Reconcile, do not just report. Appwrite rejects a default on a
          // required column, so every required-with-default field lands here -
          // and returning early meant those columns, `user_roles.role` among
          // them, were the only ones drift detection never looked at.
          await ensureExistingColumnMatchesField(tables, tableId, field);
          return;
        }

        throw retryError;
      }

      return;
    }

    throw error;
  }
}

/**
 * Waits for the columns an index needs to finish processing.
 *
 * Appwrite creates a column asynchronously; asking for an index on one that is
 * still "processing" fails, so on a fresh project every index would fail on the
 * first run and only appear on a second. Polling here makes one run enough.
 */
async function waitForColumns(
  tables: TablesDB,
  tableId: string,
  keys: readonly string[],
  timeoutMs = 30000,
) {
  const { appwriteEnv } = await getEnvModule();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const statuses = await Promise.all(
      keys.map(async (key) => {
        try {
          const column = await tables.getColumn({
            databaseId: appwriteEnv.databaseId,
            tableId,
            key,
          });

          return String((column as { status?: string }).status ?? "available");
        } catch (error) {
          if (isNotFound(error)) {
            return "missing";
          }

          throw error;
        }
      }),
    );

    if (statuses.every((status) => status === "available")) {
      return true;
    }

    if (statuses.includes("missing") || statuses.includes("failed")) {
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}

type LiveIndex = { key?: string; type?: string; columns?: string[] };

async function listLiveIndexes(tables: TablesDB, tableId: string) {
  const { appwriteEnv } = await getEnvModule();

  try {
    return (await listAllIndexes(
      tables,
      appwriteEnv.databaseId,
      tableId,
    )) as LiveIndex[];
  } catch {
    return [] as LiveIndex[];
  }
}

async function createIndex(
  tables: TablesDB,
  tableId: string,
  index: CmsIndexDefinition,
) {
  const { appwriteEnv } = await getEnvModule();

  await tables.createIndex({
    databaseId: appwriteEnv.databaseId,
    tableId,
    key: index.key,
    type: index.type as IndexType,
    columns: [...index.columns],
    orders: index.orders?.map((order) =>
      order === "DESC" ? OrderBy.Desc : OrderBy.Asc,
    ),
  });
}

/**
 * Creates an index, and repairs one that has quietly changed meaning.
 *
 * Deleting a column does not delete the indexes that use it - Appwrite drops
 * the column from them and leaves them in place. A unique index on
 * (categoryId, setCode) silently became a unique index on categoryId alone,
 * which reads as "one set per category" and rejects the second one with a
 * constraint error that names nothing. Nothing surfaces this, so the columns
 * are compared on every run.
 */
async function ensureIndex(
  tables: TablesDB,
  tableId: string,
  index: CmsIndexDefinition,
) {
  const { appwriteEnv } = await getEnvModule();
  const ready = await waitForColumns(tables, tableId, index.columns);

  if (!ready) {
    console.log(
      `  Skipped index ${tableId}.${index.key}: its columns are not available yet. Re-run to finish.`,
    );
    return;
  }

  const live = (await listLiveIndexes(tables, tableId)).find(
    (candidate) => candidate.key === index.key,
  );

  if (live) {
    const liveColumns = live.columns ?? [];
    const wanted = [...index.columns];
    const matches =
      String(live.type ?? "") === index.type &&
      liveColumns.length === wanted.length &&
      wanted.every((column, position) => column === liveColumns[position]);

    if (matches) {
      console.log(`  Index ${tableId}.${index.key} already exists.`);
      return;
    }

    console.log(
      `  DRIFT index ${tableId}.${index.key}: live ${live.type} (${liveColumns.join(", ") || "none"}) vs schema ${index.type} (${wanted.join(", ")}). Rebuilding.`,
    );

    try {
      await tables.deleteIndex({
        databaseId: appwriteEnv.databaseId,
        tableId,
        key: index.key,
      });

      // Index deletion is asynchronous; recreating too soon conflicts.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const stillThere = (await listLiveIndexes(tables, tableId)).some(
          (candidate) => candidate.key === index.key,
        );

        if (!stillThere) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.log(
        `  Could not drop index ${tableId}.${index.key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
  }

  try {
    await createIndex(tables, tableId, index);
    console.log(
      `  ${live ? "Rebuilt" : "Added"} index ${tableId}.${index.key} (${index.type}).`,
    );
  } catch (error) {
    if (isConflict(error)) {
      console.log(`  Index ${tableId}.${index.key} already exists.`);
      return;
    }

    // A unique index rejected over existing duplicates is a data problem, not
    // a schema one: report it loudly, but do not abandon the rest of the run.
    console.log(
      `  Could not create index ${tableId}.${index.key}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function ensureAssetsBucket(storage: Storage) {
  const { appwriteEnv } = await getEnvModule();

  try {
    await storage.getBucket({ bucketId: appwriteEnv.assetsBucketId });
    console.log(`Bucket ${appwriteEnv.assetsBucketId} already exists.`);
    return;
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }

  await storage.createBucket({
    bucketId: appwriteEnv.assetsBucketId,
    name: "Reviewer Assets",
    fileSecurity: false,
    enabled: true,
    maximumFileSize: 20 * 1024 * 1024,
    allowedFileExtensions: [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "webp",
      "bmp",
      "svg",
      "avif",
    ],
    compression: Compression.None,
    encryption: false,
    antivirus: true,
    transformations: true,
  });

  console.log(`Created bucket ${appwriteEnv.assetsBucketId}.`);
}

type PruneTarget = {
  kind: "table" | "column" | "index";
  tableId: string;
  key?: string;
};

/**
 * Finds everything in the database the schema no longer describes.
 *
 * This is what removes the retired `exams` / `exam_questions` / `choices`
 * tables and the columns left behind by renames. It reports before it deletes,
 * and only deletes with `--confirm`, because dropping a column drops its data
 * and a script cannot tell a retired table from a typo.
 */
async function collectPruneTargets(tables: TablesDB) {
  const { appwriteEnv } = await getEnvModule();
  const targets: PruneTarget[] = [];

  const schemaTableIds = new Set<string>(
    reviewerTableEntries.map(([, definition]) => definition.tableId),
  );
  const liveTables = await listAllTables(tables, appwriteEnv.databaseId);

  for (const table of liveTables) {
    if (!schemaTableIds.has(table.$id)) {
      targets.push({ kind: "table", tableId: table.$id });
    }
  }

  for (const [, definition] of reviewerTableEntries) {
    if (!liveTables.some((table) => table.$id === definition.tableId)) {
      continue;
    }

    const schemaColumnKeys = new Set<string>(
      definition.fields.map((field) => field.key),
    );

    const columnList = await listAllColumns(
      tables,
      appwriteEnv.databaseId,
      definition.tableId,
    );

    for (const column of columnList) {
      const key = String(column.key ?? "");

      if (!key || SYSTEM_COLUMN_KEYS.has(key) || schemaColumnKeys.has(key)) {
        continue;
      }

      targets.push({ kind: "column", tableId: definition.tableId, key });
    }

    // Indexes outlive the columns they were built on: deleting a column strips
    // it from the index rather than removing the index, so one the schema no
    // longer declares can sit there enforcing something nobody asked for.
    const schemaIndexKeys = new Set<string>(
      (
        (definition as { indexes?: readonly CmsIndexDefinition[] }).indexes ?? []
      ).map((index) => index.key),
    );

    for (const index of await listLiveIndexes(tables, definition.tableId)) {
      const key = String(index.key ?? "");

      if (!key || schemaIndexKeys.has(key)) {
        continue;
      }

      targets.push({ kind: "index", tableId: definition.tableId, key });
    }
  }

  return targets;
}

async function prune(tables: TablesDB, confirmed: boolean) {
  const { appwriteEnv } = await getEnvModule();
  const targets = await collectPruneTargets(tables);

  if (!targets.length) {
    console.log("Prune: nothing to remove. The database matches the schema.");
    return;
  }

  console.log("");
  console.log(
    `Prune: ${targets.length} item(s) in the database are not in the schema.`,
  );

  for (const target of targets) {
    const label =
      target.kind === "table"
        ? `table  ${target.tableId}`
        : target.kind === "index"
          ? `index  ${target.tableId}.${target.key}`
          : `column ${target.tableId}.${target.key}`;

    if (!confirmed) {
      console.log(`  would delete ${label}`);
      continue;
    }

    try {
      if (target.kind === "table") {
        await tables.deleteTable({
          databaseId: appwriteEnv.databaseId,
          tableId: target.tableId,
        });
      } else if (target.kind === "index") {
        await tables.deleteIndex({
          databaseId: appwriteEnv.databaseId,
          tableId: target.tableId,
          key: String(target.key),
        });
      } else {
        await tables.deleteColumn({
          databaseId: appwriteEnv.databaseId,
          tableId: target.tableId,
          key: String(target.key),
        });
      }

      console.log(`  deleted ${label}`);
    } catch (error) {
      console.log(
        `  could not delete ${label}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (!confirmed) {
    console.log("");
    console.log(
      "Nothing was deleted. Check the list above, then re-run with --prune --confirm to apply.",
    );
  }
}

/**
 * Fills in required values on rows that predate the column.
 *
 * Adding a required column to a table that already has rows leaves those rows
 * holding null, and Appwrite then rejects *every* later write to them - even an
 * update that only touches an unrelated field - with "Missing required
 * attribute". The row becomes read-only until something backfills it, which is
 * what this does, using the defaults already declared in the schema.
 */
async function backfillRequiredDefaults(tables: TablesDB, confirmed: boolean) {
  const { appwriteEnv } = await getEnvModule();
  let repaired = 0;
  let scanned = 0;

  for (const [, definition] of reviewerTableEntries) {
    const fields = definition.fields as readonly CmsFieldDefinition[];
    const fillable = fields.filter(
      (field) => field.required && field.defaultValue !== undefined,
    );

    if (!fillable.length) {
      continue;
    }

    let cursor: string | null = null;

    for (;;) {
      const queries = [Query.limit(100)];

      if (cursor) {
        queries.push(Query.cursorAfter(cursor));
      }

      const response: Awaited<ReturnType<TablesDB["listRows"]>> =
        await tables.listRows({
          databaseId: appwriteEnv.databaseId,
          tableId: definition.tableId,
          queries,
        });

      if (!response.rows.length) {
        break;
      }

      for (const row of response.rows as Array<Record<string, unknown>>) {
        scanned += 1;
        const patch: Record<string, unknown> = {};

        for (const field of fillable) {
          if (row[field.key] === null || row[field.key] === undefined) {
            patch[field.key] = field.defaultValue;
          }
        }

        if (!Object.keys(patch).length) {
          continue;
        }

        repaired += 1;
        const label = `${definition.tableId}/${String(row.$id)} <- ${JSON.stringify(patch)}`;

        if (!confirmed) {
          console.log(`  would backfill ${label}`);
          continue;
        }

        try {
          await tables.updateRow({
            databaseId: appwriteEnv.databaseId,
            tableId: definition.tableId,
            rowId: String(row.$id),
            data: patch,
          });
          console.log(`  backfilled ${label}`);
        } catch (error) {
          console.log(
            `  could not backfill ${label}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      cursor = String(
        (response.rows[response.rows.length - 1] as { $id: string }).$id,
      );

      if (response.rows.length < 100) {
        break;
      }
    }
  }

  if (!repaired) {
    console.log(`Backfill: nothing to repair (${scanned} rows checked).`);
    return;
  }

  if (!confirmed) {
    console.log("");
    console.log(
      `Backfill: ${repaired} row(s) need values. Re-run with --backfill --confirm to write them.`,
    );
  }
}

/**
 * Recomputes every category's rollup counters from the questions themselves.
 *
 * `questionCount`, `directQuestionCount`, and `setCount` are denormalised onto
 * the category so the mobile app can route without extra queries. Anything that
 * edits rows outside this CMS - the Appwrite console, a script - can leave them
 * stale, and a wrong `setCount` sends the app to the wrong screen. This is the
 * repair.
 */
/**
 * Stamps each material with its topic's subject, then recounts the tree.
 *
 * `learning_materials.subjectId` is denormalised so a subject's materials are
 * one query; materials created before the column existed have it blank, which
 * would make that query silently miss them.
 */
async function recountContent(tables: TablesDB) {
  const { appwriteEnv } = await getEnvModule();
  const { listSubjectSummaries, listTopicSummaries, syncContentCounts } =
    await import("../lib/appwrite/content");

  const [subjects, topics] = await Promise.all([
    listSubjectSummaries(),
    listTopicSummaries(),
  ]);
  const subjectByTopic = new Map(
    topics.map((topic) => [topic.id, topic.subjectId]),
  );

  let stamped = 0;
  let cursor: string | null = null;

  for (;;) {
    const queries = [Query.limit(100)];

    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }

    const response: Awaited<ReturnType<TablesDB["listRows"]>> =
      await tables.listRows({
        databaseId: appwriteEnv.databaseId,
        tableId: "learning_materials",
        queries,
      });

    if (!response.rows.length) {
      break;
    }

    for (const row of response.rows as Array<Record<string, unknown>>) {
      const topicId = String(row.topicId ?? "").trim();
      const wanted = subjectByTopic.get(topicId) ?? "";
      const current = String(row.subjectId ?? "").trim();

      if (!wanted || wanted === current) {
        continue;
      }

      await tables.updateRow({
        databaseId: appwriteEnv.databaseId,
        tableId: "learning_materials",
        rowId: String(row.$id),
        data: { subjectId: wanted },
      });
      stamped += 1;
    }

    cursor = String(
      (response.rows[response.rows.length - 1] as { $id: string }).$id,
    );

    if (response.rows.length < 100) {
      break;
    }
  }

  console.log(`  stamped subjectId on ${stamped} material(s)`);

  for (const topic of topics) {
    await syncContentCounts(topic.id, "");
  }

  for (const subject of subjects) {
    await syncContentCounts("", subject.id);
  }

  const refreshed = await listSubjectSummaries();

  for (const subject of refreshed) {
    console.log(
      `  ${subject.name}: ${subject.topicCount} topic(s), ${subject.materialCount} material(s)`,
    );
  }
}

/**
 * Moves finished subscriptions to `expired` and refreshes the profiles.
 *
 * A lapse has no event to hang off - nobody presses a button when their month
 * runs out - so this has to be run on a schedule. Daily is plenty; reads are
 * already safe in the meantime because `hasActivePremium` checks the date.
 */
async function expireSubscriptions() {
  const { expireFinishedSubscriptions } = await import(
    "../lib/appwrite/subscriptions"
  );

  const result = await expireFinishedSubscriptions();

  console.log(
    `Expiry: ${result.expired} subscription(s) ended, ${result.users.length} profile(s) refreshed.`,
  );
}

/**
 * Rewrites the like counters from the like tables.
 *
 * Part of `--recount` because it is the same kind of job as the content
 * counts: a denormalised number that no single write can keep correct, so it
 * is rebuilt from the rows that are. Since v4 the app cannot write these at
 * all - that grant is what let any member edit any other member's post - so
 * this is the only thing that moves them.
 */
async function recountCommunityLikes() {
  const { recountLikes } = await import("../lib/appwrite/community");
  const result = await recountLikes();

  for (const [tableId, counts] of Object.entries(result)) {
    console.log(
      `  ${tableId}: ${counts.corrected} of ${counts.checked} row(s) had a stale like count`,
    );
  }
}

/**
 * Hard-deletes what the app could only hide.
 *
 * Delete is owner-only on the community tables, so a member removing their
 * post can only set `isDeleted`. This clears those rows and cascades each one
 * properly. Run it on a schedule, or with --confirm after a moderation pass.
 */
async function purgeSoftDeletedRows(confirmed: boolean) {
  const { purgeSoftDeleted } = await import("../lib/appwrite/community");

  if (!confirmed) {
    console.log(
      "Purge of soft-deleted community rows needs --confirm. Nothing removed.",
    );
    return;
  }

  const removed = await purgeSoftDeleted();
  console.log(
    `Purged ${removed.posts} post(s), ${removed.comments} comment(s), ${removed.replies} reply/replies and everything under them.`,
  );
}

async function recountCategories() {
  const { listExamCategories, syncCategoryRollups } = await import(
    "../lib/appwrite/questions"
  );

  const categories = await listExamCategories();

  if (!categories.length) {
    console.log("Recount: no categories.");
    return;
  }

  for (const category of categories) {
    const result = await syncCategoryRollups(category.id);

    console.log(
      `  ${category.title}: ${result.questionCount} questions (${result.directQuestionCount} loose), ${result.setCount} published set(s)`,
    );

    for (const warning of result.warnings) {
      console.log(`    ${warning}`);
    }
  }
}

async function main() {
  const client = await createAdminClient();
  const tables = new TablesDB(client);
  const storage = new Storage(client);
  const shouldPrune = hasFlag("prune");
  const shouldBackfill = hasFlag("backfill");
  const shouldRecount = hasFlag("recount");
  const shouldExpire = hasFlag("expire");
  const shouldPurgeDeleted = hasFlag("purge-deleted");
  const confirmed = hasFlag("confirm");

  // A column too long to index is a schema mistake, not a data problem, and
  // it is the one failure ensureIndex's log-and-continue would hide. Refuse
  // the run instead: a migration that reports success while the index billing
  // depends on was rejected is worse than one that stops.
  const oversized = findOversizedIndexes();

  if (oversized.length) {
    console.error(
      `${oversized.length} index(es) cover a column Appwrite cannot index (limit 767):`,
    );

    for (const problem of oversized) {
      console.error(
        `  ${problem.tableId}.${problem.index} -> ${problem.column} is ${problem.size}`,
      );
    }

    console.error(
      "Index a fixed-length fingerprint column beside the long one instead - see purchaseTokenHash.",
    );
    process.exitCode = 1;
    return;
  }

  await ensureDatabase(tables);

  for (const [, definition] of reviewerTableEntries) {
    await ensureTable(tables, definition);

    for (const field of definition.fields) {
      await ensureColumn(tables, definition.tableId, field);
    }
  }

  for (const legacyColumn of legacyOptionalColumns) {
    await ensureLegacyColumnIsOptional(
      tables,
      legacyColumn.tableId,
      legacyColumn.key,
    );
  }

  // Indexes run after every column exists, so a multi-column index never races
  // a column still being created.
  for (const [, definition] of reviewerTableEntries) {
    // Not every table declares indexes, and the const-typed union only carries
    // the property on those that do.
    const indexes =
      (definition as { indexes?: readonly CmsIndexDefinition[] }).indexes ?? [];

    for (const index of indexes) {
      await ensureIndex(tables, definition.tableId, index);
    }
  }

  await ensureAssetsBucket(storage);

  if (shouldBackfill) {
    await backfillRequiredDefaults(tables, confirmed);
  }

  if (shouldExpire) {
    await expireSubscriptions();
  }

  if (shouldRecount) {
    await recountCategories();
    await recountContent(tables);
    await recountCommunityLikes();
  }

  if (shouldPurgeDeleted) {
    await purgeSoftDeletedRows(confirmed);
  }

  if (shouldPrune) {
    await prune(tables, confirmed);
  } else {
    const targets = await collectPruneTargets(tables);

    if (targets.length) {
      console.log("");
      console.log(
        `${targets.length} table(s)/column(s) exist that the schema no longer has. Run with --prune to list them.`,
      );
    }
  }

  console.log("");
  console.log("Appwrite bootstrap finished.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
