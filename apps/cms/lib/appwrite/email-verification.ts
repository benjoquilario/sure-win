/**
 * Completes a member's email verification from the link in their inbox.
 *
 * The verification email links here rather than into the app. The app-only
 * route (a bridge page that bounced to `reviewer://verify-email`) failed for
 * anyone who opened the email on a computer, in a mail client's in-app
 * browser that blocks custom schemes, or before installing the app: they sat
 * on a spinner and were never verified. Here the CMS finishes the job on any
 * device and the app is told afterwards.
 *
 * No session and no API key are needed for the step itself. Appwrite's
 * `PUT /account/verification` is a public endpoint — the `secret` from the
 * email is the proof of ownership, checked against the user's stored token —
 * so it runs on a plain project client.
 *
 * **Mail scanners.** Outlook Safe Links, Gmail and corporate gateways often
 * open every link in an email before the person does. That uses the token, so
 * the member's own click arrives with a spent secret and Appwrite answers
 * "invalid token". The account *is* verified, though — the scanner did it. So
 * an invalid token is followed by a look at the account (server key), and an
 * already-verified one is reported as success rather than as a dead link.
 */

import { Account, AppwriteException } from "node-appwrite";

import { hasAppwritePublicEnv, hasAppwriteServerEnv } from "./env";
import { createPublicServerClient, getAdminServices } from "./server";

export type EmailVerificationOutcome =
  /** Verified by this request. */
  | "verified"
  /** The token was spent, but the account is verified — by an earlier click or a mail scanner. */
  | "already-verified"
  /** The token is used up or past its seven days, and the account is not verified. */
  | "expired"
  /** The link is missing its parameters or they are malformed. */
  | "invalid-link"
  /** Appwrite could not be reached, or the CMS is not configured. Worth retrying. */
  | "unavailable";

/** Appwrite ids: up to 36 of a-z, A-Z, 0-9, period, hyphen, underscore. */
const USER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/;
const MAX_SECRET_LENGTH = 512;

function readParam(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

async function isAlreadyVerified(userId: string) {
  if (!hasAppwriteServerEnv()) {
    return false;
  }

  try {
    const user = await getAdminServices().users.get({ userId });
    return user.emailVerification === true;
  } catch {
    return false;
  }
}

export async function completeEmailVerificationFromLink(params: {
  userId?: string | string[];
  secret?: string | string[];
}): Promise<EmailVerificationOutcome> {
  const userId = readParam(params.userId);
  const secret = readParam(params.secret);

  if (
    !USER_ID_PATTERN.test(userId) ||
    !secret ||
    secret.length > MAX_SECRET_LENGTH
  ) {
    return "invalid-link";
  }

  if (!hasAppwritePublicEnv()) {
    return "unavailable";
  }

  try {
    await new Account(createPublicServerClient()).updateEmailVerification({
      userId,
      secret,
    });
    return "verified";
  } catch (error) {
    const code = error instanceof AppwriteException ? error.code : 0;

    // 401 is a spent or wrong secret; 404 an unknown user. Neither is worth
    // retrying, but either may hide an account that is already verified.
    if (code === 401 || code === 404 || code === 400) {
      return (await isAlreadyVerified(userId)) ? "already-verified" : "expired";
    }

    console.error(
      "[verify-email] could not complete verification:",
      error instanceof Error ? error.message : error,
    );
    return "unavailable";
  }
}
