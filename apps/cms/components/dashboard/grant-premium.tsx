"use client";

import { useActionState, useState } from "react";

import {
  emptyMembershipFormState,
  type MembershipFormState,
} from "@/lib/actions/form-state";
import {
  grantPremiumAction,
  revokePremiumAction,
  searchMembersAction,
} from "@/lib/actions/membership";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type PlanOption = { id: string; name: string; durationDays: number };

type GrantPremiumProps = {
  plans: PlanOption[];
};

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function Banner({ state }: { state: MembershipFormState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  const isError = state.status === "error";

  return (
    <p
      role="status"
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        isError
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      )}
    >
      {state.message}
    </p>
  );
}

/**
 * Highlights the part of a name or email that was searched for.
 *
 * With a dozen similar addresses on screen, "which of these did I actually
 * match on" is the question, and making the answer visible is cheaper than
 * making the reader compare strings.
 */
function Highlight({ text, term }: { text: string; term: string }) {
  const needle = term.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;

  if (at < 0) {
    return <>{text}</>;
  }

  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-500/30">
        {text.slice(at, at + needle.length)}
      </mark>
      {text.slice(at + needle.length)}
    </>
  );
}

function MembershipBadge({
  isPremium,
  hasPaid,
}: {
  isPremium: boolean;
  hasPaid: boolean;
}) {
  if (!isPremium) {
    return (
      <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
        Free
      </span>
    );
  }

  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs font-medium",
        hasPaid
          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      )}
    >
      {hasPaid ? "Premium · paid" : "Premium · granted"}
    </span>
  );
}

export function GrantPremium({ plans }: GrantPremiumProps) {
  const [searchState, search, searching] = useActionState(
    searchMembersAction,
    emptyMembershipFormState,
  );
  const [grantState, grant, granting] = useActionState(
    grantPremiumAction,
    emptyMembershipFormState,
  );
  const [revokeState, revoke, revoking] = useActionState(
    revokePremiumAction,
    emptyMembershipFormState,
  );

  // Whichever action ran most recently owns the message and the list. Without
  // this the results vanish the moment somebody grants, and they lose the row
  // they were working on.
  const latest =
    grantState.status !== "idle"
      ? grantState
      : revokeState.status !== "idle"
        ? revokeState
        : searchState;

  const results = latest.results ?? searchState.results ?? [];
  const term = latest.term ?? searchState.term ?? "";

  const [selectedId, setSelectedId] = useState("");
  const selected = results.find((member) => member.userId === selectedId);
  const busy = searching || granting || revoking;

  return (
    <div className="flex flex-col gap-6">
      <form action={search} className="flex flex-col gap-2">
        <Label htmlFor="term">Find a member</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="term"
            name="term"
            type="search"
            defaultValue={term}
            placeholder="Name or email — e.g. maria, or maria@example.com"
            autoComplete="off"
            className="max-w-md"
          />
          <Button type="submit" disabled={busy}>
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Matches on name or email, and finds accounts that never finished
          signing up. Two characters minimum.
        </p>
      </form>

      <Banner state={latest} />

      {searchState.status === "success" && results.length === 0 && (
        <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Nobody matched <span className="font-medium">{term}</span>. Partial
          names and email fragments both work, so this usually means the account
          does not exist yet — check the spelling, or ask them to sign up first.
        </p>
      )}

      {results.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
          {/* Pick a member ------------------------------------------------ */}
          <div className="overflow-hidden rounded-md border">
            <p className="border-b bg-muted/40 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {results.length} result{results.length === 1 ? "" : "s"} — click
              one to manage
            </p>
            <ul className="divide-y">
              {results.map((member) => {
                const isSelected = member.userId === selectedId;

                return (
                  <li key={member.userId}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() =>
                        setSelectedId(isSelected ? "" : member.userId)
                      }
                      className={cn(
                        "flex w-full flex-col gap-1 px-3 py-3 text-left transition-colors",
                        "hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                        isSelected && "bg-primary/10 hover:bg-primary/10",
                      )}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          <Highlight text={member.name} term={term} />
                        </span>
                        <MembershipBadge
                          isPremium={member.isPremium}
                          hasPaid={member.hasPaidSubscription}
                        />
                      </span>
                      <span className="text-sm text-muted-foreground">
                        <Highlight text={member.email} term={term} />
                      </span>
                      {member.isPremium && (
                        <span className="text-xs text-muted-foreground">
                          {member.planName || "Granted access"}
                          {member.premiumUntil
                            ? ` · until ${formatDate(member.premiumUntil)}`
                            : " · no end date"}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Act on them -------------------------------------------------- */}
          <div className="lg:sticky lg:top-6">
            {!selected ? (
              <p className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                Pick a member on the left.
              </p>
            ) : (
              <div className="flex flex-col gap-4 rounded-md border p-4">
                <div className="flex flex-col gap-1 border-b pb-3">
                  <p className="font-medium">{selected.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {selected.email}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {selected.userId}
                  </p>
                </div>

                {selected.hasPaidSubscription && (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                    This member has a Google Play purchase. You can add granted
                    time on top, but a paid subscription cannot be ended here —
                    they are still being charged for it. Refund it in Play
                    Console instead.
                  </p>
                )}

                <form action={grant} className="flex flex-col gap-3">
                  <input type="hidden" name="userId" value={selected.userId} />
                  <input type="hidden" name="term" value={term} />

                  <div className="flex flex-col gap-1">
                    <Label htmlFor="planId">Plan</Label>
                    <select
                      id="planId"
                      name="planId"
                      defaultValue=""
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">No plan — set the length below</option>
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name} ({plan.durationDays} days)
                        </option>
                      ))}
                    </select>
                    {plans.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No plans authored yet. Grants still work — set a length.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1">
                    <Label htmlFor="days">Days of access</Label>
                    <Input
                      id="days"
                      name="days"
                      type="number"
                      min={0}
                      max={3650}
                      defaultValue={30}
                      className="max-w-40"
                    />
                    <p className="text-xs text-muted-foreground">
                      Used when no plan is chosen. 0 means no end date. Time is
                      added to what they already have.
                    </p>
                  </div>

                  <div className="flex flex-col gap-1">
                    <Label htmlFor="reason">Reason (required)</Label>
                    <Input
                      id="reason"
                      name="reason"
                      required
                      placeholder="Scholarship, paid by bank transfer, support case…"
                    />
                  </div>

                  <Button type="submit" disabled={busy}>
                    {granting ? "Granting…" : "Grant premium"}
                  </Button>
                </form>

                {selected.isPremium && !selected.hasPaidSubscription && (
                  <form
                    action={revoke}
                    className="flex flex-col gap-2 border-t pt-4"
                  >
                    <input
                      type="hidden"
                      name="userId"
                      value={selected.userId}
                    />
                    <input type="hidden" name="term" value={term} />
                    <Label htmlFor="revokeReason">
                      Take granted access back
                    </Label>
                    <Input
                      id="revokeReason"
                      name="reason"
                      required
                      placeholder="Why this is being ended"
                    />
                    <Button
                      type="submit"
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      className="self-start"
                    >
                      {revoking ? "Ending…" : "End access"}
                    </Button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
