import { NextRequest, NextResponse } from "next/server";
import { Account } from "node-appwrite";

import {
  clearSessionCookie,
  resolveCmsUserFromAccount,
  setSessionCookie,
} from "@/lib/appwrite/auth";
import {
  createPublicServerClient,
  getSessionServices,
} from "@/lib/appwrite/server";

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId");
  const secret = request.nextUrl.searchParams.get("secret");

  if (!userId || !secret) {
    return NextResponse.redirect(
      new URL("/login?error=oauth_failed", request.url),
    );
  }

  try {
    const account = new Account(createPublicServerClient());
    const session = await account.createSession({ userId, secret });
    const sessionSecret = session.secret ?? secret;
    const sessionServices = getSessionServices(sessionSecret);
    const accountUser = await sessionServices.account.get();
    const cmsUser = await resolveCmsUserFromAccount(accountUser);

    if (!cmsUser) {
      await sessionServices.account
        .deleteSession({ sessionId: "current" })
        .catch(() => undefined);
      await clearSessionCookie();
      return NextResponse.redirect(
        new URL("/login?error=unauthorized", request.url),
      );
    }

    await setSessionCookie(sessionSecret);

    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch {
    await clearSessionCookie();
    return NextResponse.redirect(
      new URL("/login?error=oauth_failed", request.url),
    );
  }
}
