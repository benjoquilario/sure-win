/**
 * The Google Play Developer API, and nothing else.
 *
 * This is the half of billing that was never written. `applyGooglePurchase()`
 * and `applyGoogleNotification()` have always known what to do with a verified
 * purchase; neither of them could ever verify one, because nothing here talked
 * to Google.
 *
 * Two calls matter:
 *
 *   `purchases.subscriptionsv2.get`   is this token real, and what did it buy?
 *   `purchases.subscriptions.acknowledge`   tell Google we honoured it
 *
 * The second is a **three-day deadline**. Google automatically refunds any
 * purchase not acknowledged within it.
 *
 * No SDK. `googleapis` is 20MB of generated client to make two HTTP calls, and
 * the OAuth2 service-account flow is a signed JWT exchanged for a bearer token
 * - about forty lines with `node:crypto`. Fewer moving parts on the path where
 * money changes hands is worth more than the convenience.
 */

import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_ROOT = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

/** Refresh a little before Google expires the token, so a slow call cannot straddle it. */
const TOKEN_EXPIRY_MARGIN_SECONDS = 60;

/**
 * How long any one call to Google may take.
 *
 * Bounded on purpose, and published so the app can set its own client timeout
 * above it. Without a ceiling here, a hung connection to Google holds the
 * request open until the platform kills it - and the app cannot tell that apart
 * from a failure, so it either abandons a purchase somebody paid for or hangs a
 * checkout screen.
 *
 * Ten seconds is generous for these calls; the point is that a wait has an end.
 * A verification request makes at most two of them - a token exchange and the
 * purchase lookup - so `PLAY_REQUEST_TIMEOUT_MS * 2` is the worst case the
 * caller should plan for.
 */
export const PLAY_REQUEST_TIMEOUT_MS = 10_000;

/** The longest a verification call can spend talking to Google. */
export const PLAY_WORST_CASE_MS = PLAY_REQUEST_TIMEOUT_MS * 2;

/**
 * `fetch` that gives up.
 *
 * A timeout is reported as a `GooglePlayError` rather than an `AbortError`, so
 * callers map it to "could not reach Google, retry" like any other transport
 * failure instead of having to recognise a DOM exception name.
 */
async function fetchWithTimeout(url: string, init: RequestInit) {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(PLAY_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");

    throw new GooglePlayError(
      timedOut
        ? `Google did not answer within ${PLAY_REQUEST_TIMEOUT_MS / 1000}s.`
        : "Could not reach Google.",
    );
  }
}

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

export type PlaySubscriptionState =
  | "SUBSCRIPTION_STATE_ACTIVE"
  | "SUBSCRIPTION_STATE_CANCELED"
  | "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
  | "SUBSCRIPTION_STATE_ON_HOLD"
  | "SUBSCRIPTION_STATE_PAUSED"
  | "SUBSCRIPTION_STATE_EXPIRED"
  | "SUBSCRIPTION_STATE_PENDING"
  | "SUBSCRIPTION_STATE_UNSPECIFIED";

/**
 * What a verified purchase actually tells us, flattened.
 *
 * `subscriptionsv2.get` returns the interesting parts three levels down inside
 * `lineItems[0]`, and every caller wants the same handful of fields. Flattening
 * once here means the handlers never have to know the shape of Google's reply.
 */
export type VerifiedPurchase = {
  productId: string;
  basePlanId: string;
  offerId: string;
  /** ISO 8601. During a grace period this is already extended past the failure. */
  expiresAt: string;
  startsAt: string;
  state: PlaySubscriptionState;
  autoRenewing: boolean;
  isAcknowledged: boolean;
  orderId: string;
  /** Set when this purchase replaces another - an upgrade or a resubscribe. */
  linkedPurchaseToken: string;
  /** What the app attached at checkout, to be checked against the caller. */
  obfuscatedAccountId: string;
  regionCode: string;
  /** True for a licence tester. Real money never moved. */
  isTestPurchase: boolean;
};

export class GooglePlayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GooglePlayError";
  }
}

function readServiceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ?? "";

  if (!raw.trim()) {
    throw new GooglePlayError(
      "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not set. Purchases cannot be verified without it.",
    );
  }

  let parsed: unknown;

  try {
    // Accept base64 as well as raw JSON: some hosts mangle newlines in a
    // multi-line environment variable, and a private key is all newlines.
    const text = raw.trim().startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf8");
    parsed = JSON.parse(text);
  } catch {
    throw new GooglePlayError(
      "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON (or base64-encoded JSON).",
    );
  }

  const account = parsed as ServiceAccount;

  if (!account?.client_email || !account?.private_key) {
    throw new GooglePlayError(
      "The service account JSON has no client_email or private_key.",
    );
  }

  return {
    ...account,
    // A key pasted through a .env file usually arrives with literal \n.
    private_key: account.private_key.replace(/\\n/g, "\n"),
  };
}

export function getPlayPackageName() {
  const name = process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim();

  if (!name) {
    throw new GooglePlayError("GOOGLE_PLAY_PACKAGE_NAME is not set.");
  }

  return name;
}

/** Whether Play verification is configured at all, without throwing. */
export function hasGooglePlayCredentials() {
  return Boolean(
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim() &&
      process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim(),
  );
}

function base64Url(input: Buffer | string) {
  return (typeof input === "string" ? Buffer.from(input) : input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * A bearer token for the Play Developer API.
 *
 * Cached in module scope for its lifetime, which is an hour. Minting one costs
 * a round trip to Google, and doing that per notification would put an outage
 * we do not control in front of every renewal.
 */
export async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.value;
  }

  const account = readServiceAccount();
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  signer.end();

  let signature: string;

  try {
    signature = base64Url(signer.sign(account.private_key));
  } catch {
    // Almost always a key whose newlines did not survive the environment.
    throw new GooglePlayError(
      "Could not sign with the service account private key. Check that its newlines survived being stored.",
    );
  }

  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };

  if (!response.ok || !body.access_token) {
    throw new GooglePlayError(
      `Could not get a Play API access token: ${
        body.error_description ?? body.error ?? response.statusText
      }`,
      response.status,
    );
  }

  cachedToken = {
    value: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600) - TOKEN_EXPIRY_MARGIN_SECONDS,
  };

  return cachedToken.value;
}

async function callPlay(path: string, init?: RequestInit) {
  const token = await getAccessToken();
  const response = await fetchWithTimeout(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });

  if (response.status === 401 || response.status === 403) {
    // Nearly always the permission grant, which takes up to 24 hours to apply.
    throw new GooglePlayError(
      `Play refused the request (${response.status}). Check the service account has "View financial data" and "Manage orders and subscriptions" in Play Console - a fresh grant can take 24 hours.`,
      response.status,
    );
  }

  return response;
}

type RawSubscriptionV2 = {
  regionCode?: string;
  startTime?: string;
  subscriptionState?: PlaySubscriptionState;
  latestOrderId?: string;
  linkedPurchaseToken?: string;
  acknowledgementState?: string;
  testPurchase?: unknown;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: {
    productId?: string;
    expiryTime?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
    offerDetails?: { basePlanId?: string; offerId?: string };
  }[];
};

/**
 * Verifies one purchase token against Google, and flattens the answer.
 *
 * This is the step that cannot be skipped. A purchase token posted by a client
 * is a claim, not a fact - anyone can post one - and until this call returns,
 * nothing about it is known to be true.
 */
export async function getSubscriptionPurchase(
  purchaseToken: string,
): Promise<VerifiedPurchase> {
  if (!purchaseToken) {
    throw new GooglePlayError("No purchase token.");
  }

  const packageName = getPlayPackageName();
  const response = await callPlay(
    `/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
  );

  if (response.status === 404 || response.status === 410) {
    throw new GooglePlayError("Play does not recognise that purchase.", 404);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GooglePlayError(
      `Play returned ${response.status} for that purchase. ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  const raw = (await response.json()) as RawSubscriptionV2;

  // A subscription has one line item in every case this app can produce; the
  // array exists for multi-product subscriptions, which are not sold here.
  const line = raw.lineItems?.[0] ?? {};

  return {
    productId: line.productId ?? "",
    basePlanId: line.offerDetails?.basePlanId ?? "",
    offerId: line.offerDetails?.offerId ?? "",
    expiresAt: line.expiryTime ?? "",
    startsAt: raw.startTime ?? "",
    state: raw.subscriptionState ?? "SUBSCRIPTION_STATE_UNSPECIFIED",
    autoRenewing: line.autoRenewingPlan?.autoRenewEnabled === true,
    isAcknowledged: raw.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    orderId: raw.latestOrderId ?? "",
    linkedPurchaseToken: raw.linkedPurchaseToken ?? "",
    obfuscatedAccountId:
      raw.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? "",
    regionCode: raw.regionCode ?? "",
    isTestPurchase: Boolean(raw.testPurchase),
  };
}

/**
 * Tells Google the purchase was honoured. **Three-day deadline.**
 *
 * Acknowledging one that is already acknowledged is not an error worth raising
 * - it is the normal outcome of a retry - so that case returns quietly.
 */
export async function acknowledgeSubscription(
  productId: string,
  purchaseToken: string,
) {
  const packageName = getPlayPackageName();
  const response = await callPlay(
    `/applications/${encodeURIComponent(packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
    { method: "POST", body: JSON.stringify({}) },
  );

  if (response.ok || response.status === 204) {
    return { acknowledged: true as const };
  }

  const detail = await response.text().catch(() => "");

  // Already acknowledged. Play says 400 for this, which is not a failure here.
  if (
    response.status === 400 &&
    /already been acknowledged/i.test(detail)
  ) {
    return { acknowledged: true as const };
  }

  throw new GooglePlayError(
    `Could not acknowledge the purchase (${response.status}). It will be refunded automatically three days after it was made. ${detail.slice(0, 300)}`,
    response.status,
  );
}

/** Play's subscription state, mapped to the status this system stores. */
export function toSubscriptionStatus(state: PlaySubscriptionState) {
  switch (state) {
    case "SUBSCRIPTION_STATE_ACTIVE":
    // Cancelled means auto-renew is off, not that access has ended. The paid
    // period runs to `endsAt` and the row stays active until it does.
    case "SUBSCRIPTION_STATE_CANCELED":
      return "active" as const;
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      return "in_grace_period" as const;
    case "SUBSCRIPTION_STATE_ON_HOLD":
      return "on_hold" as const;
    case "SUBSCRIPTION_STATE_PAUSED":
      return "paused" as const;
    case "SUBSCRIPTION_STATE_EXPIRED":
      return "expired" as const;
    case "SUBSCRIPTION_STATE_PENDING":
      return "pending" as const;
    default:
      return "pending" as const;
  }
}

/** Whether a state means the member may open premium content right now. */
export function stateGrantsAccess(state: PlaySubscriptionState) {
  return (
    state === "SUBSCRIPTION_STATE_ACTIVE" ||
    state === "SUBSCRIPTION_STATE_CANCELED" ||
    state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
  );
}
