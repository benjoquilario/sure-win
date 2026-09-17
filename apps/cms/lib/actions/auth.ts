"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { Account, AppwriteException } from "node-appwrite";
import { z } from "zod";

import {
  clearSessionCookie,
  getSessionSecret,
  resolveCmsUserFromAccount,
  setSessionCookie,
} from "@/lib/appwrite/auth";
import { hasAppwritePublicEnv, hasAppwriteServerEnv } from "@/lib/appwrite/env";
import {
  createPublicServerClient,
  getAdminServices,
  getSessionServices,
} from "@/lib/appwrite/server";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function loginWithEmailPassword(formData: FormData) {
  if (!hasAppwritePublicEnv() || !hasAppwriteServerEnv()) {
    redirect("/login?error=config");
  }

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect(
      `/login?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid login payload")}`,
    );
  }

  try {
    const account = new Account(createPublicServerClient());
    const validationSession = await account.createEmailPasswordSession({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    const userId = validationSession.userId;

    if (!userId) {
      redirect(
        "/login?error=Unable to resolve the Appwrite user for this session.",
      );
    }

    const { users } = getAdminServices();
    const session = await users.createSession({ userId });
    const sessionSecret = session.secret;

    await users
      .deleteSession({ userId, sessionId: validationSession.$id })
      .catch(() => undefined);

    if (!sessionSecret) {
      redirect("/login?error=session_secret_missing");
    }

    const sessionServices = getSessionServices(sessionSecret);
    const accountUser = await sessionServices.account.get();
    const cmsUser = await resolveCmsUserFromAccount(accountUser);

    if (!cmsUser) {
      await sessionServices.account
        .deleteSession({ sessionId: "current" })
        .catch(() => undefined);
      await clearSessionCookie();
      redirect("/login?error=unauthorized");
    }

    await setSessionCookie(sessionSecret);
  } catch (error) {
    unstable_rethrow(error);

    const message =
      error instanceof AppwriteException && error.code === 401
        ? "Invalid credentials. Please check the email and password."
        : error instanceof Error
          ? error.message
          : "Unable to sign in.";

    redirect(`/login?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard");
}

export async function logout() {
  const sessionSecret = await getSessionSecret();

  if (sessionSecret) {
    const sessionServices = getSessionServices(sessionSecret);
    await sessionServices.account
      .deleteSession({ sessionId: "current" })
      .catch(() => undefined);
  }

  await clearSessionCookie();
  redirect("/login");
}
