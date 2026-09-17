/**
 * Function 1 — purchase verification, as an HTTP endpoint.
 *
 * The contract in `google-play-billing-v3.md`:
 *
 *   in    { purchaseToken, productId, orderId }
 *   out   { ok: true, subscription } | { ok: false, message }
 *   user  from the JWT, never from the body
 *
 * The mobile app can reach this directly, or an Appwrite Function in the mobile
 * repo can call `verifyAndApplyPurchase()` with the same three fields — the
 * logic is deliberately in `lib/appwrite/billing.ts` rather than here, so the
 * choice of transport is not a rewrite.
 *
 * **Authorization is an Appwrite JWT**, from `account.createJWT()` in the app,
 * sent as `Authorization: Bearer <jwt>`. The account it resolves to is the
 * account that gets the membership. Nothing in the body can change that.
 */

import { Account } from "node-appwrite";
import { NextRequest, NextResponse } from "next/server";

import { verifyAndApplyPurchase } from "@/lib/appwrite/billing";
import { hasGooglePlayCredentials } from "@/lib/appwrite/google-play";
import { createPublicServerClient } from "@/lib/appwrite/server";

/** Verification talks to Google, so it can never be prerendered or cached. */
export const dynamic = "force-dynamic";

function bearer(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
}

export async function POST(request: NextRequest) {
  if (!hasGooglePlayCredentials()) {
    // Said plainly, because the alternative is a 502 that looks like Google is
    // down when in fact nobody has set the environment variable yet.
    return NextResponse.json(
      {
        ok: false,
        message:
          "Play verification is not configured on the server. GOOGLE_PLAY_SERVICE_ACCOUNT_JSON and GOOGLE_PLAY_PACKAGE_NAME are both required.",
      },
      { status: 503 },
    );
  }

  const jwt = bearer(request);

  if (!jwt) {
    return NextResponse.json(
      { ok: false, message: "Missing Authorization: Bearer <appwrite jwt>." },
      { status: 401 },
    );
  }

  let userId = "";

  try {
    const account = new Account(createPublicServerClient().setJWT(jwt));
    const user = await account.get();
    userId = user.$id;
  } catch {
    return NextResponse.json(
      { ok: false, message: "That session is not valid." },
      { status: 401 },
    );
  }

  let body: {
    purchaseToken?: unknown;
    productId?: unknown;
    orderId?: unknown;
    obfuscatedAccountId?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Body must be JSON." },
      { status: 400 },
    );
  }

  const result = await verifyAndApplyPurchase({
    userId,
    purchaseToken: String(body.purchaseToken ?? "").trim(),
    productId: String(body.productId ?? "").trim(),
    orderId: String(body.orderId ?? "").trim() || undefined,
    expectedObfuscatedAccountId:
      String(body.obfuscatedAccountId ?? "").trim() || undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: result.message,
        // Present on 409 only, so the app can name the state without a second
        // call. Omitted rather than null elsewhere.
        ...(result.subscriptionStatus
          ? { subscriptionStatus: result.subscriptionStatus }
          : {}),
      },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    subscription: {
      id: result.subscriptionId,
      created: result.created,
      expiresAt: result.expiresAt,
    },
  });
}
