import { Query, type Models, type TablesDB } from "node-appwrite";

/** Appwrite returns 25 rows when no limit is given - tables, columns and indexes included. */
const PAGE_SIZE = 100;

/**
 * Every table in a database, not the first page of them.
 *
 * `listTables` defaults to 25. The schema passed that, and the callers that
 * had not noticed were quietly reporting two existing tables as missing and
 * skipping them during a prune - the kind of wrong answer that looks like a
 * migration bug for as long as nobody counts.
 */
export async function listAllTables(tables: TablesDB, databaseId: string) {
  const all: Models.Table[] = [];
  let cursor: string | null = null;

  for (;;) {
    const queries = [Query.limit(PAGE_SIZE)];

    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }

    const response = await tables.listTables({
      databaseId,
      queries,
      total: false,
    });

    if (!response.tables.length) {
      break;
    }

    all.push(...response.tables);
    cursor = String(response.tables[response.tables.length - 1].$id);

    if (response.tables.length < PAGE_SIZE) {
      break;
    }
  }

  return all;
}

/**
 * Every column on a table.
 *
 * Same default-25 trap as `listAllTables`, and the same misleading result: a
 * table with more than 25 columns reports the ones on page two as missing, so
 * `appwrite:inspect` invents drift that `appwrite:bootstrap` then reports as
 * "already exists". Two tools disagreeing about the same table is a long
 * afternoon.
 */
export async function listAllColumns(
  tables: TablesDB,
  databaseId: string,
  tableId: string,
) {
  const all: Array<{ key?: string }> = [];
  let cursor: string | null = null;

  for (;;) {
    const queries = [Query.limit(PAGE_SIZE)];

    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }

    const response = await tables.listColumns({
      databaseId,
      tableId,
      queries,
      total: false,
    });

    const page = response.columns as Array<{ key?: string }>;

    if (!page.length) {
      break;
    }

    all.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }

    cursor = String(page[page.length - 1].key ?? "");

    if (!cursor) {
      break;
    }
  }

  return all;
}

/** Every index on a table. See `listAllColumns` for why the limit is explicit. */
export async function listAllIndexes(
  tables: TablesDB,
  databaseId: string,
  tableId: string,
) {
  const all: Array<{ key?: string; type?: string; columns?: string[] }> = [];
  let cursor: string | null = null;

  for (;;) {
    const queries = [Query.limit(PAGE_SIZE)];

    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }

    const response = await tables.listIndexes({
      databaseId,
      tableId,
      queries,
      total: false,
    });

    const page = response.indexes as Array<{
      key?: string;
      type?: string;
      columns?: string[];
    }>;

    if (!page.length) {
      break;
    }

    all.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }

    cursor = String(page[page.length - 1].key ?? "");

    if (!cursor) {
      break;
    }
  }

  return all;
}
