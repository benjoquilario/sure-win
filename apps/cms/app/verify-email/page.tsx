import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { headers } from "next/headers";
import Image from "next/image";
import {
  CircleAlert,
  CircleCheck,
  Clock3,
  Link2Off,
  RotateCw,
  Smartphone,
  type LucideIcon,
} from "lucide-react";

import {
  completeEmailVerificationFromLink,
  type EmailVerificationOutcome,
} from "@/lib/appwrite/email-verification";

/**
 * ─── /verify-email ────────────────────────────────────────────────────────
 *
 * Where the verification email lands. It completes the verification on the
 * server before rendering (see `lib/appwrite/email-verification.ts`), then
 * says what happened and offers one way back into the app.
 *
 * Member-facing, not part of the dashboard: it wears the app's brand — its
 * logo, its font and the logo's colors — on a fixed light surface, rather
 * than the CMS's admin palette or the dashboard's dark mode. Members arrive
 * from an email, usually on a phone, so it is a single centered column sized
 * for one.
 *
 * The URL carries the verification secret, so the page sends no referrer and
 * asks not to be indexed.
 */

export const metadata: Metadata = {
  title: "Verify your email · Social Work Sure Win",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

/** The logo's colors. Mirrors `BRAND` in apps/mobile/lib/theme.ts. */
const BRAND = {
  navy: "#00246e",
  blue: "#0269ed",
  teal: "#019a9d",
  ink: "#0b1a33",
  page: "hsl(200 50% 97%)",
};

const APP_SCHEME = "reviewer";
const ANDROID_PACKAGE = "com.surewin.mobile";

type Tone = "success" | "warning" | "error";

const TONE_STYLE: Record<Tone, { icon: string; ring: string }> = {
  success: { icon: "text-[#019a9d]", ring: "bg-[#019a9d]/12" },
  warning: { icon: "text-amber-600", ring: "bg-amber-100" },
  error: { icon: "text-rose-600", ring: "bg-rose-100" },
};

type Content = {
  tone: Tone;
  Icon: LucideIcon;
  title: string;
  body: string;
  /** What the app is told when it opens: it shows its own matching state. */
  appStatus: "verified" | "expired";
  appLabel: string;
  /** The line under the card — the case the main message does not cover. */
  footnote: string;
};

const CONTENT: Record<EmailVerificationOutcome, Content> = {
  verified: {
    tone: "success",
    Icon: CircleCheck,
    title: "Email verified",
    body: "Thanks — your email address is confirmed. Head back to the app to keep reviewing.",
    appStatus: "verified",
    appLabel: "Open Sure Win",
    footnote:
      "On a computer? You're all set — open Sure Win on your phone. You can close this tab.",
  },
  "already-verified": {
    tone: "success",
    Icon: CircleCheck,
    title: "You're already verified",
    body: "This email address was confirmed earlier, so there's nothing more to do.",
    appStatus: "verified",
    appLabel: "Open Sure Win",
    footnote: "You can close this tab.",
  },
  expired: {
    tone: "warning",
    Icon: Clock3,
    title: "This link has expired",
    body: "Verification links work once and last seven days. Open the app and send yourself a new one from your profile.",
    appStatus: "expired",
    appLabel: "Open Sure Win to resend",
    footnote:
      "Requested more than one link? Only the newest one works — use the latest email.",
  },
  "invalid-link": {
    tone: "warning",
    Icon: Link2Off,
    title: "This link looks incomplete",
    body: "Part of the link seems to be missing. Open it straight from the email, or send a new one from the app.",
    appStatus: "expired",
    appLabel: "Open Sure Win",
    footnote:
      "Copying the link by hand can cut it short — tapping it in the email is safest.",
  },
  unavailable: {
    tone: "error",
    Icon: CircleAlert,
    title: "We couldn't verify you just now",
    body: "Something on our side didn't respond. Your link is still good — try again in a moment.",
    appStatus: "expired",
    appLabel: "Open Sure Win",
    footnote: "If this keeps happening, send a new link from the app.",
  },
};

/**
 * The way back into the app. On Android an `intent:` URL, which opens the app
 * when it is installed and its Play Store page when it is not — a bare custom
 * scheme does nothing at all in the second case. Elsewhere, the scheme.
 */
function buildAppLink(status: Content["appStatus"], isAndroid: boolean) {
  const path = `verify-email?status=${status}`;

  return isAndroid
    ? `intent://${path}#Intent;scheme=${APP_SCHEME};package=${ANDROID_PACKAGE};end`
    : `${APP_SCHEME}://${path}`;
}

type VerifyEmailPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function VerifyEmailPage({
  searchParams,
}: VerifyEmailPageProps) {
  const params = await searchParams;
  const outcome = await completeEmailVerificationFromLink({
    userId: params.userId,
    secret: params.secret,
  });
  const userAgent = (await headers()).get("user-agent") ?? "";
  const content = CONTENT[outcome];
  const tone = TONE_STYLE[content.tone];
  const appLink = buildAppLink(content.appStatus, /android/i.test(userAgent));

  // Same link, same parameters: Appwrite was the problem, not the link.
  const retryHref =
    outcome === "unavailable"
      ? `/verify-email?${new URLSearchParams({
          userId: String(params.userId ?? ""),
          secret: String(params.secret ?? ""),
        }).toString()}`
      : null;

  return (
    <main
      className={`${jakarta.className} flex min-h-screen w-full items-center justify-center px-4 py-10`}
      style={{ background: BRAND.page, color: BRAND.ink }}
    >
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Image
            src="/brand/sure-win-logo.png"
            alt="Social Work Sure Win"
            width={76}
            height={76}
            priority
            className="rounded-2xl"
          />
        </div>

        <section
          aria-live="polite"
          className="overflow-hidden rounded-3xl bg-white shadow-[0_24px_60px_-28px_rgba(0,36,110,0.35)] ring-1 ring-[#00246e]/8"
        >
          <div className="flex flex-col items-center gap-4 px-6 pb-7 pt-8 text-center sm:px-8">
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-full ${tone.ring}`}
            >
              <content.Icon
                aria-hidden
                className={`h-8 w-8 ${tone.icon}`}
                strokeWidth={2.4}
              />
            </div>

            <div className="space-y-2">
              <h1
                className="text-[26px] font-extrabold leading-8 tracking-tight"
                style={{ color: BRAND.navy }}
              >
                {content.title}
              </h1>
              <p className="text-[15px] font-medium leading-6 text-slate-600">
                {content.body}
              </p>
            </div>

            <div className="mt-2 flex w-full flex-col gap-2.5">
              {retryHref ? (
                <a
                  href={retryHref}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold text-white transition hover:opacity-95 active:scale-[0.99]"
                  style={{ background: BRAND.blue }}
                >
                  <RotateCw aria-hidden className="h-[18px] w-[18px]" />
                  Try again
                </a>
              ) : null}

              <a
                href={appLink}
                className={
                  retryHref
                    ? "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-[15px] font-bold transition hover:bg-slate-50 active:scale-[0.99]"
                    : "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold text-white transition hover:opacity-95 active:scale-[0.99]"
                }
                style={
                  retryHref
                    ? { color: BRAND.navy }
                    : { background: BRAND.blue }
                }
              >
                <Smartphone aria-hidden className="h-[18px] w-[18px]" />
                {content.appLabel}
              </a>
            </div>
          </div>

          <p className="border-t border-slate-100 bg-slate-50/80 px-6 py-4 text-center text-[13px] font-medium leading-5 text-slate-500">
            {content.footnote}
          </p>
        </section>

        <p className="mt-6 text-center text-xs font-medium text-slate-400">
          Social Work Sure Win · Board exam reviewer
        </p>
      </div>
    </main>
  );
}
