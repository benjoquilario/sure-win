"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/appwrite/auth";
import {
  GrantError,
  grantPremium,
  revokePremium,
  searchMembers,
} from "@/lib/appwrite/membership-grants";
import { recordStaffActivity } from "@/lib/appwrite/staff";
// The state shape and its empty value live outside this file: a "use server"
// module may export nothing but async functions, and a constant here fails the
// build the moment a client component imports it.
import type { MembershipFormState } from "@/lib/actions/form-state";

function toMessage(error: unknown) {
  if (error instanceof GrantError) {
    return error.message;
  }

  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * Every action here re-checks `billing.grant` on the server.
 *
 * The page already refuses anyone without it, and that is not the check that
 * matters: a server action is a public endpoint, reachable by anyone who can
 * form a request, whether or not they ever loaded the page that calls it.
 */
async function requireGranter() {
  return requirePermission("billing.grant");
}

export async function searchMembersAction(
  _previous: MembershipFormState,
  formData: FormData,
): Promise<MembershipFormState> {
  await requireGranter();

  const term = String(formData.get("term") ?? "").trim();

  if (term.length < 2) {
    return {
      status: "error",
      message: "Type at least two characters of a name or email.",
      term,
    };
  }

  try {
    const results = await searchMembers(term);

    return {
      status: "success",
      message: results.length
        ? `${results.length} member${results.length === 1 ? "" : "s"} found.`
        : "Nobody matched that.",
      results,
      term,
    };
  } catch (error) {
    return { status: "error", message: toMessage(error), term };
  }
}

export async function grantPremiumAction(
  _previous: MembershipFormState,
  formData: FormData,
): Promise<MembershipFormState> {
  const actor = await requireGranter();

  const userId = String(formData.get("userId") ?? "").trim();
  const planId = String(formData.get("planId") ?? "").trim();
  const days = Number(formData.get("days") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();
  const term = String(formData.get("term") ?? "").trim();

  try {
    const result = await grantPremium({
      userId,
      planId: planId || undefined,
      days,
      reason,
      actorEmail: actor.account.email ?? actor.account.$id,
    });

    // The audit trail is the point of restricting this to the owner. Without a
    // record, "who gave this account free access" has no answer.
    await recordStaffActivity({
      actor,
      action: "premium_granted",
      summary: `Granted premium to ${userId}${
        result.endsAt ? ` until ${result.endsAt.slice(0, 10)}` : " (lifetime)"
      } — ${reason}`,
      targetTable: "subscriptions",
      targetId: result.subscriptionId,
    });

    revalidatePath("/dashboard/premium");
    revalidatePath("/dashboard/subscriptions");

    return {
      status: "success",
      message: result.extended
        ? `Extended. Access now runs to ${result.endsAt.slice(0, 10)}.`
        : result.endsAt
          ? `Granted until ${result.endsAt.slice(0, 10)}.`
          : "Granted, with no end date.",
      results: term ? await searchMembers(term) : undefined,
      term,
    };
  } catch (error) {
    return {
      status: "error",
      message: toMessage(error),
      results: term ? await searchMembers(term).catch(() => []) : undefined,
      term,
    };
  }
}

export async function revokePremiumAction(
  _previous: MembershipFormState,
  formData: FormData,
): Promise<MembershipFormState> {
  const actor = await requireGranter();

  const userId = String(formData.get("userId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const term = String(formData.get("term") ?? "").trim();

  try {
    const result = await revokePremium({
      userId,
      reason,
      actorEmail: actor.account.email ?? actor.account.$id,
    });

    await recordStaffActivity({
      actor,
      action: "premium_revoked",
      summary: `Revoked granted access for ${userId} (${result.revoked} subscription${
        result.revoked === 1 ? "" : "s"
      }) — ${reason}`,
      targetTable: "subscriptions",
      targetId: userId,
    });

    revalidatePath("/dashboard/premium");
    revalidatePath("/dashboard/subscriptions");

    return {
      status: "success",
      message: `Access ended. ${result.revoked} granted subscription${
        result.revoked === 1 ? "" : "s"
      } closed.`,
      results: term ? await searchMembers(term) : undefined,
      term,
    };
  } catch (error) {
    return {
      status: "error",
      message: toMessage(error),
      results: term ? await searchMembers(term).catch(() => []) : undefined,
      term,
    };
  }
}
