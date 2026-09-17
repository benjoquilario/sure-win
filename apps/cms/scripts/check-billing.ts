/**
 * The billing alarm. Read-only - it changes nothing.
 *
 *   pnpm appwrite:billing:check
 *
 * Two questions, both of which are silent failures otherwise:
 *
 * 1. **Which purchases has Google not been acknowledged for?** Google
 *    automatically refunds any purchase not acknowledged within three days.
 *    Every row in that list is money on its way back to a member who is still
 *    using the app, and nothing anywhere else will tell you.
 *
 * 2. **Which of Google's notifications failed to apply?** A failed renewal
 *    notification means a paying member whose access is about to lapse. A
 *    failed refund means someone who was refunded and still has access.
 *
 * Exits non-zero when either list is non-empty, so it can be a cron job that
 * only speaks up when something is wrong.
 */

import { Query } from "node-appwrite";

import {
  appwriteEnv,
  getBillingWarnings,
  hasAppwriteServerEnv,
} from "../lib/appwrite/env";
import { getReviewerTableDefinition } from "@workspace/schema";
import { getAdminServices } from "../lib/appwrite/server";
import { listUnacknowledgedSubscriptions } from "../lib/appwrite/subscriptions";

const NOTIFICATIONS = getReviewerTableDefinition(
  "billing_notifications",
).tableId;

/**
 * How old a purchase has to be before it counts.
 *
 * A purchase made in the last few hours may simply still be in flight. Three
 * days is the deadline, so a day of margin turns a real problem into two more
 * days to fix it.
 */
const HOURS_BEFORE_ALARM = 24;

function hoursSince(iso: string) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? null
    : Math.floor((Date.now() - at.getTime()) / 3_600_000);
}

async function main() {
  if (!hasAppwriteServerEnv()) {
    console.error(
      "Appwrite server env is not set. Run through pnpm so .env is loaded.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Billing check - database ${appwriteEnv.databaseId}\n`);

  let problems = 0;

  // 0. Configuration -------------------------------------------------------
  //
  // First, because every other check below reads healthy on a system that
  // cannot take a payment at all. Zero unacknowledged purchases is not good
  // news when nothing can be purchased.
  const configWarnings = getBillingWarnings();

  if (!configWarnings.length) {
    console.log("Configuration: verification and notifications are set up.");
  } else {
    problems += configWarnings.length;
    console.log(`CONFIGURATION: ${configWarnings.length} thing(s) not set.\n`);

    for (const warning of configWarnings) {
      console.log(`  ${warning}`);
    }

    console.log("\n  See .env.billing.example.");
  }

  console.log("");

  // 1. Unacknowledged purchases -------------------------------------------
  const unacknowledged =
    await listUnacknowledgedSubscriptions(HOURS_BEFORE_ALARM);

  if (!unacknowledged.length) {
    console.log("Acknowledgements: every active purchase is acknowledged.");
  } else {
    problems += unacknowledged.length;
    console.log(
      `ACKNOWLEDGEMENTS: ${unacknowledged.length} active purchase(s) not acknowledged with Google.`,
    );
    console.log(
      "Google refunds these automatically after three days. Acknowledge them now.\n",
    );

    for (const row of unacknowledged) {
      const age = hoursSince(row.createdAt);
      console.log(
        `  ${row.id}  ${row.planName || "(no plan)"}  member ${row.userId}` +
          `  order ${row.orderId || "(none)"}` +
          (age === null ? "" : `  ${age}h old${age >= 72 ? " - PAST DEADLINE" : ""}`),
      );
    }
  }

  console.log("");

  // 2. Notifications that failed to apply ----------------------------------
  const { tables } = getAdminServices();

  let failed: Record<string, unknown>[] = [];

  try {
    const response = await tables.listRows({
      databaseId: appwriteEnv.databaseId,
      tableId: NOTIFICATIONS,
      queries: [
        Query.equal("status", ["failed"]),
        Query.orderAsc("createdAt"),
        Query.limit(50),
      ],
    });

    failed = response.rows as Record<string, unknown>[];
  } catch (error) {
    // The table not existing yet is a bootstrap that has not been run, not a
    // billing problem. Say which it is.
    console.log(
      `Notifications: could not be read (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
    console.log("If the table does not exist, run pnpm appwrite:bootstrap --confirm.");
    process.exitCode = problems ? 1 : 0;
    return;
  }

  if (!failed.length) {
    console.log("Notifications: nothing failed to apply.");
  } else {
    problems += failed.length;
    console.log(
      `NOTIFICATIONS: ${failed.length} message(s) from Google failed to apply.\n`,
    );

    for (const row of failed) {
      console.log(
        `  type ${String(row.notificationType ?? "?")}  ` +
          `token ${String(row.purchaseToken ?? "").slice(0, 24)}...  ` +
          `${String(row.error ?? "no reason recorded")}`,
      );
    }
  }

  console.log("");
  console.log(
    problems
      ? `${problems} thing(s) need attention.`
      : "Billing is healthy.",
  );

  if (problems) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
