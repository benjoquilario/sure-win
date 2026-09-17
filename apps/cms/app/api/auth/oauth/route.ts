import { NextRequest, NextResponse } from "next/server";
import { Account, AppwriteException, OAuthProvider } from "node-appwrite";

import { getBaseUrl, hasAppwritePublicEnv } from "@/lib/appwrite/env";
import { createPublicServerClient } from "@/lib/appwrite/server";

const providerMap: Record<string, OAuthProvider> = {
  google: OAuthProvider.Google,
  microsoft: OAuthProvider.Microsoft,
  github: OAuthProvider.Github,
  apple: OAuthProvider.Apple,
};

export async function GET(request: NextRequest) {
  const providerKey = request.nextUrl.searchParams.get("provider") ?? "google";
  const provider = providerMap[providerKey];

  if (!provider || !hasAppwritePublicEnv()) {
    return NextResponse.redirect(new URL("/login?error=config", request.url));
  }

  const account = new Account(createPublicServerClient());
  const baseUrl = getBaseUrl(request.nextUrl.origin);
  const successUrl = `${baseUrl}/api/auth/callback`;
  const failureUrl = `${baseUrl}/login?error=oauth_failed`;

  try {
    const redirectUrl = await account.createOAuth2Token({
      provider,
      success: successUrl,
      failure: failureUrl,
    });

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    const errorKey =
      error instanceof AppwriteException && error.code === 412
        ? "oauth_redirect_invalid"
        : "oauth_failed";

    return NextResponse.redirect(
      new URL(`/login?error=${errorKey}`, request.url),
    );
  }
}
