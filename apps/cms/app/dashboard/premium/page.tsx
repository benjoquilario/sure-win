import type { Metadata } from "next";

import { GrantPremium } from "@/components/dashboard/grant-premium";
import { requirePermission } from "@/lib/appwrite/auth";
import { listPlans } from "@/lib/appwrite/subscriptions";

export const metadata: Metadata = {
  title: "Grant premium",
};

/**
 * Giving a member paid access without a payment.
 *
 * Owner-only, through `billing.grant` — the one permission an admin does not
 * inherit. It is the only screen in the dashboard that costs revenue directly,
 * and the only one where the person using it is also the person who benefits
 * from using it, which is the argument for keeping it with whoever owns the
 * business rather than whoever runs the platform.
 *
 * `requirePermission` redirects anyone else before this renders. The server
 * actions behind the form check the same permission again, because a server
 * action is reachable without ever loading this page.
 */
export default async function GrantPremiumPage() {
  await requirePermission("billing.grant");

  const plans = await listPlans();

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Grant premium access
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Gives a member paid access without a payment — a scholarship, a
          partner school, or somebody who paid by another route. It writes a
          real subscription, so the access expires on schedule and shows up in
          reporting exactly like a purchase does.
        </p>
      </header>

      <div className="max-w-3xl rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
        <p className="font-medium">Every grant is recorded against your name.</p>
        <p className="mt-1">
          Who granted it, to whom, for how long and why, in the staff activity
          log. The reason field is required for that reason — a free membership
          nobody can explain later is the thing this screen is most likely to
          produce.
        </p>
      </div>

      <GrantPremium
        plans={plans
          .filter((plan) => plan.isActive)
          .map((plan) => ({
            id: plan.id,
            name: plan.name,
            durationDays: plan.durationDays,
          }))}
      />
    </div>
  );
}
