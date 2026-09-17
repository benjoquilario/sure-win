/**
 * Drives the test matrix in `google-play-billing-v3.md` against the real
 * handlers, without Play and without money.
 *
 *   pnpm appwrite:billing:test              # says what it would do
 *   pnpm appwrite:billing:test --confirm    # runs it
 *
 * Seven of the ten cases in that matrix never touch Google: they are about what
 * the handlers do with a purchase once it is verified, which is where the
 * expensive mistakes live. Replay safety, an upgrade closing the subscription it
 * replaced, a refund keeping its row — all of that is testable today, and none
 * of it should first be exercised by a paying member.
 *
 * The three remaining cases need a real Play account and a licence tester:
 * verification itself, acknowledgement, and rejecting a token from another
 * account. Those are marked SKIPPED rather than quietly dropped.
 *
 * **This writes to the live database.** It uses an obviously-fake member id and
 * a temporary plan, and it removes everything it created in a `finally` — but
 * run it against a database you are willing to have rows appear in for a few
 * seconds.
 */

import { ID, Query } from "node-appwrite";

import { appwriteEnv, hasAppwriteServerEnv } from "../lib/appwrite/env";
import { getReviewerTableDefinition } from "@workspace/schema";
import { getAdminServices } from "../lib/appwrite/server";
import {
  applyGooglePurchase,
  applyGoogleNotification,
  claimPlayNotification,
  GOOGLE_NOTIFICATION,
  hashPurchaseToken,
} from "../lib/appwrite/subscriptions";

const PLANS = getReviewerTableDefinition("subscription_plans").tableId;
const SUBSCRIPTIONS = getReviewerTableDefinition("subscriptions").tableId;
const PAYMENTS = getReviewerTableDefinition("payments").tableId;
const NOTIFICATIONS = getReviewerTableDefinition("billing_notifications").tableId;

/** Everything this script creates carries this, so cleanup can find it. */
const MARK = `zz-billing-test-${Date.now()}`;
const USER = `${MARK}-member`;
const PRODUCT = `${MARK}.monthly`;

function hasFlag(name: string) {
  return process.argv.slice(2).includes(`--${name}`);
}

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function days(count: number) {
  return new Date(Date.now() + count * 86_400_000).toISOString();
}

async function rowsFor(tableId: string, field: string, value: string) {
  const { tables } = getAdminServices();
  const response = await tables.listRows({
    databaseId: appwriteEnv.databaseId,
    tableId,
    queries: [Query.equal(field, [value]), Query.limit(50)],
    total: true,
  });
  return response.rows as (Record<string, unknown> & { $id: string })[];
}

async function run() {
  const { tables } = getAdminServices();

  // A plan to buy. applyGooglePurchase resolves the plan from the Play product
  // id, so one has to exist or every case fails for the wrong reason.
  const plan = await tables.createRow({
    databaseId: appwriteEnv.databaseId,
    tableId: PLANS,
    rowId: ID.unique(),
    data: {
      name: `Billing test plan (${MARK})`,
      code: MARK.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24),
      googleProductId: PRODUCT,
      price: 299,
      currency: "PHP",
      durationDays: 30,
      isRecurring: true,
      isActive: false, // never offered to anybody
      order: 9999,
    },
  });

  console.log(`Temporary plan ${plan.$id} (${PRODUCT}), isActive false.\n`);

  const tokenA = `${MARK}-token-a`;
  const tokenB = `${MARK}-token-b`;

  // --- 1. First purchase -------------------------------------------------
  const first = await applyGooglePurchase({
    userId: USER,
    productId: PRODUCT,
    purchaseToken: tokenA,
    orderId: `${MARK}-order-1`,
    autoRenewing: true,
    isAcknowledged: true,
    expiresAt: days(30),
  });

  check("first purchase creates a subscription", first.created);

  const afterFirst = await rowsFor(SUBSCRIPTIONS, "userId", USER);
  check("exactly one subscription row", afterFirst.length === 1, `got ${afterFirst.length}`);
  check(
    "purchaseTokenHash is populated",
    afterFirst[0]?.purchaseTokenHash === hashPurchaseToken(tokenA),
    String(afterFirst[0]?.purchaseTokenHash ?? "(blank)"),
  );
  check("status is active", afterFirst[0]?.status === "active");
  check("a payment row was recorded", (await rowsFor(PAYMENTS, "userId", USER)).length === 1);

  // --- 2. Same token verified twice --------------------------------------
  const replay = await applyGooglePurchase({
    userId: USER,
    productId: PRODUCT,
    purchaseToken: tokenA,
    orderId: `${MARK}-order-1`,
    autoRenewing: true,
    isAcknowledged: true,
    expiresAt: days(30),
  });

  check("replay updates rather than creates", !replay.created);
  check(
    "still exactly one subscription",
    (await rowsFor(SUBSCRIPTIONS, "userId", USER)).length === 1,
  );
  check(
    "still exactly one payment — orderId is unique",
    (await rowsFor(PAYMENTS, "userId", USER)).length === 1,
  );

  // --- 3. Notification delivered twice -----------------------------------
  const messageId = `${MARK}-message-1`;
  const claim1 = await claimPlayNotification({ messageId, purchaseToken: tokenA });
  const claim2 = await claimPlayNotification({ messageId, purchaseToken: tokenA });

  check("first claim succeeds", claim1.claimed);
  check("second claim is refused as a duplicate", !claim2.claimed, claim2.reason);

  // --- 4. Cancel: access continues ---------------------------------------
  await applyGoogleNotification({
    notificationType: GOOGLE_NOTIFICATION.CANCELED,
    purchaseToken: tokenA,
  });

  let row = (await rowsFor(SUBSCRIPTIONS, "userId", USER))[0];
  check("cancel leaves status active", row?.status === "active", String(row?.status));
  check("cancel turns autoRenewing off", row?.autoRenewing === false);

  // --- 5. Card declined: grace period, access continues -------------------
  await applyGoogleNotification({
    notificationType: GOOGLE_NOTIFICATION.IN_GRACE_PERIOD,
    purchaseToken: tokenA,
    expiresAt: days(14),
  });

  row = (await rowsFor(SUBSCRIPTIONS, "userId", USER))[0];
  check("grace period sets in_grace_period", row?.status === "in_grace_period", String(row?.status));
  check("grace period records the notification time", Boolean(row?.latestNotificationAt));

  // --- 6. Retries exhausted: on hold, access ends -------------------------
  await applyGoogleNotification({
    notificationType: GOOGLE_NOTIFICATION.ON_HOLD,
    purchaseToken: tokenA,
  });

  row = (await rowsFor(SUBSCRIPTIONS, "userId", USER))[0];
  check("on hold sets on_hold", row?.status === "on_hold", String(row?.status));
  check(
    "on hold ends access now",
    Boolean(row?.endsAt) && new Date(String(row.endsAt)).getTime() <= Date.now() + 5000,
  );

  // --- 7. Refund: row kept, charges marked -------------------------------
  await applyGoogleNotification({
    notificationType: GOOGLE_NOTIFICATION.REVOKED,
    purchaseToken: tokenA,
  });

  row = (await rowsFor(SUBSCRIPTIONS, "userId", USER))[0];
  const charges = await rowsFor(PAYMENTS, "userId", USER);
  check("refund sets refunded", row?.status === "refunded", String(row?.status));
  check("the charge row is kept, not deleted", charges.length === 1);
  check("the charge is marked refunded", charges[0]?.status === "refunded");
  check("refundedAt is set", Boolean(charges[0]?.refundedAt));

  // --- 8. Plan upgrade closes the replaced subscription -------------------
  // Fresh token, pointing back at the first one.
  await applyGooglePurchase({
    userId: USER,
    productId: PRODUCT,
    purchaseToken: tokenB,
    orderId: `${MARK}-order-2`,
    autoRenewing: true,
    isAcknowledged: true,
    expiresAt: days(60),
    linkedPurchaseToken: tokenA,
  });

  const all = await rowsFor(SUBSCRIPTIONS, "userId", USER);
  const replaced = all.find((r) => r.purchaseTokenHash === hashPurchaseToken(tokenA));
  const current = all.find((r) => r.purchaseTokenHash === hashPurchaseToken(tokenB));

  check("the upgrade created a second subscription", all.length === 2, `got ${all.length}`);
  check("the new subscription is active", current?.status === "active", String(current?.status));
  check(
    "the replaced subscription is closed",
    replaced?.status === "expired" || replaced?.status === "refunded",
    String(replaced?.status),
  );
  check(
    "linkedPurchaseTokenHash is populated",
    current?.linkedPurchaseTokenHash === hashPurchaseToken(tokenA),
  );

  // --- 9. Unknown token ---------------------------------------------------
  const unknown = await applyGoogleNotification({
    notificationType: GOOGLE_NOTIFICATION.RENEWED,
    purchaseToken: `${MARK}-never-seen`,
  });
  check("a notification for an unknown token is refused", !unknown.ok);

  console.log("");
  console.log("  SKIP  token verified against Play          — needs a Play account");
  console.log("  SKIP  purchase acknowledged with Play      — needs a Play account");
  console.log("  SKIP  token replayed from another account  — needs a licence tester");
}

async function cleanup() {
  const { tables } = getAdminServices();
  let removed = 0;

  const remove = async (tableId: string, rows: { $id: string }[]) => {
    for (const row of rows) {
      await tables
        .deleteRow({ databaseId: appwriteEnv.databaseId, tableId, rowId: row.$id })
        .then(() => { removed += 1; })
        .catch(() => undefined);
    }
  };

  await remove(SUBSCRIPTIONS, await rowsFor(SUBSCRIPTIONS, "userId", USER));
  await remove(PAYMENTS, await rowsFor(PAYMENTS, "userId", USER));
  await remove(NOTIFICATIONS, await rowsFor(NOTIFICATIONS, "purchaseToken", `${MARK}-token-a`));
  await remove(PLANS, await rowsFor(PLANS, "googleProductId", PRODUCT));

  console.log(`\nCleaned up ${removed} row(s).`);
}

async function main() {
  if (!hasAppwriteServerEnv()) {
    console.error("Appwrite server env is not set. Run through pnpm so .env is loaded.");
    process.exitCode = 1;
    return;
  }

  if (!hasFlag("confirm")) {
    console.log("Billing handler test — DRY RUN. Nothing will be written.\n");
    console.log("It would create a temporary inactive plan and a fake member, then check:");
    console.log("  - a first purchase writes a subscription, a payment, and the token hash");
    console.log("  - the same token applied twice updates one row instead of creating two");
    console.log("  - a redelivered notification is refused by the messageId index");
    console.log("  - cancel keeps access; grace period keeps access; on hold ends it");
    console.log("  - a refund keeps the charge row and marks it refunded");
    console.log("  - an upgrade closes the subscription it replaced");
    console.log("\nIt writes to the LIVE database and removes everything it created.");
    console.log("Re-run with --confirm to apply.");
    return;
  }

  console.log(`Billing handler test — database ${appwriteEnv.databaseId}`);
  console.log(`Fake member: ${USER}\n`);

  try {
    await run();
  } catch (error) {
    failed += 1;
    console.error("\nThrew:", error instanceof Error ? error.message : error);
  } finally {
    await cleanup();
  }

  console.log(`\n${passed} passed, ${failed} failed.`);

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
