/**
 * Function 2 — the Real-Time Developer Notification webhook.
 *
 * Where Google's Pub/Sub push subscription POSTs when a subscription renews,
 * lapses, is cancelled, or is refunded. Must be publicly reachable, which is
 * why it lives here rather than behind the dashboard's session cookie.
 *
 * **This endpoint answers 200 to almost everything, on purpose.** Pub/Sub is
 * at-least-once and retries any non-2xx for seven days, so a message that
 * cannot be applied must be *recorded and acknowledged*, not endlessly
 * redelivered. `billing_notifications` is where the failures go, and
 * `pnpm appwrite:billing:check` is what surfaces them. A 500 here is reserved
 * for the case where the server could not even write that down, which is the
 * one time a retry genuinely helps.
 *
 * Authentication: a shared secret, because Pub/Sub push cannot send an
 * Appwrite session. Set `GOOGLE_PLAY_PUBSUB_TOKEN` and put it in the push
 * subscription URL as `?token=...`. Every message is also checked against
 * `GOOGLE_PLAY_PACKAGE_NAME` before it is applied.
 */

import { NextRequest, NextResponse } from "next/server";

import { handlePlayNotification } from "@/lib/appwrite/billing";

export const dynamic = "force-dynamic";

/**
 * Compares two secrets without leaking their difference through timing.
 *
 * Length is compared first and separately, which does leak that much; the
 * secret is a random token where length is not the interesting part.
 */
function secretMatches(provided: string, expected: string) {
  if (provided.length !== expected.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < provided.length; index += 1) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }

  return difference === 0;
}

export async function POST(request: NextRequest) {
  const expected = process.env.GOOGLE_PLAY_PUBSUB_TOKEN?.trim();

  if (!expected) {
    // Refuse rather than run open. An unauthenticated endpoint that can change
    // memberships is worse than one that is not working yet.
    console.error(
      "[billing] GOOGLE_PLAY_PUBSUB_TOKEN is not set; refusing notifications.",
    );
    return NextResponse.json(
      { ok: false, message: "Notifications are not configured." },
      { status: 503 },
    );
  }

  const provided =
    request.nextUrl.searchParams.get("token") ??
    request.headers.get("x-pubsub-token") ??
    "";

  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let envelope: unknown;

  try {
    envelope = await request.json();
  } catch {
    // Malformed and unfixable by retrying, so take it off the queue.
    return NextResponse.json({ ok: true, handled: false }, { status: 200 });
  }

  try {
    const result = await handlePlayNotification(
      envelope as Parameters<typeof handlePlayNotification>[0],
    );

    if (!result.ok) {
      // Recorded as failed and waiting for a person. Acknowledged so Pub/Sub
      // stops, because redelivering it will fail in exactly the same way.
      console.error("[billing] notification not applied:", result.reason);
    }

    return NextResponse.json(
      { ok: true, handled: result.handled, reason: result.reason },
      { status: 200 },
    );
  } catch (error) {
    // The claim itself failed, so there is no record of this message at all.
    // This is the one case where a redelivery is worth having.
    console.error("[billing] notification handler threw:", error);
    return NextResponse.json(
      { ok: false, message: "Could not record the notification." },
      { status: 500 },
    );
  }
}

/**
 * Answers the reachability check without doing anything.
 *
 * Pub/Sub does not use it, but "is the URL live and is the secret right" is the
 * first question when a push subscription is not delivering, and answering it
 * with a browser beats reading a delivery-attempt graph.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.GOOGLE_PLAY_PUBSUB_TOKEN?.trim();
  const provided = request.nextUrl.searchParams.get("token") ?? "";

  if (!expected || !secretMatches(provided, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return NextResponse.json({ ok: true, endpoint: "play-rtdn", ready: true });
}
