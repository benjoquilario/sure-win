/**
 * Authors the starter rows in `subscription_plans`.
 *
 * The table is empty, and the premium screen renders whatever is in it - so
 * until this runs, a finished checkout has nothing to sell. Everything else in
 * billing is code; this is the one piece that is data.
 *
 * How this is meant to be run:
 *
 *   pnpm appwrite:seed:plans              # dry run, changes nothing
 *   pnpm appwrite:seed:plans --confirm    # apply
 *
 * Dry run is the default deliberately: read the plans it is about to write
 * before it writes them, because `googleProductId` is the join to Play and a
 * wrong one produces a plan nobody can buy.
 *
 * It is idempotent. A plan whose `googleProductId` already exists is left
 * exactly as it is rather than rewritten, so re-running after adding a fourth
 * plan adds the fourth and touches nothing else - and never overwrites copy
 * somebody has since edited in the dashboard. The unique index on
 * `googleProductId` is the backstop if that is ever wrong.
 *
 * ---------------------------------------------------------------------------
 * BEFORE YOU RUN THIS
 *
 * Every `googleProductId` below has to already exist in Play Console, as an
 * ACTIVE subscription with an ACTIVE base plan. Play is where the product and
 * the money live; this table only says how the plan is presented. A row
 * pointing at a product that does not exist looks perfectly healthy in the
 * dashboard and fails in the app, at the moment somebody tries to pay.
 *
 * The IDs here are the obvious names, not sacred ones. Change them to match
 * whatever you created - but change them in Play Console first, because a Play
 * product ID is permanent and cannot be reused after deletion.
 * ---------------------------------------------------------------------------
 */

import { Client, ID, Query, TablesDB } from "node-appwrite";

import { appwriteEnv } from "../lib/appwrite/env";
import { getReviewerTableDefinition } from "@workspace/schema";

const PLANS = getReviewerTableDefinition("subscription_plans").tableId;

/**
 * The plans to author.
 *
 * `price` is whole pesos - 299 means ₱299, and there are no centavos. It is a
 * placeholder for your own reporting: the app shows the localized price Play
 * returns, which is the amount actually charged. Editing it here changes your
 * figures and nothing a member pays.
 *
 * `durationDays` must agree with the base plan's billing period in Play. It is
 * what drives the "per month" copy and the saving shown against the monthly
 * plan, and it is the fallback end date when Play does not hand one back.
 */
const PLANS_TO_SEED = [
  {
    name: "Premium Monthly",
    code: "PREMIUMMONTHLY",
    googleProductId: "premium_monthly",
    googleBasePlanId: "monthly",
    description:
      "Full access to every exam category, question set, and review material.",
    price: 299,
    currency: "PHP",
    durationDays: 30,
    isRecurring: true,
    features: [
      "Every exam category and question set",
      "Full explanations on every item",
      "All review materials",
      "Progress tracking and performance history",
    ],
    order: 1,
    isPopular: false,
    isActive: true,
  },
  {
    name: "Premium 6 Months",
    code: "PREMIUM6M",
    googleProductId: "premium_6months",
    googleBasePlanId: "six-month",
    description:
      "Six months of full access - the usual length of a board exam review.",
    price: 1299,
    currency: "PHP",
    durationDays: 180,
    isRecurring: true,
    features: [
      "Everything in Premium Monthly",
      "Six months of access in one purchase",
      "Best fit for a full review cycle",
    ],
    order: 2,
    isPopular: true,
    isActive: true,
  },
  {
    name: "Premium Yearly",
    code: "PREMIUMYEARLY",
    googleProductId: "premium_yearly",
    googleBasePlanId: "yearly",
    description: "A full year of access, for retakers and continuing review.",
    price: 2299,
    currency: "PHP",
    durationDays: 365,
    isRecurring: true,
    features: [
      "Everything in Premium Monthly",
      "A full year of access",
      "Lowest cost per month",
    ],
    order: 3,
    isPopular: false,
    isActive: true,
  },
] as const;

function hasFlag(name: string) {
  return process.argv.slice(2).includes(`--${name}`);
}

type Row = Record<string, unknown> & { $id: string };

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
      ? "Seeding subscription plans: applying."
      : "Seeding subscription plans: DRY RUN. Nothing will be written. Add --confirm to apply.",
  );
  console.log(`database ${appwriteEnv.databaseId}\n`);

  // Precondition: bootstrap has to have run, or the table and its unique index
  // on googleProductId do not exist yet. Saying so beats a 404 halfway through.
  try {
    await tables.getTable({
      databaseId: appwriteEnv.databaseId,
      tableId: PLANS,
    });
  } catch {
    console.error(
      `Table ${PLANS} does not exist. Run pnpm appwrite:bootstrap --confirm first.`,
    );
    process.exitCode = 1;
    return;
  }

  const existing = (
    await tables.listRows({
      databaseId: appwriteEnv.databaseId,
      tableId: PLANS,
      queries: [Query.limit(100)],
    })
  ).rows as Row[];

  const taken = new Set(
    existing.map((row) => String(row.googleProductId ?? "").trim()),
  );

  console.log(`${existing.length} plan(s) already present.\n`);

  let created = 0;
  let skipped = 0;

  for (const plan of PLANS_TO_SEED) {
    if (taken.has(plan.googleProductId)) {
      console.log(`  = ${plan.googleProductId}: already authored, left alone`);
      skipped += 1;
      continue;
    }

    console.log(
      `  ${confirmed ? "+" : "would add"} ${plan.googleProductId} -> "${plan.name}" ` +
        `(${plan.currency} ${plan.price}, ${plan.durationDays} days)`,
    );

    if (!confirmed) {
      created += 1;
      continue;
    }

    try {
      await tables.createRow({
        databaseId: appwriteEnv.databaseId,
        tableId: PLANS,
        rowId: ID.unique(),
        // `app_readonly`: the table itself grants every signed-in member read,
        // so the row carries no permissions of its own.
        data: {
          ...plan,
          features: [...plan.features],
          subscriberCount: 0,
        },
      });
      created += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // The unique index doing its job. Another run got there first.
      if (message.includes("already exists") || message.includes("unique")) {
        skipped += 1;
        continue;
      }

      console.error(`  ! ${plan.googleProductId}: ${message}`);
      process.exitCode = 1;
    }
  }

  console.log("");
  console.log(
    confirmed
      ? `Done. ${created} plan(s) created, ${skipped} already present.`
      : `Dry run. ${created} would be created, ${skipped} already present.`,
  );

  if (!confirmed && created > 0) {
    console.log("Re-run with --confirm to apply.");
    return;
  }

  if (confirmed) {
    console.log("");
    console.log(
      "Next: confirm every googleProductId above exists in Play Console as an",
    );
    console.log(
      "ACTIVE subscription with an ACTIVE base plan. A plan pointing at a draft",
    );
    console.log("product is invisible to the app.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
