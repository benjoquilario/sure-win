/**
 * A verification endpoint that talks to nothing and grants nothing.
 *
 * Asked for in `billing-api-reply.md` §5.3: *"even a route that verifies auth
 * and returns a canned 200 would let us build steps 5-6 against something real
 * instead of a mock."*
 *
 * This is that, plus the rest of it. A canned `200` would let the app build the
 * happy path, which is the half that was never going to be the problem — the
 * point of the status-code table is that `400` and `502` are opposite
 * instructions, and code that has only ever seen a `200` has never exercised
 * either. So the shape is a switchboard: name a case, get exactly the response
 * the real endpoint would send.
 *
 * **It cannot grant access.** There is no database call in this file. It does
 * not import the handlers, it does not touch Google, and the only real thing it
 * does is check the JWT - because auth is the part worth rehearsing against
 * something that can actually reject you.
 *
 * Off unless `BILLING_SANDBOX_ENABLED=true`. Every response carries
 * `"sandbox": true`, so a mock can never be mistaken for a membership.
 */

import { Account } from "node-appwrite";
import { NextRequest, NextResponse } from "next/server";

import { obfuscatedAccountIdFor } from "@/lib/appwrite/billing";
import { PLAY_WORST_CASE_MS } from "@/lib/appwrite/google-play";
import { createPublicServerClient } from "@/lib/appwrite/server";

export const dynamic = "force-dynamic";

/** The cases the real endpoint can produce, and what each is for. */
const CASES = {
  success: {
    status: 200,
    describe: "A first purchase. Grant access and re-read user_profiles.",
  },
  already_owned: {
    status: 200,
    describe:
      "The same token applied twice. created:false is NOT an error - treat it exactly like success.",
  },
  invalid_token: {
    status: 400,
    describe: "Play does not recognise the token. Do not retry.",
  },
  wrong_product: {
    status: 400,
    describe: "The token is for a different product. Do not retry.",
  },
  unauthenticated: {
    status: 401,
    describe: "JWT missing or expired. Mint a fresh one and retry once.",
  },
  wrong_account: {
    status: 403,
    describe:
      "The purchase belongs to another account. Do not retry. This is what the obfuscated account id prevents.",
  },
  not_active: {
    status: 409,
    describe:
      "Expired, on hold or paused. Do not retry; send them to the paywall.",
  },
  google_unreachable: {
    status: 502,
    describe:
      "THE IMPORTANT ONE. They have paid and we have no record. Keep the token and retry on next launch.",
  },
  not_configured: {
    status: 503,
    describe: "Server not set up yet. Same handling as 502.",
  },
} as const;

type CaseName = keyof typeof CASES;

function bodyFor(name: CaseName) {
  switch (name) {
    case "success":
      return {
        ok: true,
        sandbox: true,
        subscription: {
          id: "sandbox-subscription-0000000000",
          created: true,
          expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        },
      };
    case "already_owned":
      return {
        ok: true,
        sandbox: true,
        subscription: {
          id: "sandbox-subscription-0000000000",
          created: false,
          expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        },
      };
    case "invalid_token":
      return {
        ok: false,
        sandbox: true,
        message: "Play does not recognise that purchase.",
      };
    case "wrong_product":
      return {
        ok: false,
        sandbox: true,
        message: "That purchase is for a different product.",
      };
    case "unauthenticated":
      return { ok: false, sandbox: true, message: "That session is not valid." };
    case "wrong_account":
      return {
        ok: false,
        sandbox: true,
        message: "That purchase does not belong to this account.",
      };
    case "not_active":
      return {
        ok: false,
        sandbox: true,
        message: "That subscription is on hold.",
        subscriptionStatus: "on_hold",
      };
    case "google_unreachable":
      return {
        ok: false,
        sandbox: true,
        message: `Google did not answer within ${PLAY_WORST_CASE_MS / 2000}s.`,
      };
    case "not_configured":
      return {
        ok: false,
        sandbox: true,
        message: "Play verification is not configured on the server.",
      };
  }
}

function isEnabled() {
  return process.env.BILLING_SANDBOX_ENABLED?.trim() === "true";
}

function disabled() {
  return NextResponse.json(
    {
      ok: false,
      message:
        "The billing sandbox is off. Set BILLING_SANDBOX_ENABLED=true to use it.",
    },
    { status: 404 },
  );
}

/** Lists the cases, so the app team does not have to read this file. */
export async function GET() {
  if (!isEnabled()) {
    return disabled();
  }

  return NextResponse.json({
    ok: true,
    sandbox: true,
    usage:
      'POST here with { "simulate": "<case>", ... } and the same Authorization header as the real endpoint.',
    note: "This endpoint writes nothing and grants nothing. Every response carries sandbox:true.",
    playWorstCaseMs: PLAY_WORST_CASE_MS,
    cases: Object.fromEntries(
      Object.entries(CASES).map(([name, meta]) => [
        name,
        { status: meta.status, describe: meta.describe },
      ]),
    ),
  });
}

export async function POST(request: NextRequest) {
  if (!isEnabled()) {
    return disabled();
  }

  let body: { simulate?: unknown; delayMs?: unknown } = {};

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, sandbox: true, message: "Body must be JSON." },
      { status: 400 },
    );
  }

  const name = String(body.simulate ?? "success") as CaseName;

  if (!(name in CASES)) {
    return NextResponse.json(
      {
        ok: false,
        sandbox: true,
        message: `Unknown case "${name}".`,
        cases: Object.keys(CASES),
      },
      { status: 400 },
    );
  }

  // Auth is checked for real, and before the simulated case is applied - so an
  // app that forgets the header finds out here rather than in production. The
  // one exception is `unauthenticated`, which is the case you ask for when you
  // want to rehearse the 401 path with a perfectly good token.
  if (name !== "unauthenticated") {
    const header = request.headers.get("authorization") ?? "";
    const jwt = header.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : "";

    if (!jwt) {
      return NextResponse.json(
        {
          ok: false,
          sandbox: true,
          message: "Missing Authorization: Bearer <appwrite jwt>.",
        },
        { status: 401 },
      );
    }

    try {
      const account = new Account(createPublicServerClient().setJWT(jwt));
      const user = await account.get();

      // Handed back so the app can check its own derivation against ours
      // without waiting for a real purchase to disagree with it.
      const expected = obfuscatedAccountIdFor(user.$id);
      const sent = String(
        (body as { obfuscatedAccountId?: unknown }).obfuscatedAccountId ?? "",
      ).trim();

      const payload = bodyFor(name) as Record<string, unknown>;

      payload.you = {
        userId: user.$id,
        expectedObfuscatedAccountId: expected,
        ...(sent
          ? { sentObfuscatedAccountId: sent, matches: sent === expected }
          : { note: "Send obfuscatedAccountId to have it checked against ours." }),
      };

      await maybeDelay(body.delayMs);

      return NextResponse.json(payload, { status: CASES[name].status });
    } catch {
      return NextResponse.json(
        { ok: false, sandbox: true, message: "That session is not valid." },
        { status: 401 },
      );
    }
  }

  await maybeDelay(body.delayMs);

  return NextResponse.json(bodyFor(name), { status: CASES[name].status });
}

/**
 * Optional stall, for rehearsing a slow network.
 *
 * Capped below the platform's own request limit, because a sandbox that hangs
 * a serverless function is a sandbox that costs money to play with.
 */
async function maybeDelay(value: unknown) {
  const ms = Number(value);

  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 20_000)));
}
