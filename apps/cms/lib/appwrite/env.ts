const defaultDatabaseId = "social_work_reviewer";
const defaultAssetsBucketId = "reviewer_assets";
const defaultSessionCookie = "cms-reviewer-session";
const defaultAppUrl = "http://localhost:3000";

function parseList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export const appwriteEnv = {
  endpoint: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ?? "",
  projectId: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ?? "",
  projectName:
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_NAME ?? "Social Work Reviewer",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
  apiKey: process.env.APPWRITE_API_KEY ?? "",
  databaseId: process.env.APPWRITE_DATABASE_ID ?? defaultDatabaseId,
  assetsBucketId:
    process.env.APPWRITE_ASSETS_BUCKET_ID ?? defaultAssetsBucketId,
  sessionCookieName:
    process.env.APPWRITE_SESSION_COOKIE ?? defaultSessionCookie,
  // The way back in. These lists grant dashboard access by email before any
  // role row exists, and cannot be revoked from the UI - which is the point:
  // a locked-out owner needs a door that the dashboard does not control.
  superAdminEmails: parseList(process.env.APPWRITE_CMS_SUPER_ADMIN_EMAILS),
  adminEmails: parseList(process.env.APPWRITE_CMS_ADMIN_EMAILS),
  moderatorEmails: parseList(process.env.APPWRITE_CMS_MODERATOR_EMAILS),
  encoderEmails: parseList(process.env.APPWRITE_CMS_ENCODER_EMAILS),
};

export function hasAppwritePublicEnv() {
  return Boolean(appwriteEnv.endpoint && appwriteEnv.projectId);
}

export function hasAppwriteServerEnv() {
  return Boolean(
    hasAppwritePublicEnv() && appwriteEnv.apiKey && appwriteEnv.databaseId,
  );
}

export function getBaseUrl(fallbackOrigin?: string) {
  return (appwriteEnv.appUrl || fallbackOrigin || defaultAppUrl).replace(
    /\/$/,
    "",
  );
}

export function getEnvironmentWarnings() {
  const warnings: string[] = [];

  if (!appwriteEnv.endpoint) {
    warnings.push("NEXT_PUBLIC_APPWRITE_ENDPOINT is missing.");
  }

  if (!appwriteEnv.projectId) {
    warnings.push("NEXT_PUBLIC_APPWRITE_PROJECT_ID is missing.");
  }

  if (!appwriteEnv.apiKey) {
    warnings.push(
      "APPWRITE_API_KEY is missing. Admin CRUD, role checks, bootstrap, and notifications will not work.",
    );
  }

  if (!appwriteEnv.databaseId) {
    warnings.push("APPWRITE_DATABASE_ID is missing.");
  }

  if (!appwriteEnv.superAdminEmails.length && !appwriteEnv.adminEmails.length) {
    warnings.push(
      "Neither APPWRITE_CMS_SUPER_ADMIN_EMAILS nor APPWRITE_CMS_ADMIN_EMAILS is set. If the super admin row in user_roles is ever lost, nobody will be able to grant it back.",
    );
  } else if (!appwriteEnv.superAdminEmails.length) {
    warnings.push(
      "APPWRITE_CMS_SUPER_ADMIN_EMAILS is not set, so APPWRITE_CMS_ADMIN_EMAILS is being treated as the super admin list. Set it explicitly to separate the two.",
    );
  }

  return warnings;
}

/**
 * What Google Play billing needs, and what breaks without each.
 *
 * Separate from `getEnvironmentWarnings` because billing being unconfigured is
 * normal until the Play account exists, and a permanent warning nobody can act
 * on is a warning people learn to scroll past.
 */
export function getBillingWarnings() {
  const warnings: string[] = [];

  if (!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim()) {
    warnings.push(
      "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is missing. Purchases cannot be verified or acknowledged, and Google refunds any purchase not acknowledged within three days.",
    );
  }

  if (!process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim()) {
    warnings.push(
      "GOOGLE_PLAY_PACKAGE_NAME is missing. Verification cannot name the app, and notifications cannot be checked against it.",
    );
  }

  if (!process.env.GOOGLE_PLAY_PUBSUB_TOKEN?.trim()) {
    warnings.push(
      "GOOGLE_PLAY_PUBSUB_TOKEN is missing, so /api/billing/notifications refuses every message. Renewals, cancellations and refunds will never arrive.",
    );
  }

  return warnings;
}
